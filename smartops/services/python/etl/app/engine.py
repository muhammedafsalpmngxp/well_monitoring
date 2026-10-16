"""ETL Engine: thin orchestrator for Extract → Transform → Load lifecycle."""

import logging
import os
import re
import threading
from collections import defaultdict
from datetime import datetime, timezone

from .client import ControlPlaneClient
from .extract import DataExtractor, _validate_table_name, _validate_column_name
from .load import TenantLoader
from .models import RunResponse
from .transform import transform_batch, set_fk_resolve_cache, TransformTracer, set_active_tracer, discover_abbreviations, clear_abbrev_cache

# ── Streaming mode control ─────────────────────────────────────────────────────
# When enabled, processes extraction batches incrementally instead of holding all
# three datasets (source + transformed + entity) simultaneously. Reduces peak
# memory from ~3×N to ~1.5×N. Entity rows are still accumulated for FK-safe loading.
ENABLE_STREAMING: bool = os.environ.get("ETL_ENABLE_STREAMING", "1").lower() in ("1", "true", "yes")

logger = logging.getLogger("smartops.etl.engine")

try:
    import pyodbc as _pyodbc
except ImportError:
    _pyodbc = None  # type: ignore


class ETLEngine:
    """
    Sequences Extract → Transform → Load and manages the IngestionRun lifecycle.
    All heavy lifting is in DataExtractor, transform_batch, and TenantLoader.
    """

    def __init__(self, client: ControlPlaneClient) -> None:
        self._client    = client
        self._extractor = DataExtractor(client)
        self._loader    = TenantLoader(client)
        self._locks: dict[int, threading.Lock] = {}
        self._locks_guard = threading.Lock()

    def _get_lock(self, tenant_source_id: int) -> threading.Lock:
        """Get or create a per-tenant-source lock to prevent concurrent runs."""
        with self._locks_guard:
            if tenant_source_id not in self._locks:
                self._locks[tenant_source_id] = threading.Lock()
            return self._locks[tenant_source_id]


    def execute_run(self, tenant_source_id: int, full_refresh: bool = False) -> RunResponse:
        """Execute a full ETL cycle and return the outcome."""
        lock = self._get_lock(tenant_source_id)
        if not lock.acquire(blocking=False):
            logger.warning("ETL run already in progress for ts=%d — rejecting", tenant_source_id)
            return RunResponse(
                tenant_source_id=tenant_source_id,
                status="Failed",
                message=f"ETL run already in progress for tenant-source {tenant_source_id}",
            )
        try:
            return self._execute_run_locked(tenant_source_id, full_refresh)
        finally:
            clear_abbrev_cache()
            lock.release()

    _BANNER = "═" * 60

    def _execute_run_locked(self, tenant_source_id: int, full_refresh: bool) -> RunResponse:
        """Internal: run ETL while holding the per-tenant-source lock."""
        mode = "FULL REFRESH" if full_refresh else "INCREMENTAL"
        logger.info("")
        logger.info(self._BANNER)
        logger.info("  ETL RUN START  │  tenant_source=%d  │  mode=%s", tenant_source_id, mode)
        logger.info(self._BANNER)

        ts = self._client.get_tenant_source(tenant_source_id)
        if ts is None:
            logger.warning("Tenant-source %d not found — aborting run", tenant_source_id)
            return RunResponse(
                tenant_source_id=tenant_source_id,
                status="Failed",
                message=f"Tenant-source {tenant_source_id} not found",
            )

        started_at = datetime.now(timezone.utc).isoformat()
        run        = self._client.create_ingestion_run(tenant_source_id, started_at)
        run_id     = run.get("ingestionRunId")
        logger.info("Run id=%s created for tenant_source=%d", run_id, tenant_source_id)

        rows_extracted = rows_loaded = error_count = 0
        try:
            mappings = self._client.get_field_mappings(tenant_source_id)
            if not mappings:
                raise ValueError("No field mappings configured for this tenant-source")

            # Fetch canonical metadata ONCE (shared by classify, enrich, and load)
            cf_list = self._client.get_canonical_fields()
            ce_list = self._client.get_canonical_entities()

            # Pre-build metadata structures reused across phases (eliminates redundant API calls)
            field_meta, graph = self._loader.build_metadata_from(cf_list, ce_list)
            _cf_by_id = {cf["canonicalFieldId"]: cf for cf in cf_list if cf.get("isActive")}

            # Classify source objects: ref-feeding vs core-feeding
            ref_sources = self._classify_ref_sources(mappings, cf_list, ce_list)

            # Pre-build source FK resolution caches for fk_resolve() transforms
            fk_cache = self._build_fk_resolve_cache(ts, mappings)
            set_fk_resolve_cache(fk_cache)

            # Pre-discover abbreviation mappings from source data (for abbrev() transforms)
            self._pre_discover_abbreviations(ts, mappings)

            # Enrich mappings with target field metadata for auto-coercion
            self._enrich_mappings_with_target_metadata(mappings, cf_list)

            # ── Phase 1+2+3: EXTRACT → TRANSFORM → LOAD ─────────────────
            if ENABLE_STREAMING:
                rows_extracted, rows_loaded, error_count = self._execute_streaming(
                    ts, mappings, full_refresh, ref_sources, run_id,
                    field_meta, graph, _cf_by_id,
                )
            else:
                rows_extracted, rows_loaded, error_count = self._execute_sequential(
                    ts, mappings, full_refresh, ref_sources, run_id,
                    field_meta, graph, _cf_by_id,
                )

            finished_at = datetime.now(timezone.utc).isoformat()
            elapsed = (datetime.fromisoformat(finished_at) - datetime.fromisoformat(started_at)).total_seconds()
            self._client.update_ingestion_run(
                run_id,
                tenantSourceId=tenant_source_id,
                startedAt=started_at,
                finishedAt=finished_at,
                status="Completed",
                rowsExtracted=rows_extracted,
                rowsLoaded=rows_loaded,
                errorCount=error_count,
            )
            status_label = "COMPLETED" if error_count == 0 else "COMPLETED WITH ERRORS"
            logger.info("")
            logger.info(self._BANNER)
            logger.info("  RUN SUMMARY  │  run_id=%s  │  %s", run_id, status_label)
            logger.info(self._BANNER)
            logger.info("  Extracted   : %d rows", rows_extracted)
            logger.info("  Loaded      : %d rows", rows_loaded)
            logger.info("  Errors      : %d", error_count)
            logger.info("  Duration    : %.1fs", elapsed)
            logger.info(self._BANNER)
            logger.info("")
            return RunResponse(
                ingestion_run_id=run_id,
                tenant_source_id=tenant_source_id,
                status="Completed",
                message=f"Extracted {rows_extracted}, loaded {rows_loaded}, errors {error_count}",
            )

        except Exception as exc:
            finished_at = datetime.now(timezone.utc).isoformat()
            elapsed = (datetime.fromisoformat(finished_at) - datetime.fromisoformat(started_at)).total_seconds()
            logger.info("")
            logger.info(self._BANNER)
            logger.info("  RUN FAILED  │  run_id=%s  │  %.1fs", run_id, elapsed)
            logger.info(self._BANNER)
            logger.exception("  Reason: %s", exc)
            logger.info(self._BANNER)
            logger.info("")
            try:
                self._client.update_ingestion_run(
                    run_id,
                    tenantSourceId=tenant_source_id,
                    startedAt=started_at,
                    finishedAt=finished_at,
                    status="Failed",
                    rowsExtracted=rows_extracted,
                    rowsLoaded=rows_loaded,
                    errorCount=error_count,
                )
            except Exception:
                logger.error("Failed to update run status for id=%s", run_id)
            return RunResponse(
                ingestion_run_id=run_id,
                tenant_source_id=tenant_source_id,
                status="Failed",
                message="ETL run failed — check server logs for details",
            )

    # ------------------------------------------------------------------
    # Pipeline execution strategies
    # ------------------------------------------------------------------

    def _execute_streaming(
        self, ts: dict, mappings: list[dict], full_refresh: bool,
        ref_sources: set[str], run_id: int | None,
        field_meta: dict, graph, _cf_by_id: dict,
    ) -> tuple[int, int, int]:
        """
        Streaming pipeline: extract in batches → transform each batch → accumulate
        entity rows → load once.

        Memory profile:
          - During extract+transform: O(batch_size) per batch (source+transformed freed each iteration)
          - Before load: O(total_entity_rows) — all transformed rows accumulated in entity_rows
          - Peak ≈ 1.5× total rows (vs 3× in sequential mode which holds source + transformed + entity)

        The full entity_rows accumulation is required because the load phase performs
        topological FK-ordered insertion with a progressive pk_cache: parent tables must
        be loaded before children so that generated PKs are available for FK resolution.
        Splitting the load would break FK integrity and produce orphan rows.
        """
        logger.info("")
        logger.info("─── STREAMING: EXTRACT + TRANSFORM ─────────────────────")
        entity_rows: dict[str, list[dict]] = defaultdict(list)
        rows_extracted = 0
        t_errors = 0
        eid_map = graph.entity_id_map()
        source_sys_id = ts.get("sourceSystemId")

        with TransformTracer(run_id) as tracer:
            set_active_tracer(tracer)
            batch_idx = 0
            for batch in self._extractor.extract_streaming(ts, mappings, full_refresh, ref_sources):
                rows_extracted += len(batch)
                # Transform this batch
                transformed_chunk, chunk_errors = transform_batch(batch, mappings)
                t_errors += chunk_errors
                # Remap to entity rows
                for row in transformed_chunk:
                    sub = self._loader._remap_single_row(row, field_meta, eid_map)
                    self._loader._attach_fk_context(sub, graph)
                    for sql_table, row_data in sub.items():
                        if source_sys_id is not None:
                            row_data["source_system_id"] = source_sys_id
                        entity_rows[sql_table].append(row_data)
                # Release batch memory
                del batch, transformed_chunk
                batch_idx += 1
                if batch_idx % 10 == 0:
                    logger.debug("Streaming progress: %d rows extracted, %d batches", rows_extracted, batch_idx)
            set_active_tracer(None)

        logger.info("Extract+Transform complete: %d rows → %d entity rows (%d errors)",
                    rows_extracted, sum(len(v) for v in entity_rows.values()), t_errors)

        # ── LOAD ─────────────────────────────────────────────────────────
        logger.info("")
        logger.info("─── PHASE 3: LOAD ──────────────────────────────────────")
        mapped = self._build_mapped_fields(mappings, _cf_by_id, graph.entity_id_map())
        self._warn_unmapped_merge_keys(mapped, graph)
        rows_loaded, l_errors = self._loader.load_entity_rows(
            ts, dict(entity_rows), run_id, full_refresh,
            field_meta=field_meta, graph=graph,
        )
        return rows_extracted, rows_loaded, t_errors + l_errors

    def _execute_sequential(
        self, ts: dict, mappings: list[dict], full_refresh: bool,
        ref_sources: set[str], run_id: int | None,
        field_meta: dict, graph, _cf_by_id: dict,
    ) -> tuple[int, int, int]:
        """
        Original sequential pipeline: extract all → transform all → load all.
        Used as fallback when streaming is disabled.
        """
        # ── Phase 1: EXTRACT ──────────────────────────────────────────
        logger.info("")
        logger.info("─── PHASE 1: EXTRACT ───────────────────────────────────")
        source_data = self._extractor.extract(ts, mappings, full_refresh, ref_sources)
        rows_extracted = len(source_data)
        logger.info("Extract complete: %d rows from source", rows_extracted)

        # ── Phase 2: TRANSFORM ────────────────────────────────────────
        logger.info("")
        logger.info("─── PHASE 2: TRANSFORM ─────────────────────────────────")
        with TransformTracer(run_id) as tracer:
            set_active_tracer(tracer)
            transformed, t_errors = transform_batch(source_data, mappings)
            set_active_tracer(None)
        del source_data
        logger.info("Transform complete: %d → %d rows (%d errors)", rows_extracted, len(transformed), t_errors)

        # ── Phase 3: LOAD ─────────────────────────────────────────────
        logger.info("")
        logger.info("─── PHASE 3: LOAD ──────────────────────────────────────")
        mapped = self._build_mapped_fields(mappings, _cf_by_id, graph.entity_id_map())
        self._warn_unmapped_merge_keys(mapped, graph)
        rows_loaded, l_errors = self._loader.load(
            ts, transformed, run_id, full_refresh,
            field_meta=field_meta, graph=graph,
        )
        return rows_extracted, rows_loaded, t_errors + l_errors

    def preflight_check(self, tenant_source_id: int) -> list[dict]:
        """
        Validate the mapping configuration BEFORE running any ETL.
        Returns a list of issue dicts: {"level": "error"|"warning", "check": str, "detail": str}
        """
        try:
            import pyodbc as _pyodbc
        except ImportError:
            _pyodbc = None

        issues: list[dict] = []
        ctx = self._build_preflight_context(tenant_source_id, _pyodbc, issues)
        if ctx is not None:
            _ts, mappings, tenant_cols, source_cols, cf_by_id, eid_to_table, graph = ctx
            self._validate_field_mappings(
                mappings, tenant_cols, source_cols, cf_by_id, eid_to_table, issues,
            )
            mapped = self._build_mapped_fields(mappings, cf_by_id, eid_to_table)
            self._validate_scd2_keys(mapped, graph, issues)
        return issues

    # ------------------------------------------------------------------
    # Source object classification
    # ------------------------------------------------------------------

    def _classify_ref_sources(
        self, mappings: list[dict],
        cf_list: list[dict] | None = None,
        ce_list: list[dict] | None = None,
    ) -> set[str]:
        """
        Identify source objects that EXCLUSIVELY feed ref-layer tables.
        These are extracted fully (no ROW_LIMIT) to ensure FK integrity.

        Source objects that feed BOTH ref and core layers remain subject to
        ROW_LIMIT (they're typically large transactional tables).

        Returns set of sourceObject names that target ONLY ref-layer entities.
        """
        if cf_list is None:
            cf_list = self._client.get_canonical_fields()
        if ce_list is None:
            ce_list = self._client.get_canonical_entities()

        cf_by_id = {cf["canonicalFieldId"]: cf for cf in cf_list if cf.get("isActive")}
        ce_by_id = {ce["canonicalEntityId"]: ce for ce in ce_list if ce.get("isActive")}

        # Collect layers each source object feeds
        source_layers: dict[str, set[str]] = {}
        for m in mappings:
            src_obj = m.get("sourceObject")
            if not src_obj:
                continue
            cf = cf_by_id.get(m.get("canonicalFieldId"))
            if not cf:
                continue
            ce = ce_by_id.get(cf["canonicalEntityId"])
            if ce:
                source_layers.setdefault(src_obj, set()).add(ce.get("layer", "core"))

        # Only sources that EXCLUSIVELY feed ref layer get unlimited extraction
        ref_sources = {src for src, layers in source_layers.items() if layers == {"ref"}}

        if ref_sources:
            logger.info("Ref-only sources (no row limit): %s", sorted(ref_sources))
        # Log mixed sources for visibility
        mixed = {src for src, layers in source_layers.items() if "ref" in layers and layers != {"ref"}}
        if mixed:
            logger.info("Mixed ref+core sources (row limit applies): %s", sorted(mixed))
        return ref_sources

    # ------------------------------------------------------------------
    # Enrich mappings with target metadata for auto-coercion
    # ------------------------------------------------------------------

    def _enrich_mappings_with_target_metadata(
        self, mappings: list[dict], cf_list: list[dict] | None = None,
    ) -> None:
        """
        Attach target field metadata (_targetDataType, _fieldName, _referenceEntityId)
        to each mapping dict so the transform layer can auto-coerce values based on
        the canonical field's declared data type. No user action needed.
        """
        if cf_list is None:
            cf_list = self._client.get_canonical_fields()
        cf_by_id = {cf["canonicalFieldId"]: cf for cf in cf_list if cf.get("isActive")}
        for m in mappings:
            cf = cf_by_id.get(m.get("canonicalFieldId"))
            if cf:
                m["_targetDataType"] = cf.get("dataType")
                m["_fieldName"] = cf.get("fieldName")
                m["_referenceEntityId"] = cf.get("referenceEntityId")

    # ------------------------------------------------------------------
    # Source FK resolution
    # ------------------------------------------------------------------

    _FK_RESOLVE_RE = re.compile(r'fk_resolve\(([^)]+)\)', re.IGNORECASE)

    def _build_fk_resolve_cache(
        self, tenant_source: dict, mappings: list[dict],
    ) -> dict[str, dict]:
        """
        Scan mappings for fk_resolve() transform rules and pre-build
        source-side lookup caches.

        A rule like  fk_resolve(EquipmentType,ID,Code)  causes us to
        query the source DB:  SELECT [ID], [Code] FROM [EquipmentType]
        and build  { 328: 'HTP18', 329: 'ETE04', ... }

        Returns { "EquipmentType,ID,Code": { <id>: <key>, ... }, ... }
        """
        # Collect unique fk_resolve() param sets from all transform rules
        params_needed: set[str] = set()
        for m in mappings:
            rule = m.get("transformRule") or ""
            for match in self._FK_RESOLVE_RE.finditer(rule):
                params_needed.add(match.group(1))

        if not params_needed:
            return {}

        conn_ref = tenant_source.get("connectionRef", "")
        conn_str = os.environ.get(f"SOURCE_{conn_ref}", conn_ref)
        conn_str = DataExtractor.norm_conn(conn_str)
        if not conn_str or _pyodbc is None:
            logger.warning("Cannot build FK resolve cache — no source connection")
            return {}

        cache: dict[str, dict] = {}
        try:
            conn = _pyodbc.connect(conn_str, timeout=30)
            cur = conn.cursor()
            for params in params_needed:
                parts = [p.strip() for p in params.split(",")]
                if len(parts) != 3:
                    logger.warning("fk_resolve expects 3 params (table,id_col,key_col) — got %r", params)
                    continue
                table, id_col, key_col = parts
                safe_table = _validate_table_name(table)
                safe_id = _validate_column_name(id_col)
                safe_key = _validate_column_name(key_col)
                cur.execute(f"SELECT [{safe_id}], [{safe_key}] FROM [{safe_table}]")
                mapping = {row[0]: row[1] for row in cur.fetchall()}
                cache[params] = mapping
                logger.debug("FK resolve cache: %s → %d entries", params, len(mapping))
            conn.close()
            total_entries = sum(len(v) for v in cache.values())
            logger.info("FK resolve cache: %d lookup(s) built, %d total entries", len(cache), total_entries)
        except Exception as exc:
            logger.warning("Failed to build FK resolve cache: %s", exc)

        return cache

    _ABBREV_RE = re.compile(r'abbrev\b', re.IGNORECASE)

    def _pre_discover_abbreviations(
        self, tenant_source: dict, mappings: list[dict],
    ) -> None:
        """
        Scan mappings for ``abbrev()`` transform rules, query DISTINCT source
        values for the relevant columns, and auto-discover code → full-name
        mappings (acronym detection, parenthetical extraction).

        Populates the module-level ``_DYNAMIC_ABBREVS`` cache used by
        ``_tr_abbrev`` during the streaming transform.
        """
        # Collect unique (sourceObject, sourceField) pairs that use abbrev()
        abbrev_columns: set[tuple[str, str]] = set()
        for m in mappings:
            rule = m.get("transformRule") or ""
            if self._ABBREV_RE.search(rule):
                src_obj = m.get("sourceObject")
                src_field = m.get("sourceField")
                if src_obj and src_field:
                    abbrev_columns.add((src_obj, src_field))

        if not abbrev_columns:
            clear_abbrev_cache()
            return

        conn_ref = tenant_source.get("connectionRef", "")
        conn_str = os.environ.get(f"SOURCE_{conn_ref}", conn_ref)
        conn_str = DataExtractor.norm_conn(conn_str)
        if not conn_str or _pyodbc is None:
            logger.warning("Cannot discover abbreviations — no source connection")
            clear_abbrev_cache()
            return

        all_values: list[str | None] = []
        try:
            conn = _pyodbc.connect(conn_str, timeout=30)
            cur = conn.cursor()
            for table, column in abbrev_columns:
                safe_table = _validate_table_name(table)
                safe_col = _validate_column_name(column)
                cur.execute(f"SELECT DISTINCT [{safe_col}] FROM [{safe_table}]")
                for row in cur.fetchall():
                    all_values.append(row[0])
                logger.debug("Abbreviation pre-scan: %s.%s → %d distinct values",
                            safe_table, safe_col, len(all_values))
            conn.close()
        except Exception as exc:
            logger.warning("Failed to pre-scan for abbreviations: %s", exc)
            clear_abbrev_cache()
            return

        discover_abbreviations(all_values)

    # ------------------------------------------------------------------
    # Preflight helpers
    # ------------------------------------------------------------------

    def _build_preflight_context(
        self, tenant_source_id: int, _pyodbc, issues: list[dict],
    ):
        """Gather prerequisites for preflight; returns None on blocking failure."""
        ts = self._client.get_tenant_source(tenant_source_id)
        if ts is None:
            issues.append({"level": "error", "check": "tenant_source",
                           "detail": f"tenant_source_id={tenant_source_id} not found"})
            return None

        mappings = self._client.get_field_mappings(tenant_source_id)
        if not mappings:
            issues.append({"level": "error", "check": "field_mappings",
                           "detail": f"No active FieldMappings for tenant_source_id={tenant_source_id}"})
            return None

        tenant = self._client.get_tenant(ts.get("tenantId"))
        if not tenant or not tenant.get("dataPlaneRef"):
            issues.append({"level": "error", "check": "tenant_db",
                           "detail": "Tenant has no dataPlaneRef"})
            return None

        tenant_cols, ok = self._discover_tenant_columns(tenant, _pyodbc, issues)
        if not ok:
            return None
        source_cols = self._discover_source_columns(ts, mappings, _pyodbc, issues)

        _, graph = self._loader.build_metadata()
        cf_list = self._client.get_canonical_fields()
        cf_by_id = {cf["canonicalFieldId"]: cf for cf in cf_list if cf.get("isActive")}
        eid_to_table = graph.entity_id_map()

        return ts, mappings, tenant_cols, source_cols, cf_by_id, eid_to_table, graph

    def _discover_tenant_columns(self, tenant, _pyodbc, issues: list[dict]):
        """Return (tenant_cols dict, success bool)."""
        if not _pyodbc:
            issues.append({"level": "warning", "check": "tenant_db",
                           "detail": "pyodbc not installed \u2014 skipping DB checks"})
            return {}, True
        conn_str = DataExtractor.norm_conn(tenant["dataPlaneRef"])
        tenant_cols: dict[str, set[str]] = {}
        try:
            with _pyodbc.connect(conn_str, timeout=15) as tc:
                cur = tc.cursor()
                cur.execute("""
                    SELECT '[' + TABLE_SCHEMA + '].[' + TABLE_NAME + ']', COLUMN_NAME
                    FROM INFORMATION_SCHEMA.COLUMNS
                """)
                for tbl, col in cur.fetchall():
                    tenant_cols.setdefault(tbl, set()).add(col)
        except Exception as exc:
            issues.append({"level": "error", "check": "tenant_db",
                           "detail": f"Cannot connect to tenant DB: {exc}"})
            return tenant_cols, False
        return tenant_cols, True

    def _discover_source_columns(self, ts, mappings, _pyodbc, issues: list[dict]):
        """Return set of source column names."""
        source_cols: set[str] = set()
        conn_ref = ts.get("connectionRef", "")
        if not (_pyodbc and conn_ref):
            return source_cols
        source_objects = list({m.get("sourceObject") for m in mappings if m.get("sourceObject")})
        conn_str_src = DataExtractor.norm_conn(
            os.environ.get(f"SOURCE_{conn_ref}", conn_ref)
            if not conn_ref.startswith(("DRIVER=", "Server=", "mssql://", "http"))
            else conn_ref
        )
        try:
            with _pyodbc.connect(conn_str_src, timeout=15) as sc:
                cur = sc.cursor()
                for tbl in source_objects:
                    safe = _validate_table_name(tbl)
                    try:
                        cur.execute(f"SELECT TOP 0 * FROM [{safe}]")
                        source_cols |= {d[0] for d in cur.description}
                    except Exception as exc:
                        issues.append({"level": "error", "check": "source_table",
                                       "detail": f"Cannot read [{safe}]: {exc}"})
        except Exception as exc:
            issues.append({"level": "warning", "check": "source_db",
                           "detail": f"Cannot connect to source DB: {exc}"})
        return source_cols

    def _validate_field_mappings(
        self, mappings, tenant_cols, source_cols, cf_by_id, eid_to_table, issues: list[dict],
    ) -> None:
        """Check each mapping's canonical field, source field, target column, and lookup rules."""
        lookup_re = re.compile(r'^lookup\(([^,]+),([^,]+),([^)]+)\)$', re.IGNORECASE)
        for m in mappings:
            cfid = m.get("canonicalFieldId")
            src_field = m.get("sourceField", "")
            rule = m.get("transformRule") or ""
            cf = cf_by_id.get(cfid)
            if cf is None:
                issues.append({"level": "error", "check": "canonical_field",
                               "detail": f"canonical_field_id={cfid} not found or inactive"})
                continue
            field_name = cf["fieldName"]
            sql_table = eid_to_table.get(cf["canonicalEntityId"])
            if source_cols and src_field not in source_cols:
                issues.append({"level": "error", "check": "source_field",
                               "detail": f"'{src_field}' not in source table"})
            if tenant_cols and sql_table:
                table_cols = tenant_cols.get(sql_table, set())
                if table_cols and field_name not in table_cols:
                    issues.append({"level": "error", "check": "column_name",
                                   "detail": f"'{field_name}' not in {sql_table}"})
            self._validate_lookup_steps(rule, tenant_cols, lookup_re, issues)

    @staticmethod
    def _resolve_lookup_table(raw_table: str) -> str:
        if "." in raw_table and not raw_table.startswith("["):
            schema, tbl = raw_table.split(".", 1)
            return f"[{schema}].[{tbl}]"
        return raw_table

    def _validate_lookup_steps(self, rule, tenant_cols, lookup_re, issues: list[dict]) -> None:
        """Validate lookup() transform steps against tenant DB columns."""
        if not tenant_cols:
            return
        for step in (s.strip() for s in rule.split("|") if s.strip()):
            lm = lookup_re.match(step)
            if not lm:
                continue
            lookup_table = self._resolve_lookup_table(lm.group(1).strip())
            match_col = lm.group(2).strip()
            return_col = lm.group(3).strip()
            lk_cols = tenant_cols.get(lookup_table, set())
            if not lk_cols:
                issues.append({"level": "error", "check": "lookup_table",
                               "detail": f"{lookup_table} not in tenant DB"})
                continue
            if match_col not in lk_cols:
                issues.append({"level": "error", "check": "lookup_match_col",
                               "detail": f"'{match_col}' not in {lookup_table}"})
            if return_col not in lk_cols:
                issues.append({"level": "error", "check": "lookup_return_col",
                               "detail": f"'{return_col}' not in {lookup_table}"})

    @staticmethod
    def _build_mapped_fields(mappings, cf_by_id, eid_to_table) -> dict[str, set[str]]:
        """Build {sql_table: {field_names}} from mappings."""
        mapped: dict[str, set[str]] = {}
        for m in mappings:
            cf = cf_by_id.get(m.get("canonicalFieldId"))
            if cf:
                tbl = eid_to_table.get(cf["canonicalEntityId"])
                if tbl:
                    mapped.setdefault(tbl, set()).add(cf["fieldName"])
        return mapped

    @staticmethod
    def _validate_scd2_keys(mapped_fields_by_entity, graph, issues: list[dict]) -> None:
        """Check SCD2 natural keys and MERGE unique keys are mapped."""
        for sql_table in graph.topological_order():
            info = graph.get(sql_table)
            if info is None:
                continue
            mapped = mapped_fields_by_entity.get(sql_table, set())
            if not mapped:
                continue
            if info.is_scd2 and info.natural_key and info.natural_key not in mapped:
                issues.append({"level": "error", "check": "scd2_natural_key",
                               "detail": f"{sql_table} natural_key '{info.natural_key}' not mapped"})
            if info.unique_keys and not info.unique_keys.issubset(mapped):
                issues.append({"level": "warning", "check": "unique_key",
                               "detail": f"{sql_table} MERGE keys {info.unique_keys - mapped} not mapped"})

    @staticmethod
    def _warn_unmapped_merge_keys(mapped_fields_by_entity: dict, graph: "SchemaGraph") -> None:
        """Log warnings for entities with unmapped composite unique keys.
        These entities will INSERT duplicates instead of MERGE/upsert on repeated runs."""
        for sql_table in graph.topological_order():
            info = graph.get(sql_table)
            if info is None:
                continue
            mapped = mapped_fields_by_entity.get(sql_table, set())
            if not mapped:
                continue
            # Only check entities with composite unique keys (2+ keys)
            if len(info.unique_keys) < 2:
                continue
            # Exclude identity/auto-gen PK — it's always unmapped and that's fine
            business_keys = info.unique_keys - {info.identity_col} if info.identity_col else info.unique_keys
            unmapped_keys = business_keys - mapped
            if unmapped_keys:
                logger.warning(
                    "SNAPSHOT GAP: %s has unmapped MERGE keys %s — rows will INSERT (duplicates) instead of upsert",
                    sql_table, unmapped_keys,
                )

    # ------------------------------------------------------------------
    # Mappings preview
    # ------------------------------------------------------------------

    def get_mappings_preview(self, tenant_source_id: int) -> list[dict] | None:
        """
        Build an enriched view of field mappings for a tenant-source.

        Returns a list of dicts with keys:
          source_table, source_field, layer, canonical_entity, canonical_field,
          is_foreign_key, fk_references, data_present, data_type, transform_rule

        Returns None if tenant-source not found.
        """
        ts = self._client.get_tenant_source(tenant_source_id)
        if ts is None:
            return None

        mappings = self._client.get_field_mappings(tenant_source_id)
        if not mappings:
            return []

        cf_list = self._client.get_canonical_fields()
        cf_by_id = {cf["canonicalFieldId"]: cf for cf in cf_list if cf.get("isActive")}

        ce_list = self._client.get_canonical_entities()
        ce_by_id = {ce["canonicalEntityId"]: ce for ce in ce_list if ce.get("isActive")}

        data_presence = self._check_data_presence(ts, mappings)
        return [
            self._build_preview_row(m, cf_by_id, ce_by_id, data_presence)
            for m in mappings
        ]

    @staticmethod
    def _build_preview_row(
        m: dict, cf_by_id: dict, ce_by_id: dict,
        data_presence: dict[tuple[str, str], str],
    ) -> dict:
        """Map a single FieldMapping to a preview row dict."""
        cf = cf_by_id.get(m.get("canonicalFieldId"))
        ce = ce_by_id.get(cf["canonicalEntityId"]) if cf else None
        src_table = m.get("sourceObject") or ""
        src_field = m.get("sourceField") or ""
        is_fk = bool(cf.get("referenceEntityId")) if cf else False
        fk_ref = ETLEngine._resolve_fk_reference(cf, ce_by_id) if is_fk else ""
        return {
            "source_table": src_table,
            "source_field": src_field,
            "canonical_entity": ce.get("entityName", "") if ce else "",
            "layer": ce.get("layer", "") if ce else "",
            "canonical_field": cf["fieldName"] if cf else f"[unknown cfid={m.get('canonicalFieldId')}]",
            "is_foreign_key": is_fk,
            "fk_references": fk_ref,
            "data_present": data_presence.get((src_table, src_field), "Unknown"),
            "data_type": cf.get("dataType", "") if cf else "",
            "transform_rule": m.get("transformRule") or "",
        }

    @staticmethod
    def _resolve_fk_reference(cf: dict | None, ce_by_id: dict) -> str:
        """Resolve the FK reference to '[layer].[EntityName]' format."""
        if not cf:
            return ""
        ref_entity = ce_by_id.get(cf.get("referenceEntityId"))
        if not ref_entity:
            return ""
        ref_layer = ref_entity.get("layer", "")
        ref_name = ref_entity.get("entityName", "")
        return f"[{ref_layer}].[{ref_name}]" if ref_layer else ref_name

    def _check_data_presence(
        self, tenant_source: dict, mappings: list[dict],
    ) -> dict[tuple[str, str], str]:
        """
        Sample the source DB to check whether each mapped column has data.

        Returns {(source_table, source_field): "Yes"|"No"|"Unknown"}.
        """
        if _pyodbc is None:
            return {}

        conn_str = self._resolve_source_conn(tenant_source)
        if not conn_str:
            return {}

        table_fields = self._group_fields_by_table(mappings)
        try:
            conn = _pyodbc.connect(conn_str, timeout=15)
        except Exception as exc:
            logger.warning("Cannot connect to source DB for data presence check: %s", exc)
            return {}

        result: dict[tuple[str, str], str] = {}
        try:
            cur = conn.cursor()
            for table, fields in table_fields.items():
                self._probe_table_columns(cur, table, fields, result)
        finally:
            conn.close()
        return result

    @staticmethod
    def _resolve_source_conn(tenant_source: dict) -> str:
        """Resolve and normalise the source connection string."""
        conn_ref = tenant_source.get("connectionRef", "")
        conn_str = os.environ.get(f"SOURCE_{conn_ref}", conn_ref)
        return DataExtractor.norm_conn(conn_str)

    @staticmethod
    def _group_fields_by_table(mappings: list[dict]) -> dict[str, list[str]]:
        """Group source fields by source table from mappings."""
        table_fields: dict[str, list[str]] = {}
        for m in mappings:
            tbl = m.get("sourceObject") or ""
            fld = m.get("sourceField") or ""
            if tbl and fld:
                table_fields.setdefault(tbl, []).append(fld)
        return table_fields

    @staticmethod
    def _probe_table_columns(
        cur, table: str, fields: list[str],
        result: dict[tuple[str, str], str],
    ) -> None:
        """Run a SELECT TOP 1 to detect non-null data per column."""
        try:
            safe_table = _validate_table_name(table)
            safe_cols = [_validate_column_name(f) for f in fields]
            col_list = ", ".join(f"[{c}]" for c in safe_cols)
            cur.execute(f"SELECT TOP 1 {col_list} FROM [{safe_table}]")
            row = cur.fetchone()
            for i, fld in enumerate(fields):
                has_data = row is not None and row[i] is not None
                result[(table, fld)] = "Yes" if has_data else "No"
        except Exception as exc:
            logger.warning("Data presence check failed for [%s]: %s", table, exc)
            for fld in fields:
                result[(table, fld)] = "Unknown"
