"""The tenant's Ask Data knowledge (AI Settings > Ask Data & Features > Terms & column names): what the company calls
things, how it computes them, answers it approved, and how its tables link.

* Business terms: the company's own words ("NPT", "uptime"), each defined once as a filter (schema.table.column =
  value) or a meaning in plain words.
* Metrics: shared KPI definitions ("Rig uptime" = SUM(well.rig_day.uptime_hours)), so every answer computes a KPI the
  same way.
  Only the terms and metrics a question uses go to the AI (orchestrator, SQL Author, verifier), like the value matches,
  so a long dictionary costs nothing on questions that do not use it.
* Learned examples: questions with the SQL that answered them, liked by a user and approved by an admin. The few most
  similar to a question go to the SQL Author.
* Column names and notes: what a column ("FLAF Score" for bl_flaf_scr) or table is called and means, added to the
  SCHEMA block; the Tenant API shows the name as the table header.
* Table links: joins an admin confirmed where the database has no foreign key, added to the SCHEMA block as FK lines
  (tools/links.py suggests them).

All of it arrives with the tenant's Ask Data settings (settings.Term, Metric, Example, ColumnNote, Link); nothing is
stored here. The texts come from the tenant's prompts (askdata.msg.business_term*, metric*, learned_example*,
column_called, table_note).
"""
from __future__ import annotations

import re
from typing import Iterable

from app.askdata.prompts import msg
from app.askdata.settings import AskDataSettings, ColumnNote, Example, Link, Metric, Term
from app.askdata.tools.value_match import STOP_WORDS

MAX_EXAMPLES = 3                 # learned examples shown per question
_COLUMN_LINE = re.compile(r"^(\s+-\s+)(\[[^\]]+\]|\S+)(.*)$")
_FK_LINE = re.compile(r"^\s+FK:\s+(\S+)\s*->\s*(\S+)\s*$")
_WORD = re.compile(r"[^\W_]+")
_FORMULA = {"count": "COUNT({c})", "countdistinct": "COUNT(DISTINCT {c})", "sum": "SUM({c})", "avg": "AVG({c})",
            "min": "MIN({c})", "max": "MAX({c})"}


def _mentions(text: str, phrase: str) -> bool:
    # A plural counts too: "dry wells" uses the term "dry well".
    return bool(phrase) and re.search(rf"(?<![^\W_]){re.escape(phrase)}(?:e?s)?(?![^\W_])", text, re.I) is not None


def used_terms(question: str, terms: Iterable[Term]) -> list[Term]:
    """The terms whose name or a synonym appears in the question (as a whole word or phrase)."""
    return [t for t in terms if any(_mentions(question, w) for w in (t.term, *t.synonyms))]


def used_metrics(question: str, metrics: Iterable[Metric]) -> list[Metric]:
    return [m for m in metrics if _mentions(question, m.name)]


def terms_block(question: str, terms: Iterable[Term]) -> str:
    """The BUSINESS TERMS block for the terms the question uses, or ""."""
    lines = []
    for t in used_terms(question, terms):
        if t.column and t.value:
            lines.append(msg("business_term_filter", TERM=t.term, COLUMN=t.column, VALUE=t.value.replace("'", "''")))
        if t.meaning:
            lines.append(msg("business_term_meaning", TERM=t.term, MEANING=" ".join(t.meaning.split())))
    return msg("business_terms", TERMS="\n".join(lines)) if lines else ""


def formula(m: Metric) -> str:
    """A metric as SQL: COUNT(*) for a count without a column, else e.g. SUM(well.rig_day.uptime_hours)."""
    if m.agg.lower() == "count" and not m.column:
        return "COUNT(*)"
    return _FORMULA.get(m.agg.lower(), m.agg.upper() + "({c})").format(c=m.column)


def metrics_block(question: str, metrics: Iterable[Metric]) -> str:
    """The METRICS block for the metrics the question names, or ""."""
    lines = [msg("metric", NAME=m.name, FORMULA=formula(m), DESCRIPTION=f" ({' '.join(m.description.split())})" if m.description else "")
             for m in used_metrics(question, metrics)]
    return msg("metrics", METRICS="\n".join(lines)) if lines else ""


