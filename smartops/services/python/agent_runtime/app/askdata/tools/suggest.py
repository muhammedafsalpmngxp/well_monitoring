"""Suggested questions for Ask your data, built from the column profiles (tools/column_profile.py): no AI call.

* Starters, for an empty panel: a few questions over the tables with the most to say (a category with few values, a
  date), in the business names of the columns when the tenant gave them (tools/knowledge.py).
* Follow-ups, after an answer: the same question for another value ("Same for Marmul"), broken down by a category or
  by month. They rely on the conversation, which the panel keeps.

Nothing here names a table or a column: it reads whatever the profiles hold for this tenant's settings.
"""
from __future__ import annotations

import re
from collections import Counter
from typing import Iterable

from app.askdata.settings import ColumnNote
from app.askdata.tools.column_profile import SHOW_VALUES, _id_like
from app.askdata.tools.knowledge import display_names

MAX_STARTERS = 4
MAX_FOLLOW_UPS = 3
MIN_ROWS = 20                    # smaller tables are not offered as starters
MAX_VALUE = 20                   # a longer value is not put in a starter question
# Words in table names that say nothing about what a row is ("well_master" is about wells).
_GENERIC = frozenset("master details detail data tbl table dim fact raw list info snapshot report csv excel dump "
                     "new old temp tmp stg staging vw view".split())
# Tables named like this are loads or copies, not what people ask about: never offered as starters.
_STAGING = frozenset("dump csv import imports staging stg tmp temp backup bak copy test old log audit".split())
_LITERAL = re.compile(r"'((?:[^']|'')+)'")
_FK_TARGET = re.compile(r"^\s+FK:\s+\S+\s*->\s*(\S+)\.[^.\s]+\s*$", re.M)
_FROM = re.compile(r"(?:from|join)\s+(\[?\w+\]?\.\[?\w+\]?)", re.I)


def _plural(word: str) -> str:
    if re.search(r"[^aeiou]y$", word):
        return word[:-1] + "ies"
    return word + ("es" if re.search(r"(s|x|z|ch|sh)$", word) else "s")


def _entity(table: str) -> str:
    """What one row is, in words: "well.well_master" -> "wells", "dsq.drilling_sequence" -> "drilling sequence records"."""
    words = [w for w in table.split(".")[-1].lower().split("_") if w and w not in _GENERIC]
    if not words:
        return "records"
    # A plural only for a plain word: "wells", but "wbs records", "drilling sequence records".
    if len(words) == 1 and len(words[0]) > 3 and not words[0].endswith("s"):
        return _plural(words[0])
    return " ".join(words) + " records"


def _words(table: str, column: str, names: dict[str, str]) -> str:
    """A column in words: its business name, else its name without underscores and a trailing "name"."""
    if (shown := names.get(f"{table}.{column}")):
        return shown
    words = [w for w in column.lower().replace("_", " ").split() if w]
    if len(words) > 1 and words[-1] == "name":
        words = words[:-1]
    return " ".join(words)


def _categories(columns: dict) -> list[tuple[str, dict]]:
    """Text columns with a few values, mostly filled, that are not one row per value (a lookup), numbers kept as
    text ("0.00") or an id; true / false columns are left out (a poor question)."""
    out = []
    for name, p in columns.items():
        values, rows = p.get("values") or [], p.get("rows") or 0
        if p.get("kind") != "text" or not 2 <= len(values) <= SHOW_VALUES or _id_like(name):
            continue
        if rows and (p.get("empty") or 0) / rows > 0.5 or all(n == 1 for _v, n in values) or all(_number(v) for v, _n in values):
            continue
        out.append((name, p))
    # Columns with three or more values first (a lift type says more than a yes / no flag), then the fullest.
    return sorted(out, key=lambda c: (len(c[1]["values"]) < 3, (c[1].get("empty") or 0) / max(c[1].get("rows") or 1, 1)))


def _dates(columns: dict) -> list[str]:
    return [name for name, p in columns.items() if p.get("kind") == "date" and p.get("min") and p.get("min") != p.get("max")]


