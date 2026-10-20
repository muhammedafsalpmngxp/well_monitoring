"""A compact, LLM-friendly description of the live database, and the fingerprints that decide staleness.

Three rendered artefacts, cached on disk under CACHE_ROOT/features/anomaly/<db identity + access scope + settings>:

    schema.txt         tables (+ row counts on the TABLE line), columns (+PK), declared FKs, MANY ROWS PER markers
    value_hints.txt    real coded values from small lookup tables
    numeric_hints.txt  MEASURED range / scale / null rate of numeric columns, and text columns that fail to parse

The schema cache is used only while the live fingerprint (structure + keys + row counts + identity + render version)
still matches; a moved fingerprint rebuilds all three. TWO FINGERPRINTS, DELIBERATELY: the compiled catalog is
guarded by the structure ONLY (no row counts), per table, so a nightly load never recompiles anything.

NOTHING HERE NAMES A TABLE OR COLUMN. Visibility is the request's FeatureAccess (allowed schemas / included tables /
excluded tables / excluded columns) plus a built-in secret-name filter. Catalogue SQL is engine SQL (it reads
INFORMATION_SCHEMA and sys.*, identical on every database); every statement still passes the SELECT-only gate, and
every statement reading a business table also passes the feature's table allowlist.
"""
from __future__ import annotations

import hashlib
import logging
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

from app.askdata.common.readonly import assert_read_only
from app.features.anomaly import TITLE, dbio
from app.features.anomaly.config import cfg
from app.features.common import access
from app.features.common.context import current

log = logging.getLogger("agent_runtime.anomaly")

# Substrings that mark a column as secret - never exposed to a model. A security floor shared with Ask Data
# (app/askdata/tools/schema_introspect.py), deliberately not a tenant setting: it can only ever hide more.
SECRET_COLUMN_MARKERS = ("password", "secret", "token", "pwd", "apikey", "api_key", "credential", "private_key")

# Bumped whenever _render() changes the TEXT for an unchanged database (folded into the LIVE fingerprint only: a
# rendering change makes the rendered files stale, never a compiled probe's SQL).
_RENDER_VERSION = "5-anomaly-row-counts-on-table-line"

_TSQL_RESERVED = frozenset("""
ADD ALL ALTER AND ANY AS ASC AUTHORIZATION BACKUP BEGIN BETWEEN BREAK BROWSE BULK BY CASCADE CASE
CHECK CHECKPOINT CLOSE CLUSTERED COALESCE COLLATE COLUMN COMMIT COMPUTE CONSTRAINT CONTAINS
CONTAINSTABLE CONTINUE CONVERT CREATE CROSS CURRENT CURRENT_DATE CURRENT_TIME CURRENT_TIMESTAMP
CURRENT_USER CURSOR DATABASE DBCC DEALLOCATE DECLARE DEFAULT DELETE DENY DESC DISK DISTINCT
DISTRIBUTED DOUBLE DROP DUMP ELSE END ERRLVL ESCAPE EXCEPT EXEC EXECUTE EXISTS EXIT EXTERNAL FETCH
FILE FILLFACTOR FOR FOREIGN FREETEXT FREETEXTTABLE FROM FULL FUNCTION GOTO GRANT GROUP HAVING
HOLDLOCK IDENTITY IDENTITY_INSERT IDENTITYCOL IF IN INDEX INNER INSERT INTERSECT INTO IS JOIN KEY
KILL LEFT LIKE LINENO LOAD MERGE NATIONAL NOCHECK NONCLUSTERED NOT NULL NULLIF OF OFF OFFSETS ON
OPEN OPENDATASOURCE OPENQUERY OPENROWSET OPENXML OPTION OR ORDER OUTER OVER PERCENT PIVOT PLAN
PRECISION PRIMARY PRINT PROC PROCEDURE PUBLIC RAISERROR READ READTEXT RECONFIGURE REFERENCES
REPLICATION RESTORE RESTRICT RETURN REVERT REVOKE RIGHT ROLLBACK ROWCOUNT ROWGUIDCOL RULE SAVE
SCHEMA SECURITYAUDIT SELECT SESSION_USER SET SETUSER SHUTDOWN SOME STATISTICS SYSTEM_USER TABLE
TABLESAMPLE TEXTSIZE THEN TO TOP TRAN TRANSACTION TRIGGER TRUNCATE TRY_CONVERT TSEQUAL UNION
UNIQUE UNPIVOT UPDATE UPDATETEXT USE USER VALUES VARYING VIEW WAITFOR WHEN WHERE WHILE WITH
WRITETEXT
""".split())
_BARE_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_$#]*$")
_NUMERIC_TYPES = frozenset(("int", "bigint", "smallint", "tinyint", "decimal", "numeric", "float", "real", "money",
                            "smallmoney"))
