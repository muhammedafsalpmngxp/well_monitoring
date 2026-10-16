"""Schema graph: entity metadata, topological ordering, SCD2 & unique-key registry."""

import logging
import re
from typing import Any

logger = logging.getLogger("smartops.etl.schema")

_SAFE_IDENT = re.compile(r'^\w+$')
_LAYER_PRIORITY: dict[str, int] = {"ref": 1, "core": 2, "ml": 3, "meta": 4, "raw": 4}
_SCD2_MARKERS: frozenset[str]   = frozenset({"is_current", "effective_start_date"})
FACT_TYPES: frozenset[str]      = frozenset({"fact", "bridge"})

# ── Type-aware NULL defaults ───────────────────────────────────────────────────
_TYPE_DEFAULTS: dict[str, Any] = {
    # Numeric types
    "int": 0, "integer": 0, "bigint": 0, "smallint": 0, "tinyint": 0,
    "decimal": 0.0, "numeric": 0.0, "money": 0.0, "smallmoney": 0.0,
    "float": 0.0, "real": 0.0,
    # Boolean: default to 0 (False) — safer than defaulting to True
    "bit": 0,
}

# Date/time and string types: NULL is acceptable — skip validation
NULLABLE_TYPES: frozenset[str] = frozenset({
    "datetime", "datetime2", "smalldatetime", "date", "time",
    "varchar", "nvarchar", "char", "nchar", "text", "ntext",
})


def default_for_type(data_type: str | None) -> Any:
    """Return a sensible non-null default for a SQL Server data type, or None."""
    if not data_type:
        return None
    base = data_type.strip().split("(")[0].lower()
    return _TYPE_DEFAULTS.get(base)


class EntityInfo:
    """Immutable metadata for one canonical entity (target DB table)."""

    __slots__ = (
        "entity_id", "sql_table", "layer", "layer_priority",
        "table_type", "is_scd2", "unique_keys", "required_fields", "natural_key",
        "field_types", "fk_fields", "identity_col",
    )

    def __init__(
        self, entity_id: int, sql_table: str, layer: str, table_type: str,
        is_scd2: bool, unique_keys: frozenset, required_fields: frozenset,
        natural_key: str | None, field_types: dict[str, str] | None = None,
        fk_fields: frozenset | None = None, identity_col: str | None = None,
    ) -> None:
        self.entity_id       = entity_id
        self.sql_table       = sql_table
        self.layer           = layer
        self.layer_priority  = _LAYER_PRIORITY.get(layer, 5)
        self.table_type      = table_type
        self.is_scd2         = is_scd2
        self.unique_keys     = unique_keys
        self.required_fields = required_fields
        self.natural_key     = natural_key
        self.field_types     = field_types or {}
        self.fk_fields       = fk_fields or frozenset()
        self.identity_col    = identity_col


