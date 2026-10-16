"""Tenant data loader: MERGE, SCD2, and batch-commit logic."""

import json
import logging
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from .client import ControlPlaneClient
from .dead_letter import DeadLetterWriter
from .extract import DataExtractor, _validate_column_name, _validate_table_name
from .schema_graph import (
    FACT_TYPES, EntityInfo, SchemaGraph, deduplicate_rows, validate_required,
    default_for_type, NULLABLE_TYPES,
)
from .transform import _LookupRef, _tr_date_key

logger = logging.getLogger("smartops.etl.load")

try:
    import pyodbc
    # Re-enable connection pooling for performance (saves ~500ms per connection).
    # IDENTITY_INSERT state is explicitly reset per-entity in _load_entity_with_pks.
    pyodbc.pooling = True
except ImportError:
    pyodbc = None  # type: ignore

_SAFE_IDENT = re.compile(r'^\w+$')
_AND_JOIN = " AND "
_COMM_LINK_ERROR = "Communication link"
_CONN_ERROR_08S01 = "08S01"
_NO_NONNULL_COLS_MSG = "no non-null columns"
_ROLLBACK_BATCH_SQL = "ROLLBACK TRANSACTION etl_batch"
_DECIMAL_28_6_CAST = "DECIMAL(28,6)"
_ERR_547 = "(547)"
_ERR_2627 = "(2627)"
_ERR_2601 = "(2601)"
_ERR_23000 = "(23000)"
BATCH_COMMIT_SIZE: int = int(os.environ.get("ETL_BATCH_COMMIT_SIZE", "5000"))
BATCH_INSERT_SIZE: int = int(os.environ.get("ETL_BATCH_INSERT_SIZE", "2000"))
DEAD_LETTER_DIR = Path(os.environ.get("ETL_DEAD_LETTER_DIR", str(Path(__file__).resolve().parents[1] / "dead_letter")))
PRELOAD_DIR = Path(os.environ.get("ETL_PRELOAD_DIR", str(Path(__file__).resolve().parents[1] / "preload")))
ENABLE_PRELOAD: bool = os.environ.get("ETL_ENABLE_PRELOAD", "0").lower() in ("1", "true", "yes")
ENABLE_DEAD_LETTER: bool = os.environ.get("ETL_ENABLE_DEAD_LETTER", "0").lower() in ("1", "true", "yes")
ENABLE_BATCH_MODE: bool = os.environ.get("ETL_ENABLE_BATCH_MODE", "1").lower() in ("1", "true", "yes")


class MergeBuilder:
    """Generates and caches SQL statements keyed by (table, col-set)."""

    _SYS: frozenset[str] = frozenset({"created_at", "is_active", "source_system_id"})

    def __init__(self) -> None:
        self._cache: dict[tuple, str] = {}

    def build_merge(self, sql_table: str, row_columns: list[str], unique_cols: frozenset,
                    db_columns: frozenset[str] | None = None,
                    identity_col: str | None = None) -> str:
        ck = (sql_table, "m", tuple(row_columns), tuple(sorted(db_columns)) if db_columns else None, identity_col)
        if ck in self._cache:
            return self._cache[ck]
        using    = ", ".join(f"? AS [{c}]" for c in row_columns)
        src_list = ", ".join(f"[{c}]" for c in row_columns)
        # Use NULL-safe comparison: (a = b OR (a IS NULL AND b IS NULL))
        on_parts = []
        for c in sorted(unique_cols):
            on_parts.append(
                f"(target.[{c}] = src.[{c}] OR (target.[{c}] IS NULL AND src.[{c}] IS NULL))"
            )
        on       = _AND_JOIN.join(on_parts)
        # Exclude identity column from UPDATE (can't update identity columns)
        no_update = unique_cols | self._SYS | ({identity_col} if identity_col else set())
        upd_cols = [c for c in row_columns if c not in no_update]
        # Only include modified_at if the table actually has that column
        has_modified_at = db_columns is None or "modified_at" in db_columns
        if upd_cols:
            upd = ", ".join(f"[{c}] = src.[{c}]" for c in upd_cols)
            if has_modified_at:
                upd += ", [modified_at] = SYSUTCDATETIME()"
        else:
            upd = "[modified_at] = SYSUTCDATETIME()" if has_modified_at else "[source_system_id] = src.[source_system_id]"
        ins_cols = ", ".join(f"[{c}]" for c in row_columns)
        ins_vals = ", ".join(f"src.[{c}]" for c in row_columns)
        sql = (
            f"MERGE INTO {sql_table} AS target\n"
            f"USING (SELECT {using}) AS src({src_list})\n"
            f"ON {on}\n"
            f"WHEN MATCHED THEN UPDATE SET {upd}\n"
            f"WHEN NOT MATCHED THEN INSERT ({ins_cols}) VALUES ({ins_vals});"
        )
        self._cache[ck] = sql
        return sql

    def build_scd2_close(self, sql_table: str, natural_key: str) -> str:
        ck = (sql_table, "sc", natural_key)
        if ck not in self._cache:
            self._cache[ck] = (
                f"UPDATE {sql_table} SET [is_current]=0, "
                f"[effective_end_date]=SYSUTCDATETIME(), [modified_at]=SYSUTCDATETIME() "
                f"WHERE [{natural_key}]=? AND [is_current]=1"
            )
        return self._cache[ck]

    def build_scd2_insert(self, sql_table: str, row_columns: list[str]) -> str:
        ck = (sql_table, "si", tuple(row_columns))
        if ck not in self._cache:
            cols = ", ".join(f"[{c}]" for c in row_columns)
            ph   = ", ".join("?" for _ in row_columns)
            self._cache[ck] = (
                f"INSERT INTO {sql_table} ({cols}, [is_current], [effective_start_date], [created_at]) "
                f"VALUES ({ph}, 1, SYSUTCDATETIME(), SYSUTCDATETIME())"
            )
        return self._cache[ck]

    def build_fact_insert(self, sql_table: str, row_columns: list[str]) -> str:
        ck = (sql_table, "fi", tuple(row_columns))
        if ck not in self._cache:
            cols = ", ".join(f"[{c}]" for c in row_columns)
            ph   = ", ".join("?" for _ in row_columns)
            self._cache[ck] = f"INSERT INTO {sql_table} ({cols}) VALUES ({ph})"
        return self._cache[ck]


def _find_parent_for_fk(fk_field: str, info: EntityInfo, graph: SchemaGraph) -> str | None:
    """
    Determine which parent sql_table a FK field references using the schema graph's FK deps.
    Returns the parent sql_table string or None.
    """
    # The FK deps are stored as {child_table: set(parent_tables)}
    # We need to match fk_field to a specific parent. Heuristic:
    # The fk_field name usually matches the parent entity's identity_col.
    for parent_table in graph._fk_deps.get(info.sql_table, set()):
        parent_info = graph.get(parent_table)
        if parent_info and parent_info.identity_col == fk_field:
            return parent_table
    # Fallback: check if any parent has a field with matching name
    for parent_table in graph._fk_deps.get(info.sql_table, set()):
        parent_info = graph.get(parent_table)
        if parent_info and fk_field in parent_info.field_types:
            return parent_table
    return None


def _direct_parent_lookup(
    fk_field: str, existing: Any, fk_context: dict,
    info: EntityInfo, graph: SchemaGraph,
    pk_cache: dict[str, dict[Any, Any]],
) -> tuple[Any, str | None]:
    """Strategy 1: Direct parent lookup via schema graph. Returns (result, parent_table)."""
    parent_table = _find_parent_for_fk(fk_field, info, graph)
    if not parent_table or parent_table not in pk_cache:
        return None, parent_table
    parent_cache = pk_cache[parent_table]
    parent_ctx = fk_context.get(parent_table, {})
    for bk_val in parent_ctx.values():
        if bk_val in parent_cache:
            return parent_cache[bk_val], parent_table
    if existing is not None and existing in parent_cache:
        return parent_cache[existing], parent_table
    return None, parent_table


def _collect_context_values(
    fk_context: dict, pk_cache: dict[str, dict[Any, Any]], existing: Any,
) -> set[Any]:
    """Collect starting resolved values from fk_context caches."""
    resolved: set[Any] = set()
    for ctx_table, ctx_vals in fk_context.items():
        if ctx_table not in pk_cache:
            continue
        cache = pk_cache[ctx_table]
        for bk_val in ctx_vals.values():
            if bk_val in cache:
                resolved.add(cache[bk_val])
    if existing is not None:
        resolved.add(existing)
    return resolved


def _expand_through_hops(
    resolved_values: set[Any], pk_cache: dict[str, dict[Any, Any]],
) -> set[Any]:
    """Expand resolved values through intermediate caches (max 3 hops)."""
    for _hop in range(3):
        next_vals: set[Any] = set()
        for cache in pk_cache.values():
            for val in resolved_values:
                if val in cache:
                    next_vals.add(cache[val])
        if not next_vals - resolved_values:
            break
        resolved_values |= next_vals
    return resolved_values


def _find_in_cache(values: set[Any], target_cache: dict[Any, Any]) -> Any:
    """Find first value that exists in target cache."""
    for val in values:
        if val in target_cache:
            return target_cache[val]
    return None


def _resolve_fk_from_cache(
    fk_field: str, existing: Any, fk_context: dict,
    info: EntityInfo, graph: SchemaGraph,
    pk_cache: dict[str, dict[Any, Any]],
) -> int | None:
    """
    Try to resolve a single FK field value from the progressive pk_cache.
    Supports chained resolution (e.g., pdo_well_id → well_key → well_scope_key).
    """
    result, parent_table = _direct_parent_lookup(fk_field, existing, fk_context, info, graph, pk_cache)
    if result is not None:
        return result
    if not parent_table or parent_table not in pk_cache:
        return None
    target_cache = pk_cache[parent_table]
    resolved_values = _collect_context_values(fk_context, pk_cache, existing)
    found = _find_in_cache(resolved_values, target_cache)
    if found is not None:
        return found
    resolved_values = _expand_through_hops(resolved_values, pk_cache)
    return _find_in_cache(resolved_values, target_cache)