_TEXT_TYPES = frozenset(("varchar", "nvarchar", "char", "nchar"))
_CAMEL_SPLIT = re.compile(r"(?<=[a-z0-9])(?=[A-Z])")


def quote_column(col: str) -> str:
    """The form the author must copy: [bracketed] whenever the bare name would not parse."""
    if col.upper() in _TSQL_RESERVED or not _BARE_IDENTIFIER.match(col):
        return f"[{col}]"
    return col


# ── Scope: what the feature may see ──

def _access():
    return current().request.access


def schemas_in_scope() -> list[str]:
    """Lower-case schemas whose catalogue is read: the allowed schemas, or those of the included tables."""
    acc = _access()
    included = [t.strip().lower() for t in acc.included_tables if t.strip().count(".") == 1]
    if included:
        return sorted({t.split(".")[0] for t in included})
    schemas = sorted({s.strip().lower() for s in acc.allowed_schemas if s.strip()})
    if not schemas:
        raise access.AccessDenied(f"{TITLE} is not set up yet: an admin chooses the tables it may read under "
                                  f"Settings > AI Settings > {TITLE}.")
    return schemas


def table_visible(schema: str, table: str) -> bool:
    return access.allowed(f"{schema}.{table}", _access())


def _is_secret(col: str) -> bool:
    lc = col.lower()
    return any(m in lc for m in SECRET_COLUMN_MARKERS)


def column_hidden(schema: str, table: str, column: str) -> bool:
    if _is_secret(column):
        return True
    excluded = {x.strip().lower() for x in _access().excluded_columns if x.strip()}
    if not excluded:
        return False
    return (f"{schema}.{table}.{column}".lower() in excluded or f"{table}.{column}".lower() in excluded
            or column.lower() in excluded)


def identity() -> str:
    db = current().request.db
    return f"{db.server}:{db.port}/{db.name}".lower()


def scope_signature() -> str:
    """Everything outside the database that changes what is visible, folded into every fingerprint."""
    acc = _access()
    return "|".join((
        "schemas=" + ",".join(sorted(s.strip().lower() for s in acc.allowed_schemas if s.strip())),
        "included=" + ",".join(sorted(s.strip().lower() for s in acc.included_tables if s.strip())),
        "excluded=" + ",".join(sorted(s.strip().lower() for s in acc.excluded_tables if s.strip())),
        "excluded_cols=" + ",".join(sorted(s.strip().lower() for s in acc.excluded_columns if s.strip())),
        f"db={identity()}",
    ))


def _render_settings_signature() -> str:
    """The settings that change the RENDERED hint files: a change rebuilds them under a new cache key."""
    s = cfg()
    return "|".join(str(v) for v in (
        s.text_numeric_min_parse, s.dup_check_min_rows, s.hint_max_tables, s.hint_max_values, s.hint_max_rows,
        sorted(s.hint_column_suffixes), sorted(s.hint_column_names), s.numeric_max_rows, s.numeric_max_cols_per_query,
        sorted(s.ratio_markers), sorted(s.key_tokens), s.full_detail_null_pct, s.full_detail_max_over_avg,
    ))


def cache_dir() -> Path:
    """This database + scope + rendering settings' own cache directory (never shared across databases/scopes)."""
    from app.askdata.settings import CACHE_ROOT

    name = re.sub(r"[^A-Za-z0-9_.-]+", "-", current().request.db.name or "db").strip("-")[:40] or "db"
    digest = hashlib.sha256((scope_signature() + "#" + _render_settings_signature()).encode("utf-8")).hexdigest()[:16]
    return Path(CACHE_ROOT) / "features" / "anomaly" / f"{name}-{digest}"


def _read_cache(name: str) -> str:
    try:
        return (cache_dir() / name).read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def _write_cache(name: str, text: str) -> None:
    folder = cache_dir()
    try:
        folder.mkdir(parents=True, exist_ok=True)
        tmp = folder / (name + ".tmp")
        tmp.write_text(text, encoding="utf-8")
        os.replace(tmp, folder / name)
    except OSError as exc:  # noqa: BLE001 - a cache that cannot be written only costs a rebuild next time
        log.warning("anomaly introspect: cache not written (%s)", type(exc).__name__)


def _drop_cache(*names: str) -> None:
    for name in names:
        try:
            (cache_dir() / name).unlink(missing_ok=True)
        except OSError:
            pass


