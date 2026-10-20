"""Cut the reference material down to what ONE rule actually needs (the context-window and cost control).

A rule concerns a handful of tables, not eighty. Grounding names them; the schema and both hint files are sliced to
those tables plus anything one declared foreign key away. The business rules are cut by topic (a section naming one
of the rule's own tags is always kept); the worked examples are cut only where each DECLARES (`- applies:`) that it
does not apply. SAFETY RULE THROUGHOUT: pruning is only an optimisation - whenever the result would be empty,
doubtful or barely smaller, the FULL text is returned. Limits come from settings.
"""
from __future__ import annotations

import logging
import re

from app.features.anomaly.config import cfg
from app.features.anomaly.schema_index import load_index

log = logging.getLogger("agent_runtime.anomaly")

# The block delimiter. THE TRAILING ANYTHING IS LOAD-BEARING: the TABLE line carries "  -- 10,302 rows".
_TABLE_RE = re.compile(r"^TABLE\s+(\S+)[^\n]*$", re.MULTILINE)
_FK_RE = re.compile(r"^\s+FK:\s+\S+\s*->\s*(\S+)\.\w+\s*$", re.MULTILINE)
_VALUE_LINE_RE = re.compile(r"^-\s+(\S+)\s+\(")
_NUMERIC_HEAD_RE = re.compile(r"^(\S+)\s+\([\d,]+\s+rows\)\s*$")
_COLUMN_NAME_RE = re.compile(r"^\s+-\s+(\[[^\]]+\]|\S+)\s", re.MULTILINE)
_HEADING_RE = re.compile(r"^#{1,6}\s+(.*?)\s*$", re.MULTILINE)
_WORD_RE = re.compile(r"[A-Za-z][A-Za-z0-9_]{2,}")
_APPLIES_RE = re.compile(r"^\s*[-*]\s*applies\s*:\s*(\S+)\s*$", re.IGNORECASE | re.MULTILINE)
_NULL_PCT_RE = re.compile(r"nulls\s+(\d+)%")


def split_blocks(schema_text: str) -> dict[str, str]:
    """schema.table -> its block of the schema text, in order."""
    out: dict[str, str] = {}
    for part in re.split(r"(?=^TABLE\s)", schema_text or "", flags=re.MULTILINE):
        m = _TABLE_RE.search(part)
        if m:
            out[m.group(1)] = part.rstrip() + "\n"
    return out


def _bare(name: str) -> str:
    return name[1:-1] if name.startswith("[") and name.endswith("]") else name


def table_index(schema_text: str, numeric_text: str = "") -> str:
    """One line per table - name, HOW MANY ROWS IT HOLDS, column names - for Grounding. The count is what tells an
    empty copy from its populated twin."""
    counts: dict[str, int | None] = {}
    try:
        counts = {name: table.row_count for name, table in load_index(schema_text, numeric_text).tables.items()}
    except Exception:  # noqa: BLE001 - a missing count must not cost the whole index
        counts = {}
    lines: list[str] = []
    for table, block in split_blocks(schema_text).items():
        cols = [_bare(c) for c in _COLUMN_NAME_RE.findall(block)]
        size = ""
        if counts.get(table) is not None:
            rows = counts[table]
            size = f" [{rows:,} rows]" if rows else " [EMPTY - nothing can be found here]"
        lines.append(f"{table}{size}: {', '.join(cols)}")
    return "\n".join(lines)


def _neighbours(blocks: dict[str, str], wanted: set[str]) -> set[str]:
    out = set(wanted)
    for table in wanted:
        for parent in _FK_RE.findall(blocks.get(table, "")):
            if parent in blocks:
                out.add(parent)
    for table, block in blocks.items():
        if table not in out and any(parent in wanted for parent in _FK_RE.findall(block)):
            out.add(table)
    return out


def resolve(blocks: dict[str, str], names: list[str]) -> set[str]:
    """Match what Grounding named against what exists (schema prefix and case forgiven; never invented)."""
    by_lower = {t.lower(): t for t in blocks}
    by_bare: dict[str, list[str]] = {}
    for t in blocks:
        by_bare.setdefault(t.partition(".")[2].lower(), []).append(t)
    resolved: set[str] = set()
    for raw in names or []:
        name = (raw or "").strip().replace("[", "").replace("]", "").lower()
        if not name:
            continue
        if name in by_lower:
            resolved.add(by_lower[name])
            continue
        candidates = by_bare.get(name.rpartition(".")[2], [])
        resolved.update(candidates)
    return resolved


def prune_schema(schema_text: str, names: list[str]) -> tuple[str, list[str]]:
    """(schema block for the prompt, the tables in it). The FULL text whenever pruning is not clearly worthwhile."""
    settings = cfg()
    blocks = split_blocks(schema_text)
    if not blocks:
        return schema_text, []
    if len(blocks) <= settings.schema_prune_above_tables:
        return schema_text, list(blocks)
    wanted = resolve(blocks, names)
    if not wanted:
        return schema_text, list(blocks)
    keep = _neighbours(blocks, wanted)
    if len(keep) > settings.max_pruned_tables:
        keep = wanted
    if len(keep) > settings.max_pruned_tables or len(keep) > len(blocks) * settings.min_saving_ratio:
        return schema_text, list(blocks)
    ordered = [t for t in blocks if t in keep]
    return "\n".join(blocks[t] for t in ordered).strip(), ordered


