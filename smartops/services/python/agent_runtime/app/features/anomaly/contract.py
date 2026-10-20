"""Deterministic checks on a probe - on its SQL text before it runs, and on what it returned (ported verbatim).

  static_problems                HARD contract on the SQL text, before any database round trip
  check_summary / check_detail   HARD contract on what came back (columns from cursor.description, never parsed)
  grain / saturation / dedup     HARD refusals decided from the sample the executor already fetched
  sanity_concerns, grain_concerns ADVISORY: handed to the Verifier to adjudicate, never a failure on their own

Every message is phrased as an instruction because it is fed verbatim to the SQL Author: these are machine-computed
diagnostics with the values that triggered them, so they stay in code (the tolerances come from settings).
"""
from __future__ import annotations

import re
from typing import Any, Sequence

from app.features.anomaly.config import cfg
from app.features.anomaly.model import (
    DETAIL_RECOMMENDED,
    DETAIL_REQUIRED,
    EVIDENCE_PREFIX,
    SUMMARY_OPTIONAL,
    SUMMARY_REQUIRED,
)

_ORDER_BY = re.compile(r"\border\s+by\b", re.IGNORECASE)
_SELECT_TOP = re.compile(r"\bselect\s+top\b", re.IGNORECASE)
# Division by an identifier or a parenthesised expression (a literal divisor cannot be zero).
_DIVISION = re.compile(r"/\s*[A-Za-z_(]")
_UNRESOLVED = re.compile(r"\{\{")
# How introspection marks a table holding more than one row per entity (matched, never re-derived).
GRAIN_MARKER = "MANY ROWS PER "


def _alias(column: str) -> re.Pattern:
    return re.compile(rf"\bAS\s+\[?{re.escape(column)}\]?\b", re.IGNORECASE)


def blank_literals(sql: str) -> str:
    """Replace every '...' literal with '' so its contents cannot be read as code ('' escapes a quote)."""
    out: list[str] = []
    i, n = 0, len(sql or "")
    while i < n:
        if sql[i] == "'":
            i += 1
            while i < n:
                if sql[i] == "'":
                    if i + 1 < n and sql[i + 1] == "'":
                        i += 2
                        continue
                    i += 1
                    break
                i += 1
            out.append("''")
            continue
        out.append(sql[i])
        i += 1
    return "".join(out)


def strip_comments(sql: str) -> str:
    """Remove -- and /* */ comments (a comment marker inside a literal is not a comment)."""
    out: list[str] = []
    i, n = 0, len(sql or "")
    while i < n:
        if sql.startswith("--", i):
            nl = sql.find("\n", i)
            i = n if nl == -1 else nl
            out.append(" ")
            continue
        if sql.startswith("/*", i):
            end = sql.find("*/", i + 2)
            i = n if end == -1 else end + 2
            out.append(" ")
            continue
        if sql[i] == "'":
            start = i
            i += 1
            while i < n:
                if sql[i] == "'":
                    if i + 1 < n and sql[i + 1] == "'":
                        i += 2
                        continue
                    i += 1
                    break
                i += 1
            out.append(sql[start:i])
            continue
        out.append(sql[i])
        i += 1
    return "".join(out)


def code_of(sql: str) -> str:
    """The executable part of a query: no comments, no literal contents."""
    return blank_literals(strip_comments(sql))


def _division_problems(sql: str, which: str) -> list[str]:
    window_chars = cfg().nullif_window
    problems: list[str] = []
    bare = code_of(sql)
    for m in _DIVISION.finditer(bare):
        window = bare[m.start(): m.start() + window_chars]
        if "nullif" in window.lower():
            continue
        problems.append(
            f"{which} divides without a NULLIF guard near {window.strip()[:32]!r}. A probe runs unattended, so a "
            f"divide-by-zero is a failed rule rather than a visible error - write the divisor as NULLIF(<divisor>, 0)."
        )
    return problems