# ── The catalogue reader: every SQL statement of introspection, behind one small class (tests fake it) ──

class CatalogReader:
    """Reads the catalogue and samples data on one open cursor. Every statement passes the SELECT-only gate; those
    reading a business table also pass the feature's table allowlist."""

    def __init__(self, cursor: Any) -> None:
        self.cur = cursor

    def _rows(self, sql: str, params: Iterable[Any] = (), data: bool = False) -> list[tuple]:
        if data:
            dbio.guard(sql)
        else:
            assert_read_only(sql)
        self.cur.execute(sql, *list(params))
        return [tuple(r) for r in self.cur.fetchall()]

    def _in(self, schemas: list[str]) -> str:
        return ",".join("?" for _ in schemas)

    def columns(self, schemas: list[str]) -> list[tuple]:
        """(schema, table, column, data_type, max_length, is_nullable) in ordinal order."""
        return [r[:6] for r in self._rows(
            "SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE, "
            "ORDINAL_POSITION FROM INFORMATION_SCHEMA.COLUMNS "
            f"WHERE LOWER(TABLE_SCHEMA) IN ({self._in(schemas)}) ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION",
            schemas)]

    def structure_columns(self, schemas: list[str]) -> list[tuple]:
        """(schema, table, column, data_type, max_length, is_nullable) ordered by name - the structural signal."""
        return self._rows(
            "SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE "
            f"FROM INFORMATION_SCHEMA.COLUMNS WHERE LOWER(TABLE_SCHEMA) IN ({self._in(schemas)}) "
            "ORDER BY TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME", schemas)

    def primary_keys(self, schemas: list[str]) -> list[tuple]:
        """(schema, table, column)."""
        return self._rows(
            "SELECT sch.name, t.name, c.name FROM sys.indexes i "
            "JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id "
            "JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id "
            "JOIN sys.tables t ON t.object_id = i.object_id JOIN sys.schemas sch ON sch.schema_id = t.schema_id "
            f"WHERE i.is_primary_key = 1 AND LOWER(sch.name) IN ({self._in(schemas)}) "
            "ORDER BY sch.name, t.name, c.name", schemas)

    def foreign_keys(self, schemas: list[str]) -> list[tuple]:
        """(schema, table, column, ref_schema, ref_table, ref_column)."""
        return self._rows(
            "SELECT sch.name, t.name, c.name, rsch.name, rt.name, rc.name FROM sys.foreign_key_columns fkc "
            "JOIN sys.tables t ON t.object_id = fkc.parent_object_id JOIN sys.schemas sch ON sch.schema_id = t.schema_id "
            "JOIN sys.columns c ON c.object_id = fkc.parent_object_id AND c.column_id = fkc.parent_column_id "
            "JOIN sys.tables rt ON rt.object_id = fkc.referenced_object_id "
            "JOIN sys.schemas rsch ON rsch.schema_id = rt.schema_id "
            "JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id "
            f"WHERE LOWER(sch.name) IN ({self._in(schemas)}) ORDER BY sch.name, t.name, c.name", schemas)

    def row_counts(self, schemas: list[str]) -> list[tuple]:
        """(schema, table, approximate rows) from storage metadata: the DMV, else sys.partitions (a read-only login
        routinely lacks VIEW DATABASE STATE). No table is scanned."""
        last: Exception | None = None
        for source, column in (("sys.dm_db_partition_stats", "p.row_count"), ("sys.partitions", "p.rows")):
            try:
                return self._rows(
                    f"SELECT s.name, t.name, SUM({column}) FROM {source} p "
                    "JOIN sys.tables t ON t.object_id = p.object_id JOIN sys.schemas s ON s.schema_id = t.schema_id "
                    f"WHERE p.index_id IN (0, 1) AND LOWER(s.name) IN ({self._in(schemas)}) "
                    "GROUP BY s.name, t.name ORDER BY s.name, t.name", schemas)
            except Exception as exc:  # noqa: BLE001 - try the next source before giving up
                last = exc
        raise last if last else RuntimeError("no row-count source available")

    def key_signature(self, schemas: list[str]) -> list[tuple]:
        """Keys and constraints that change without a column changing: PK, FK, CHECK, DEFAULT, UNIQUE."""
        inn = self._in(schemas)
        rows: list[tuple] = []
        rows += [("PK", *r) for r in self.primary_keys(schemas)]
        rows += [("FK", *r) for r in self.foreign_keys(schemas)]
        rows += [("CHECK", *r) for r in self._rows(
            "SELECT sch.name, t.name, cc.name, cc.definition FROM sys.check_constraints cc "
            "JOIN sys.tables t ON t.object_id = cc.parent_object_id JOIN sys.schemas sch ON sch.schema_id = t.schema_id "
            f"WHERE LOWER(sch.name) IN ({inn}) ORDER BY sch.name, t.name, cc.name", schemas)]
        rows += [("DEFAULT", *r) for r in self._rows(
            "SELECT sch.name, t.name, c.name, dc.definition FROM sys.default_constraints dc "
            "JOIN sys.tables t ON t.object_id = dc.parent_object_id "
            "JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id "
            "JOIN sys.schemas sch ON sch.schema_id = t.schema_id "
            f"WHERE LOWER(sch.name) IN ({inn}) ORDER BY sch.name, t.name, c.name", schemas)]
        rows += [("UNIQUE", *r) for r in self._rows(
            "SELECT sch.name, t.name, i.name, c.name FROM sys.indexes i "
            "JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id "
            "JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id "
            "JOIN sys.tables t ON t.object_id = i.object_id JOIN sys.schemas sch ON sch.schema_id = t.schema_id "
            f"WHERE i.is_unique = 1 AND i.is_primary_key = 0 AND LOWER(sch.name) IN ({inn}) "
            "ORDER BY sch.name, t.name, i.name, ic.key_ordinal", schemas)]
        return rows

    # ── data samples (business tables: allowlist-checked) ──
    def count_rows(self, schema: str, table: str) -> int:
        return int(self._rows(f"SELECT COUNT(*) FROM [{schema}].[{table}]", data=True)[0][0] or 0)

    def count_distinct(self, schema: str, table: str, key: str, with_total: bool) -> tuple[int | None, int]:
        if with_total:
            total, distinct = self._rows(f"SELECT COUNT(*), COUNT(DISTINCT [{key}]) FROM [{schema}].[{table}]",
                                         data=True)[0]
            return total, distinct
        return None, self._rows(f"SELECT COUNT(DISTINCT [{key}]) FROM [{schema}].[{table}]", data=True)[0][0]

    def distinct_values(self, schema: str, table: str, columns: list[str], limit: int) -> list[tuple]:
        cols = ", ".join(f"[{c}]" for c in columns)
        return self._rows(f"SELECT DISTINCT TOP {int(limit)} {cols} FROM [{schema}].[{table}] ORDER BY {cols}",
                          data=True)

    def profile(self, schema: str, table: str, numeric: list[str], textish: list[str]) -> list[Any]:
        """One aggregate pass: rows, then per numeric column min/max/avg/stdev/non-null, per text column
        non-null/unparseable."""
        parts = ["COUNT(*) AS _rows"]
        for c in numeric:
            q = f"[{c}]"
            parts += [f"MIN(CAST({q} AS float))", f"MAX(CAST({q} AS float))", f"AVG(CAST({q} AS float))",
                      f"STDEV(CAST({q} AS float))", f"COUNT({q})"]
        for c in textish:
            q = f"[{c}]"
            parts += [f"COUNT({q})", f"SUM(CASE WHEN {q} IS NOT NULL AND TRY_CAST({q} AS float) IS NULL THEN 1 ELSE 0 END)"]
        return list(self._rows(f"SELECT {', '.join(parts)} FROM [{schema}].[{table}]", data=True)[0])


