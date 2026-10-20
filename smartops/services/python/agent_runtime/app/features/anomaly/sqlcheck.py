"""Deterministic, schema-derived observations about a probe's SQL. Advisory, never fatal (ported verbatim).

Handed to the Rule Verifier as EVIDENCE TO ADJUDICATE: a table marked MANY ROWS PER read without collapsing it, a
declared foreign key joined to the wrong column, and a measured 0-1 / 0-100 column compared against a literal on the
wrong side of 1 - the silent, confident zero.
"""
from __future__ import annotations

import logging
import re

log = logging.getLogger("agent_runtime.anomaly")

_TABLE_RE = re.compile(r"^TABLE\s+(\S+)", re.MULTILINE)
_FK_RE = re.compile(r"^\s+FK:\s+(\w+)\s*->\s*(\S+)\.(\w+)\s*$", re.MULTILINE)
_DUP_RE = re.compile(r"MANY ROWS PER\s+(\[[^\]]+\]|\w+)")
_COLLAPSING = ("count(distinct", "group by", "row_number", "distinct ", "sum(", "avg(", "max(", "min(")
_NUM_HEAD_RE = re.compile(r"^(\S+)\s+\([\d,]+\s+rows\)\s*$")
_NUM_COL_RE = re.compile(r"^\s+-\s+(\S+):\s+min\s.*\|\s*(.+?)\s*$")
_COMPARISON = r"(?:\w+\.)?{col}\s*(>=|<=|<>|!=|=|>|<)\s*([0-9]+(?:\.[0-9]+)?)"


def _blocks(schema: str) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for block in re.split(r"(?=^TABLE\s)", schema or "", flags=re.MULTILINE):
        m = _TABLE_RE.search(block)
        if m:
            out.append((m.group(1), block))
    return out


def _bare(name: str) -> str:
    return name[1:-1] if name.startswith("[") and name.endswith("]") else name


def _scales(numeric_text: str) -> dict[str, dict[str, str]]:
    out: dict[str, dict[str, str]] = {}
    table = ""
    for line in (numeric_text or "").splitlines():
        head = _NUM_HEAD_RE.match(line)
        if head is not None:
            table = head.group(1)
            continue
        if not table:
            continue
        m = _NUM_COL_RE.match(line)
        if m is None:
            continue
        verdict = m.group(2).upper()
        if "FRACTION_1" in verdict:
            out.setdefault(table, {})[m.group(1)] = "FRACTION_1"
        elif "PERCENT_100" in verdict:
            out.setdefault(table, {})[m.group(1)] = "PERCENT_100"
    return out


def _scale_concerns(sql_low: str, table: str, columns: dict[str, str]) -> list[str]:
    found: list[str] = []
    for column, scale in columns.items():
        pattern = _COMPARISON.format(col=re.escape(column.lower()))
        for op, literal in re.findall(pattern, sql_low):
            try:
                value = float(literal)
            except ValueError:
                continue
            if scale == "FRACTION_1" and value > 1:
                found.append(f"{table}.{column} was MEASURED as a 0-1 fraction, but the query compares it {op} "
                             f"{literal}. On a 0-1 column that condition is either always or never true, so the probe "
                             f"would report a silent, confident zero. Compare against a 0-1 value, or multiply the "
                             f"column by 100 first.")
            elif scale == "PERCENT_100" and 0 < value < 1:
                found.append(f"{table}.{column} was MEASURED as a 0-100 percentage, but the query compares it {op} "
                             f"{literal}, which is a fraction. Compare against a 0-100 value.")
    return found


def check(sql: str, schema: str, numeric_text: str = "") -> list[str]:
    if not sql or not schema:
        return []
    low = " ".join(sql.split()).lower()
    concerns: list[str] = []
    scales = _scales(numeric_text)
    for table, block in _blocks(schema):
        if table.lower() not in low:
            continue
        for key in _DUP_RE.findall(block):
            if not any(token in low for token in _COLLAPSING):
                concerns.append(f"{table} holds many rows per {_bare(key)} but the query does not aggregate or "
                                f"de-duplicate it, so each entity is counted more than once")
                break
        for column, target_table, target_column in _FK_RE.findall(block):
            if f"{column.lower()} =" not in low and f"{column.lower()}=" not in low:
                continue
            if target_table.lower() not in low:
                continue
            if target_column.lower() not in low:
                concerns.append(f"{table}.{column} is declared to join {target_table}.{target_column}, but that "
                                f"column does not appear in the query")
        concerns.extend(_scale_concerns(low, table, scales.get(table, {})))
    return concerns


def check_probe(summary_sql: str, detail_sql: str, schema: str, numeric_text: str = "") -> list[str]:
    """Concerns across both halves, de-duplicated and order-preserving."""
    try:
        found = check(summary_sql, schema, numeric_text) + check(detail_sql, schema, numeric_text)
    except Exception as exc:  # noqa: BLE001 - an advisory signal must never break a compile
        log.warning("anomaly sanity: schema check skipped (%s)", type(exc).__name__)
        return []
    return list(dict.fromkeys(found))