def static_problems(summary_sql: str, detail_sql: str, rule_id: str) -> list[str]:
    """Hard contract violations visible in the SQL text. Empty list means it passed."""
    problems: list[str] = []
    summary = summary_sql or ""
    detail = detail_sql or ""
    if not summary.strip():
        problems.append("The SUMMARY query is missing entirely. A probe is always a PAIR.")
    if not detail.strip():
        problems.append("The DETAIL query is missing entirely. A probe is always a PAIR.")
    if not summary.strip() or not detail.strip():
        return problems

    summary_code = code_of(summary)
    detail_code = code_of(detail)
    summary_text = strip_comments(summary)   # literals survive: the rule_id check looks for one

    for column in SUMMARY_REQUIRED:
        if not _alias(column).search(summary_code):
            problems.append(f"SUMMARY does not alias a column {column}. It must be aliased exactly AS {column}, "
                            f"because the runner reads the result by that name.")
    if rule_id and f"'{rule_id}'" not in summary_text:
        problems.append(f"SUMMARY must carry its own id as a literal aliased AS rule_id, written exactly "
                        f"'{rule_id}'. The report keys every finding on it.")
    for column in DETAIL_REQUIRED:
        if not _alias(column).search(detail_code):
            problems.append(f"DETAIL does not alias a column {column}. Every findings row must carry {column} - the "
                            f"stable identifier of the thing that is wrong, so somebody can go and fix that record.")
    if EVIDENCE_PREFIX not in detail_code.lower():
        problems.append(f"DETAIL has no {EVIDENCE_PREFIX}* column. Add at least one column carrying the actual values "
                        f"that PROVE the anomaly (the dates, the percentages, the counts). A finding the reader cannot "
                        f"verify from the row itself is an assertion, not a finding.")
    if not _ORDER_BY.search(detail_code):
        problems.append("DETAIL has no ORDER BY. The runner caps how many rows are kept, so without an explicit "
                        "worst-first ordering the report would show an arbitrary sample instead of the rows that "
                        "matter.")
    if _SELECT_TOP.search(detail_code):
        problems.append("DETAIL uses TOP. Remove it - the runner applies the cap. A hand-added TOP makes "
                        "anomaly_count and the number of detail rows disagree, which is reported as the two queries "
                        "contradicting each other.")
    problems += _division_problems(summary, "SUMMARY")
    problems += _division_problems(detail, "DETAIL")
    if _UNRESOLVED.search(summary + detail):
        problems.append("An unresolved {{placeholder}} is still present. Write the real value - the query is stored "
                        "ready to run, with no substitution step left after this one.")
    return problems


def columns_of(cursor_description: Sequence[Any] | None) -> list[str]:
    """Column names from a cursor.description, lowercased (T-SQL is case-insensitive about aliases)."""
    if not cursor_description:
        return []
    return [str(d[0]).strip().lower() for d in cursor_description]


def check_summary(columns: Sequence[str], row_count: int) -> list[str]:
    problems: list[str] = []
    have = {c.lower() for c in columns}
    missing = [c for c in SUMMARY_REQUIRED if c not in have]
    if missing:
        problems.append("SUMMARY is missing required column(s): " + ", ".join(missing)
                        + f". It must SELECT exactly one row aliased {', '.join(SUMMARY_REQUIRED)}"
                        + f" (optionally also {', '.join(SUMMARY_OPTIONAL)}).")
    if row_count == 0:
        problems.append("SUMMARY returned NO rows. It must always return exactly one row, including when nothing is "
                        "anomalous (anomaly_count = 0). Aggregate over the scope rather than filtering the scope down "
                        "to the anomalies.")
    elif row_count > 1:
        problems.append(f"SUMMARY returned {row_count} rows; it must return exactly one. Remove the GROUP BY, or "
                        "aggregate it away in an outer SELECT.")
    return problems


def check_detail(columns: Sequence[str]) -> list[str]:
    problems: list[str] = []
    have = {c.lower() for c in columns}
    missing = [c for c in DETAIL_REQUIRED if c not in have]
    if missing:
        problems.append("DETAIL is missing required column(s): " + ", ".join(missing)
                        + ". Every findings row must carry entity_key - the stable identifier of the thing that is "
                          "wrong, so someone can go and fix that record.")
    if not any(c.startswith(EVIDENCE_PREFIX) for c in have):
        problems.append(f"DETAIL has no {EVIDENCE_PREFIX}* column. Add at least one column carrying the actual values "
                        "that PROVE the anomaly (the dates, the percentages, the counts). A finding the reader cannot "
                        "verify from the row itself is an assertion, not a finding.")
    return problems