def make_reader(conn: Any) -> CatalogReader:
    return CatalogReader(conn.cursor())


# ── Picture building ──

@dataclass
class Picture:
    """The three rendered artefacts for this database and scope."""
    schema: str = ""
    value_hints: str = ""
    numeric_hints: str = ""
    from_cache: bool = False
    notes: list[str] = field(default_factory=list)


def _visible_columns(reader: CatalogReader, schemas: list[str]) -> dict[str, list[tuple]]:
    tables: dict[str, list[tuple]] = {}
    for sch, tbl, col, dtype, maxlen, nullable in reader.columns(schemas):
        if not table_visible(sch, tbl) or column_hidden(sch, tbl, col):
            continue
        tables.setdefault(f"{sch}.{tbl}", []).append((col, dtype, maxlen, nullable))
    return tables


def _primary_keys(reader: CatalogReader, schemas: list[str]) -> dict[str, set[str]]:
    pks: dict[str, set[str]] = {}
    for sch, tbl, col in reader.primary_keys(schemas):
        if not table_visible(sch, tbl) or column_hidden(sch, tbl, col):
            continue
        pks.setdefault(f"{sch}.{tbl}", set()).add(col)
    return pks


def _foreign_keys(reader: CatalogReader, schemas: list[str], visible: set[str]) -> dict[str, list[str]]:
    fks: dict[str, list[str]] = {}
    for fs, ft, fc, ts, tt, tc in reader.foreign_keys(schemas):
        frm, to = f"{fs}.{ft}", f"{ts}.{tt}"
        if frm not in visible or to not in visible:
            continue
        if column_hidden(fs, ft, fc) or column_hidden(ts, tt, tc):
            continue
        fks.setdefault(frm, []).append(f"{fc} -> {to}.{tc}")
    return fks


