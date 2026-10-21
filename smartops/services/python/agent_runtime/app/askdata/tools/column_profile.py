"""Column profiles for the SQL Author: what each column really holds, read from the live database.

Column names alone are vague ("status", "flag_1"), so every visible column of the allowed tables gets one short line
in the SCHEMA block: how many values it has (all of them when there are few), its range for
numbers and dates, and how often it is empty:

    - status nvarchar(30) | 4 values: Active, Completed, Stopped, Suspended | 25% empty
    - spud_date date | 2019-01-03 … 2026-10-15

The value lists also feed value matching (tools/value_match.py), which links words in a question to stored values.

Nothing here names a table or a column: it profiles whatever the tenant's settings let Ask Data read (the same
visible columns as the SCHEMA block, so a hidden or secret column is never profiled). Large tables are profiled on a
sample of their first SAMPLE_ROWS rows; their counts are marked "≈".

Profiles are slow to build on a big database, so they are built in the background and cached next to the schema
(one file per database and visibility settings). A question never waits for them: until they exist the SCHEMA block
has no profiles, and a cache older than PROFILE_TTL is rebuilt in the background while the old one is still used.
Set ASKDATA_PROFILES=off to switch them off (tests do).
"""
from __future__ import annotations

import contextvars
import json
import os
import re
import threading
import time
from datetime import date, datetime, time as dtime
from decimal import Decimal
from typing import Any

from app.askdata.common.connection import get_connection
from app.askdata.log import get_agent_logger

log = get_agent_logger("db_assistant")

PROFILE_TTL = 24 * 3600          # the data changes: rebuild at least daily
SAMPLE_ROWS = 200_000            # larger tables are profiled on their first rows
SHOW_VALUES = 12                 # a column with at most this many values lists all of them in the prompt (no counts: they cost tokens)
EMPTY_NOTE = 20                  # an empty share is shown from this percentage up
MATCH_VALUES = 500               # ... and with at most this many keeps them all for value matching
VALUE_CHARS = 40                 # a listed value is cut to this length in the prompt
LONG_TEXT = 400                  # text longer than this (or max) gets only its empty share
BUILD_TIMEOUT = 120              # seconds per profiling query

_TEXT = {"char", "varchar", "nchar", "nvarchar"}
_NUMBER = {"tinyint", "smallint", "int", "bigint", "decimal", "numeric", "float", "real", "money", "smallmoney"}
_DATE = {"date", "datetime", "datetime2", "smalldatetime", "datetimeoffset", "time"}
_LISTABLE = _TEXT | {"bit"}
_COMPARABLE = _TEXT | _NUMBER | _DATE | {"bit", "uniqueidentifier"}

_LOCK = threading.Lock()
_BUILDING: set[str] = set()
_LOADED: dict[str, tuple[float, dict]] = {}    # path -> (mtime, tables)
_COLUMN_LINE = re.compile(r"^(\s+-\s+)(\[[^\]]+\]|\S+)(.*)$")


def enabled() -> bool:
    return os.environ.get("ASKDATA_PROFILES", "on").strip().lower() not in ("off", "0", "false", "no")


def _path() -> str:
    from app.askdata.tools.schema_introspect import _cache_dir
    return os.path.join(_cache_dir(), "profiles.json")


def _q(name: str) -> str:
    return "[" + name.replace("]", "]]") + "]"


def _plain(v: Any) -> Any:
    """A value the cache file (JSON) can hold: dates and times as ISO text, decimals as numbers, the rest as text."""
    if isinstance(v, datetime):
        return v.isoformat(sep=" ")
    if isinstance(v, (date, dtime)):
        return v.isoformat()
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, bytes):
        return None
    return v if v is None or isinstance(v, (str, int, float, bool)) else str(v)


def _kind(dtype: str, maxlen: Any) -> str:
    d = (dtype or "").lower()
    if d in ("text", "ntext"):
        return "long"
    if d in _TEXT:
        return "long" if maxlen in (-1, None) or (isinstance(maxlen, int) and maxlen > LONG_TEXT) else "text"
    if d in _NUMBER:
        return "number"
    if d in _DATE:
        return "date"
    if d == "bit":
        return "bit"
    return "other"