def definitions(question: str, settings: AskDataSettings) -> str:
    """The business terms and metrics a question uses, for the orchestrator, SQL Author and verifier."""
    return "\n\n".join(b for b in (terms_block(question, settings.terms), metrics_block(question, settings.metrics)) if b)


def _content_words(text: str) -> set[str]:
    return {w for w in (x.lower() for x in _WORD.findall(text)) if len(w) >= 3 and w not in STOP_WORDS}


def examples_block(question: str, examples: Iterable[Example], limit: int = MAX_EXAMPLES) -> str:
    """The approved examples sharing most words with the question (at least one), best first, or ""."""
    wanted = _content_words(question)
    scored = sorted(((len(wanted & _content_words(e.question)), i, e) for i, e in enumerate(examples)), key=lambda x: (-x[0], x[1]))
    chosen = [e for score, _i, e in scored if score > 0][:limit]
    if not chosen:
        return ""
    return msg("learned_examples", EXAMPLES="\n\n".join(msg("learned_example", QUESTION=e.question, SQL=e.sql.strip()) for e in chosen))


def known_words(question: str, settings: AskDataSettings) -> frozenset[str]:
    """Words value matching leaves alone: those of the terms and metrics the question uses and of the columns' business
    names (they name a definition or a column, not a stored value)."""
    words: set[str] = set()
    phrases = [p for t in used_terms(question, settings.terms) for p in (t.term, *t.synonyms)]
    phrases += [m.name for m in used_metrics(question, settings.metrics)] + [n.display_name for n in settings.notes]
    for phrase in phrases:
        words |= {w.lower() for w in _WORD.findall(phrase)}
    return frozenset(words)


def display_names(notes: Iterable[ColumnNote]) -> dict[str, str]:
    """{schema.table.column (lower): business name}."""
    return {n.column: n.display_name for n in notes if n.display_name and n.column.count(".") == 2}


def annotate(schema_text: str, notes: Iterable[ColumnNote], links: Iterable[Link] = ()) -> str:
    """The SCHEMA block with each noted column's line followed by ' | called "<name>" | <note>', a NOTE line under each
    noted table (its TABLE line stays the bare name: the safety check reads it), and an FK line for each confirmed table
    link whose two tables and columns the block shows (and that it does not already have)."""
    by_key = {n.column: n for n in notes}
    joins = _joins(schema_text, links)
    if not by_key and not joins:
        return schema_text
    out: list[str] = []
    table = None

    def close() -> None:
        out.extend(f"  FK: {column} -> {target}" for column, target in joins.get(table, []))

    for line in schema_text.split("\n"):
        if line.startswith("TABLE "):
            close()
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
            close()
            table = None
        out.append(line)
    close()
    return "\n".join(out)


def _joins(schema_text: str, links: Iterable[Link]) -> dict[str, list[tuple[str, str]]]:
    """{from table: [(column, "schema.table.column")]} for the links the SCHEMA block can show and does not have."""
    columns: dict[str, set[str]] = {}
    fks: set[tuple[str, str, str]] = set()
    table = None
    for line in schema_text.split("\n"):
        if line.startswith("TABLE "):
            table = line[len("TABLE "):].strip().lower()
            columns[table] = set()
        elif table is not None and (m := _FK_LINE.match(line)):
            fks.add((table, m.group(1).lower(), m.group(2).lower()))
        elif table is not None and (m := _COLUMN_LINE.match(line)):
            columns[table].add(m.group(2).strip("[]").replace("]]", "]").lower())
        elif not line.strip():
            table = None
    out: dict[str, list[tuple[str, str]]] = {}
    for link in links:
        frm, to = link.from_column.lower(), link.to_column.lower()
        (ft, _, fc), (tt, _, tc) = frm.rpartition("."), to.rpartition(".")
        if fc in columns.get(ft, set()) and tc in columns.get(tt, set()) and (ft, fc, to) not in fks and (tt, tc, frm) not in fks:
            out.setdefault(ft, []).append((fc, to))
    return out


def _describe(n: ColumnNote) -> str:
    parts = [msg("column_called", NAME=n.display_name)] if n.display_name else []
    if n.note:
        parts.append(" ".join(n.note.split()))
    return " | ".join(parts)