def _sizes(reader: CatalogReader, schemas: list[str]) -> dict[str, int]:
    try:
        return {f"{s}.{t}": int(n or 0) for s, t, n in reader.row_counts(schemas)}
    except Exception:  # noqa: BLE001 - fall back to counting per table where needed
        return {}


def _detect_duplicate_keys(reader: CatalogReader, tables: dict[str, list[tuple]], pks: dict[str, set[str]],
                           sizes: dict[str, int]) -> dict[str, str]:
    """table -> the key column that repeats, MEASURED (COUNT DISTINCT) for tables with no single-column PK."""
    settings = cfg()
    found: dict[str, str] = {}
    for table, cols in tables.items():
        total = sizes.get(table)
        if total is not None and total < settings.dup_check_min_rows:
            continue
        tpk = pks.get(table, set())
        if len(tpk) == 1:
            continue
        candidates = sorted(tpk) or [c[0] for c in cols if c[0].lower().endswith("id")]
        if not candidates:
            continue
        key = candidates[0]
        sch, _, tbl = table.partition(".")
        try:
            counted, distinct = reader.count_distinct(sch, tbl, key, with_total=total is None)
            total = counted if total is None else total
        except Exception:  # noqa: BLE001 - a table we cannot count must not break introspection
            continue
        if total and distinct and total > distinct:
            found[table] = key
    return found


def render_schema(tables: dict[str, list[tuple]], pks: dict[str, set[str]], fks: dict[str, list[str]],
                  dup_keys: dict[str, str] | None = None, sizes: dict[str, int] | None = None) -> str:
    """The schema block. Row count on the TABLE line (EMPTY marked, unknown left unmarked)."""
    dup_keys = dup_keys or {}
    sizes = sizes or {}
    lines: list[str] = []
    for table, cols in tables.items():
        count = sizes.get(table)
        if count == 0:
            lines.append(f"TABLE {table}  -- EMPTY: 0 rows. Nothing can be found here.")
        elif count:
            lines.append(f"TABLE {table}  -- {count:,} rows")
        else:
            lines.append(f"TABLE {table}")
        tpk = pks.get(table, set())
        for col, dtype, maxlen, nullable in cols:
            typ = dtype + (f"({maxlen})" if maxlen and int(maxlen) > 0 else "")
            null = "" if nullable == "YES" else " NOT NULL"
            pk = " PK" if col in tpk else ""
            lines.append(f"  - {quote_column(col)} {typ}{null}{pk}")
        if table in dup_keys:
            key = quote_column(dup_keys[table])
            lines.append(f"  MANY ROWS PER {key} - de-duplicate (COUNT(DISTINCT ...) or GROUP BY) before counting "
                         f"anything per-{key}")
        for rel in fks.get(table, []):
            lines.append(f"  FK: {rel}")
        lines.append("")
    return "\n".join(lines).strip()


def _structure_signature(reader: CatalogReader, schemas: list[str], h) -> None:
    """Fold everything STRUCTURAL into ``h``: columns, keys, constraints, scope and database identity."""
    h.update(("!scope=" + scope_signature()).encode("utf-8"))
    h.update(b"\n")
    for row in reader.structure_columns(schemas):
        h.update("|".join("" if v is None else str(v) for v in row).encode("utf-8"))
        h.update(b"\n")
    try:
        for row in reader.key_signature(schemas):
            h.update(("$" + "|".join("" if v is None else str(v) for v in row)).encode("utf-8"))
            h.update(b"\n")
    except Exception as exc:  # noqa: BLE001
        log.info("anomaly introspect: key/constraint signal unavailable (%s)", type(exc).__name__)


def live_fingerprint(reader: CatalogReader, schemas: list[str]) -> str:
    """Structure + row counts + render version: guards the rendered files, which describe DATA."""
    h = hashlib.sha256()
    _structure_signature(reader, schemas, h)
    h.update(("!render=" + _RENDER_VERSION).encode("utf-8"))
    try:
        for row in reader.row_counts(schemas):
            h.update(("#" + "|".join(str(v) for v in row)).encode("utf-8"))
            h.update(b"\n")
    except Exception as exc:  # noqa: BLE001
        log.info("anomaly introspect: row-count signal unavailable (%s)", type(exc).__name__)
    return h.hexdigest()