def detail_advice(columns: Sequence[str]) -> list[str]:
    have = {c.lower() for c in columns}
    return [f"DETAIL has no {c} column - the report will fall back to a less readable default"
            for c in DETAIL_RECOMMENDED if c not in have]


def summary_values(columns: Sequence[str], row: Sequence[Any]) -> dict[str, Any]:
    return {str(c).strip().lower(): v for c, v in zip(columns, row)}


def _as_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def nearly_saturated(count: int | None, scope: int | None) -> bool:
    """Scope so nearly all anomalies that the percentage means little. Shared by the gate and the summary."""
    settings = cfg()
    if not scope or count is None or scope < settings.saturation_floor:
        return False
    if count >= scope:
        return False
    return (count / scope) >= settings.near_saturation_share


def sanity_concerns(values: dict[str, Any], detail_row_count: int | None = None) -> list[str]:
    """Advisory observations about a probe's NUMBERS. Never fails a rule by itself."""
    concerns: list[str] = []
    scope = _as_int(values.get("scope_total"))
    count = _as_int(values.get("anomaly_count"))
    if scope == 0:
        concerns.append("scope_total is 0 - the probe examined NO rows at all. This is almost always a join on the "
                        "wrong column or a filter on a value that does not exist, not a clean result. Confirm the "
                        "query can ever match anything.")
    elif count is not None and scope is not None:
        if count > scope:
            concerns.append(f"anomaly_count ({count}) exceeds scope_total ({scope}), which is impossible - the two are "
                            "being counted at different grains. The detail query is probably joining a one-to-many "
                            "table without de-duplicating it.")
        elif count == scope and scope > 0:
            concerns.append(f"every row in scope is flagged ({count} of {scope}). Occasionally real, but usually means "
                            "the condition is inverted, the scale is wrong (comparing a 0-1 fraction against 100), or "
                            "the filter belongs in the scope rather than the test.")
        elif scope > 0 and nearly_saturated(count, scope):
            concerns.append(f"nearly every row in scope is flagged ({count} of {scope}, {100.0 * count / scope:.2f}%). "
                            "Confirm that scope_total is a real population and not the anomaly restated with a "
                            "handful of rows escaping it - at this share the percentage usually measures how the scope "
                            "was selected rather than how much is wrong. If the scope IS the right population, say so "
                            "and leave it.")
    if detail_row_count is not None and count is not None and detail_row_count != count:
        concerns.append(f"SUMMARY reports {count} anomalies but DETAIL returned {detail_row_count} rows. The two "
                        "queries disagree - they must apply the SAME condition to the SAME grain.")
    pct = values.get("anomaly_pct")
    if pct is not None and scope:
        try:
            expected = 100.0 * (count or 0) / scope
            if abs(float(pct) - expected) > cfg().pct_tolerance:
                concerns.append(f"anomaly_pct ({float(pct):.2f}) does not match anomaly_count/scope_total "
                                f"({expected:.2f}). Compute it as 100.0 * anomaly_count / NULLIF(scope_total, 0).")
        except (TypeError, ValueError):
            concerns.append("anomaly_pct is not numeric.")
    return concerns


def _indistinguishable(columns: Sequence[str], rows: Sequence[Sequence[Any]]) -> tuple[int, int]:
    """(sample rows, how many are distinct once entity_key is ignored)."""
    have = [str(c).strip().lower() for c in columns]
    keep = [i for i, c in enumerate(have) if c != "entity_key"]
    if not keep:
        return 0, 0
    seen = {tuple(str(r[i]) if i < len(r) else "" for i in keep) for r in rows}
    return len(rows), len(seen)


