"""What the numbers and codes in a probe's tables MEAN, as one hash.

Every structural signal (rule hash, table fingerprints) is blind to a column that keeps its name, type and
nullability while its scale flips from 0-100 to 0-1: the stored comparison then silently returns zero anomalies.
This folds in ONLY facts about meaning - the scale verdict per numeric column, the bounds derived from it, whether a
text column is codes, the real coded values of a lookup - never volume (min/max/avg/stdev/null rate/row counts), so a
nightly data load never invalidates anything. It fails OPEN: "" means "cannot be computed" and never invalidates.
"""
from __future__ import annotations

import hashlib
import re

from app.features.anomaly.schema_index import load_index

_VALUE_LINE_RE = re.compile(r"^-\s+(\S+)\s+\(")


def _numeric_facts(tables: tuple[str, ...], schema_text: str, numeric_hints: str) -> list[str]:
    try:
        index = load_index(schema_text or "", numeric_hints or "")
    except Exception:  # noqa: BLE001 - an unverifiable check must not fail a probe
        return []
    facts: list[str] = []
    for name in tables:
        table = index.tables.get(name) or index.get(name)
        if table is None:
            return []          # an unresolved table makes the whole fingerprint unsound
        for column, stat in sorted(table.stats.items()):
            bounds = stat.bounds()
            facts.append(f"{name}.{column}|scale={(stat.scale or '').strip().upper()}"
                         f"|bounds={'' if bounds is None else f'{bounds[0]:g}..{bounds[1]:g}'}"
                         f"|codes={int(bool(stat.text_is_codes))}")
    return facts


def _value_facts(tables: tuple[str, ...], value_hints: str) -> list[str]:
    if not value_hints:
        return []
    keep = {t.lower() for t in tables}
    out = [line.strip() for line in value_hints.splitlines()
           if (m := _VALUE_LINE_RE.match(line)) is not None and m.group(1).lower() in keep]
    return sorted(out)


def semantic_fingerprint(tables, schema_text: str = "", value_hints: str = "", numeric_hints: str = "") -> str:
    """One hash for the MEANING of every column the probe reads. "" when unknowable."""
    names = tuple(dict.fromkeys(str(t).strip() for t in (tables or []) if str(t).strip()))
    if not names:
        return ""
    facts = _numeric_facts(names, schema_text, numeric_hints)
    values = _value_facts(names, value_hints)
    if not facts and not values:
        return ""
    h = hashlib.sha256()
    h.update(b"semantics-v1\n")
    for line in sorted(facts) + values:
        h.update(line.encode("utf-8"))
        h.update(b"\n")
    return h.hexdigest()


def describe_drift(tables) -> str:
    listed = ", ".join(sorted(str(t) for t in (tables or []))[:4]) or "its tables"
    return ("the MEASURED MEANING of a column it reads has changed - a numeric scale, a derived bound or a lookup's "
            f"coded values moved in {listed}, while the column declarations did not. Its stored comparisons may now "
            "be against the wrong scale, which is a silent false pass, so it is rebuilt rather than trusted.")
