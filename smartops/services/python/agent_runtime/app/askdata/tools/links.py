"""Suggested links between Ask Data tables that the database has no foreign key for (AI Settings > Ask Data &
Features > Terms & column names > Table links). An admin confirms or rejects each; confirmed links become FK lines in
the SCHEMA block (tools/knowledge.annotate), so the SQL Author and the join check use them.

A link is suggested for a key-like column name ("well_id", "cluster_code", "crew_no") found in several tables, from
each table to the base table where the column's values are unique (the table it points to), when no FK already joins
the two. Read from the column profiles (tools/column_profile.py); no database query. Nothing here names a table.
"""
from __future__ import annotations

import re

MAX_LINKS = 50
_KEYISH = re.compile(r"(^|_)(id|code|no|num|number|key)$")
_TABLE = re.compile(r"^TABLE\s+(\S+)")
_FK = re.compile(r"^\s+FK:\s+(\S+)\s*->\s*(\S+)\.([^.\s]+)\s*$")


def _fks(schema_text: str) -> set[frozenset[str]]:
    """Each FK of the SCHEMA block as {from table.column, to table.column}."""
    pairs, table = set(), None
    for line in schema_text.split("\n"):
        if (m := _TABLE.match(line)):
            table = m.group(1).lower()
        elif table and (m := _FK.match(line)):
            pairs.add(frozenset({f"{table}.{m.group(1).lower()}", f"{m.group(2).lower()}.{m.group(3).lower()}"}))
    return pairs


def _unique(p: dict) -> bool:
    """Each filled row has its own value (a key), in a base table (a view's values may only look unique)."""
    filled = (p.get("rows") or 0) - (p.get("empty") or 0)
    return p.get("table_rows") is not None and not p.get("sampled") and filled >= 2 and (p.get("distinct") or 0) >= filled


def _overlap(frm: dict, to: dict) -> float | None:
    """Share of the from-column's listed values that the to-column also lists; None when either has no value list."""
    a = {str(v).lower() for v, _n in frm.get("values") or []}
    b = {str(v).lower() for v, _n in to.get("values") or []}
    return round(len(a & b) / len(a), 2) if a and b else None


def _fits(frm: dict, to: dict) -> bool:
    """False when the from-column's numbers fall outside the to-column's range (they cannot all point to it)."""
    if frm.get("kind") != "number" or frm.get("min") is None or to.get("min") is None:
        return True
    try:
        return float(to["min"]) <= float(frm["min"]) and float(frm["max"]) <= float(to["max"])
    except (TypeError, ValueError):
        return True


def suggest(profiles: dict, schema_text: str) -> list[dict]:
    """[{from: "schema.table.column", to: "schema.table.column", overlap}], best first, at most MAX_LINKS."""
    joined = _fks(schema_text)
    owners: dict[str, list[tuple[str, dict]]] = {}
    for table, columns in profiles.items():
        for column, p in columns.items():
            # "id" and "pk_*" are each table's own surrogate key, not a link.
            if column != "id" and not column.startswith("pk_") and _KEYISH.search(column):
                owners.setdefault(column, []).append((table, p))
    out = []
    for column, tables in owners.items():
        keys = [(t, p) for t, p in tables if _unique(p)]
        if len(tables) < 2 or not keys:
            continue
        # The table the others point to: where the value is a key, the biggest such table (a 1:1 table links to it).
        target, target_p = max(keys, key=lambda k: k[1].get("table_rows") or 0)
        for table, p in tables:
            if table == target or p.get("kind") != target_p.get("kind") or not _fits(p, target_p):
                continue
            if frozenset({f"{table}.{column}", f"{target}.{column}"}) in joined:
                continue
            out.append({"from": f"{table}.{column}", "to": f"{target}.{column}", "overlap": _overlap(p, target_p)})
    out.sort(key=lambda x: (x["overlap"] is None, -(x["overlap"] or 0), x["from"]))
    return out[:MAX_LINKS]