def _tables(profiles: dict, schema_text: str = "") -> list[str]:
    """Base tables (not views, loads or copies) big enough to ask about: the ones with most foreign keys first, in or
    out (the schema's FK lines: modelled tables before loose report tables), then most categories and dates."""
    links = Counter(t.lower() for t in _FK_TARGET.findall(schema_text))
    for block in re.split(r"(?=^TABLE\s)", schema_text, flags=re.M):
        if block.startswith("TABLE "):
            links[block.split(None, 2)[1].lower()] += len(re.findall(r"^\s+FK:", block, re.M))
    scored = []
    for table, columns in profiles.items():
        if columns and next(iter(columns.values())).get("table_rows") is None:
            continue
        if _STAGING & set(table.split(".")[-1].lower().split("_")):
            continue
        rows = max((p.get("rows") or 0) for p in columns.values()) if columns else 0
        cats = len(_categories(columns))
        if rows >= MIN_ROWS and cats:
            scored.append((-links[table], -(cats + min(len(_dates(columns)), 1)), -rows, table))
    return [t for *_rest, t in sorted(scored)]


def starters(profiles: dict, notes: Iterable[ColumnNote] = (), schema_text: str = "") -> list[str]:
    """Up to MAX_STARTERS questions: one per table first (each table starting with a different kind), then more."""
    names = display_names(notes)
    per_table = []
    for i, table in enumerate(_tables(profiles, schema_text)):
        columns = profiles[table]
        (column, p), dates = _categories(columns)[0], _dates(columns)
        entity, cat = _entity(table), _words(table, column, names)
        questions = [f"How many {entity} are there by {cat}?"]
        if len(top := str(p["values"][0][0])) <= MAX_VALUE:      # a long code makes a poor question
            questions.append(f"How many {entity} have {cat} {top}?")
        if dates:
            questions.append(f"How many {entity} per month of {_words(table, dates[0], names)}?")
        k = i % len(questions)
        per_table.append(questions[k:] + questions[:k])
    out: list[str] = []
    for round_ in range(3):
        for questions in per_table:
            if round_ < len(questions) and len(out) < MAX_STARTERS and questions[round_] not in out:
                out.append(questions[round_])
    return out


def reads_tables(sql: str) -> bool:
    """True when the SQL reads a schema.table (not just SELECT 'a message')."""
    return bool(_FROM.search(sql or ""))


def follow_ups(sql: str, profiles: dict, notes: Iterable[ColumnNote] = ()) -> list[str]:
    """Up to MAX_FOLLOW_UPS next questions for an answer built from ``sql``: another value of a filter it used, a
    breakdown by a category it did not use, the same by month."""
    names = display_names(notes)
    text = (sql or "").lower()
    tables = [t for t in dict.fromkeys(m.replace("[", "").replace("]", "").lower() for m in _FROM.findall(sql or ""))
              if t in profiles]
    out: list[str] = []
    same = next((v for literal in _LITERAL.findall(sql or "") if (v := _sibling(literal.replace("''", "'"), profiles))), None)
    if same:
        out.append(f"Same for {same}")
    for table in tables:
        cats = [(c, p) for c, p in _categories(profiles[table]) if not re.search(rf"\b{re.escape(c)}\b", text)]
        if cats:
            out.append(f"Break this down by {_words(table, cats[0][0], names)}")
            break
    for table in tables:
        dates = [d for d in _dates(profiles[table]) if not re.search(rf"\b{re.escape(d)}\b", text)]
        if dates:
            out.append(f"Show this by month of {_words(table, dates[0], names)}")
            break
    return out[:MAX_FOLLOW_UPS]


def _number(value) -> bool:
    try:
        float(str(value).replace(",", ""))
        return True
    except ValueError:
        return False


def _sibling(value: str, profiles: dict) -> str | None:
    """The most common other value of the busiest column holding ``value`` with counts ("Nimr" -> "Marmul" from a
    cluster column), else None. Lookup tables (each value once) cannot say which values matter."""
    best = None
    for columns in profiles.values():
        for _name, p in _categories(columns):
            values = [str(v) for v, _n in p["values"]]
            if value.lower() in (v.lower() for v in values) and (best is None or (p.get("rows") or 0) > (best.get("rows") or 0)):
                best = p
    if best is None:
        return None
    return next((str(v) for v, _n in best["values"] if str(v).lower() != value.lower()), None)