def profile_table(cur, table: str, columns: list[tuple], rows: int | None) -> dict:
    """{column (lower): profile} for one table: one aggregate query, then one value list per listable column."""
    sch, tbl = table.split(".", 1)
    sampled = rows is not None and rows > SAMPLE_ROWS
    source = (f"(SELECT TOP {SAMPLE_ROWS} * FROM {_q(sch)}.{_q(tbl)}) AS p" if sampled
              else f"{_q(sch)}.{_q(tbl)} AS p")
    cols = [(c, _kind(dtype, maxlen)) for c, dtype, maxlen, _null in columns]
    exprs = ["COUNT_BIG(*)"]
    for c, kind in cols:
        exprs.append(f"SUM(CASE WHEN p.{_q(c)} IS NULL THEN 0 ELSE 1 END)")
        distinct = kind in ("text", "number", "date", "bit")
        exprs.append(f"COUNT_BIG(DISTINCT p.{_q(c)})" if distinct else "NULL")
        ranged = kind in ("number", "date")
        exprs.append(f"MIN(p.{_q(c)})" if ranged else "NULL")
        exprs.append(f"MAX(p.{_q(c)})" if ranged else "NULL")
    cur.execute(f"SELECT {', '.join(exprs)} FROM {source}")
    row = cur.fetchone()
    total = int(row[0] or 0)
    out: dict[str, dict] = {}
    for i, (c, kind) in enumerate(cols):
        nonnull, distinct, lo, hi = row[1 + 4 * i: 5 + 4 * i]
        # table_rows is None for a view (no catalogue count): it is never searched live, as a view may be costly.
        p: dict[str, Any] = {"kind": kind, "rows": total, "empty": total - int(nonnull or 0), "sampled": sampled,
                             "table_rows": rows}
        if distinct is not None:
            p["distinct"] = int(distinct)
        if lo is not None:
            p["min"], p["max"] = _plain(lo), _plain(hi)
        if kind in ("text", "bit") and p.get("distinct") and p["distinct"] <= MATCH_VALUES:
            try:
                cur.execute(f"SELECT TOP {MATCH_VALUES} p.{_q(c)}, COUNT_BIG(*) FROM {source} WHERE p.{_q(c)} IS NOT NULL "
                            f"GROUP BY p.{_q(c)} ORDER BY COUNT_BIG(*) DESC")
                p["values"] = [[str(_plain(v)), int(n)] for v, n in cur.fetchall() if v is not None]
            except Exception as exc:  # noqa: BLE001 - one column must not lose the table's profile
                log.warning("profiles: values of %s.%s skipped (%s)", table, c, exc)
        out[c.lower()] = p
    return out


def build() -> dict:
    """Profiles of every visible table (the SCHEMA block's tables and columns)."""
    from app.askdata.tools.schema_introspect import _fetch_columns, _row_counts

    started = time.monotonic()
    conn = get_connection(timeout=BUILD_TIMEOUT, readonly=True)
    try:
        cur = conn.cursor()
        tables = _fetch_columns(cur)
        try:
            sizes = {f"{s}.{t}".lower(): (n or 0) for s, t, n in _row_counts(cur)}
        except Exception:  # noqa: BLE001 - without sizes every table is profiled in full
            sizes = {}
        out: dict[str, dict] = {}
        for table, columns in tables.items():
            try:
                out[table.lower()] = profile_table(cur, table, columns, sizes.get(table.lower()))
            except Exception as exc:  # noqa: BLE001 - a table that cannot be read keeps no profile
                log.warning("profiles: %s skipped (%s)", table, exc)
    finally:
        conn.close()
    log.info("profiles: %d tables profiled in %.1fs", len(out), time.monotonic() - started)
    return out


