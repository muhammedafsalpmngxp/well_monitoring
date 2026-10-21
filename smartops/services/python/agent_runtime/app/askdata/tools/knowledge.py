"""The tenant's business terms and column names for Ask Data (AI Settings > Ask Data & Features > Terms & column names).

* Business terms: the company's own words ("NPT", "uptime"), each defined once as a filter (schema.table.column =
  value) or a meaning in plain words. Only the terms a question uses go to the AI (orchestrator, SQL Author,
  verifier), like the value matches, so a long dictionary costs nothing on questions that do not use it.
* Column names and notes: what a column ("FLAF Score" for bl_flaf_scr) or table is called and means. They are added
  to the SCHEMA block, so the AI understands the business name; the Tenant API shows the name as the table header.

Both arrive with the tenant's Ask Data settings (settings.Term, settings.ColumnNote); nothing is stored here. The
texts come from the tenant's prompts (askdata.msg.business_term*, column_called, table_note).
"""
from __future__ import annotations

import re
from typing import Iterable

from app.askdata.prompts import msg
from app.askdata.settings import ColumnNote, Term

_COLUMN_LINE = re.compile(r"^(\s+-\s+)(\[[^\]]+\]|\S+)(.*)$")
_WORD = re.compile(r"[^\W_]+")


def _mentions(text: str, phrase: str) -> bool:
    # A plural counts too: "dry wells" uses the term "dry well".
    return bool(phrase) and re.search(rf"(?<![^\W_]){re.escape(phrase)}(?:e?s)?(?![^\W_])", text, re.I) is not None


def used_terms(question: str, terms: Iterable[Term]) -> list[Term]:
    """The terms whose name or a synonym appears in the question (as a whole word or phrase)."""
    return [t for t in terms if any(_mentions(question, w) for w in (t.term, *t.synonyms))]


def terms_block(question: str, terms: Iterable[Term]) -> str:
    """The BUSINESS TERMS block for the terms the question uses, or ""."""
    lines = []
    for t in used_terms(question, terms):
        if t.column and t.value:
            lines.append(msg("business_term_filter", TERM=t.term, COLUMN=t.column, VALUE=t.value.replace("'", "''")))
        if t.meaning:
            lines.append(msg("business_term_meaning", TERM=t.term, MEANING=" ".join(t.meaning.split())))
    return msg("business_terms", TERMS="\n".join(lines)) if lines else ""


def known_words(question: str, terms: Iterable[Term], notes: Iterable[ColumnNote]) -> frozenset[str]:
    """Words value matching leaves alone: those of the terms the question uses and of the columns' business names
    (they name a definition or a column, not a stored value)."""
    words: set[str] = set()
    for t in used_terms(question, terms):
        for phrase in (t.term, *t.synonyms):
            words |= {w.lower() for w in _WORD.findall(phrase)}
    for n in notes:
        words |= {w.lower() for w in _WORD.findall(n.display_name)}
    return frozenset(words)


def display_names(notes: Iterable[ColumnNote]) -> dict[str, str]:
    """{schema.table.column (lower): business name}."""
    return {n.column: n.display_name for n in notes if n.display_name and n.column.count(".") == 2}


def annotate(schema_text: str, notes: Iterable[ColumnNote]) -> str:
    """The SCHEMA block with each noted column's line followed by ' | called "<name>" | <note>', and a NOTE line under
    each noted table (its TABLE line stays the bare name: the safety check reads it)."""
    by_key = {n.column: n for n in notes}
    if not by_key:
        return schema_text
    out: list[str] = []
    table = None
    for line in schema_text.split("\n"):
        if line.startswith("TABLE "):
            table = line[len("TABLE "):].strip().lower()
            out.append(line)
            if (n := by_key.get(table)) is not None and (text := _describe(n)):
                out.append("  " + msg("table_note", TEXT=text))
            continue
        if table is not None and (m := _COLUMN_LINE.match(line)):
            name = m.group(2).strip("[]").replace("]]", "]").lower()
            if (n := by_key.get(f"{table}.{name}")) is not None and (text := _describe(n)):
                line = f"{line} | {text}"
        elif not line.strip():
            table = None
        out.append(line)
    return "\n".join(out)


def _describe(n: ColumnNote) -> str:
    parts = [msg("column_called", NAME=n.display_name)] if n.display_name else []
    if n.note:
        parts.append(" ".join(n.note.split()))
    return " | ".join(parts)