def slice_value_hints(hints: str, tables: list[str]) -> str:
    """Value hints for ``tables`` only, keeping the header line; "" when no table matched."""
    if not hints or not tables:
        return hints
    keep = {t.lower() for t in tables}
    lines = hints.splitlines()
    out = lines[:1]
    matched = 0
    for line in lines[1:]:
        m = _VALUE_LINE_RE.match(line)
        if m is not None and m.group(1).lower() in keep:
            out.append(line)
            matched += 1
    return "\n".join(out) if matched else ""


def slice_numeric_hints(hints: str, tables: list[str]) -> str:
    """Numeric hints for ``tables`` only, structure-aware (column lines follow their table heading)."""
    if not hints or not tables:
        return hints
    keep = {t.lower() for t in tables}
    lines = hints.splitlines()
    out = lines[:1]
    including = False
    matched = 0
    for line in lines[1:]:
        m = _NUMERIC_HEAD_RE.match(line)
        if m is not None:
            including = m.group(1).lower() in keep
            if including:
                out.append(line)
                matched += 1
            continue
        if including:
            out.append(line)
    return "\n".join(out) if matched else ""


def build_context(schema_text: str, value_hints: str, numeric_hints: str,
                  names: list[str]) -> tuple[str, str, list[str]]:
    """(schema block, hint block, tables): the three artefacts sliced against ONE resolved table list."""
    schema_block, tables = prune_schema(schema_text, names)
    values = slice_value_hints(value_hints, tables)
    numbers = slice_numeric_hints(numeric_hints, tables)
    hint_block = "\n\n".join(p for p in (values, numbers) if p.strip())
    return schema_block, hint_block, tables


# ── Reference material: business rules and worked examples ──

def _terms(text: str) -> set[str]:
    """Topic words, snake_case split into its parts, generic stopwords removed."""
    stop = {w.lower() for w in cfg().reference_stopwords}
    out: set[str] = set()
    for word in _WORD_RE.findall(text.lower()):
        for part in word.split("_"):
            if len(part) > 2 and part not in stop:
                out.add(part)
    return out


def split_sections(text: str) -> list[tuple[str, str]]:
    """[(heading, whole section including its heading)], with any preamble under heading ""."""
    out: list[tuple[str, str]] = []
    marks = list(_HEADING_RE.finditer(text or ""))
    if not marks:
        return [("", text or "")]
    if marks[0].start() > 0:
        out.append(("", text[: marks[0].start()]))
    for i, m in enumerate(marks):
        end = marks[i + 1].start() if i + 1 < len(marks) else len(text)
        out.append((m.group(1), text[m.start():end]))
    return out


def prune_reference(text: str, rule_text: str, keywords: tuple[str, ...] = (), label: str = "reference") -> str:
    """The business rules cut to the sections this rule plausibly needs. A section naming one of the rule's own
    tags / category / entity is kept outright; small sections are never dropped; a marginal saving returns all."""
    settings = cfg()
    if not settings.reference_prune or not (text or "").strip():
        return text
    sections = split_sections(text)
    if len(sections) < settings.reference_min_sections:
        return text
    wanted = _terms(rule_text)
    if not wanted:
        return text
    subject = _terms(" ".join(keywords))
    kept: list[str] = []
    dropped: list[str] = []
    for heading, body in sections:
        if not heading or len(body) <= settings.reference_keep_below:
            kept.append(body)
            continue
        section_terms = _terms(heading + "\n" + body)
        if subject & section_terms:
            kept.append(body)
            continue
        overlap = len(section_terms & wanted) / len(wanted)
        if overlap >= settings.reference_min_overlap:
            kept.append(body)
        else:
            dropped.append(heading)
    if not dropped:
        return text
    out = "".join(kept).strip()
    if len(out) > len(text) * settings.min_saving_ratio:
        return text
    log.info("anomaly prune: %s %d -> %d chars, dropped %d section(s)", label, len(text), len(out), len(dropped))
    return out


def example_conditions(schema_block: str, hint_block: str, method: str = "", tolerance: str = "") -> set[str]:
    """Which worked-example conditions hold for the rule about to be written - decided from what is already in the
    prompt, never from a name."""
    facts = {"always"}
    if "MANY ROWS PER " in (schema_block or ""):
        facts.add("grain")
    if (hint_block or "").strip():
        facts.add("scale")
    threshold = cfg().substantially_empty_pct
    if any(int(m.group(1)) >= threshold for m in _NULL_PCT_RE.finditer(hint_block or "")):
        facts.add("nulls")
    if (method or "").strip().lower() == "statistical" or (tolerance or "").strip():
        facts.add("threshold")
    return facts


def prune_examples(text: str, conditions: set[str]) -> str:
    """Keep the worked examples whose declared `applies:` condition holds; an undeclared one is always kept."""
    if not cfg().reference_prune or not (text or "").strip():
        return text
    kept: list[str] = []
    dropped = 0
    for heading, body in split_sections(text):
        m = _APPLIES_RE.search(body)
        applies = m.group(1).strip().lower() if m else "always"
        if not heading or applies in conditions:
            kept.append(body)
        else:
            dropped += 1
    if not dropped:
        return text
    return "".join(kept).strip()