class SchemaGraph:
    """
    Entity dependency metadata built from the Control Plane canonical schema.

    Build:  graph = SchemaGraph.build(canonical_fields, canonical_entities)
    Query:  graph.topological_order(), graph.get(sql_table), graph.entity_id_map()
    """

    def __init__(self, entities: dict[str, EntityInfo], fk_deps: dict[str, set[str]] | None = None) -> None:
        self._entities = entities
        self._fk_deps = fk_deps or {}  # {sql_table: set of sql_tables it depends on}

    @classmethod
    def build(cls, canonical_fields: list[dict], canonical_entities: list[dict]) -> "SchemaGraph":
        """Factory: construct from Control Plane API responses."""
        by_entity: dict[int, list[dict]] = {}
        for cf in canonical_fields:
            if cf.get("isActive"):
                by_entity.setdefault(cf["canonicalEntityId"], []).append(cf)

        # Build entity_id → sql_table map first (for FK dep resolution)
        eid_to_table: dict[int, str] = {}
        entities: dict[str, EntityInfo] = {}
        for ce in canonical_entities:
            if not ce.get("isActive"):
                continue
            eid   = ce["canonicalEntityId"]
            ename = ce.get("entityName", "")
            layer = ce.get("layer", "core")
            if not _SAFE_IDENT.match(layer) or not _SAFE_IDENT.match(ename):
                logger.warning("Skipping unsafe entity id=%d layer=%r name=%r", eid, layer, ename)
                continue
            sql_table   = f"[{layer}].[{ename}]"
            eid_to_table[eid] = sql_table
            field_list  = by_entity.get(eid, [])
            field_names = {f["fieldName"] for f in field_list}
            is_scd2     = _SCD2_MARKERS.issubset(field_names)
            table_type  = ce.get("tableType") or cls._infer_type(layer, is_scd2, field_names)
            unique_keys = frozenset(f["fieldName"] for f in field_list if f.get("isUnique"))
            required    = frozenset(f["fieldName"] for f in field_list if f.get("isRequired"))
            field_types = {f["fieldName"]: f.get("dataType", "") for f in field_list}
            fk_fields = frozenset(f["fieldName"] for f in field_list if f.get("referenceEntityId"))
            identity_col = cls._detect_identity_col(field_list, ename)
            natural_key = cls._resolve_natural_key(ce, is_scd2, unique_keys, identity_col)
            entities[sql_table] = EntityInfo(
                entity_id=eid, sql_table=sql_table, layer=layer,
                table_type=table_type, is_scd2=is_scd2,
                unique_keys=unique_keys, required_fields=required, natural_key=natural_key,
                field_types=field_types, fk_fields=fk_fields, identity_col=identity_col,
            )

        fk_deps = cls._build_fk_deps(canonical_entities, by_entity, eid_to_table)

        logger.debug("SchemaGraph: %d entities, %d FK deps", len(entities), sum(len(v) for v in fk_deps.values()))
        return cls(entities, fk_deps)

    def get(self, sql_table: str) -> EntityInfo | None:
        """Return EntityInfo for a bracketed sql_table name, or None."""
        return self._entities.get(sql_table)

    def topological_order(self) -> list[str]:
        """FK-safe insertion order: respects layer priority AND FK dependencies within layers."""
        # Kahn's algorithm on the FK dependency graph, with layer priority as tiebreaker
        in_degree: dict[str, int] = dict.fromkeys(self._entities, 0)
        adj: dict[str, list[str]] = {t: [] for t in self._entities}
        for table, deps in self._fk_deps.items():
            if table not in self._entities:
                continue
            for dep in deps:
                if dep in self._entities:
                    adj[dep].append(table)
                    in_degree[table] = in_degree.get(table, 0) + 1

        # Start with nodes having no FK dependencies, sorted by (layer_priority, name)
        import heapq
        heap = [(self._entities[t].layer_priority, t) for t in self._entities if in_degree[t] == 0]
        heapq.heapify(heap)

        result: list[str] = []
        while heap:
            _, table = heapq.heappop(heap)
            result.append(table)
            for dependent in adj.get(table, []):
                in_degree[dependent] -= 1
                if in_degree[dependent] == 0:
                    heapq.heappush(heap, (self._entities[dependent].layer_priority, dependent))

        # Any remaining (cycle) — append at end sorted by priority
        remaining = [t for t in self._entities if t not in set(result)]
        if remaining:
            logger.warning("FK cycle detected among: %s — appending in layer order", remaining)
            remaining.sort(key=lambda t: (self._entities[t].layer_priority, t))
            result.extend(remaining)

        return result

    def entity_id_map(self) -> dict[int, str]:
        """Return {entity_id: sql_table} for fast field→table remapping."""
        return {ei.entity_id: t for t, ei in self._entities.items()}

    @staticmethod
    def _detect_identity_col(field_list: list[dict], ename: str) -> str | None:
        """Detect identity/PK column using multi-strategy approach."""
        ename_lower = ename.lower()
        # Strategy 1: strict name-prefix match (e.g., Project.project_key, Well.well_key)
        for f in field_list:
            fn = f["fieldName"]
            dt = f.get("dataType", "").lower().split("(")[0]
            if (
                fn.endswith(("_id", "_key"))
                and dt in ("int", "bigint")
                and not f.get("referenceEntityId")
                and fn.replace("_", "").lower().startswith(ename_lower.replace("_", ""))
            ):
                return fn
        # Strategy 2: fallback — single or shortest-named int/bigint unique non-FK field
        candidates = [
            f["fieldName"] for f in field_list
            if f["fieldName"].endswith(("_id", "_key"))
            and f.get("dataType", "").lower().split("(")[0] in ("int", "bigint")
            and not f.get("referenceEntityId")
            and f.get("isUnique")
        ]
        if len(candidates) == 1:
            return candidates[0]
        if candidates:
            candidates.sort(key=lambda c: (len(c), c))
            return candidates[0]
        return None

    @staticmethod
    def _resolve_natural_key(
        ce: dict, is_scd2: bool, unique_keys: frozenset, identity_col: str | None,
    ) -> str | None:
        """Natural key: explicit from entity, or first non-identity unique key for SCD2."""
        if ce.get("naturalKey"):
            return ce["naturalKey"]
        if is_scd2:
            non_identity_uks = [uk for uk in sorted(unique_keys) if uk != identity_col]
            return non_identity_uks[0] if non_identity_uks else None
        return None

    @staticmethod
    def _build_fk_deps(
        canonical_entities: list[dict],
        by_entity: dict[int, list[dict]],
        eid_to_table: dict[int, str],
    ) -> dict[str, set[str]]:
        """Build FK dependency graph: table -> set of tables it references."""
        fk_deps: dict[str, set[str]] = {}
        for ce in canonical_entities:
            if not ce.get("isActive"):
                continue
            eid = ce["canonicalEntityId"]
            sql_table = eid_to_table.get(eid)
            if not sql_table:
                continue
            for cf in by_entity.get(eid, []):
                ref_eid = cf.get("referenceEntityId")
                if ref_eid and ref_eid in eid_to_table:
                    ref_table = eid_to_table[ref_eid]
                    if ref_table != sql_table:  # no self-refs
                        fk_deps.setdefault(sql_table, set()).add(ref_table)
        return fk_deps

    @staticmethod
    def _infer_type(layer: str, is_scd2: bool, field_names: set[str]) -> str:
        if layer in ("ml", "meta", "raw"):
            return layer
        if is_scd2:
            return "dim_scd2"
        if layer == "ref":
            return "lookup"
        measure_kw = {"progress", "qty", "manhours", "duration", "variance", "value", "pi_"}
        return "fact" if any(kw in fn for fn in field_names for kw in measure_kw) else "dim"


def validate_required(row: dict[str, Any], required_fields: frozenset) -> list[str]:
    """Return names of required fields that are None in the row (empty = valid)."""
    return [col for col in required_fields if row.get(col) is None]


def deduplicate_rows(
    rows: list[dict[str, Any]], unique_cols: frozenset,
) -> tuple[list[dict[str, Any]], int]:
    """Keep first occurrence per unique key; coalesce non-NULL values from duplicates."""
    if not unique_cols:
        return rows, 0
    seen: dict[tuple, int] = {}
    unique: list[dict] = []
    skipped = 0
    cols = sorted(unique_cols)
    for row in rows:
        key = tuple(row.get(c) for c in cols)
        if key in seen:
            skipped += 1
            # Coalesce: fill NULLs in the kept row with non-NULL values from this duplicate
            kept = unique[seen[key]]
            for k, v in row.items():
                if v is not None and kept.get(k) is None:
                    kept[k] = v
        else:
            seen[key] = len(unique)
            unique.append(row)
    if skipped:
        logger.debug("Dedup %s: removed %d duplicate(s)", cols, skipped)
    return unique, skipped