def _worst_repeat(columns: Sequence[str], rows: Sequence[Sequence[Any]]) -> str:
    """The most-repeated finding in the sample, quoted, so the rejection says WHAT to group on."""
    have = [str(c).strip().lower() for c in columns]
    keep = [i for i, c in enumerate(have) if c != "entity_key"]
    if not keep or not rows:
        return ""
    groups: dict[tuple, list[Sequence[Any]]] = {}
    for row in rows:
        groups.setdefault(tuple(str(row[i]) if i < len(row) else "" for i in keep), []).append(row)
    worst_key, worst_rows = max(groups.items(), key=lambda kv: len(kv[1]))
    if len(worst_rows) < 2:
        return ""
    label = ""
    if "entity_label" in have:
        at = have.index("entity_label")
        label = str(worst_rows[0][at]) if at < len(worst_rows[0]) else ""
    if not label:
        label = next((v for v in worst_key if v), "")
    keys = ""
    if "entity_key" in have:
        at = have.index("entity_key")
        keys = ", ".join(str(r[at]) for r in worst_rows[:4] if at < len(r))
    return (f" For example {label[:60]!r} appears {len(worst_rows)} times in the sample, under entity_key {keys} - "
            f"identical in every other column. Those are one thing, not {len(worst_rows)}: whatever distinguishes "
            f"those rows is a version of the record, not a separate finding, so group on the value that identifies "
            f"the THING and keep only its current version.")


def grain_concerns(columns: Sequence[str], rows: Sequence[Sequence[Any]]) -> list[str]:
    """ADVISORY: the findings repeat, but whether that is wrong depends on the rule."""
    settings = cfg()
    total, distinct = _indistinguishable(columns, rows)
    if total < settings.grain_min_sample or distinct == 0:
        return []
    if distinct > total * settings.grain_max_distinct_share:
        return []
    return [f"the findings repeat: {total} sample row(s) reduce to {distinct} once entity_key is ignored, so the same "
            "record is being reported several times under different keys. Where the source keeps one row per update, "
            "this means the probe is counting UPDATES rather than things - every count it produces is multiplied by "
            "the number of times each thing was touched. Confirm the probe resolves to the current record per entity "
            "before judging it."]


def grain_problems(columns: Sequence[str], rows: Sequence[Sequence[Any]], truncated: bool = False,
                   schema_block: str = "") -> list[str]:
    """Hard check: DETAIL returns one row per entity, and entity_key is an identifier (decided from the sample)."""
    settings = cfg()
    have = [str(c).strip().lower() for c in columns]
    if "entity_key" not in have or len(rows) < settings.grain_min_sample:
        return []
    at = have.index("entity_key")
    keys = [r[at] for r in rows if at < len(r) and r[at] is not None]
    if len(keys) < settings.grain_min_sample:
        return []

    problems: list[str] = []
    distinct = len({str(k) for k in keys})
    if distinct < len(keys):
        problems.append(
            f"DETAIL returns the same entity_key more than once: {len(keys)} sample row(s) carry only {distinct} "
            f"distinct key(s), so {len(keys) - distinct} row(s) repeat a record already reported. entity_key must "
            "identify ONE thing that is wrong, so every count derived from these rows is inflated. Resolve to one row "
            "per entity before judging it - where the source keeps a history, select the current record per entity "
            "first, and make SUMMARY count at that same grain."
        )
    try:
        numbers = sorted(int(k) for k in keys)
    except (TypeError, ValueError):
        numbers = []
    if numbers and numbers[0] == 1 and numbers == list(range(1, len(numbers) + 1)):
        problems.append("entity_key is a positional row number (1, 2, 3 ...), not an identifier. A reader cannot act "
                        "on a finding that names a position in a result set. Select the real key of the record - the "
                        "code or id that identifies it in its own table.")
    if GRAIN_MARKER in (schema_block or ""):
        total, distinct_rows = _indistinguishable(columns, rows)
        if total >= settings.grain_min_sample and distinct_rows and \
                distinct_rows <= total * settings.grain_max_distinct_share:
            markers = sorted(set(re.findall(rf"{GRAIN_MARKER}(\S+)", schema_block or "")))
            named = (" The SCHEMA marks the repeated grain on: " + ", ".join(markers[:4]) + "." if markers else "")
            problems.append(
                f"DETAIL reports the same record repeatedly: {total} sample row(s) reduce to {distinct_rows} once "
                f"entity_key is ignored, and a table this probe reads is marked in the SCHEMA as holding MANY ROWS PER "
                "entity. The probe is counting updates rather than things, so every count it produces is multiplied "
                "by how many times each thing was touched."
                + _worst_repeat(columns, rows) + named
                + " Select the CURRENT record per entity first - the one with the latest update, using ROW_NUMBER() "
                  "OVER (PARTITION BY <the entity> ORDER BY <the update marker> DESC) and keeping row 1 - and make "
                  "SUMMARY count at that same grain, so scope_total and anomaly_count are both per entity."
            )
    return problems