class TenantLoader:
    """Owns the Load phase: remap, validate, and write to tenant DB."""

    def __init__(self, client: ControlPlaneClient) -> None:
        self._client = client
        self._merger = MergeBuilder()
        self._db_col_types_cache: dict[str, dict[str, str]] = {}
        self._db_not_null_cache: dict[str, set[str]] = {}
        self._db_col_precision_cache: dict[str, dict[str, tuple[int, int]]] = {}
        self._last_row_error: str = ""

    def load(
        self,
        tenant_source: dict,
        transformed_data: list[dict],
        run_id: int | None,
        full_refresh: bool,
        field_meta: dict[int, dict] | None = None,
        graph: "SchemaGraph | None" = None,
    ) -> tuple[int, int]:
        """Execute the load phase. Returns (rows_loaded, rows_failed).

        Args:
            field_meta: Pre-built field metadata dict. If None, fetched from API.
            graph: Pre-built SchemaGraph. If None, fetched from API.
        """
        ts_id = tenant_source.get("tenantSourceId")
        logger.info("Load tenant_source=%s rows=%d full_refresh=%s", ts_id, len(transformed_data), full_refresh)

        if not transformed_data:
            return 0, 0
        if pyodbc is None:
            raise HTTPException(503, "pyodbc not installed")

        ref = self._resolve_ref(tenant_source, ts_id)
        # Use pre-built metadata if provided (avoids redundant API calls)
        if field_meta is not None and graph is not None:
            pass  # already have both
        else:
            field_meta, graph = self.build_metadata()
        source_sys_id     = tenant_source.get("sourceSystemId")
        entity_rows       = self._remap(transformed_data, field_meta, graph, source_sys_id)

        if not entity_rows:
            logger.warning("No rows mapped to any entity (tenant_source=%s)", ts_id)
            return 0, 0

        logger.info("Target entities: %d tables queued for load", len(entity_rows))

        # Write pre-load snapshot for verification (disabled by default)
        if ENABLE_PRELOAD:
            self._dump_preload(run_id, entity_rows)

        conn_str = DataExtractor.norm_conn(ref)

        if ENABLE_DEAD_LETTER:
            with DeadLetterWriter(run_id, DEAD_LETTER_DIR) as dl:
                loaded, failed = self._write(conn_str, entity_rows, graph, source_sys_id, full_refresh, dl)
            if dl_sum := dl.summary():
                total_rejected = sum(dl_sum.values())
                logger.warning("")
                logger.warning("  DEAD-LETTER REPORT: %d row(s) rejected across %d entities",
                               total_rejected, len(dl_sum))
                for tbl, cnt in dl_sum.items():
                    logger.warning("    • %s — %d rejected row(s)  → see dead_letter/ for details", tbl, cnt)
        else:
            with DeadLetterWriter(run_id, DEAD_LETTER_DIR) as dl:
                loaded, failed = self._write(conn_str, entity_rows, graph, source_sys_id, full_refresh, dl)

        return loaded, failed

    def load_entity_rows(
        self,
        tenant_source: dict,
        entity_rows: dict[str, list[dict]],
        run_id: int | None,
        full_refresh: bool,
        field_meta: dict[int, dict] | None = None,
        graph: "SchemaGraph | None" = None,
    ) -> tuple[int, int]:
        """Load pre-remapped entity rows directly (used by streaming pipeline).

        Skips the remap step since entity_rows are already grouped by sql_table.
        Returns (rows_loaded, rows_failed).
        """
        ts_id = tenant_source.get("tenantSourceId")
        total_rows = sum(len(v) for v in entity_rows.values())
        logger.info("Load (streaming) tenant_source=%s rows=%d full_refresh=%s", ts_id, total_rows, full_refresh)

        if not entity_rows:
            return 0, 0
        if pyodbc is None:
            raise HTTPException(503, "pyodbc not installed")

        ref = self._resolve_ref(tenant_source, ts_id)
        if field_meta is None or graph is None:
            field_meta, graph = self.build_metadata()
        source_sys_id = tenant_source.get("sourceSystemId")

        logger.info("Target entities: %d tables queued for load", len(entity_rows))

        if ENABLE_PRELOAD:
            self._dump_preload(run_id, entity_rows)

        conn_str = DataExtractor.norm_conn(ref)

        with DeadLetterWriter(run_id, DEAD_LETTER_DIR) as dl:
            loaded, failed = self._write(conn_str, entity_rows, graph, source_sys_id, full_refresh, dl)
            if ENABLE_DEAD_LETTER:
                if dl_sum := dl.summary():
                    total_rejected = sum(dl_sum.values())
                    logger.warning("")
                    logger.warning("  DEAD-LETTER REPORT: %d row(s) rejected across %d entities",
                                   total_rejected, len(dl_sum))
                    for tbl, cnt in dl_sum.items():
                        logger.warning("    • %s — %d rejected row(s)  → see dead_letter/ for details", tbl, cnt)

        return loaded, failed

    @staticmethod
    def _dump_preload(run_id: int | None, entity_rows: dict[str, list[dict]]) -> None:
        """Write mapped data to JSONL files for pre-insertion verification."""
        PRELOAD_DIR.mkdir(parents=True, exist_ok=True)
        ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        rid = run_id or 0
        for sql_table, rows in entity_rows.items():
            safe = re.sub(r"[\[\]\.]", "_", sql_table).strip("_")
            path = PRELOAD_DIR / f"run_{rid}_{safe}_{ts}.jsonl"
            with open(path, "w", encoding="utf-8") as fh:
                for row in rows:
                    fh.write(json.dumps(row, default=str) + "\n")
        total_rows = sum(len(r) for r in entity_rows.values())
        logger.info("Pre-load snapshot: %d entities, %d total rows → %s/run_%s_*",
                     len(entity_rows), total_rows, PRELOAD_DIR.name, rid)

    def build_metadata(self) -> tuple[dict[int, dict], SchemaGraph]:
        """Fetch canonical metadata and build field_meta lookup + SchemaGraph."""
        cf_list = self._client.get_canonical_fields()
        ce_list = self._client.get_canonical_entities()
        return self.build_metadata_from(cf_list, ce_list)

    def build_metadata_from(
        self, cf_list: list[dict], ce_list: list[dict],
    ) -> tuple[dict[int, dict], SchemaGraph]:
        """Build field_meta lookup + SchemaGraph from pre-fetched API data (no API calls)."""
        field_meta: dict[int, dict] = {
            cf["canonicalFieldId"]: {
                "fieldName":  cf["fieldName"],
                "entityId":   cf["canonicalEntityId"],
                "isRequired": bool(cf.get("isRequired", False)),
                "isUnique":   bool(cf.get("isUnique",   False)),
            }
            for cf in cf_list if cf.get("isActive")
        }
        graph = SchemaGraph.build(cf_list, ce_list)
        return field_meta, graph

    def _resolve_ref(self, tenant_source: dict, ts_id: Any) -> str:
        tid = tenant_source.get("tenantId")
        if not tid:
            raise ValueError(f"tenant_source={ts_id} missing tenantId")
        tenant = self._client.get_tenant(tid)
        if tenant is None:
            raise ValueError(f"Tenant {tid} not found in Control Plane")
        ref = tenant.get("dataPlaneRef")
        if not ref:
            raise ValueError(f"Tenant {tid} has no dataPlaneRef configured")
        return ref

    def _remap(
        self, data: list[dict], field_meta: dict[int, dict],
        graph: SchemaGraph, source_sys_id: Any,
    ) -> dict[str, list[dict]]:
        eid_map = graph.entity_id_map()
        entity_rows: dict[str, list[dict]] = {}
        for row in data:
            sub = self._remap_single_row(row, field_meta, eid_map)
            # Propagate FK context: each child row gets the parent's business key values
            # from the same source row so the loader can resolve FKs from tenant DB
            self._attach_fk_context(sub, graph)
            for sql_table, row_data in sub.items():
                if source_sys_id is not None:
                    row_data["source_system_id"] = source_sys_id
                entity_rows.setdefault(sql_table, []).append(row_data)
        return entity_rows

    @staticmethod
    def _attach_fk_context(sub: dict[str, dict], graph: SchemaGraph) -> None:
        """
        Attach _fk_context to each entity sub-row so the loader can resolve FK fields
        from parent tables in the tenant DB. The context contains each parent entity's
        unique/business key values from the same source row.
        """
        # Build context: for each entity that has unique keys, record the values
        context: dict[str, dict[str, Any]] = {}  # {sql_table: {field_name: value}}
        for sql_table, row_data in sub.items():
            info = graph.get(sql_table)
            if info is None:
                continue
            # Record unique key fields + natural key values for this entity
            bk_values: dict[str, Any] = {}
            for uk_field in info.unique_keys:
                if uk_field in row_data and row_data[uk_field] is not None:
                    bk_values[uk_field] = row_data[uk_field]
            if info.natural_key and info.natural_key in row_data:
                bk_values[info.natural_key] = row_data[info.natural_key]
            if bk_values:
                context[sql_table] = bk_values

        # Attach context to all rows
        for sql_table, row_data in sub.items():
            row_data["_fk_context"] = context

    @staticmethod
    def _remap_single_row(
        row: dict, field_meta: dict[int, dict], eid_map: dict[int, str],
    ) -> dict[str, dict]:
        sub: dict[str, dict] = {}
        for key, value in row.items():
            if not key.startswith("field_"):
                continue
            try:
                fid = int(key[6:])
            except ValueError:
                continue
            meta      = field_meta.get(fid)
            sql_table = eid_map.get(meta["entityId"]) if meta else None
            if sql_table is None:
                continue
            sub.setdefault(sql_table, {})[meta["fieldName"]] = value
        return sub

    def _write(
        self, conn_str: str, entity_rows: dict[str, list[dict]],
        graph: SchemaGraph, source_sys_id: Any, full_refresh: bool, dl: DeadLetterWriter,
    ) -> tuple[int, int]:
        # ── STEP 1: Pre-verify all entity data in Python (no DB needed) ──
        verified = self._pre_verify_all(entity_rows, graph, dl)

        conn = pyodbc.connect(conn_str, timeout=60)
        try:
            cursor = conn.cursor()
            cursor.fast_executemany = True

            # ── STEP 2: Clear target + seed reference data ──
            if full_refresh and source_sys_id is not None:
                self._delete_for_full_refresh(cursor, graph, source_sys_id, entity_rows)
            self._seed_reference_data(cursor)
            conn.commit()

            # ── STEP 3: Bulk INSERT verified data ──
            total_loaded, total_failed, conn = self._bulk_insert_verified(
                conn, cursor, verified, graph, dl, conn_str=conn_str,
                full_refresh=full_refresh,
            )
            try:
                conn.commit()
            except Exception:
                pass
            logger.info("Load phase complete: %d loaded, %d failed", total_loaded, total_failed)
        except Exception:
            logger.error("Fatal DB error during load — rolling back transaction")
            try:
                conn.rollback()
            except Exception:
                pass
            raise
        finally:
            try:
                conn.close()
            except Exception:
                pass
        return total_loaded, total_failed

    def _pre_verify_all(
        self, entity_rows: dict[str, list[dict]], graph: SchemaGraph, _dl: DeadLetterWriter,
    ) -> dict[str, list[dict]]:
        """Pre-verify ALL entity rows in Python before touching the DB.

        1. Resolves lookups (deferred to load-time cache later)
        2. Deduplicates rows per entity
        3. Validates required fields + applies defaults
        4. Returns {sql_table: verified_rows} ready for bulk INSERT.
        """
        verified: dict[str, list[dict]] = {}
        load_order = [t for t in graph.topological_order() if t in entity_rows]

        for sql_table in load_order:
            rows = entity_rows[sql_table]
            info = graph.get(sql_table)
            if info is None:
                continue
            rows_in = len(rows)

            # Dedup
            dedup_keys = info.unique_keys - {info.identity_col} if info.identity_col else info.unique_keys
            rows, skipped = deduplicate_rows(rows, dedup_keys)
            if skipped:
                logger.info("Verify dedup %s: %d removed (%d → %d)", sql_table, skipped, rows_in, len(rows))

            # Drop rows where ALL merge-key columns are None or empty string
            # (e.g. ref.LiftType row from NULL source well_type)
            if dedup_keys:
                mk_cols = dedup_keys - {"source_system_id"}
                if mk_cols:
                    before = len(rows)
                    rows = [
                        r for r in rows
                        if any(r.get(k) not in (None, "") for k in mk_cols)
                    ]
                    dropped = before - len(rows)
                    if dropped:
                        logger.info("Verify null-key %s: %d row(s) with empty key dropped", sql_table, dropped)

            verified[sql_table] = rows

        total_rows = sum(len(v) for v in verified.values())
        logger.info("Pre-verification: %d entities, %d rows ready for bulk insert", len(verified), total_rows)
        return verified

    @staticmethod
    def _detect_lookup_deps(
        load_order: list[str], entity_rows: dict[str, list[dict]],
    ) -> dict[str, set[str]]:
        """Detect lookup() dependencies from transformed data."""
        lookup_deps: dict[str, set[str]] = {}
        load_set = set(load_order)
        for sql_table in load_set:
            rows = entity_rows.get(sql_table)
            if not rows:
                continue
            for row in rows[:50]:
                for val in row.values():
                    if isinstance(val, _LookupRef) and val.table in load_set and val.table != sql_table:
                        lookup_deps.setdefault(sql_table, set()).add(val.table)
        return lookup_deps

    @staticmethod
    def _reorder_for_deps(
        load_order: list[str], lookup_deps: dict[str, set[str]],
    ) -> list[str]:
        """Re-sort load order to respect lookup dependencies."""
        order = list(load_order)
        for _ in range(len(order)):
            changed = False
            position = {t: i for i, t in enumerate(order)}
            for child, parents in lookup_deps.items():
                if child not in position:
                    continue
                child_pos = position[child]
                max_parent_pos = max(
                    (position[p] for p in parents if p in position),
                    default=-1,
                )
                if max_parent_pos > child_pos:
                    order.remove(child)
                    order.insert(max_parent_pos, child)
                    changed = True
                    break
            if not changed:
                break
        return order

    @staticmethod
    def _adjust_order_for_lookups(
        load_order: list[str], entity_rows: dict[str, list[dict]],
    ) -> list[str]:
        """Detect lookup() dependencies from transformed data and reorder if needed."""
        lookup_deps = TenantLoader._detect_lookup_deps(load_order, entity_rows)
        if not lookup_deps:
            return load_order
        order = TenantLoader._reorder_for_deps(load_order, lookup_deps)
        if order != load_order:
            moved = [t for t, orig in zip(order, load_order) if t != orig]
            if moved:
                logger.info("Load order adjusted for lookup deps: %s", ", ".join(moved[:5]))
        return order

    def _bulk_insert_verified(
        self, conn: Any, cursor: Any, verified: dict[str, list[dict]],
        graph: SchemaGraph, dl: DeadLetterWriter,
        conn_str: str | None = None,
        full_refresh: bool = False,
    ) -> tuple[int, int, Any]:
        """Bulk INSERT pre-verified data. Simpler than staging/MERGE.

        For each entity:
        1. Resolve FK lookups (needs DB connection for cache)
        2. Validate types
        3. Direct executemany INSERT in batches of 1000
        4. Commit after each entity
        """
        total_loaded = total_failed = 0
        pk_cache: dict[str, dict[Any, Any]] = {}
        db_col_cache: dict[str, frozenset[str] | None] = {}
        entity_results: list[tuple[str, int, int, int, float]] = []

        load_order = [t for t in graph.topological_order() if t in verified]

        # Detect lookup() dependencies from transformed rows and adjust load order.
        # Lookup refs reference target DB tables that must be populated before this entity.
        load_order = self._adjust_order_for_lookups(load_order, verified)
        total_entities = len(load_order)

        self._prefetch_db_metadata(cursor, load_order, db_col_cache, graph)

        for entity_idx, sql_table in enumerate(load_order, 1):
            rows = verified[sql_table]
            info = graph.get(sql_table)
            if info is None:
                continue
            rows_in = len(rows)
            logger.info("[%d/%d] Loading %s (%d rows)...", entity_idx, total_entities, sql_table, rows_in)
            _t0 = time.monotonic()

            if sql_table not in db_col_cache:
                db_col_cache[sql_table] = self._get_db_columns(cursor, sql_table)
            self._db_col_cache = db_col_cache
            self._fix_identity_col(cursor, sql_table, info)

            # Resolve FK lookups + auto-resolve from pk_cache
            self._auto_resolve_fks(rows, info, graph, pk_cache, full_refresh=full_refresh)
            self._nullify_string_fks(rows, info)

            # Type validation
            db_types = self._db_col_types_cache.get(sql_table) or self._get_db_column_types(cursor, sql_table)
            self._coerce_date_key_strings(rows, info, db_types)
            rows, type_rejects = self._pre_validate_types(rows, info, db_types, dl, sql_table)
            total_failed += type_rejects

            # Resolve lookup refs
            lookup_caches = self._build_lookup_caches(cursor, rows)

            # Diagnostic: log empty lookup caches that will cause mass rejection
            for cache_key, cache_data in lookup_caches.items():
                if not cache_data:
                    logger.warning("  Lookup cache EMPTY: %s.%s → %s (table has 0 rows)",
                                   cache_key[0], cache_key[1], cache_key[2])

            valid_rows: list[dict] = []
            failed = 0
            _first_reject_logged = False
            for row in rows:
                row.pop("_fk_context", None)
                if self._resolve_row_lookups(row, lookup_caches, info, sql_table, dl):
                    if not _first_reject_logged:
                        # Log the first rejection reason to aid debugging
                        for col, val in row.items():
                            if val is None and col in info.fk_fields and col in info.required_fields:
                                logger.warning("  First rejection: %s.%s — required FK is NULL "
                                               "(lookup target may not be loaded yet)", sql_table, col)
                                break
                        _first_reject_logged = True
                    failed += 1
                    continue
                skip_validation = self._apply_entity_defaults(row, info)
                missing = validate_required(row, info.required_fields - skip_validation)
                if missing:
                    dl.reject(sql_table, row, f"missing required: {missing}")
                    failed += 1
                    continue
                cols = self._prepare_row_columns(row, info, db_col_cache.get(sql_table))
                if cols:
                    valid_rows.append(row)
                else:
                    failed += 1

            if not valid_rows:
                entity_results.append((sql_table, rows_in, 0, rows_in, time.monotonic() - _t0))
                total_failed += failed
                continue

            # Build column list (exclude identity)
            all_cols: set[str] = set()
            for r in valid_rows:
                all_cols.update(r.keys())
            batch_cols = sorted(all_cols - ({info.identity_col} if info.identity_col else set())
                                - {"_source_object", "_fk_context"})
            db_real_cols = db_col_cache.get(sql_table)
            if db_real_cols:
                batch_cols = [c for c in batch_cols if c in db_real_cols]

            # ── Coerce Python values to correct types before INSERT ──
            self._coerce_rows_for_insert(valid_rows, batch_cols, sql_table)

            # ── SQL-level dedup: remove duplicates the Python dedup missed ──
            valid_rows = self._sql_level_dedup(valid_rows, info, sql_table)

            # Bulk INSERT in batches
            _BATCH = 1000
            loaded = 0
            try:
                insert_sql = (
                    f"INSERT INTO {sql_table} ({', '.join(f'[{c}]' for c in batch_cols)}) "
                    f"VALUES ({', '.join('?' for _ in batch_cols)})"
                )
                for batch_start in range(0, len(valid_rows), _BATCH):
                    batch = valid_rows[batch_start:batch_start + _BATCH]
                    param_rows = [[row.get(c) for c in batch_cols] for row in batch]
                    try:
                        cursor.executemany(insert_sql, param_rows)
                        loaded += len(batch)
                    except Exception as exc:
                        exc_str = str(exc)[:200]
                        if _COMM_LINK_ERROR in exc_str or _CONN_ERROR_08S01 in exc_str:
                            logger.warning("Connection lost during %s INSERT — reconnecting", sql_table)
                            try:
                                conn.close()
                            except Exception:
                                pass
                            if conn_str:
                                conn = pyodbc.connect(conn_str, timeout=60)
                                cursor = conn.cursor()
                                cursor.fast_executemany = True
                            failed += len(batch)
                        else:
                            logger.warning("Bulk INSERT failed for %s (%d rows): %s", sql_table, len(batch), exc_str)
                            failed += len(batch)

                # Commit after each entity
                try:
                    conn.commit()
                except Exception:
                    pass

                # Capture PKs for child entity FK resolution
                bk_fields = list(info.unique_keys - ({info.identity_col} if info.identity_col else set()))
                if info.identity_col and bk_fields:
                    new_pks = self._capture_batch_pks(cursor, sql_table, info, bk_fields, valid_rows)
                    if new_pks:
                        pk_cache[sql_table] = new_pks

            except Exception as exc:
                logger.exception("Entity %s failed: %s", sql_table, str(exc)[:120])
                failed += len(valid_rows)

            total_loaded += loaded
            total_failed += failed
            _elapsed = time.monotonic() - _t0
            entity_results.append((sql_table, rows_in, loaded, failed, _elapsed))

        # Summary table
        if entity_results:
            logger.info("")
            logger.info("  %-40s %6s %6s %6s %7s", "ENTITY", "INPUT", "LOADED", "FAILED", "TIME")
            logger.info("  %s", "─" * 69)
            for tbl, r_in, r_ok, r_fail, r_time in entity_results:
                mark = " ✗" if r_fail > 0 else ""
                logger.info("  %-40s %6d %6d %6d %6.1fs%s", tbl, r_in, r_ok, r_fail, r_time, mark)
            logger.info("  %s", "─" * 69)
            total_time = sum(r[4] for r in entity_results)
            logger.info("  %-40s %6d %6d %6d %6.1fs", "TOTAL",
                         sum(r[1] for r in entity_results), total_loaded, total_failed, total_time)
            if pk_cache:
                logger.info("  FK cache built for %d parent entities", len(pk_cache))
        return total_loaded, total_failed, conn

    def _delete_for_full_refresh(
        self, cursor: Any, graph: SchemaGraph, source_sys_id: Any,
        entity_rows: dict[str, list[dict]] | None = None,
    ) -> None:
        """Delete existing rows in reverse topological order for full refresh.
        Only deletes tables in entity_rows. If a delete fails due to FK constraints
        (child table not being cleared), it's skipped gracefully — the subsequent
        MERGE/upsert will handle the data update instead."""
        tables_to_delete = set(entity_rows.keys()) if entity_rows else None
        cleared: list[str] = []
        skipped: list[str] = []

        for sql_table in reversed(graph.topological_order()):
            info = graph.get(sql_table)
            if info is None:
                continue
            if "source_system_id" not in info.field_types:
                logger.debug("Skipping full_refresh delete for %s (no source_system_id column)", sql_table)
                continue
            if tables_to_delete is not None and sql_table not in tables_to_delete:
                continue
            try:
                cursor.execute(f"DELETE FROM {sql_table} WHERE [source_system_id] = ?", source_sys_id)
                cleared.append(sql_table)
            except Exception as exc:
                # FK constraint violation — child rows exist that we're not clearing
                # Skip this delete; the load phase will MERGE/upsert instead
                skipped.append(sql_table)
                logger.debug("Full refresh skip %s: %s", sql_table, str(exc)[:120])

        logger.info("Full refresh: cleared %d tables for source=%s", len(cleared), source_sys_id)
        if skipped:
            logger.warning("Full refresh: %d tables skipped (FK constraints): %s",
                           len(skipped), ", ".join(skipped))

    _SEED_DATA: dict[str, list[dict]] = {
        "[ref].[DocumentType]": [
            {"code": "FLAF", "name": "Field Layout Approval Form"},
            {"code": "Z6", "name": "SAP Z6 Notification"},
            {"code": "RLMU", "name": "Red-line Markup"},
        ],
        "[ref].[DocumentStatus]": [
            {"code": "DRF", "name": "Draft"},
            {"code": "ISS", "name": "Issued"},
            {"code": "APR", "name": "Approved"},
        ],
    }

    def _seed_reference_data(self, cursor: Any) -> None:
        """Seed reference tables that have no source data (needed for FK integrity).

        Uses MERGE to avoid duplicates — safe to call on every run.
        Rows are inserted with source_system_id=0 (system seed) so they
        survive full_refresh DELETE (which only targets source_system_id=9).
        """
        seeded = 0
        for sql_table, rows in self._SEED_DATA.items():
            for row in rows:
                try:
                    cursor.execute(
                        f"IF NOT EXISTS (SELECT 1 FROM {sql_table} WHERE [code] = ?) "
                        f"INSERT INTO {sql_table} ([code], [name], [source_system_id], [is_active], [created_at], [modified_at]) "
                        f"VALUES (?, ?, 0, 1, SYSUTCDATETIME(), SYSUTCDATETIME())",
                        row["code"], row["code"], row["name"],
                    )
                    if cursor.rowcount > 0:
                        seeded += 1
                except Exception as exc:
                    logger.warning("Seed failed %s.%s: %s", sql_table, row["code"], str(exc)[:120])
        if seeded:
            logger.info("Seeded %d reference row(s) (DocumentType, DocumentStatus)", seeded)

    @staticmethod
    def _get_db_columns(cursor: Any, sql_table: str) -> frozenset[str] | None:
        """Introspect actual DB column names for a table. Returns None on error."""
        try:
            cursor.execute(f"SELECT TOP 0 * FROM {sql_table}")
            return frozenset(col[0] for col in cursor.description) if cursor.description else None
        except Exception as exc:
            logger.warning("DB column introspection failed for %s: %s", sql_table, str(exc)[:120])
            return None

    @staticmethod
    def _get_db_column_types(cursor: Any, sql_table: str) -> dict[str, str]:
        """Introspect actual DB column names and types for a table."""
        try:
            cursor.execute(
                "SELECT c.name, t.name AS type_name "
                "FROM sys.columns c "
                "JOIN sys.types t ON c.user_type_id = t.user_type_id "
                "WHERE c.object_id = OBJECT_ID(?)",
                sql_table,
            )
            # Lowercase column names for case-insensitive lookup
            return {row[0].lower(): row[1] for row in cursor.fetchall()}
        except Exception as exc:
            logger.warning("DB type introspection failed for %s: %s", sql_table, str(exc)[:120])
            return {}

    _identity_cache: dict[str, str | None] = {}

    @classmethod
    def _fix_identity_col(cls, cursor: Any, sql_table: str, info: "EntityInfo") -> None:
        """Override schema graph identity_col with the actual DB identity column if different."""
        if sql_table not in cls._identity_cache:
            try:
                cursor.execute(
                    "SELECT c.name FROM sys.identity_columns ic "
                    "JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id "
                    "WHERE ic.object_id = OBJECT_ID(?)",
                    sql_table,
                )
                row = cursor.fetchone()
                cls._identity_cache[sql_table] = row[0] if row else None
            except Exception:
                cls._identity_cache[sql_table] = None
        actual_id = cls._identity_cache[sql_table]
        if actual_id and actual_id != info.identity_col:
            logger.debug("Identity override %s: %s → %s", sql_table, info.identity_col, actual_id)
            info.identity_col = actual_id

    def _prefetch_db_metadata(
        self, cursor: Any, tables: list[str],
        db_col_cache: dict[str, frozenset[str] | None],
        _graph: "SchemaGraph",
    ) -> None:
        """Bulk-fetch column names and identity columns for all tables in one round-trip.
        Saves ~750ms per entity on high-latency connections."""
        try:
            # Fetch all columns for all target tables in one query
            cursor.execute(
                "SELECT '[' + s.name + '].[' + t.name + ']' AS sql_table, c.name AS col_name "
                "FROM sys.columns c "
                "JOIN sys.tables t ON c.object_id = t.object_id "
                "JOIN sys.schemas s ON t.schema_id = s.schema_id "
                "ORDER BY sql_table, c.column_id"
            )
            all_cols: dict[str, set[str]] = {}
            for row in cursor.fetchall():
                all_cols.setdefault(row[0], set()).add(row[1])
            for sql_table in tables:
                if sql_table in all_cols:
                    db_col_cache[sql_table] = frozenset(all_cols[sql_table])

            # Fetch all identity columns in one query
            cursor.execute(
                "SELECT '[' + s.name + '].[' + t.name + ']' AS sql_table, c.name "
                "FROM sys.identity_columns ic "
                "JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id "
                "JOIN sys.tables t ON ic.object_id = t.object_id "
                "JOIN sys.schemas s ON t.schema_id = s.schema_id"
            )
            for row in cursor.fetchall():
                self._identity_cache[row[0]] = row[1]
            # Mark tables with no identity column
            for sql_table in tables:
                if sql_table not in self._identity_cache:
                    self._identity_cache[sql_table] = None

            # Fetch all column types in one query (saves per-entity _get_db_column_types calls)
            cursor.execute(
                "SELECT '[' + s.name + '].[' + t.name + ']' AS sql_table, c.name, tp.name AS type_name, c.is_nullable, "
                "c.precision, c.scale "
                "FROM sys.columns c "
                "JOIN sys.tables t ON c.object_id = t.object_id "
                "JOIN sys.schemas s ON t.schema_id = s.schema_id "
                "JOIN sys.types tp ON c.user_type_id = tp.user_type_id"
            )
            col_types_all: dict[str, dict[str, str]] = {}
            not_null_all: dict[str, set[str]] = {}
            col_precision_all: dict[str, dict[str, tuple[int, int]]] = {}
            for row in cursor.fetchall():
                # Lowercase column names for case-insensitive lookup
                # (batch_cols from control plane may differ in case from sys.columns)
                col_types_all.setdefault(row[0], {})[row[1].lower()] = row[2]
                if not row[3]:
                    not_null_all.setdefault(row[0], set()).add(row[1].lower())
                # Store precision/scale for decimal/numeric columns
                if row[2] in ("decimal", "numeric") and row[4] and row[5] is not None:
                    col_precision_all.setdefault(row[0], {})[row[1].lower()] = (int(row[4]), int(row[5]))
            self._db_col_types_cache = col_types_all
            self._db_not_null_cache = not_null_all
            self._db_col_precision_cache = col_precision_all

            logger.debug("Prefetched metadata: %d tables, %d identity cols, %d type maps",
                         len(db_col_cache), sum(1 for v in self._identity_cache.values() if v),
                         len(col_types_all))
        except Exception as exc:
            logger.warning("Bulk metadata prefetch failed (will fall back to per-table): %s", str(exc)[:120])

    def _load_entities(
        self, conn: Any, cursor: Any, entity_rows: dict[str, list[dict]],
        graph: SchemaGraph, dl: DeadLetterWriter, full_refresh: bool = False,
        conn_str: str | None = None,
    ) -> tuple[int, int, Any]:
        """Load entities in forward topological order (parents first).
        Returns (total_loaded, total_failed, current_connection)."""
        total_loaded = total_failed = pending = 0
        # Progressive FK cache: {parent_sql_table: {business_key_value: identity_pk_value}}
        pk_cache: dict[str, dict[Any, Any]] = {}
        # Actual DB column cache: {sql_table: frozenset of column names}
        db_col_cache: dict[str, frozenset[str] | None] = {}
        # Track per-entity results for summary
        entity_results: list[tuple[str, int, int, int, float]] = []  # (table, rows_in, loaded, failed, elapsed_s)

        # Build ordered load list for progress tracking
        load_order = [t for t in graph.topological_order() if t in entity_rows]
        total_entities = len(load_order)

        # Pre-fetch all DB metadata in bulk (saves ~750ms per entity on high-latency connections)
        self._prefetch_db_metadata(cursor, load_order, db_col_cache, graph)

        for entity_idx, sql_table in enumerate(load_order, 1):
            rows = entity_rows[sql_table]
            info = graph.get(sql_table)
            if info is None:
                continue
            rows_in = len(rows)

            # ── Progress indicator ─────────────────────────────────────────
            logger.info("[%d/%d] Loading %s (%d rows)...", entity_idx, total_entities, sql_table, rows_in)
            _entity_t0 = time.monotonic()
            # Cache actual DB columns for this table
            if sql_table not in db_col_cache:
                db_col_cache[sql_table] = self._get_db_columns(cursor, sql_table)
            # Store cache reference for use by _load_entity_with_pks → _prepare_row_columns
            self._db_col_cache = db_col_cache

            # Override schema graph identity_col with actual DB identity if mismatched
            self._fix_identity_col(cursor, sql_table, info)

            # Auto-resolve FK fields from pk_cache (parent tables already loaded)
            self._auto_resolve_fks(rows, info, graph, pk_cache, full_refresh=full_refresh)

            # Safety net: null out any remaining string FK values to prevent SQL type errors
            self._nullify_string_fks(rows, info)

            # Coerce date strings in int date_key columns to YYYYMMDD int
            db_types = self._db_col_types_cache.get(sql_table) or self._get_db_column_types(cursor, sql_table)
            self._coerce_date_key_strings(rows, info, db_types)

            # Pre-validate data types
            rows, type_rejects = self._pre_validate_types(rows, info, db_types, dl, sql_table)
            if type_rejects:
                total_failed += type_rejects

            # Dedup: exclude identity column from unique key set
            dedup_keys = info.unique_keys - {info.identity_col} if info.identity_col else info.unique_keys
            rows, skipped = deduplicate_rows(rows, dedup_keys)
            if skipped:
                logger.info("Dedup %s: %d duplicate(s) removed (from %d to %d)", sql_table, skipped, rows_in, len(rows))

            # ── Per-entity connection AFTER dedup (uses actual row count) ──
            # Only large entities (>50K rows after dedup) get their own connection.
            _PER_ENTITY_CONN_THRESHOLD = 50000
            actual_rows = len(rows)
            use_own_conn = conn_str and actual_rows > _PER_ENTITY_CONN_THRESHOLD
            entity_conn = conn
            entity_cursor = cursor
            if use_own_conn:
                try:
                    entity_conn = pyodbc.connect(conn_str, timeout=60)
                    entity_cursor = entity_conn.cursor()
                    entity_cursor.fast_executemany = True
                except Exception as conn_exc:
                    logger.warning("Per-entity connection failed for %s: %s — using shared",
                                   sql_table, str(conn_exc)[:80])
                    entity_conn = conn
                    entity_cursor = cursor
                    use_own_conn = False

            # Choose batch or row-by-row loading strategy
            try:
                if ENABLE_BATCH_MODE and not info.is_scd2 and actual_rows >= 2:
                    loaded, failed, pending, new_pks = self._load_entity_batched(
                        entity_conn, entity_cursor, sql_table, rows, info, dl, pending, full_refresh,
                        pk_cache=pk_cache, graph=graph,
                    )
                else:
                    loaded, failed, pending, new_pks = self._load_entity_with_pks(
                        entity_cursor, sql_table, rows, info, dl, pending, full_refresh,
                    )
            except Exception as entity_exc:
                exc_msg = str(entity_exc)[:200]
                is_conn_dead = _COMM_LINK_ERROR in exc_msg or _CONN_ERROR_08S01 in exc_msg
                if is_conn_dead:
                    logger.warning("Connection lost during %s — %s",
                                   sql_table, "per-entity conn will close" if use_own_conn else "reconnecting shared conn")
                    loaded, failed, new_pks = 0, rows_in, {}
                    if not use_own_conn and conn_str:
                        # Shared connection died — recover it
                        try:
                            conn.close()
                        except Exception:
                            pass
                        try:
                            conn = pyodbc.connect(conn_str, timeout=60)
                            cursor = conn.cursor()
                            cursor.fast_executemany = True
                            pending = 0
                        except Exception as reconn_exc:
                            logger.exception("Reconnect failed: %s — aborting remaining entities", str(reconn_exc)[:120])
                            total_failed += rows_in
                            _entity_elapsed = time.monotonic() - _entity_t0
                            entity_results.append((sql_table, rows_in, 0, rows_in, _entity_elapsed))
                            for remaining_table in load_order[entity_idx:]:
                                remaining_rows = len(entity_rows[remaining_table])
                                total_failed += remaining_rows
                                entity_results.append((remaining_table, remaining_rows, 0, remaining_rows, 0.0))
                            break
                else:
                    loaded, failed, new_pks = 0, rows_in, {}
                    logger.error("Entity load failed for %s: %s", sql_table, exc_msg)
            finally:
                # Close per-entity connection (shared connection stays open)
                if use_own_conn and entity_conn is not conn:
                    try:
                        entity_conn.commit()
                    except Exception:
                        pass
                    try:
                        entity_conn.close()
                    except Exception:
                        pass

            total_loaded += loaded
            total_failed += failed
            _entity_elapsed = time.monotonic() - _entity_t0
            entity_results.append((sql_table, rows_in, loaded, failed, _entity_elapsed))

            # Cache generated PKs for child entity FK resolution
            if new_pks and info.identity_col:
                pk_cache[sql_table] = new_pks

            # Commit after each entity to prevent TCP drops from losing all work
            if not use_own_conn and loaded > 0:
                try:
                    conn.commit()
                except Exception:
                    pass
                pending = 0

        # ── Entity load summary table ─────────────────────────────────────
        if entity_results:
            logger.info("")
            logger.info("  %-40s %6s %6s %6s %7s", "ENTITY", "INPUT", "LOADED", "FAILED", "TIME")
            logger.info("  %s", "─" * 69)
            for tbl, r_in, r_ok, r_fail, r_time in entity_results:
                mark = " ✗" if r_fail > 0 else ""
                logger.info("  %-40s %6d %6d %6d %6.1fs%s", tbl, r_in, r_ok, r_fail, r_time, mark)
            logger.info("  %s", "─" * 69)
            total_time = sum(r[4] for r in entity_results)
            logger.info("  %-40s %6d %6d %6d %6.1fs", "TOTAL",
                         sum(r[1] for r in entity_results), total_loaded, total_failed, total_time)
            if pk_cache:
                logger.info("  FK cache built for %d parent entities", len(pk_cache))
        return total_loaded, total_failed, conn

    @staticmethod
    def _get_fk_candidates(
        row: dict, declared_fks: set[str], date_suffixes: tuple, identity_col: str | None,
    ) -> set[str]:
        """Get FK field candidates from a row (declared + heuristic string _key/_id)."""
        candidates = set(declared_fks)
        for col, val in row.items():
            if val is not None and isinstance(val, str) and col.endswith(("_key", "_id")):
                if any(col.endswith(ds) for ds in date_suffixes):
                    continue
                if col == identity_col:
                    continue
                candidates.add(col)
        return candidates

    @staticmethod
    def _handle_stale_fk(
        row: dict, fk_field: str, existing: Any, fk_context: dict,
        info: EntityInfo, graph: SchemaGraph, pk_cache: dict,
    ) -> None:
        """Handle a potentially stale FK during full_refresh."""
        resolved = _resolve_fk_from_cache(fk_field, None, fk_context, info, graph, pk_cache)
        if resolved is not None:
            row[fk_field] = resolved
        else:
            row[fk_field] = None
            logger.debug("FK stale (full_refresh): %s.%s=%r → NULL", info.sql_table, fk_field, existing)

    @staticmethod
    def _resolve_single_fk(
        row: dict, fk_field: str, fk_context: dict,
        info: EntityInfo, graph: SchemaGraph, pk_cache: dict,
        valid_pk_sets: dict[str, set], full_refresh: bool,
    ) -> None:
        """Resolve a single FK candidate for a row."""
        existing = row.get(fk_field)
        if isinstance(existing, _LookupRef):
            return
        if existing is not None and not isinstance(existing, str):
            if full_refresh and fk_field in valid_pk_sets:
                if existing not in valid_pk_sets[fk_field]:
                    TenantLoader._handle_stale_fk(row, fk_field, existing, fk_context, info, graph, pk_cache)
            return
        resolved = _resolve_fk_from_cache(fk_field, existing, fk_context, info, graph, pk_cache)
        if resolved is not None:
            row[fk_field] = resolved
        elif existing is not None and isinstance(existing, str) and fk_field in info.fk_fields:
            row[fk_field] = None
            logger.debug("FK unresolved: %s.%s='%s' → NULL", info.sql_table, fk_field, existing[:40])

    @staticmethod
    def _build_valid_pk_sets(
        declared_fks: set[str], info: EntityInfo, graph: SchemaGraph,
        pk_cache: dict[str, dict[Any, Any]], full_refresh: bool,
    ) -> dict[str, set]:
        """Pre-compute valid PK value sets for full_refresh stale-check."""
        if not (full_refresh and declared_fks):
            return {}
        result: dict[str, set] = {}
        for fk_field in declared_fks:
            parent_table = _find_parent_for_fk(fk_field, info, graph)
            if parent_table and parent_table in pk_cache:
                result[fk_field] = set(pk_cache[parent_table].values())
        return result

    @staticmethod
    def _auto_resolve_fks(
        rows: list[dict], info: EntityInfo, graph: SchemaGraph,
        pk_cache: dict[str, dict[Any, Any]],
        full_refresh: bool = False,
    ) -> None:
        """Auto-populate FK fields on child rows using the progressive pk_cache."""
        if not pk_cache:
            for row in rows:
                row.pop("_fk_context", None)
            return
        declared_fks = set(info.fk_fields) if info.fk_fields else set()
        _date_suffixes = ("_date_key", "_date_id", "_date")
        identity_col = info.identity_col
        _valid_pk_sets = TenantLoader._build_valid_pk_sets(declared_fks, info, graph, pk_cache, full_refresh)
        for row in rows:
            fk_context = row.pop("_fk_context", None) or {}
            candidates = TenantLoader._get_fk_candidates(row, declared_fks, _date_suffixes, identity_col)
            for fk_field in candidates:
                TenantLoader._resolve_single_fk(
                    row, fk_field, fk_context, info, graph, pk_cache, _valid_pk_sets, full_refresh,
                )

    @staticmethod
    def _nullify_string_fks(rows: list[dict], info: EntityInfo) -> None:
        """Safety net: null out any remaining string values in declared FK fields.
        Prevents 'Error converting nvarchar to bigint' when pk_cache misses."""
        if not info.fk_fields:
            return
        for row in rows:
            for fk_field in info.fk_fields:
                val = row.get(fk_field)
                if val is not None and isinstance(val, str):
                    row[fk_field] = None

    @staticmethod
    def _is_date_key_int_col(col: str, dtype: str, db_types: dict[str, str] | None) -> bool:
        """Check if column is an int-typed date_key that needs coercion."""
        _int_types = frozenset({"int", "integer", "bigint", "smallint"})
        _datetime_types = frozenset({"datetime", "datetime2", "date", "datetimeoffset", "smalldatetime"})
        if not col.endswith(("_date_key", "_date")):
            return False
        base = dtype.strip().split("(")[0].lower() if dtype else ""
        if base not in _int_types:
            return False
        if db_types:
            actual = db_types.get(col.lower(), "").lower()
            if actual in _datetime_types:
                logger.debug("Skipping date_key coercion for %s: canonical=%s actual=%s", col, base, actual)
                return False
        return True

    @staticmethod
    def _coerce_single_date_key_col(rows: list[dict], col: str) -> None:
        """Coerce string values in a single date_key column to YYYYMMDD int."""
        for row in rows:
            val = row.get(col)
            if val is None or not isinstance(val, str):
                continue
            if 'T' in val or (len(val) > 8 and '-' in val):
                continue
            converted = _tr_date_key(val, "")
            row[col] = converted

    @staticmethod
    def _coerce_date_key_strings(rows: list[dict], info: EntityInfo, db_types: dict[str, str] | None = None) -> None:
        """Coerce string date values in int *_date_key columns to YYYYMMDD int."""
        for col, dtype in info.field_types.items():
            if TenantLoader._is_date_key_int_col(col, dtype, db_types):
                TenantLoader._coerce_single_date_key_col(rows, col)

    @staticmethod
    def _validate_row_types(
        row: dict, check_cols: list[tuple[str, str]], db_types: dict[str, str],
    ) -> str | None:
        """Validate numeric types for a single row. Returns rejection reason or None."""
        for col, cat in check_cols:
            val = row.get(col)
            if val is None or isinstance(val, (int, float)):
                continue
            if not isinstance(val, str):
                continue
            stripped = val.strip()
            if not stripped:
                row[col] = None
                continue
            try:
                row[col] = int(float(stripped)) if cat == "int" else float(stripped)
            except (ValueError, OverflowError):
                return f"type mismatch: {col}={val!r} cannot convert to {db_types.get(col, '?')}"
        return None

    @staticmethod
    def _pre_validate_types(
        rows: list[dict], info: EntityInfo, db_types: dict[str, str],
        dl: DeadLetterWriter, sql_table: str,
    ) -> tuple[list[dict], int]:
        """Pre-validate data types before MERGE to prevent type conversion errors."""
        int_types = frozenset({"int", "integer", "bigint", "smallint", "tinyint"})
        numeric_types = frozenset({"decimal", "numeric", "float", "real", "money", "smallmoney"})
        check_cols: list[tuple[str, str]] = []
        for col, dtype in db_types.items():
            base = dtype.strip().split("(")[0].lower()
            if base in int_types:
                check_cols.append((col, "int"))
            elif base in numeric_types:
                check_cols.append((col, "num"))
        if not check_cols:
            return rows, 0
        valid: list[dict] = []
        rejected = 0
        for row in rows:
            reason = TenantLoader._validate_row_types(row, check_cols, db_types)
            if reason:
                dl.reject(sql_table, row, reason)
                rejected += 1
            else:
                valid.append(row)
        return valid, rejected

    def _process_single_load_row(
        self, cursor: Any, sql_table: str, row: dict, info: EntityInfo,
        dl: DeadLetterWriter, lookup_caches: dict, needs_identity_insert: bool,
    ) -> bool:
        """Process a single row for loading. Returns True if loaded successfully."""
        row.pop("_fk_context", None)
        if self._resolve_row_lookups(row, lookup_caches, info, sql_table, dl):
            return False
        if needs_identity_insert and info.identity_col in row and row[info.identity_col] is not None:
            try:
                row[info.identity_col] = int(row[info.identity_col])
            except (ValueError, TypeError):
                pass
        skip_validation = self._apply_entity_defaults(row, info)
        missing = validate_required(row, info.required_fields - skip_validation)
        if missing:
            dl.reject(sql_table, row, f"missing required (no default): {missing}")
            return False
        cols = self._prepare_row_columns(row, info, getattr(self, '_db_col_cache', {}).get(sql_table))
        if not cols:
            dl.reject(sql_table, row, _NO_NONNULL_COLS_MSG)
            return False
        return self._execute_row_sql(cursor, sql_table, row, cols, info, dl)

    def _load_entity(
        self, cursor: Any, sql_table: str, rows: list[dict],
        info: EntityInfo, dl: DeadLetterWriter, pending: int,
    ) -> tuple[int, int, int]:
        loaded = failed = 0
        lookup_caches = self._build_lookup_caches(cursor, rows)
        needs_identity_insert = (
            info.identity_col
            and any(row.get(info.identity_col) is not None for row in rows)
        )
        if needs_identity_insert:
            try:
                cursor.execute(f"SET IDENTITY_INSERT {sql_table} ON")
            except Exception as exc:
                logger.warning("IDENTITY_INSERT ON failed for %s: %s", sql_table, exc)
                needs_identity_insert = False
        for row in rows:
            if self._process_single_load_row(cursor, sql_table, row, info, dl, lookup_caches, needs_identity_insert):
                loaded += 1
                pending += 1
            else:
                failed += 1
        if needs_identity_insert:
            try:
                cursor.execute(f"SET IDENTITY_INSERT {sql_table} OFF")
            except Exception:
                pass
        return loaded, failed, pending

    def _coerce_rows_for_insert(
        self, rows: list[dict], batch_cols: list[str], sql_table: str,
    ) -> None:
        """Coerce Python values to correct SQL types before INSERT."""
        col_types = self._db_col_types_cache.get(sql_table) or self._get_db_column_types(None, sql_table)
        col_precision = self._db_col_precision_cache.get(sql_table, {})
        _int_types = {"int", "bigint", "smallint", "tinyint"}
        _dec_types = {"decimal", "numeric", "float", "real", "money", "smallmoney"}
        _date_types = {"datetime", "datetime2", "date", "smalldatetime"}
        for row in rows:
            for col in batch_cols:
                val = row.get(col)
                if val is None:
                    continue
                ct = col_types.get(col.lower(), "").lower()
                self._coerce_single_value(row, col, val, ct, _int_types, _dec_types, _date_types)
                self._bounds_check_value(row, col, ct, col_precision)

    @staticmethod
    def _sql_level_dedup(valid_rows: list[dict], info: EntityInfo, sql_table: str) -> list[dict]:
        """Remove duplicates using merge keys with case-insensitive collation."""
        merge_keys = info.unique_keys - ({info.identity_col} if info.identity_col else set()) - {"source_system_id"}
        if not merge_keys:
            return valid_rows
        mk_cols = sorted(merge_keys)
        seen: set[tuple] = set()
        deduped: list[dict] = []
        for row in valid_rows:
            key = tuple(
                v.lower() if isinstance(v, str) else v
                for v in (row.get(c) for c in mk_cols)
            )
            if key not in seen:
                seen.add(key)
                deduped.append(row)
        if len(deduped) < len(valid_rows):
            logger.info("  %s: SQL-key dedup %d → %d", sql_table, len(valid_rows), len(deduped))
        return deduped

    @staticmethod
    def _coerce_single_value(
        row: dict, col: str, val: Any, ct: str,
        int_types: set, dec_types: set, date_types: set,
    ) -> None:
        """Coerce a single cell value to the target SQL type."""
        if ct in int_types and not isinstance(val, int):
            try:
                row[col] = int(float(str(val).strip()))
            except (ValueError, TypeError):
                row[col] = None
        elif ct in dec_types and not isinstance(val, (int, float)):
            try:
                row[col] = float(str(val).strip().replace(",", ""))
            except (ValueError, TypeError):
                row[col] = None
        elif ct == "bit" and not isinstance(val, (bool, int)):
            row[col] = int(str(val).strip().lower() in ("1", "true", "yes"))
        elif ct in date_types and isinstance(val, str):
            from datetime import datetime as _dt
            try:
                row[col] = _dt.fromisoformat(val.replace("Z", "+00:00"))
            except (ValueError, TypeError):
                row[col] = None

    @staticmethod
    def _clamp_decimal_precision(
        row: dict, col: str, val: float | int, col_precision: dict[str, tuple[int, int]],
    ) -> None:
        """Clamp value to fit decimal(precision, scale) range."""
        ps = col_precision.get(col.lower())
        if not ps:
            return
        precision, scale = ps
        max_integer_digits = precision - scale
        max_val = 10 ** max_integer_digits - 10 ** (-scale)
        if abs(val) <= max_val:
            return
        if max_integer_digits <= 1 and abs(val) > 1:
            row[col] = round(val / 100.0, scale)
        else:
            row[col] = round(max_val if val > 0 else -max_val, scale)

    @staticmethod
    def _bounds_check_value(
        row: dict, col: str, ct: str, col_precision: dict[str, tuple[int, int]],
    ) -> None:
        """Apply bounds checks for decimal/numeric/smallint/tinyint."""
        val = row.get(col)
        if val is not None and isinstance(val, (int, float)) and ct in ("decimal", "numeric"):
            TenantLoader._clamp_decimal_precision(row, col, val, col_precision)
        if ct == "smallint" and isinstance(row.get(col), int):
            row[col] = max(-32768, min(32767, row[col]))
        elif ct == "tinyint" and isinstance(row.get(col), int):
            row[col] = max(0, min(255, row[col]))

    # ══════════════════════════════════════════════════════════════════════════
    # BATCH MERGE: temp-table staging for high-throughput bulk loading
    # ══════════════════════════════════════════════════════════════════════════

    def _load_entity_batched(
        self, conn: Any, cursor: Any, sql_table: str, rows: list[dict],
        info: EntityInfo, dl: DeadLetterWriter, pending: int,
        full_refresh: bool = False,
        pk_cache: dict[str, dict] | None = None,
        graph: "SchemaGraph | None" = None,
    ) -> tuple[int, int, int, dict[Any, Any]]:
        """
        Batch-load entity using temp table staging + single MERGE.

        Strategy:
          1. Prepare all rows (defaults, validation, column filtering)
          2. Bulk-INSERT valid rows into #etl_staging via executemany()
          3. Execute single MERGE from #etl_staging into target
          4. Capture generated PKs via OUTPUT clause
          5. On batch failure, fall back to per-row execution

        Returns (loaded, failed, pending, pk_cache_dict).
        """
        new_pks: dict[Any, Any] = {}
        _t0 = time.monotonic()
        lookup_caches = self._build_lookup_caches(cursor, rows)
        _t_lookup = time.monotonic() - _t0
        if _t_lookup > 1.0:
            logger.info("  %s lookup cache: %.1fs (%d caches)", sql_table, _t_lookup, len(lookup_caches))

        # ── Prepare rows: resolve lookups, apply defaults, validate ────────
        valid_rows: list[dict] = []
        valid_cols_set: set[str] = set()
        failed = 0

        for row in rows:
            row.pop("_fk_context", None)

            if self._resolve_row_lookups(row, lookup_caches, info, sql_table, dl):
                failed += 1
                continue

            skip_validation = self._apply_entity_defaults(row, info)

            missing = validate_required(row, info.required_fields - skip_validation)
            if missing:
                dl.reject(sql_table, row, f"missing required (no default): {missing}")
                failed += 1
                continue

            cols = self._prepare_row_columns(row, info, getattr(self, '_db_col_cache', {}).get(sql_table))
            if not cols:
                dl.reject(sql_table, row, _NO_NONNULL_COLS_MSG)
                failed += 1
                continue

            # Pre-validate required FK fields
            if info.fk_fields:
                fk_fail = False
                for fk_field in info.fk_fields:
                    if fk_field in cols and row.get(fk_field) is None and fk_field in info.required_fields:
                        dl.reject(sql_table, row, f"required FK '{fk_field}' is NULL (parent not loaded)")
                        fk_fail = True
                        break
                if fk_fail:
                    failed += 1
                    continue

            valid_rows.append(row)
            valid_cols_set.update(cols)

        if not valid_rows:
            return 0, failed, pending, new_pks

        # ── Determine consistent column set for all rows ──────────────────
        # Exclude identity column from batch insert (let DB generate it)
        batch_cols = sorted(valid_cols_set - ({info.identity_col} if info.identity_col else set()))
        # Ensure merge keys are present — exclude source_system_id (system col, not business key)
        # Including it causes UNIQUE KEY violations when DB constraint is on business key alone
        merge_keys = info.unique_keys - ({info.identity_col} if info.identity_col else set()) - {"source_system_id"}
        for mk in merge_keys:
            if mk not in batch_cols:
                batch_cols.append(mk)
        batch_cols.sort()

        if not batch_cols:
            return 0, failed, pending, new_pks

        logger.debug("  %s: identity=%s merge_keys=%s batch_cols=%d rows=%d",
                      sql_table, info.identity_col, sorted(merge_keys), len(batch_cols), len(valid_rows))

        # ── Choose execution strategy ─────────────────────────────────
        # For small batches, use direct MERGE with VALUES (2 round-trips)
        # instead of staging table (7+ round-trips). ODBC limit is 2100 params.
        _DIRECT_MERGE_PARAM_LIMIT = 2000
        db_cols = getattr(self, '_db_col_cache', {}).get(sql_table)
        col_types = self._db_col_types_cache.get(sql_table) or self._get_db_column_types(cursor, sql_table)
        merge_keys = info.unique_keys - ({info.identity_col} if info.identity_col else set()) - {"source_system_id"}
        total_params = len(valid_rows) * len(batch_cols)
        use_direct = (
            total_params < _DIRECT_MERGE_PARAM_LIMIT
            and merge_keys
            and merge_keys.issubset(batch_cols)
        )

        try:
            # Use savepoint so failure only rolls back THIS entity, not prior ones
            cursor.execute("SAVE TRANSACTION etl_batch")

            if use_direct:
                # ── Direct MERGE with VALUES (no staging table) ───────────
                total_loaded, new_pks = self._execute_direct_merge(
                    cursor, sql_table, valid_rows, batch_cols, merge_keys, db_cols, info,
                    pk_cache=pk_cache, graph=graph, dl=dl,
                    full_refresh=full_refresh,
                )
            else:
                # ── Staging table path for large batches ──────────────────
                # For very large batches (>10K rows), chunk to keep TCP alive
                _CHUNK_SIZE = 10000
                if len(valid_rows) > _CHUNK_SIZE:
                    total_loaded = 0
                    all_pks: dict[Any, Any] = {}
                    for chunk_start in range(0, len(valid_rows), _CHUNK_SIZE):
                        chunk = valid_rows[chunk_start:chunk_start + _CHUNK_SIZE]
                        chunk_loaded, chunk_pks = self._execute_staged_merge(
                            cursor, conn, sql_table, chunk, batch_cols, merge_keys,
                            db_cols, info, col_types,
                            graph=graph, dl=dl,
                            full_refresh=full_refresh,
                        )
                        total_loaded += chunk_loaded
                        all_pks.update(chunk_pks)
                        # Commit between chunks to keep TCP connection alive
                        conn.commit()
                    new_pks = all_pks
                else:
                    total_loaded, new_pks = self._execute_staged_merge(
                        cursor, conn, sql_table, valid_rows, batch_cols, merge_keys,
                        db_cols, info, col_types,
                        graph=graph, dl=dl,
                        full_refresh=full_refresh,
                    )

            pending += total_loaded
            logger.debug("Batch MERGE %s: %d rows loaded (%s)",
                         sql_table, total_loaded, "direct" if use_direct else "staged")
            return total_loaded, failed, pending, new_pks

        except Exception as exc:
            exc_str = str(exc)[:200]
            is_type_error = "converting data type" in exc_str or "42000" in exc_str
            is_conn_error = _COMM_LINK_ERROR in exc_str or _CONN_ERROR_08S01 in exc_str
            is_large_batch = len(valid_rows) > 500

            # ── Connection error → re-raise for outer recovery ────────────
            if is_conn_error:
                logger.warning("Connection lost during %s MERGE — re-raising for recovery", sql_table)
                raise

            # ── Large batch + type error → TRY_CAST cleanse + retry (seconds, not hours)
            if is_type_error and not use_direct and is_large_batch:
                logger.warning(
                    "Batch MERGE type error for %s — SQL-side TRY_CAST cleanse (%d rows)",
                    sql_table, len(valid_rows),
                )
                try:
                    cursor.execute(_ROLLBACK_BATCH_SQL)
                except Exception:
                    try:
                        conn.rollback()
                    except Exception:
                        pass
                try:
                    total_loaded, new_pks = self._execute_staged_merge_with_cleanse(
                        cursor, conn, sql_table, valid_rows, batch_cols, merge_keys,
                        db_cols, info, col_types, graph=graph, dl=dl,
                        full_refresh=full_refresh,
                    )
                    pending += total_loaded
                    return total_loaded, failed, pending, new_pks
                except Exception as retry_exc:
                    logger.exception(
                        "Cleansed retry failed for %s (%s) — skipping entity",
                        sql_table, str(retry_exc)[:120],
                    )
                    try:
                        conn.rollback()
                    except Exception:
                        pass
                    return 0, failed + len(valid_rows), pending, {}

            # ── Large batch + other error → skip (never row-by-row on 64K rows)
            if is_large_batch:
                logger.warning(
                    "Batch failed for %s (%s) — SKIPPING %d rows (too large for row-by-row)",
                    sql_table, exc_str, len(valid_rows),
                )
                if not use_direct:
                    try:
                        cursor.execute("IF OBJECT_ID('tempdb..#etl_staging') IS NOT NULL DROP TABLE #etl_staging")
                    except Exception:
                        pass
                try:
                    cursor.execute(_ROLLBACK_BATCH_SQL)
                except Exception:
                    try:
                        conn.rollback()
                    except Exception:
                        pass
                return 0, failed + len(valid_rows), pending, {}

            # ── Small batch (<500 rows) → row-by-row fallback is acceptable
            logger.warning(
                "Batch MERGE failed for %s (%s) — row-by-row fallback (%d rows)",
                sql_table, exc_str, len(valid_rows),
            )
            if not use_direct:
                try:
                    cursor.execute("IF OBJECT_ID('tempdb..#etl_staging') IS NOT NULL DROP TABLE #etl_staging")
                except Exception:
                    pass
            try:
                cursor.execute(_ROLLBACK_BATCH_SQL)
            except Exception:
                try:
                    conn.rollback()
                except Exception:
                    pass
            loaded_fb, failed_fb, pending_fb, new_pks_fb = self._load_entity_with_pks(
                cursor, sql_table, rows, info, dl, pending, full_refresh,
            )
            return loaded_fb, failed + failed_fb, pending_fb, new_pks_fb

    # ------------------------------------------------------------------
    # Direct MERGE: inline VALUES for small batches (2 round-trips)
    # ------------------------------------------------------------------

    def _execute_direct_merge(
        self, cursor: Any, sql_table: str, valid_rows: list[dict],
        batch_cols: list[str], merge_keys: frozenset[str],
        db_cols: frozenset[str] | None, info: EntityInfo,
        pk_cache: dict[str, dict] | None = None,
        graph: "SchemaGraph | None" = None,
        dl: "DeadLetterWriter | None" = None,
        full_refresh: bool = False,
    ) -> tuple[int, dict[Any, Any]]:
        """Execute MERGE with inline VALUES — no staging table overhead.

        For 10 rows × 20 cols = 200 params, this is 1 SQL call vs 5+ with staging.
        Returns (rows_loaded, pk_cache_dict).
        """
        # Deduplicate by merge keys to prevent "MERGE attempted to UPDATE same row twice"
        seen: set[tuple] = set()
        deduped: list[dict] = []
        for row in valid_rows:
            mk_vals = tuple(row.get(k) for k in sorted(merge_keys))
            if mk_vals not in seen:
                seen.add(mk_vals)
                deduped.append(row)
        if len(deduped) < len(valid_rows):
            logger.debug("Direct merge dedup %s: %d → %d rows", sql_table, len(valid_rows), len(deduped))
            valid_rows = deduped

        # ── FK pre-validation using pk_cache (small batches only) ─────
        if pk_cache and graph and info.fk_fields and dl:
            validated: list[dict] = []
            for row in valid_rows:
                fk_ok = True
                for fk_field in info.fk_fields:
                    fk_val = row.get(fk_field)
                    if fk_val is None or isinstance(fk_val, str):
                        continue
                    parent_table = _find_parent_for_fk(fk_field, info, graph)
                    if parent_table and parent_table in pk_cache:
                        parent_pks = pk_cache[parent_table]
                        if fk_val not in parent_pks.values():
                            dl.reject(sql_table, row,
                                f"FK pre-check: {fk_field}={fk_val} not in {parent_table}")
                            fk_ok = False
                            break
                if fk_ok:
                    validated.append(row)
            if len(validated) < len(valid_rows):
                logger.info("  %s FK pre-check: %d/%d rows rejected (direct)",
                            sql_table, len(valid_rows) - len(validated), len(valid_rows))
                valid_rows = validated
            if not valid_rows:
                return 0, {}

        # Build parameterised VALUES clause: (?, ?, ?), (?, ?, ?), ...
        row_ph = f"({', '.join('?' for _ in batch_cols)})"
        values_clause = ", ".join(row_ph for _ in valid_rows)
        params = []
        for row in valid_rows:
            params.extend(row.get(c) for c in batch_cols)

        src_cols = ", ".join(f"[{c}]" for c in batch_cols)

        # ON clause with NULL-safe comparison
        on_parts = [
            f"(target.[{c}] = src.[{c}] OR (target.[{c}] IS NULL AND src.[{c}] IS NULL))"
            for c in sorted(merge_keys)
        ]
        on_clause = _AND_JOIN.join(on_parts)

        # UPDATE clause
        no_update = merge_keys | MergeBuilder._SYS | ({info.identity_col} if info.identity_col else set())
        upd_cols = [c for c in batch_cols if c not in no_update]
        has_modified_at = db_cols is None or "modified_at" in db_cols
        if upd_cols:
            upd = ", ".join(f"target.[{c}] = src.[{c}]" for c in upd_cols)
            if has_modified_at:
                upd += ", target.[modified_at] = SYSUTCDATETIME()"
        else:
            upd = "target.[modified_at] = SYSUTCDATETIME()" if has_modified_at else "target.[source_system_id] = src.[source_system_id]"

        ins_cols = ", ".join(f"[{c}]" for c in batch_cols)
        ins_vals = ", ".join(f"src.[{c}]" for c in batch_cols)

        _t0 = time.monotonic()
        if full_refresh and not merge_keys:
            # Full refresh + no merge keys: plain INSERT
            insert_sql = (
                f"INSERT INTO {sql_table} ({ins_cols}) "
                f"SELECT {src_cols} FROM (VALUES {values_clause}) AS src({src_cols})"
            )
            cursor.execute(insert_sql, params)
        else:
            # Use MERGE for tables with unique keys (handles pre-existing rows from other sources)
            merge_sql = (
                f"MERGE INTO {sql_table} AS target\n"
                f"USING (VALUES {values_clause}) AS src({src_cols})\n"
                f"ON {on_clause}\n"
                f"WHEN MATCHED THEN UPDATE SET {upd}\n"
                f"WHEN NOT MATCHED THEN INSERT ({ins_cols}) VALUES ({ins_vals});"
            )
            cursor.execute(merge_sql, params)

        # Capture PKs for FK cache
        new_pks: dict[Any, Any] = {}
        bk_fields = list(info.unique_keys) if info.unique_keys else []
        if not bk_fields and info.natural_key:
            bk_fields = [info.natural_key]
        if info.identity_col and bk_fields:
            new_pks = self._capture_batch_pks(cursor, sql_table, info, bk_fields, valid_rows)
        _t_total = time.monotonic() - _t0
        if _t_total > 5.0:
            logger.info("  %s direct MERGE+PK: %.1fs (%d rows)", sql_table, _t_total, len(valid_rows))

        return len(valid_rows), new_pks

    # ------------------------------------------------------------------
    # Staged MERGE: temp table for large batches
    # ------------------------------------------------------------------

    def _execute_staged_merge(
        self, cursor: Any, _conn: Any, sql_table: str, valid_rows: list[dict],
        batch_cols: list[str], merge_keys: frozenset[str],
        db_cols: frozenset[str] | None, info: EntityInfo,
        col_types: dict[str, str],
        graph: "SchemaGraph | None" = None,
        dl: "DeadLetterWriter | None" = None,
        full_refresh: bool = False,
    ) -> tuple[int, dict[Any, Any]]:
        """Staging-table MERGE for large batches. Returns (rows_loaded, pk_cache_dict)."""
        staging_table = "#etl_staging"

        # Combine DDL: drop + create in one call
        staging_ddl = self._build_staging_ddl(staging_table, batch_cols, col_types)
        cursor.execute(
            f"IF OBJECT_ID('tempdb..{staging_table}') IS NOT NULL DROP TABLE {staging_table}; "
            + staging_ddl
        )

        # Bulk INSERT into staging using executemany
        insert_sql = (
            f"INSERT INTO {staging_table} ({', '.join(f'[{c}]' for c in batch_cols)}) "
            f"VALUES ({', '.join('?' for _ in batch_cols)})"
        )
        for batch_start in range(0, len(valid_rows), BATCH_INSERT_SIZE):
            batch = valid_rows[batch_start:batch_start + BATCH_INSERT_SIZE]
            param_rows = [
                [row.get(c) for c in batch_cols]
                for row in batch
            ]
            cursor.executemany(insert_sql, param_rows)

        # ── Dedup FIRST (reduces data volume for FK validation) ───────
        total_loaded = 0
        deduped_count = 0
        if merge_keys:
            partition_cols = ", ".join(f"[{c}]" for c in sorted(merge_keys))
            dedup_sql = (
                f";WITH _dedup AS ("
                f"  SELECT *, ROW_NUMBER() OVER (PARTITION BY {partition_cols} ORDER BY (SELECT NULL)) AS _rn"
                f"  FROM {staging_table}"
                f") DELETE FROM _dedup WHERE _rn > 1"
            )
            cursor.execute(dedup_sql)
            deduped_count = cursor.rowcount
            if deduped_count > 0:
                logger.info("Batch dedup %s: removed %d duplicate(s) from staging (before FK check)",
                            sql_table, deduped_count)

        # ── Proactive TRY_CAST cleanse: fix type issues BEFORE MERGE ──
        cleansed_count = self._cleanse_staging_types(cursor, staging_table, batch_cols, col_types, sql_table)
        if cleansed_count > 0:
            logger.info("  %s: proactive cleanse — %d bad value(s) fixed", sql_table, cleansed_count)

        # ── SQL-side FK validation: remove orphan rows from staging ───
        fk_rejected = self._validate_staging_fks(
            cursor, staging_table, batch_cols, info, graph, dl, sql_table,
        )

        self._execute_final_merge_or_insert(
            cursor, sql_table, staging_table, batch_cols, merge_keys, db_cols, info, col_types, full_refresh,
        )
        total_loaded = len(valid_rows) - deduped_count - fk_rejected
        if not merge_keys and not full_refresh:
            total_loaded = len(valid_rows) - fk_rejected

        # Capture PKs for FK cache
        new_pks: dict[Any, Any] = {}
        bk_fields = list(info.unique_keys) if info.unique_keys else []
        if not bk_fields and info.natural_key:
            bk_fields = [info.natural_key]
        if info.identity_col and bk_fields:
            new_pks = self._capture_batch_pks(cursor, sql_table, info, bk_fields, valid_rows)

        # Clean up staging
        try:
            cursor.execute(f"IF OBJECT_ID('tempdb..{staging_table}') IS NOT NULL DROP TABLE {staging_table}")
        except Exception:
            pass

        return total_loaded, new_pks

    # ------------------------------------------------------------------
    # Staged MERGE with TRY_CAST cleanse (type-error recovery)
    # ------------------------------------------------------------------

    def _execute_staged_merge_with_cleanse(
        self, cursor: Any, _conn: Any, sql_table: str, valid_rows: list[dict],
        batch_cols: list[str], merge_keys: frozenset[str],
        db_cols: frozenset[str] | None, info: EntityInfo,
        col_types: dict[str, str],
        graph: "SchemaGraph | None" = None,
        dl: "DeadLetterWriter | None" = None,
        full_refresh: bool = False,
    ) -> tuple[int, dict[Any, Any]]:
        """Staged MERGE with SQL-side TRY_CAST cleansing for type-error recovery.

        When a batch MERGE fails due to 'Error converting data type varchar to numeric',
        this method re-stages the data and uses TRY_CAST to null out unconvertible values
        before retrying. Handles 64K+ rows in seconds instead of hours of row-by-row.
        """
        staging_table = "#etl_staging"

        # Build and populate staging table
        staging_ddl = self._build_staging_ddl(staging_table, batch_cols, col_types)
        cursor.execute(
            f"IF OBJECT_ID('tempdb..{staging_table}') IS NOT NULL DROP TABLE {staging_table}; "
            + staging_ddl
        )

        insert_sql = (
            f"INSERT INTO {staging_table} ({', '.join(f'[{c}]' for c in batch_cols)}) "
            f"VALUES ({', '.join('?' for _ in batch_cols)})"
        )
        for batch_start in range(0, len(valid_rows), BATCH_INSERT_SIZE):
            batch = valid_rows[batch_start:batch_start + BATCH_INSERT_SIZE]
            param_rows = [[row.get(c) for c in batch_cols] for row in batch]
            cursor.executemany(insert_sql, param_rows)

        # ── Dedup FIRST (reduces data volume for cleanse + FK validation) ──
        deduped_count = 0
        if merge_keys:
            partition_cols = ", ".join(f"[{c}]" for c in sorted(merge_keys))
            cursor.execute(
                f";WITH _dedup AS ("
                f"  SELECT *, ROW_NUMBER() OVER (PARTITION BY {partition_cols} ORDER BY (SELECT NULL)) AS _rn"
                f"  FROM {staging_table}"
                f") DELETE FROM _dedup WHERE _rn > 1"
            )
            deduped_count = cursor.rowcount
            if deduped_count > 0:
                logger.info("  %s dedup: removed %d duplicate(s) from staging", sql_table, deduped_count)

        # ── TRY_CAST cleanse: null out non-numeric strings in numeric columns ──
        cleansed_count = self._cleanse_staging_types(
            cursor, staging_table, batch_cols, col_types, sql_table, verbose=True,
        )
        if cleansed_count:
            logger.info("  %s: cleansed %d bad value(s) — retrying", sql_table, cleansed_count)

        # ── FK validation ──
        fk_rejected = self._validate_staging_fks(
            cursor, staging_table, batch_cols, info, graph, dl, sql_table,
        )

        # ── INSERT or MERGE ──
        self._execute_final_merge_or_insert(
            cursor, sql_table, staging_table, batch_cols, merge_keys, db_cols, info, col_types, full_refresh,
        )
        total_loaded = len(valid_rows) - deduped_count - fk_rejected
        if not merge_keys and not full_refresh:
            total_loaded = len(valid_rows) - fk_rejected

        # Capture PKs
        new_pks: dict[Any, Any] = {}
        bk_fields = list(info.unique_keys) if info.unique_keys else []
        if not bk_fields and info.natural_key:
            bk_fields = [info.natural_key]
        if info.identity_col and bk_fields:
            new_pks = self._capture_batch_pks(cursor, sql_table, info, bk_fields, valid_rows)

        try:
            cursor.execute(f"IF OBJECT_ID('tempdb..{staging_table}') IS NOT NULL DROP TABLE {staging_table}")
        except Exception:
            pass

        logger.info("  %s: cleansed load complete — %d rows loaded", sql_table, total_loaded)
        return total_loaded, new_pks

    # ------------------------------------------------------------------
    # Shared staging helpers
    # ------------------------------------------------------------------

    def _execute_final_merge_or_insert(
        self, cursor: Any, sql_table: str, staging_table: str,
        batch_cols: list[str], merge_keys: frozenset[str],
        db_cols: frozenset[str] | None, info: EntityInfo,
        col_types: dict[str, str], full_refresh: bool,
    ) -> None:
        """Execute the final INSERT or MERGE from staging into target."""
        if merge_keys and merge_keys.issubset(batch_cols) and not (full_refresh and not merge_keys):
            merge_sql = self._build_batch_merge_sql(
                sql_table, staging_table, batch_cols, merge_keys, db_cols, info,
                col_types=col_types,
            )
            cursor.execute(merge_sql)
        else:
            select_exprs = ", ".join(self._cast_expr(c, col_types) for c in batch_cols)
            cursor.execute(
                f"INSERT INTO {sql_table} ({', '.join(f'[{c}]' for c in batch_cols)}) "
                f"SELECT {select_exprs} FROM {staging_table}"
            )

    # ------------------------------------------------------------------
    # SQL-side TRY_CAST cleanse on staging table
    # ------------------------------------------------------------------

    @staticmethod
    def _cleanse_staging_types(
        cursor: Any, staging_table: str, batch_cols: list[str],
        col_types: dict[str, str], sql_table: str, verbose: bool = False,
    ) -> int:
        """TRY_CAST cleanse on staging table — null out unconvertible values. Returns count fixed."""
        _CAST_MAP = {
            "int": "BIGINT", "bigint": "BIGINT", "smallint": "BIGINT", "tinyint": "BIGINT",
            "decimal": "FLOAT", "numeric": "FLOAT", "float": "FLOAT", "real": "FLOAT",
            "money": "FLOAT", "smallmoney": "FLOAT",
            "date": "DATETIME2", "datetime": "DATETIME2", "datetime2": "DATETIME2",
            "smalldatetime": "DATETIME2",
        }
        cleansed_count = 0
        for col in batch_cols:
            target_type = col_types.get(col.lower(), "").lower().split("(")[0]
            cast_type = _CAST_MAP.get(target_type)
            if not cast_type:
                continue
            cursor.execute(
                f"UPDATE {staging_table} SET [{col}] = NULL "
                f"WHERE [{col}] IS NOT NULL AND TRY_CAST([{col}] AS {cast_type}) IS NULL"
            )
            if cursor.rowcount > 0:
                if verbose:
                    logger.info("  %s TRY_CAST cleanse: %d bad values in [%s]",
                                sql_table, cursor.rowcount, col)
                cleansed_count += cursor.rowcount
        return cleansed_count

    # ------------------------------------------------------------------
    # SQL-side FK validation on staging table (scales to 10M+ rows)
    # ------------------------------------------------------------------

    def _validate_single_staging_fk(
        self, cursor: Any, staging_table: str, fk_field: str,
        info: EntityInfo, graph: SchemaGraph, sql_table: str,
    ) -> int:
        """Validate a single FK field in staging. Returns count of deleted orphan rows."""
        parent_table = _find_parent_for_fk(fk_field, info, graph)
        if not parent_table:
            return 0
        parent_info = graph.get(parent_table)
        if not parent_info:
            return 0
        parent_col = parent_info.identity_col or fk_field
        try:
            safe_fk = _validate_column_name(fk_field)
            safe_parent_col = _validate_column_name(parent_col)
            parent_col_type = None
            parent_types = self._db_col_types_cache.get(parent_table, {})
            if parent_types:
                parent_col_type = parent_types.get(parent_col.lower())
            cast_map = {
                "int": "INT", "bigint": "BIGINT", "smallint": "SMALLINT",
                "decimal": _DECIMAL_28_6_CAST, "numeric": _DECIMAL_28_6_CAST,
                "float": "FLOAT",
            }
            cast_type = cast_map.get(parent_col_type, "") if parent_col_type else ""
            fk_expr = f"TRY_CAST(stg.[{safe_fk}] AS {cast_type})" if cast_type else f"stg.[{safe_fk}]"
            null_check = f"stg.[{safe_fk}]" if not cast_type else fk_expr
            delete_sql = (
                f"DELETE stg FROM {staging_table} stg "
                f"WHERE {null_check} IS NOT NULL "
                f"AND NOT EXISTS ("
                f"  SELECT 1 FROM {parent_table} p "
                f"  WHERE p.[{safe_parent_col}] = {fk_expr}"
                f")"
            )
            cursor.execute(delete_sql)
            deleted = cursor.rowcount
            if deleted > 0:
                logger.info("  %s FK pre-check: %d row(s) rejected (%s → %s)",
                            sql_table, deleted, fk_field, parent_table)
            return deleted
        except Exception as exc:
            logger.debug("FK staging check failed for %s.%s: %s", sql_table, fk_field, str(exc)[:120])
            return 0

    def _validate_staging_fks(
        self, cursor: Any, staging_table: str, batch_cols: list[str],
        info: EntityInfo, graph: "SchemaGraph | None",
        _dl: "DeadLetterWriter | None", sql_table: str,
    ) -> int:
        """Validate FK fields in staging table against parent tables using SQL NOT EXISTS."""
        if not info.fk_fields or not graph:
            return 0
        total_rejected = 0
        for fk_field in info.fk_fields:
            if fk_field not in batch_cols:
                continue
            total_rejected += self._validate_single_staging_fk(
                cursor, staging_table, fk_field, info, graph, sql_table,
            )
        return total_rejected

    @staticmethod
    def _build_staging_ddl(staging_table: str, cols: list[str], col_types: dict[str, str]) -> str:
        """Generate CREATE TABLE DDL for the staging temp table.
        
        All columns use NVARCHAR(MAX) to accept any source data.
        TRY_CAST cleanse runs on staging before MERGE to fix bad values.
        """
        col_defs = [f"[{c}] NVARCHAR(MAX) NULL" for c in cols]
        return f"CREATE TABLE {staging_table} ({', '.join(col_defs)})"

    def _build_batch_merge_sql(
        self, sql_table: str, staging_table: str, cols: list[str],
        merge_keys: frozenset[str], db_columns: frozenset[str] | None,
        info: EntityInfo, col_types: dict[str, str] | None = None,
    ) -> str:
        """Generate a MERGE statement from staging table into target.
        
        Since staging uses NVARCHAR(MAX) for all columns, we use TRY_CAST
        in the USING subquery to convert to target types before matching.
        """
        # Build a USING subquery that casts staging columns to target types
        cast_exprs = []
        for c in cols:
            cast_expr = self._cast_expr(c, col_types)
            cast_exprs.append(f"{cast_expr} AS [{c}]")
        using_select = ", ".join(cast_exprs)

        # ON clause with NULL-safe comparison
        on_parts = []
        for c in sorted(merge_keys):
            on_parts.append(
                f"(target.[{c}] = src.[{c}] OR (target.[{c}] IS NULL AND src.[{c}] IS NULL))"
            )
        on_clause = _AND_JOIN.join(on_parts)

        # UPDATE clause: exclude merge keys, system cols, identity
        no_update = merge_keys | MergeBuilder._SYS | ({info.identity_col} if info.identity_col else set())
        upd_cols = [c for c in cols if c not in no_update]
        has_modified_at = db_columns is None or "modified_at" in db_columns
        if upd_cols:
            upd = ", ".join(f"target.[{c}] = src.[{c}]" for c in upd_cols)
            if has_modified_at:
                upd += ", target.[modified_at] = SYSUTCDATETIME()"
        else:
            upd = "target.[modified_at] = SYSUTCDATETIME()" if has_modified_at else "target.[source_system_id] = src.[source_system_id]"

        # INSERT clause
        ins_cols = ", ".join(f"[{c}]" for c in cols)
        ins_vals = ", ".join(f"src.[{c}]" for c in cols)

        return (
            f"MERGE INTO {sql_table} AS target\n"
            f"USING (SELECT {using_select} FROM {staging_table}) AS src\n"
            f"ON {on_clause}\n"
            f"WHEN MATCHED THEN UPDATE SET {upd}\n"
            f"WHEN NOT MATCHED THEN INSERT ({ins_cols}) VALUES ({ins_vals});"
        )

    @staticmethod
    def _cast_expr(col: str, col_types: dict[str, str] | None) -> str:
        """Generate TRY_CAST expression for a staging column based on target type."""
        if not col_types:
            return f"[{col}]"
        # Lowercase lookup: col_types keys are normalized to lowercase
        target_type = col_types.get(col.lower(), "").lower()
        _TYPE_CAST_MAP = {
            "int": "INT", "bigint": "BIGINT", "smallint": "SMALLINT", "tinyint": "TINYINT",
            "decimal": _DECIMAL_28_6_CAST, "numeric": _DECIMAL_28_6_CAST,
            "money": "DECIMAL(19,4)", "smallmoney": "DECIMAL(10,4)",
            "float": "FLOAT", "real": "REAL",
            "bit": "BIT",
            "datetime": "DATETIME", "datetime2": "DATETIME2", "date": "DATE",
            "smalldatetime": "SMALLDATETIME", "time": "TIME",
        }
        cast_type = _TYPE_CAST_MAP.get(target_type)
        if cast_type:
            return f"TRY_CAST([{col}] AS {cast_type})"
        return f"[{col}]"

    def _capture_batch_pks(
        self, cursor: Any, sql_table: str, info: EntityInfo,
        bk_fields: list[str], rows: list[dict],
    ) -> dict[Any, Any]:
        """Capture identity PKs for business keys after batch load."""
        new_pks: dict[Any, Any] = {}
        if not info.identity_col or not bk_fields:
            return new_pks

        # Collect unique business key values from the loaded rows
        bk_values: set[Any] = set()
        for row in rows:
            for bk in bk_fields:
                val = row.get(bk)
                if val is not None:
                    bk_values.add(val)

        if not bk_values:
            return new_pks

        # Query PKs in batches to avoid parameter limits
        id_col = _validate_column_name(info.identity_col)
        bk_col = _validate_column_name(bk_fields[0])
        PK_BATCH = 500
        bk_list = list(bk_values)

        for i in range(0, len(bk_list), PK_BATCH):
            chunk = bk_list[i:i + PK_BATCH]
            placeholders = ", ".join("?" for _ in chunk)
            try:
                cursor.execute(
                    f"SELECT [{bk_col}], [{id_col}] FROM {sql_table} WHERE [{bk_col}] IN ({placeholders})",
                    chunk,
                )
                for row in cursor.fetchall():
                    new_pks[row[0]] = row[1]
            except Exception as exc:
                logger.debug("PK capture failed for %s: %s", sql_table, str(exc)[:80])
                break

        return new_pks

    def _load_entity_with_pks(
        self, cursor: Any, sql_table: str, rows: list[dict],
        info: EntityInfo, dl: DeadLetterWriter, pending: int,
        full_refresh: bool = False,
    ) -> tuple[int, int, int, dict[Any, Any]]:
        """
        Load entity rows and capture generated PKs for the progressive FK cache.
        Returns (loaded, failed, pending, {business_key_value: pk_value}).
        """
        new_pks: dict[Any, Any] = {}
        loaded = failed = 0
        lookup_caches = self._build_lookup_caches(cursor, rows)

        # Safety: clear stale IDENTITY_INSERT state from pooled connections
        if info.identity_col:
            try:
                cursor.execute(f"SET IDENTITY_INSERT {sql_table} OFF")
            except Exception:
                pass

        # Enable IDENTITY_INSERT if any row provides an explicit identity value
        needs_identity_insert = (
            info.identity_col
            and any(row.get(info.identity_col) not in (None, 0) for row in rows)
        )
        if needs_identity_insert:
            try:
                cursor.execute(f"SET IDENTITY_INSERT {sql_table} ON")
            except Exception as exc:
                logger.warning("IDENTITY_INSERT ON failed for %s: %s", sql_table, exc)
                needs_identity_insert = False

        # Determine business key fields for PK cache
        bk_fields = list(info.unique_keys) if info.unique_keys else []
        if not bk_fields and info.natural_key:
            bk_fields = [info.natural_key]

        # Fail-fast: stop retrying after N consecutive FK constraint errors (same error repeating)
        _FAIL_FAST_THRESHOLD = 5
        consecutive_fk_failures = 0
        last_fk_constraint: str | None = None
        fk_aborted = False
        # Error consolidation: count errors by type for summary logging
        error_counts: dict[str, int] = {}

        for row in rows:
            row.pop("_fk_context", None)

            # Fail-fast: if we've seen the same FK error N times in a row, dead-letter remaining
            if fk_aborted:
                dl.reject(sql_table, row, f"skipped (fail-fast): {last_fk_constraint}")
                failed += 1
                continue

            if self._resolve_row_lookups(row, lookup_caches, info, sql_table, dl):
                failed += 1
                continue

            if needs_identity_insert and info.identity_col in row and row[info.identity_col] is not None:
                try:
                    row[info.identity_col] = int(row[info.identity_col])
                except (ValueError, TypeError):
                    pass

            skip_validation = self._apply_entity_defaults(row, info)

            missing = validate_required(row, info.required_fields - skip_validation)
            if missing:
                dl.reject(sql_table, row, f"missing required (no default): {missing}")
                failed += 1
                continue

            cols = self._prepare_row_columns(row, info, getattr(self, '_db_col_cache', {}).get(sql_table))
            if not cols:
                dl.reject(sql_table, row, _NO_NONNULL_COLS_MSG)
                failed += 1
                continue

            if self._execute_row_sql(cursor, sql_table, row, cols, info, dl, full_refresh):
                loaded  += 1
                pending += 1
                consecutive_fk_failures = 0  # Reset on success
                # Capture generated PK for FK cache
                if info.identity_col and bk_fields:
                    pk_val = self._get_last_identity(cursor, row, info)
                    if pk_val is not None:
                        # Cache by each business key value
                        for bk in bk_fields:
                            bk_val = row.get(bk)
                            if bk_val is not None:
                                new_pks[bk_val] = pk_val
                    else:
                        logger.debug("FK cache: could not capture identity for %s (identity=%s)",
                                     sql_table, info.identity_col)
            else:
                failed += 1
                # Track consecutive constraint failures for fail-fast
                last_err = getattr(self, '_last_row_error', '')
                is_constraint_err = (
                    _ERR_547 in last_err or _ERR_23000 in last_err
                    or _ERR_2627 in last_err or _ERR_2601 in last_err
                )
                if is_constraint_err:
                    # Extract constraint name for grouping (FK_, UQ_, PK_, IX_ etc.)
                    constraint_match = re.search(r'constraint\s+"(\w+)"', last_err)
                    err_name = constraint_match.group(1) if constraint_match else "constraint_violation"
                    error_counts[err_name] = error_counts.get(err_name, 0) + 1
                    if last_fk_constraint == err_name:
                        consecutive_fk_failures += 1
                    else:
                        last_fk_constraint = err_name
                        consecutive_fk_failures = 1
                    if consecutive_fk_failures >= _FAIL_FAST_THRESHOLD:
                        remaining = len(rows) - (loaded + failed)
                        logger.warning(
                            "%s: fail-fast after %d consecutive errors (%s) — "
                            "skipping ~%d remaining rows",
                            sql_table, consecutive_fk_failures, err_name, remaining,
                        )
                        fk_aborted = True
                else:
                    consecutive_fk_failures = 0
                    err_key = last_err[:60] if last_err else "unknown"
                    error_counts[err_key] = error_counts.get(err_key, 0) + 1

        if needs_identity_insert:
            try:
                cursor.execute(f"SET IDENTITY_INSERT {sql_table} OFF")
            except Exception:
                pass

        # Log consolidated error summary (instead of per-row noise)
        if error_counts:
            for err_type, count in error_counts.items():
                logger.error("  %s │ %s × %d row(s)", sql_table, err_type, count)

        return loaded, failed, pending, new_pks

    @staticmethod
    def _try_explicit_identity(row: dict, info: EntityInfo) -> int | None:
        """Strategy 1: Return explicit identity value from the row."""
        if info.identity_col and info.identity_col in row and row[info.identity_col] is not None:
            try:
                return int(row[info.identity_col])
            except (ValueError, TypeError):
                pass
        return None

    @staticmethod
    def _try_scd2_identity(cursor: Any, row: dict, info: EntityInfo) -> int | None:
        """Strategy 2: Query identity for SCD2 entities using unique key."""
        if not (info.is_scd2 and info.identity_col):
            return None
        for uk_field in info.unique_keys:
            if uk_field == info.identity_col:
                continue
            uk_val = row.get(uk_field)
            if uk_val is None:
                continue
            try:
                id_col = _validate_column_name(info.identity_col)
                uk_col = _validate_column_name(uk_field)
                sql = (
                    f"SELECT [{id_col}] FROM {info.sql_table} "
                    f"WHERE [{uk_col}] = ? AND [is_current] = 1"
                )
                logger.debug("SCD2 identity resolve: %s with %s=%r", info.sql_table, uk_col, uk_val)
                cursor.execute(sql, uk_val)
                result = cursor.fetchone()
                if result and result[0] is not None:
                    logger.debug("SCD2 identity resolve: %s → %s", info.sql_table, result[0])
                    return int(result[0])
                else:
                    logger.debug("SCD2 identity resolve: no result for %s=%r", uk_col, uk_val)
            except Exception as exc:
                logger.debug("SCD2 identity resolve failed for %s.%s=%r: %s", info.sql_table, uk_field, uk_val, exc)
                continue
        return None

    @staticmethod
    def _try_scope_identity(cursor: Any) -> int | None:
        """Strategy 3: SCOPE_IDENTITY() for non-SCD2 entities."""
        try:
            cursor.execute("SELECT SCOPE_IDENTITY()")
            result = cursor.fetchone()
            if result and result[0] is not None:
                return int(result[0])
        except Exception:
            pass
        return None

    @staticmethod
    def _try_uk_identity(cursor: Any, row: dict, info: EntityInfo) -> int | None:
        """Strategy 4: Query by unique key (SCOPE_IDENTITY fails after MERGE)."""
        if not info.identity_col:
            return None
        for uk_field in info.unique_keys:
            if uk_field == info.identity_col:
                continue
            uk_val = row.get(uk_field)
            if uk_val is None:
                continue
            try:
                id_col = _validate_column_name(info.identity_col)
                uk_col = _validate_column_name(uk_field)
                sql = f"SELECT [{id_col}] FROM {info.sql_table} WHERE [{uk_col}] = ?"
                cursor.execute(sql, uk_val)
                result = cursor.fetchone()
                if result and result[0] is not None:
                    return int(result[0])
            except Exception:
                continue
        return None

    @staticmethod
    def _get_last_identity(cursor: Any, row: dict, info: EntityInfo) -> int | None:
        """Retrieve the last inserted IDENTITY value (or explicit if provided)."""
        result = TenantLoader._try_explicit_identity(row, info)
        if result is not None:
            return result
        result = TenantLoader._try_scd2_identity(cursor, row, info)
        if result is not None:
            return result
        result = TenantLoader._try_scope_identity(cursor)
        if result is not None:
            return result
        return TenantLoader._try_uk_identity(cursor, row, info)

    @staticmethod
    def _populate_lookup_cache(cursor: Any, ref: _LookupRef) -> dict:
        """Fetch all rows from a lookup table into a match→return dict.
        Stores both original-case and lowercase keys for case-insensitive UUID matching."""
        try:
            match_col = _validate_column_name(ref.match_col)
            return_col = _validate_column_name(ref.return_col)
            cursor.execute(f"SELECT [{match_col}], [{return_col}] FROM {ref.table}")
            cache = {}
            for r in cursor.fetchall():
                cache[r[0]] = r[1]
                # Add lowercase key for case-insensitive matching (UUID/string)
                if isinstance(r[0], str):
                    cache[r[0].lower()] = r[1]
            return cache
        except Exception as exc:
            logger.warning("Bulk lookup cache failed for %s: %s", ref.table, exc)
            return {}

    @staticmethod
    def _build_lookup_caches(cursor: Any, rows: list[dict]) -> dict[tuple, dict]:
        """Bulk-fetch lookup caches to avoid N+1 queries."""
        caches: dict[tuple, dict] = {}
        for row in rows:
            for col, val in row.items():
                if isinstance(val, _LookupRef):
                    # Walk the chain to collect caches for nested lookups too
                    ref = val
                    while isinstance(ref, _LookupRef):
                        key = (ref.table, ref.match_col, ref.return_col)
                        if key not in caches:
                            caches[key] = TenantLoader._populate_lookup_cache(cursor, ref)
                        ref = ref.value
        return caches

    @staticmethod
    def _resolve_lookup_chain(val: _LookupRef, lookup_caches: dict[tuple, dict]) -> None:
        """Resolve chained lookups: if val.value is itself a _LookupRef, resolve it first."""
        inner = val
        while isinstance(inner.value, _LookupRef):
            inner_ref = inner.value
            inner_key = (inner_ref.table, inner_ref.match_col, inner_ref.return_col)
            inner_cache = lookup_caches.get(inner_key, {})
            resolved_inner = inner_cache.get(inner_ref.value)
            if resolved_inner is None and isinstance(inner_ref.value, str):
                resolved_inner = inner_cache.get(inner_ref.value.lower())
            inner.value = resolved_inner
            if resolved_inner is None:
                break
            inner = val

    @staticmethod
    def _lookup_with_fallback(cache: dict, value: Any) -> Any:
        """Look up value in cache with case-insensitive string fallback."""
        resolved = cache.get(value)
        if resolved is None and isinstance(value, str):
            resolved = cache.get(value.lower())
        return resolved

    @staticmethod
    def _resolve_row_lookups(
        row: dict, lookup_caches: dict[tuple, dict],
        info: EntityInfo, sql_table: str, dl: DeadLetterWriter,
    ) -> bool:
        """Resolve _LookupRef values in row. Returns True if a REQUIRED FK lookup failed."""
        for col, val in list(row.items()):
            if not isinstance(val, _LookupRef):
                continue
            TenantLoader._resolve_lookup_chain(val, lookup_caches)
            key = (val.table, val.match_col, val.return_col)
            cache = lookup_caches.get(key, {})
            resolved = TenantLoader._lookup_with_fallback(cache, val.value)
            row[col] = resolved
            if resolved is None and col in info.fk_fields:
                if col in info.required_fields:
                    dl.reject(sql_table, row, f"FK lookup failed: {col}={val!r} not found in {val.table}")
                    return True
                else:
                    logger.debug("FK lookup soft-fail: %s.%s=%r → NULL (nullable)", sql_table, col, val)
        return False

    @staticmethod
    def _should_skip_default(col: str, row: dict, info: EntityInfo) -> bool:
        """Check if a column should be skipped during default filling."""
        if col in info.fk_fields:
            return True
        if col == info.identity_col:
            return True
        return col in row and row[col] is not None

    def _apply_entity_defaults(self, row: dict, info: EntityInfo) -> set[str]:
        """Auto-fill missing non-datetime columns with defaults. Returns skip_validation set."""
        skip_validation: set[str] = set()
        not_null_cols = self._db_not_null_cache.get(info.sql_table, set())
        for col, data_type in info.field_types.items():
            if self._should_skip_default(col, row, info):
                continue
            base_type = data_type.strip().split("(")[0].lower() if data_type else ""
            if base_type in NULLABLE_TYPES:
                # NOT NULL string columns get empty string; nullable ones stay None
                is_not_null = col.lower() in not_null_cols or col in info.required_fields
                if is_not_null and base_type not in (
                    "datetime", "datetime2", "smalldatetime", "date", "time",
                ):
                    row[col] = ""
                else:
                    skip_validation.add(col)
                continue
            fill = default_for_type(data_type)
            if fill is not None:
                row[col] = fill
        return skip_validation

    @staticmethod
    def _ensure_merge_keys(
        cols: list[str], merge_keys: frozenset, exclude: set[str],
        known_cols: set[str] | None, row: dict,
    ) -> None:
        """Ensure unique key columns are in cols for MERGE (even if value is None)."""
        for mk in merge_keys:
            if mk in cols or mk in exclude:
                continue
            if known_cols is not None and mk not in known_cols:
                continue
            if mk not in row:
                row[mk] = None
            cols.append(mk)

    @staticmethod
    def _prepare_row_columns(row: dict, info: EntityInfo, db_columns: frozenset[str] | None = None) -> list[str]:
        """Build column list for insertion, excluding identity and SCD2 system columns.

        If the row has an explicit non-None value for the identity column
        (provided by field mapping), include it — the caller will use
        SET IDENTITY_INSERT ON to preserve source IDs.

        Columns not present in the actual DB table are excluded to prevent
        'Invalid column name' errors (canonical schema may be out of sync).

        Unique key columns are always included (even with NULL values) so that
        MERGE statements can match existing rows on those keys.
        """
        exclude: set[str] = set()
        if info.identity_col and not row.get(info.identity_col):
            exclude.add(info.identity_col)
        if info.is_scd2:
            exclude |= {"is_current", "effective_start_date", "effective_end_date", "created_at"}
        # Unique key columns (minus identity) must be in cols even if NULL for MERGE matching
        merge_keys = (info.unique_keys - {info.identity_col}) if info.identity_col else info.unique_keys
        # Use actual DB columns (introspected) if available; fall back to canonical field_types
        if db_columns:
            known_cols = set(db_columns)
        elif info.field_types:
            known_cols = set(info.field_types)
        else:
            known_cols = None
        cols = sorted(
            c for c, v in row.items()
            if v is not None
            and _SAFE_IDENT.match(c)
            and c not in exclude
            and (known_cols is None or c in known_cols)
        )
        # Ensure unique key columns are included for MERGE (even if value is None)
        TenantLoader._ensure_merge_keys(cols, merge_keys, exclude, known_cols, row)
        cols.sort()
        return cols

    def _execute_scd2(
        self, cursor: Any, sql_table: str, row: dict, cols: list[str], info: EntityInfo,
    ) -> bool:
        """Execute SCD2 close+insert atomically. Returns False if natural key is NULL."""
        nk_val = row.get(info.natural_key)
        if nk_val is None:
            return False
        cursor.execute("SAVE TRANSACTION scd2_row")
        try:
            cursor.execute(self._merger.build_scd2_close(sql_table, info.natural_key), nk_val)
            cursor.execute(self._merger.build_scd2_insert(sql_table, cols), [row[c] for c in cols])
        except Exception:
            cursor.execute("ROLLBACK TRANSACTION scd2_row")
            raise
        return True

    def _retry_error_544(self, cursor: Any, sql_table: str, row: dict, cols: list[str], info: EntityInfo) -> bool:
        """Retry with IDENTITY_INSERT ON for error 544."""
        id_col = info.identity_col or next(
            (c for c in cols if c.endswith(('_id', '_key'))
             and isinstance(row.get(c), (int, float))), None
        )
        if not id_col or id_col not in cols:
            return False
        try:
            logger.debug("%s auto-retry: IDENTITY_INSERT ON (error 544, col=%s)", sql_table, id_col)
            cursor.execute(f"SET IDENTITY_INSERT {sql_table} ON")
            merge_keys = info.unique_keys - {id_col}
            if not merge_keys or not merge_keys.issubset(cols):
                cursor.execute(self._merger.build_fact_insert(sql_table, cols), [row[c] for c in cols])
            else:
                cursor.execute(self._merger.build_merge(sql_table, cols, merge_keys), [row[c] for c in cols])
            cursor.execute(f"SET IDENTITY_INSERT {sql_table} OFF")
            return True
        except Exception as retry_exc:
            try:
                cursor.execute(f"SET IDENTITY_INSERT {sql_table} OFF")
            except Exception:
                pass
            logger.warning("%s identity retry also failed: %s", sql_table, retry_exc)
            return False

    def _retry_error_545(self, cursor: Any, sql_table: str, row: dict, cols: list[str], info: EntityInfo) -> bool:
        """Retry by stripping identity col for error 545."""
        id_col = info.identity_col
        if not id_col or id_col not in cols:
            return False
        retry_cols = [c for c in cols if c != id_col]
        if not retry_cols:
            return False
        try:
            logger.debug("%s auto-retry: strip identity col '%s' (error 545)", sql_table, id_col)
            merge_keys = info.unique_keys - {id_col}
            if not merge_keys or not merge_keys.issubset(retry_cols):
                cursor.execute(self._merger.build_fact_insert(sql_table, retry_cols), [row[c] for c in retry_cols])
            else:
                cursor.execute(self._merger.build_merge(sql_table, retry_cols, merge_keys), [row[c] for c in retry_cols])
            return True
        except Exception as retry_exc:
            logger.warning("%s identity-strip retry also failed: %s", sql_table, retry_exc)
            return False

    def _retry_error_547(self, cursor: Any, sql_table: str, row: dict, cols: list[str], info: EntityInfo, err_msg: str) -> bool:
        """Retry by NULLing the offending FK for error 547."""
        fk_col_match = re.search(r"column\s+'(\w+)'", err_msg)
        if not fk_col_match:
            return False
        fk_col = fk_col_match.group(1)
        if fk_col not in cols or fk_col in info.required_fields:
            return False
        try:
            logger.info("%s retry with %s=NULL (FK constraint, error 547)", sql_table, fk_col)
            row[fk_col] = None
            retry_cols = [c for c in cols if c != fk_col]
            merge_keys = info.unique_keys - {info.identity_col} if info.identity_col else info.unique_keys
            db_cols = getattr(self, '_db_col_cache', {}).get(sql_table)
            if not merge_keys or not merge_keys.issubset(retry_cols):
                cursor.execute(self._merger.build_fact_insert(sql_table, retry_cols), [row[c] for c in retry_cols])
            else:
                cursor.execute(self._merger.build_merge(sql_table, retry_cols, merge_keys, db_cols, info.identity_col), [row[c] for c in retry_cols])
            return True
        except Exception as retry_exc:
            logger.warning("%s FK-null retry also failed: %s", sql_table, retry_exc)
            return False

    def _execute_row_sql(
        self, cursor: Any, sql_table: str, row: dict,
        cols: list[str], info: EntityInfo, dl: DeadLetterWriter,
        full_refresh: bool = False,
    ) -> bool:
        # Issue 3 fix: pre-validate required FK fields before attempting SQL
        if info.fk_fields:
            for fk_field in info.fk_fields:
                if fk_field in cols and row.get(fk_field) is None:
                    # Check if this FK column has a DB-level NOT NULL or FK constraint
                    # by checking if it's in required_fields
                    if fk_field in info.required_fields:
                        dl.reject(sql_table, row, f"required FK '{fk_field}' is NULL (parent not loaded)")
                        return False
        # Detect if row provides an explicit identity value (source-provided IDs)
        has_explicit_identity = (
            info.identity_col
            and info.identity_col in cols
            and row.get(info.identity_col) not in (None, 0)
        )
        try:
            if has_explicit_identity:
                cursor.execute(f"SET IDENTITY_INSERT {sql_table} ON")
            if info.is_scd2 and info.natural_key and not full_refresh:
                if not self._execute_scd2(cursor, sql_table, row, cols, info):
                    if has_explicit_identity:
                        cursor.execute(f"SET IDENTITY_INSERT {sql_table} OFF")
                    dl.reject(sql_table, row, f"SCD2 natural_key '{info.natural_key}' is NULL")
                    return False
            elif info.table_type in FACT_TYPES:
                # Use MERGE if unique keys are available to handle pre-existing rows
                merge_keys = info.unique_keys - {info.identity_col} if info.identity_col else info.unique_keys
                db_cols = getattr(self, '_db_col_cache', {}).get(sql_table)
                if merge_keys and merge_keys.issubset(cols):
                    cursor.execute(self._merger.build_merge(sql_table, cols, merge_keys, db_cols, info.identity_col), [row[c] for c in cols])
                else:
                    cursor.execute(self._merger.build_fact_insert(sql_table, cols), [row[c] for c in cols])
            else:
                # Exclude identity col from unique_keys for MERGE matching
                merge_keys = info.unique_keys - {info.identity_col} if info.identity_col else info.unique_keys
                db_cols = getattr(self, '_db_col_cache', {}).get(sql_table)
                # Ensure IDENTITY_INSERT is OFF before MERGE (defensive against stale session state)
                if info.identity_col and not has_explicit_identity:
                    try:
                        cursor.execute(f"SET IDENTITY_INSERT {sql_table} OFF")
                    except Exception:
                        pass
                if not merge_keys or not merge_keys.issubset(cols):
                    cursor.execute(self._merger.build_fact_insert(sql_table, cols), [row[c] for c in cols])
                else:
                    cursor.execute(self._merger.build_merge(sql_table, cols, merge_keys, db_cols, info.identity_col), [row[c] for c in cols])
            if has_explicit_identity:
                cursor.execute(f"SET IDENTITY_INSERT {sql_table} OFF")
            return True
        except Exception as exc:
            if has_explicit_identity:
                try:
                    cursor.execute(f"SET IDENTITY_INSERT {sql_table} OFF")
                except Exception:
                    pass
            # ── Dynamic error-recovery retry ─────────────────────────────
            err_msg = str(exc)
            if '(544)' in err_msg and not has_explicit_identity:
                if self._retry_error_544(cursor, sql_table, row, cols, info):
                    return True
            elif '(545)' in err_msg:
                if self._retry_error_545(cursor, sql_table, row, cols, info):
                    return True
            elif _ERR_547 in err_msg:
                if self._retry_error_547(cursor, sql_table, row, cols, info, err_msg):
                    return True
            dl.reject(sql_table, row, str(exc))
            # Store error for fail-fast detection (accessed by _load_entity_with_pks)
            self._last_row_error = str(exc)
            # Only log non-constraint errors individually (constraint errors are summarized by the caller)
            err_msg = str(exc)
            if not any(code in err_msg for code in (_ERR_547, _ERR_23000, _ERR_2627, _ERR_2601)):
                self._log_insert_failure(sql_table, exc)
            return False

    @staticmethod
    def _log_insert_failure(sql_table: str, exc: Exception) -> None:
        """Log a structured, actionable error message for a failed row insert."""
        err_msg = str(exc)
        # FK constraint violation (error 547)
        fk_match = re.search(
            r"constraint\s+\"(FK_\w+)\"[^\"]*table\s+\"([^\"]+)\"[^']*column\s+'(\w+)'",
            err_msg,
        )
        if fk_match:
            constraint, ref_table, ref_col = fk_match.groups()
            logger.error(
                "LOAD FAILED │ %s │ FK violation: constraint %s → "
                "referenced row not found in %s.%s  "
                "(Action: ensure the parent entity is mapped and loaded before this entity)",
                sql_table, constraint, ref_table, ref_col,
            )
            return
        # Duplicate key (error 2627)
        if '(2627)' in err_msg:
            logger.error(
                "LOAD FAILED │ %s │ Duplicate key — row already exists with same unique key",
                sql_table,
            )
            return
        # Generic — log the first meaningful line without the full stack
        short = err_msg.split("\n")[0][:200] if "\n" in err_msg else err_msg[:200]
        logger.error("LOAD FAILED │ %s │ %s", sql_table, short)