def structure_fingerprint(reader: CatalogReader, schemas: list[str]) -> str:
    """Structure ONLY - no row counts. The whole-database fallback guarding the compiled catalog."""
    h = hashlib.sha256()
    _structure_signature(reader, schemas, h)
    return h.hexdigest()


def table_signatures(reader: CatalogReader, schemas: list[str]) -> dict[str, str]:
    """One STRUCTURAL hash per VISIBLE table ("schema.table", lower case). A table withdrawn from the scope therefore
    reads as missing, so a probe reading it is judged stale instead of being refused at run time."""
    prefix = scope_signature()
    parts: dict[str, list[str]] = {}
    for row in reader.structure_columns(schemas):
        if not table_visible(row[0], row[1]):
            continue
        parts.setdefault(f"{row[0]}.{row[1]}".lower(), []).append("|".join("" if v is None else str(v)
                                                                           for v in row[2:]))
    try:
        for row in reader.key_signature(schemas):
            key = f"{row[1]}.{row[2]}".lower()
            if key in parts:
                parts[key].append("$" + "|".join("" if v is None else str(v) for v in (row[0], *row[3:])))
    except Exception as exc:  # noqa: BLE001
        log.info("anomaly introspect: key/constraint signal unavailable (%s)", type(exc).__name__)
    out: dict[str, str] = {}
    for key, lines in parts.items():
        h = hashlib.sha256()
        h.update((prefix + "\n" + key + "\n").encode("utf-8"))
        for line in sorted(lines):
            h.update(line.encode("utf-8"))
            h.update(b"\n")
        out[key] = h.hexdigest()
    return out


def probe_fingerprint(tables, signatures: dict[str, str]) -> str:
    """One hash for the structure of every table a probe reads; "" for an unknown table list."""
    names = sorted({str(t).strip().lower() for t in (tables or []) if str(t).strip()})
    if not names:
        return ""
    h = hashlib.sha256()
    for name in names:
        h.update(f"{name}={signatures.get(name, '<missing>')}\n".encode("utf-8"))
    return h.hexdigest()


def missing_tables(tables, signatures: dict[str, str]) -> list[str]:
    return sorted(str(t) for t in (tables or []) if str(t).strip() and str(t).strip().lower() not in signatures)


# ── value hints ──

def _is_hint_column(col: str) -> bool:
    settings = cfg()
    lc = col.lower()
    return lc.endswith(tuple(s.lower() for s in settings.hint_column_suffixes)) or \
        lc in {n.lower() for n in settings.hint_column_names}


def build_value_hints(reader: CatalogReader, tables: dict[str, list[tuple]], sizes: dict[str, int]) -> str:
    """Real coded values from small lookup tables (recognised by SHAPE: few rows, name/code-ish text columns)."""
    settings = cfg()
    table_cols: list[tuple[str, str, list[str]]] = []
    for table, cols in tables.items():
        wanted = [c[0] for c in cols if _is_hint_column(c[0])]
        if wanted:
            sch, _, tbl = table.partition(".")
            table_cols.append((sch, tbl, wanted))
    lines = ["VALUE HINTS (real coded values from the lookup tables - filter, join and decode using these ACTUAL "
             "values rather than guessing them):"]
    for sch, tbl, cols in table_cols[: settings.hint_max_tables]:
        known = sizes.get(f"{sch}.{tbl}")
        if known is not None and known > settings.hint_max_rows:
            continue
        try:
            if known is None and reader.count_rows(sch, tbl) > settings.hint_max_rows:
                continue
            rows = reader.distinct_values(sch, tbl, cols, settings.hint_max_values)
        except Exception:  # noqa: BLE001 - a bad/empty table must not break hint building
            continue
        if not rows:
            continue
        vals = ["|".join("" if v is None else str(v).strip() for v in r) for r in rows]
        lines.append(f"- {sch}.{tbl} ({', '.join(cols)}): " + "; ".join(vals))
    return "\n".join(lines) if len(lines) > 1 else ""


# ── numeric hints ──

def _name_tokens(col: str) -> set[str]:
    return {t for t in re.split(r"[^A-Za-z0-9]+", _CAMEL_SPLIT.sub("_", col).lower()) if t}