def _save(tables: dict, path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump({"built_at": time.time(), "sample_rows": SAMPLE_ROWS, "tables": tables}, fh, ensure_ascii=False)
    os.replace(tmp, path)


def _refresh(path: str) -> None:
    try:
        tables = build()
        if tables:
            _save(tables, path)
    except Exception as exc:  # noqa: BLE001 - profiles are an aid; Ask Data works without them
        log.warning("profiles: build failed (%s)", exc)
    finally:
        with _LOCK:
            _BUILDING.discard(path)


def current() -> dict:
    """The cached profiles ({} until the first build finishes); starts a background build when missing or stale."""
    if not enabled():
        return {}
    path = _path()
    tables, built_at = {}, 0.0
    try:
        mtime = os.path.getmtime(path)
        cached = _LOADED.get(path)
        if cached and cached[0] == mtime:
            tables = cached[1]
        else:
            with open(path, encoding="utf-8") as fh:
                data = json.load(fh)
            tables = data.get("tables") or {}
            _LOADED[path] = (mtime, tables)
        built_at = mtime
    except (OSError, ValueError):
        pass
    if time.time() - built_at > PROFILE_TTL:
        with _LOCK:
            start = path not in _BUILDING
            _BUILDING.add(path)
        if start:
            # The run's database and settings live in a context variable: the build thread gets a copy.
            ctx = contextvars.copy_context()
            threading.Thread(target=ctx.run, args=(_refresh, path), name="askdata-profiles", daemon=True).start()
    return tables


def _value(v: Any) -> str:
    s = " ".join(str(v).split())
    return s if len(s) <= VALUE_CHARS else s[:VALUE_CHARS - 1] + "…"


def _count(n: int, sampled: bool) -> str:
    return ("≈" if sampled else "") + f"{n:,}"


def _id_like(column: str) -> bool:
    c = column.lower()
    return c == "id" or c.endswith(("_id", "_key", "_no", "_number")) or c.startswith("pk_")


def describe(p: dict, column: str = "") -> str:
    """One column's profile as the text after its schema line ("" when there is nothing useful to say): the values
    of a text column, the range of a date or of a number that is not an id, and a notable empty share. Counts of
    distinct ids and their ranges say nothing about which column to use, so they are left out (they cost tokens)."""
    parts: list[str] = []
    sampled = bool(p.get("sampled"))
    values, distinct = p.get("values"), p.get("distinct")
    if values and distinct is not None and distinct <= SHOW_VALUES and len(values) == distinct:
        parts.append(f"{distinct} value{'s' if distinct != 1 else ''}: "
                     + ", ".join(_value(v) for v, _n in values))
    elif values and not _id_like(column):
        parts.append(f"{_count(distinct or len(values), sampled)} values, most common: "
                     + ", ".join(_value(v) for v, _n in values[:3]))
    if p.get("min") is not None and not (p.get("kind") == "number" and _id_like(column)):
        lo, hi = p["min"], p["max"]
        parts.append(f"{_value(lo)} … {_value(hi)}" if lo != hi else f"always {_value(lo)}")
    rows, empty = p.get("rows") or 0, p.get("empty") or 0
    if rows and empty:
        pct = 100 * empty / rows
        if empty == rows:
            parts.append("always empty")
        elif pct >= EMPTY_NOTE:
            parts.append(f"{round(pct)}% empty")
    return " | ".join(parts)


def annotate(schema_text: str, tables: dict) -> str:
    """The SCHEMA block with each profiled column's line followed by " | <profile>"."""
    if not tables:
        return schema_text
    out, table = [], None
    for line in schema_text.split("\n"):
        if line.startswith("TABLE "):
            table = tables.get(line[len("TABLE "):].strip().lower())
        elif table is not None and (m := _COLUMN_LINE.match(line)):
            name = m.group(2).strip("[]").replace("]]", "]")
            p = table.get(name.lower())
            text = describe(p, name) if p else ""
            if text:
                line = f"{line} | {text}"
        elif not line.strip():
            table = None
        out.append(line)
    return "\n".join(out)