def saturation_problems(values: dict[str, Any]) -> list[str]:
    """Hard check: a probe whose scope IS its anomalies measures nothing (above the configured floor)."""
    scope = _as_int(values.get("scope_total"))
    count = _as_int(values.get("anomaly_count"))
    if scope is None or count is None or scope < cfg().saturation_floor:
        return []
    if count != scope:
        return []
    return [f"Every record in scope is flagged ({count} of {scope}), so scope_total is not a denominator - it is the "
            "anomalies counted twice, and the percentage is 100% by construction rather than by measurement. SUMMARY "
            "must aggregate over the POPULATION the rule is about and mark each record anomalous or not; only the "
            "DETAIL query narrows to the offenders. Move the condition that identifies the anomaly out of the scope "
            "and into the CASE expression."]


# ── Two rules measuring the same thing ──
_OWN_ID = re.compile(r"'[^']*'\s+AS\s+rule_id", re.IGNORECASE)
_FROM_JOIN_TABLE = re.compile(r"\b(?:FROM|JOIN)\s+([A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*)", re.IGNORECASE)
_FLAG_CONDITION = re.compile(r"\bCASE\s+WHEN\s+(.+?)\s+THEN\s+1\b", re.IGNORECASE | re.DOTALL)
_SCOPE_CONDITION = re.compile(
    r"\bWHERE\s+(.+?)(?=\bGROUP\s+BY\b|\bORDER\s+BY\b|\bHAVING\b|\)\s*(?:,|\bSELECT\b)|\Z)", re.IGNORECASE | re.DOTALL)


def probe_signature(summary_sql: str) -> str:
    """What a probe MEASURES - its tables, its flag condition and its scope, aliases stripped. "" when nothing is
    comparable (a FALSE duplicate is worse than a missed one)."""
    code = _OWN_ID.sub("", code_of(summary_sql or ""))

    def _norm(parts) -> list[str]:
        return sorted(re.sub(r"\b[A-Za-z_][A-Za-z0-9_]*\.", "", re.sub(r"\s+", " ", p).strip().lower())
                      for p in parts)

    tables = sorted({t.lower() for t in _FROM_JOIN_TABLE.findall(code)})
    flags = _norm(m.group(1) for m in _FLAG_CONDITION.finditer(code))
    scopes = _norm(m.group(1) for m in _SCOPE_CONDITION.finditer(code))
    if not tables or not flags:
        return ""
    return "|".join(tables) + "||" + "|".join(flags) + "||" + "|".join(scopes)


_TABLE_LINE = re.compile(r"^TABLE\s+(\S+)[^\n]*?--\s*([\d,]+)\s+rows", re.MULTILINE)


def dedup_problems(values: dict[str, Any], schema_block: str) -> list[str]:
    """Hard check: the probe claims a per-entity grain but examined every stored row of a MANY ROWS PER table."""
    scope = _as_int(values.get("scope_total"))
    if not scope:
        return []
    tolerance = cfg().dedup_scope_tolerance
    for m in _TABLE_LINE.finditer(schema_block or ""):
        rows = int(m.group(2).replace(",", ""))
        if not rows:
            continue
        block = schema_block[m.start():]
        end = block.find("\nTABLE ")
        if GRAIN_MARKER not in (block[:end] if end > 0 else block):
            continue
        if abs(scope - rows) <= rows * tolerance:
            return [
                f"SUMMARY examined {scope:,} records, which is the entire row count of {m.group(1)} ({rows:,}) - a "
                "table the SCHEMA marks as holding MANY ROWS PER entity. Whatever de-duplication this query performs "
                "is not reducing anything: check what you partitioned by, because partitioning by a column that is "
                "already unique per row (an id, a surrogate key) leaves every row in its own group and keeps them all. "
                "Partition by the value that identifies the THING - the code or key the schema marks the grain on - so "
                "scope_total counts things, not updates. Every percentage this probe reports is otherwise measured "
                "against the wrong denominator, and cannot be compared with any other check on this table."
            ]
    return []