def _is_key_like(col: str, pk_columns: set[str] | None = None) -> bool:
    if pk_columns and col in pk_columns:
        return True
    keys = {k.lower() for k in cfg().key_tokens}
    last = re.split(r"[^A-Za-z0-9]+", _CAMEL_SPLIT.sub("_", col).lower())[-1]
    return last in keys or _name_tokens(col) == {"id"}


def null_pct(nulls: int, total: int) -> str:
    """Null rate, never rounded to a figure that contradicts the statistics beside it."""
    if total <= 0 or nulls <= 0:
        return "0%"
    if nulls >= total:
        return "100%"
    pct = 100.0 * nulls / total
    if pct < 1:
        return "<1%"
    if pct > 99:
        return ">99%"
    return f"{pct:.0f}%"


def classify_scale(col: str, lo, hi, pk_columns: set[str] | None = None) -> str:
    """Name the observed scale (whole-token name match for a ratio, never on an identifier)."""
    if lo is None or hi is None:
        return "no data"
    markers = {m.lower() for m in cfg().ratio_markers}
    ratio_ish = bool(_name_tokens(col) & markers) and not _is_key_like(col, pk_columns)
    try:
        lo_f, hi_f = float(lo), float(hi)
    except (TypeError, ValueError):
        return "unknown"
    if ratio_ish:
        if hi_f > 100:
            return f"PERCENT_100 but MAX={hi_f:g} EXCEEDS 100 - out-of-range values present"
        if lo_f < 0:
            return f"proportion but MIN={lo_f:g} is NEGATIVE - out-of-range values present"
        if hi_f <= 1.0:
            return "FRACTION_1 (0-1) - multiply by 100 to report a percentage"
        return "PERCENT_100 (0-100) - already a percentage, do NOT multiply"
    return "plain number"


def _is_full_detail(lo, hi, avg, nulls: int, total: int, scale: str) -> bool:
    settings = cfg()
    if scale and scale != "plain number":
        return True
    if lo is not None and lo < 0:
        return True
    if total and nulls and (100.0 * nulls / total) >= settings.full_detail_null_pct:
        return True
    if avg and hi is not None and abs(avg) > 0 and abs(hi) > abs(avg) * settings.full_detail_max_over_avg:
        return True
    return False


def build_numeric_hints(reader: CatalogReader, tables: dict[str, list[tuple]], pks: dict[str, set[str]],
                        sizes: dict[str, int]) -> str:
    """MEASURED range / scale / null rate per numeric column, and text columns that hold numbers that fail to parse.
    One aggregate pass per table; tables over the row limit are listed as NOT PROFILED."""
    settings = cfg()
    lines = ["NUMERIC HINTS (MEASURED from the live data - use these to pick the correct scale and real bounds; never "
             "assume a decimal column is 0-100 or 0-1):"]
    skipped: list[str] = []
    for table, cols in tables.items():
        sch, _, tbl = table.partition(".")
        total = sizes.get(table)
        if total is not None and total > settings.numeric_max_rows:
            skipped.append(f"{table} ({total:,} rows)")
            continue
        numeric = [c for c, dt, *_ in cols if str(dt).lower() in _NUMERIC_TYPES][: settings.numeric_max_cols_per_query]
        textish = [c for c, dt, *_ in cols if str(dt).lower() in _TEXT_TYPES][: settings.numeric_max_cols_per_query]
        if not numeric and not textish:
            continue
        try:
            row = reader.profile(sch, tbl, numeric, textish)
        except Exception as exc:  # noqa: BLE001 - one bad table must not stop profiling
            log.info("anomaly numeric hints: skipped a table (%s)", type(exc).__name__)
            continue
        n_rows = row[0] or 0
        if not n_rows:
            continue
        i = 1
        out: list[str] = []
        tpk = pks.get(table, set())
        for c in numeric:
            lo, hi, avg, sd, non_null = row[i: i + 5]
            i += 5
            lo = None if lo is None else float(lo)
            hi = None if hi is None else float(hi)
            avg = None if avg is None else float(avg)
            sd = None if sd is None else float(sd)
            nulls = n_rows - (non_null or 0)
            scale = classify_scale(c, lo, hi, tpk)
            if _is_full_detail(lo, hi, avg, nulls, n_rows, scale):
                bits = [f"min {lo:g}" if lo is not None else "min -", f"max {hi:g}" if hi is not None else "max -",
                        f"avg {avg:.4g}" if avg is not None else "avg -",
                        f"stdev {sd:.4g}" if sd is not None else "stdev -", f"nulls {null_pct(nulls, n_rows)}"]
                out.append(f"  - {c}: {', '.join(bits)} | {scale}")
            else:
                out.append(f"  - {c}: {f'{lo:g}..{hi:g}' if lo is not None and hi is not None else '-'}")
        for c in textish:
            non_null, bad = row[i: i + 2]
            i += 2
            non_null, bad = int(non_null or 0), int(bad or 0)
            parse_rate = (non_null - bad) / non_null if non_null else 0.0
            if bad and parse_rate < settings.text_numeric_min_parse:
                out.append(f"  - {c} (text): only {non_null - bad} of {non_null} values parse as a number "
                           f"({parse_rate:.0%}) - this column holds codes, labels or free text, NOT a quantity. Do not "
                           f"range-check or cast-check it.")
            elif bad:
                out.append(f"  - {c} (text): {bad} of {non_null} values do NOT parse as a number - TRY_CAST is "
                           f"required, and the failures are themselves a finding")
            elif non_null:
                out.append(f"  - {c} (text): all {non_null} values parse as a number - use TRY_CAST before comparing")
        if out:
            lines.append(f"{table}  ({int(n_rows):,} rows)")
            lines.extend(out)
    if skipped:
        lines.append("NOT PROFILED (too large to scan; the scale of their numeric columns is UNKNOWN - do not assume "
                     "one): " + "; ".join(skipped))
    return "\n".join(lines) if len(lines) > 1 else ""


def describe(refresh: bool = False) -> Picture:
    """The three artefacts for this database and scope: from the cache while the live fingerprint matches, else
    rebuilt (and cached). Raises DatabaseUnavailable / AccessDenied with safe messages."""
    settings = cfg()
    schemas = schemas_in_scope()
    if refresh:
        _drop_cache("schema.txt", "schema.fingerprint", "value_hints.txt", "numeric_hints.txt")
    with dbio.connection(timeout=settings.metadata_timeout) as conn:
        reader = make_reader(conn)
        cached = _read_cache("schema.txt")
        live = ""
        if cached:
            try:
                live = live_fingerprint(reader, schemas)
            except Exception as exc:  # noqa: BLE001 - a drift check must never block the feature
                log.warning("anomaly introspect: drift check failed (%s) - using the cached description",
                            type(exc).__name__)
                return Picture(cached, _read_cache("value_hints.txt"), _read_cache("numeric_hints.txt"), True,
                               ["The database could not be checked for changes, so the cached description was used."])
            if live and live == _read_cache("schema.fingerprint"):
                # The three files are written together with this fingerprint, so they describe the same database.
                return Picture(cached, _read_cache("value_hints.txt"), _read_cache("numeric_hints.txt"), True)
        try:
            tables = _visible_columns(reader, schemas)
            pks = _primary_keys(reader, schemas)
            fks = _foreign_keys(reader, schemas, set(tables))
            sizes = _sizes(reader, schemas)
            dup_keys = _detect_duplicate_keys(reader, tables, pks, sizes)
            schema = render_schema(tables, pks, fks, dup_keys, sizes)
            values = build_value_hints(reader, tables, sizes)
            conn.timeout = settings.detail_timeout          # profiling is a scan per table
            numbers = build_numeric_hints(reader, tables, pks, sizes)
            conn.timeout = settings.metadata_timeout
            live = live or live_fingerprint(reader, schemas)
        except dbio.DB_ERRORS:
            raise dbio.DatabaseUnavailable("The database description could not be read. Check the Ask Data database "
                                           "connection and that the login can read INFORMATION_SCHEMA.") from None
    if schema.strip():           # never cache an empty schema (a wrong scope would read as "no tables exist")
        _write_cache("schema.txt", schema)
        _write_cache("value_hints.txt", values)
        _write_cache("numeric_hints.txt", numbers)
        _write_cache("schema.fingerprint", live)
    return Picture(schema, values, numbers, False)


def fingerprints() -> tuple[str, dict[str, str], list[str]]:
    """(structure fingerprint, per-table signatures, notes) on one connection, on the METADATA budget. Unavailable is
    reported, never fatal: the caller then cannot judge staleness and says so."""
    settings = cfg()
    try:
        schemas = schemas_in_scope()
        with dbio.connection(timeout=settings.metadata_timeout) as conn:
            reader = make_reader(conn)
            return structure_fingerprint(reader, schemas), table_signatures(reader, schemas), []
    except (dbio.DatabaseUnavailable, *dbio.DB_ERRORS) as exc:
        return "", {}, [f"The structure fingerprints are unavailable ({type(exc).__name__}), so compiled probes could "
                        f"not be checked for staleness. If this is a timeout, raise the metadata timeout setting "
                        f"(currently {settings.metadata_timeout}s)."]
