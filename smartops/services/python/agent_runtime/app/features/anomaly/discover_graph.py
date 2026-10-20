"""The DISCOVER stage: context_builder -> scout -> evidence_check -> dedup_filter -> proposal_writer (ported).

The model is never asked "what might be wrong?". The context builder MEASURES (from the cached schema and hints:
no query against the data), the Scout only judges which measured facts are business problems, and code then drops
every proposal that cites no real observation, restates a covered check or re-proposes a refused one. It writes no
SQL, touches no catalog and makes no rule: a proposal becomes a rule only when a person accepts it (proposal-to-rule)
and SQL only when the ordinary compile writes it.
"""
from __future__ import annotations

import hashlib
import logging
import re

from app.features.anomaly import prompts as pt
from app.features.anomaly.config import cfg
from app.features.anomaly.introspect import Picture
from app.features.anomaly.schema_index import SchemaIndex
from app.features.anomaly.textutil import extract_json
from app.features.common import llm

log = logging.getLogger("agent_runtime.anomaly")

# Fields a proposal cannot be useful without (do_not_flag may legitimately be empty).
_REQUIRED = ("title", "what_is_wrong", "why_it_matters", "how_to_detect")
_WORD = re.compile(r"[a-z][a-z0-9_]{2,}")


# ── context_builder (deterministic): measured facts, each with an OBS-nnn id ──

def _observation(kind: str, table: str, column: str, fact: str, **extra) -> dict:
    return {"kind": kind, "table": table, "column": column, "fact": fact, **extra}


def _unconstrained_keys(index: SchemaIndex) -> list[dict]:
    """Columns named like a key (by the configured pattern) with no declared relationship behind them."""
    settings = cfg()
    key_suffix = re.compile(settings.discover_key_suffix_pattern, re.IGNORECASE)
    self_key = re.compile(settings.discover_self_key_pattern, re.IGNORECASE)
    out: list[dict] = []
    for name, table in sorted(index.tables.items()):
        if (table.row_count or 0) < settings.discover_min_table_rows:
            continue
        constrained = {fk.child_column.lower() for fk in (table.foreign_keys or [])}
        for column in table.columns:
            lower = column.name.lower()
            if lower in constrained or self_key.match(lower) or not key_suffix.search(lower):
                continue
            stem = key_suffix.sub("", lower)
            targets = [other for other in index.tables if stem and stem in other.lower().split(".")[-1] and other != name]
            if not targets:
                continue
            out.append(_observation(
                "unconstrained_key", name, column.name,
                f"{name}.{column.name} is named like a reference and {name} holds {table.row_count:,} rows, but the "
                f"database declares NO relationship for it. A table it may be meant to point at: {targets[0]}. Nothing "
                f"verifies that the values actually exist there.", candidate_target=targets[0]))
    return out


def _numeric_problems(index: SchemaIndex) -> list[dict]:
    """Values outside the range their own measured scale implies, and unreadable quantities kept as text."""
    minimum = cfg().discover_min_table_rows
    out: list[dict] = []
    for name, table in sorted(index.tables.items()):
        if (table.row_count or 0) < minimum:
            continue
        for column in table.columns:
            stat = (table.stats or {}).get(column.name)
            if stat is None:
                continue
            bound = stat.bounds()
            if bound is not None:
                low, high = bound
                if stat.hi is not None and stat.hi > high:
                    out.append(_observation("out_of_range", name, column.name,
                                            f"{name}.{column.name} holds values on a {low:g} to {high:g} scale (measured "
                                            f"average {stat.avg:,.4g}), but its highest observed value is "
                                            f"{stat.hi:,.4g} - above the range it should occupy."))
                if stat.lo is not None and stat.lo < low:
                    out.append(_observation("out_of_range", name, column.name,
                                            f"{name}.{column.name} holds values on a {low:g} to {high:g} scale but its "
                                            f"lowest observed value is {stat.lo:,.4g} - below that range."))
            if stat.text_total and stat.text_bad and not stat.text_is_codes:
                share = stat.text_bad / stat.text_total
                out.append(_observation("unreadable_number", name, column.name,
                                        f"{name}.{column.name} keeps a quantity as text, and {stat.text_bad:,} of "
                                        f"{stat.text_total:,} non-blank values ({share:.1%}) cannot be read as a number. "
                                        f"Every calculation over this column silently omits them."))
    return out


def _mostly_empty(index: SchemaIndex) -> list[dict]:
    settings = cfg()
    out: list[dict] = []
    for name, table in sorted(index.tables.items()):
        rows = table.row_count or 0
        if rows < settings.discover_min_table_rows:
            continue
        for column in table.columns:
            stat = (table.stats or {}).get(column.name)
            if stat is None or not stat.null_pct:
                continue
            if stat.null_pct >= settings.discover_mostly_empty_share * 100:
                out.append(_observation("mostly_empty", name, column.name,
                                        f"{name}.{column.name} is empty in {stat.null_pct}% of {rows:,} rows. Anything "
                                        f"joined or filtered through it loses that share of the table without "
                                        f"reporting an error."))
    return out


def _history_tables(schema_text: str) -> list[dict]:
    """Tables the schema marks as holding many rows per entity (the marker sits on its own line under the table)."""
    out: list[dict] = []
    table = ""
    for line in schema_text.splitlines():
        head = re.match(r"^TABLE\s+(\S+)", line)
        if head:
            table = head.group(1)
            continue
        if "MANY ROWS PER " not in line:
            continue
        marker = line.split("MANY ROWS PER ", 1)[1].split(" - ", 1)[0].strip().rstrip(".")
        out.append(_observation("history_grain", table, marker,
                                f"{table or 'a table'} holds MANY ROWS PER {marker} - it is a history of updates, not "
                                f"one row per thing. Contradictions between successive records, and values that go "
                                f"backwards, can only be seen in a table shaped like this."))
    return out


def _singleton_codes(value_hints: str) -> list[dict]:
    """Coded values that appear once or twice among many (only where the hints carry counts)."""
    limit = cfg().discover_singleton_max_count
    out: list[dict] = []
    table = column = ""
    for line in value_hints.splitlines():
        head = re.match(r"^(\S+)\.(\S+)\s*[:\-]", line.strip())
        if head:
            table, column = head.group(1), head.group(2)
        for value, count in re.findall(r"'([^']{1,60})'\s*[x×(]\s*(\d[\d,]*)", line):
            n = int(count.replace(",", ""))
            if n <= limit and table:
                out.append(_observation("singleton_code", table, column,
                                        f"{table}.{column} holds the value '{value}' in only {n} record(s) while other "
                                        f"values are common. A one-off code is usually a typo or a category nobody "
                                        f"maintains."))
    return out


def context_builder(picture: Picture, index: SchemaIndex) -> list[dict]:
    observations: list[dict] = []
    observations += _unconstrained_keys(index)
    observations += _numeric_problems(index)
    observations += _mostly_empty(index)
    observations += _history_tables(picture.schema)
    observations += _singleton_codes(picture.value_hints)
    for n, obs in enumerate(observations, 1):
        obs["id"] = f"OBS-{n:03d}"
    return observations


# ── scout (LLM, main tier by default) - one call ──

def _covered_block(covered: list[dict]) -> str:
    lines = []
    for rule in covered:
        tags = f" [{rule['tags']}]" if rule.get("tags") else ""
        ident = f"{rule['rule_id']}  " if rule.get("rule_id") else ""
        category = f" ({rule.get('category', '')})" if rule.get("category") else ""
        lines.append(f"- {ident}{rule['title']}{category}{tags}")
    return "\n".join(lines)


def _rejected_block(rejected: list[dict]) -> str:
    return "\n".join(f"- {r['title']}" + (f" - refused because: {r['reason']}" if r.get("reason") else "")
                     for r in rejected)


def _not_expressible_block(covered: list[dict]) -> str:
    return "\n".join(f"- {r['title']}" for r in covered if (r.get("compiled_status") or "") == "not_applicable")


def scout(observations: list[dict], schema_text: str, covered: list[dict], rejected: list[dict],
          limit: int) -> tuple[list[dict], str, int]:
    """(proposals, error, model calls)."""
    if not observations:
        return [], "", 0
    settings = cfg()
    parts = [pt.build(pt.SCOUT_OBSERVATIONS, OBSERVATIONS="\n".join(f"{o['id']}  {o['fact']}" for o in observations)),
             pt.build(pt.SCOUT_SCHEMA, SCHEMA=schema_text)]
    if covered:
        parts.append(pt.build(pt.SCOUT_COVERED, COVERED=_covered_block(covered)))
    not_expressible = _not_expressible_block(covered)
    if not_expressible:
        parts.append(pt.build(pt.SCOUT_NOT_EXPRESSIBLE, RULES=not_expressible))
    if rejected:
        parts.append(pt.build(pt.SCOUT_REFUSED, REFUSED=_rejected_block(rejected)))
    parts.append(pt.build(pt.SCOUT_FINAL, MAX_PROPOSALS=limit))
    try:
        raw = llm.chat(pt.scout_system(limit), "\n\n".join(parts), agent="scout",
                       temperature=settings.scout_temperature, fast=settings.scout_tier == "fast", json_mode=True)
    except llm.AiUnavailable:
        raise
    except Exception as exc:  # noqa: BLE001 - a provider failure is not a finding
        return [], f"The Scout could not be run ({type(exc).__name__}).", 1
    parsed = extract_json(raw, default=None)
    if isinstance(parsed, list):
        parsed = {"proposals": parsed}
    if not isinstance(parsed, dict):
        return [], "The Scout's reply could not be read. Try again.", 1
    proposals = [p for p in (parsed.get("proposals") or []) if isinstance(p, dict)]
    return proposals[:limit], "", 1      # truncated, not rejected: eleven when asked for eight is still work done


# ── evidence_check (deterministic): the anti-hallucination gate ──

def evidence_check(proposals: list[dict], observations: list[dict], dropped: list[dict]) -> list[dict]:
    known = {o["id"]: o for o in observations}
    kept: list[dict] = []
    for proposal in proposals:
        title = str(proposal.get("title") or "").strip() or "(untitled)"
        missing = [f for f in _REQUIRED if not str(proposal.get(f) or "").strip()]
        if missing:
            dropped.append({"title": title, "reason": "incomplete", "detail": "the proposal left out " + ", ".join(missing)})
            continue
        cited = str(proposal.get("observation_id") or "").strip().upper()
        if not cited:
            dropped.append({"title": title, "reason": "no evidence",
                            "detail": "no measurement was cited, so nothing supports it"})
            continue
        if cited not in known:
            dropped.append({"title": title, "reason": "evidence not found",
                            "detail": f"cited {cited}, which was never measured"})
            continue
        observation = known[cited]
        proposal["observation_id"] = cited
        proposal["observation_fact"] = observation["fact"]          # the MEASURED wording, not the paraphrase
        if not str(proposal.get("evidence") or "").strip():
            proposal["evidence"] = observation["fact"]
        proposal["tables"] = [t for t in (observation.get("table"),) if t]
        kept.append(proposal)
    return kept


# ── dedup_filter (deterministic): over MEANING, asymmetric thresholds ──

def _stem(word: str) -> str:
    return word[:-1] if len(word) > 4 and word.endswith("s") else word


def terms(*texts) -> set[str]:
    noise = {w.lower() for w in cfg().dedup_noise_words}
    words: set[str] = set()
    for value in texts:
        words |= {_stem(w) for w in _WORD.findall(str(value or "").lower())}
    return words - noise


def _overlap(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / min(len(a), len(b))


def dedup_filter(proposals: list[dict], covered: list[dict], rejected: list[dict], dropped: list[dict]) -> list[dict]:
    settings = cfg()
    covered_terms = [(rule, terms(rule.get("title"), rule.get("category"), rule.get("tags"))) for rule in covered]
    # THE TITLE ONLY for refusals: the reason says why a person said no, not what the rule was about.
    rejected_terms = [(rule, terms(rule.get("title"))) for rule in rejected]
    kept: list[dict] = []
    for proposal in proposals:
        mine = terms(proposal.get("title"), proposal.get("what_is_wrong"), proposal.get("how_to_detect"))
        match = max(((r, _overlap(mine, t)) for r, t in rejected_terms), key=lambda p: p[1], default=(None, 0.0))
        if match[0] is not None and match[1] >= settings.dedup_rejected_threshold:
            dropped.append({"title": proposal.get("title", ""), "reason": "previously refused",
                            "detail": f"matches {match[0].get('rule_id', '')} \"{match[0].get('title', '')}\""
                                      + (f" - refused because: {match[0]['reason']}" if match[0].get("reason") else "")})
            continue
        match = max(((r, _overlap(mine, t)) for r, t in covered_terms), key=lambda p: p[1], default=(None, 0.0))
        if match[0] is not None and match[1] >= settings.dedup_covered_threshold:
            dropped.append({"title": proposal.get("title", ""), "reason": "already covered",
                            "detail": f"matches {match[0].get('rule_id', '')} \"{match[0].get('title', '')}\""})
            continue
        if any(_overlap(mine, terms(k.get("title"), k.get("what_is_wrong"), k.get("how_to_detect")))
               >= settings.dedup_covered_threshold for k in kept):
            dropped.append({"title": proposal.get("title", ""), "reason": "duplicate",
                            "detail": "another proposal in this same run describes the same defect"})
            continue
        kept.append(proposal)
    return kept


# ── proposal_writer (deterministic): a stable handle per proposal ──

def proposal_hash(proposal: dict) -> str:
    """A handle over the normalised SUBJECT (sorted terms of title + detection logic, and the tables), so the same
    defect described again next week keeps its handle."""
    words = sorted(set(_WORD.findall(" ".join(str(proposal.get(f) or "") for f in ("title", "how_to_detect")).lower())))
    tables = ",".join(sorted(proposal.get("tables") or ()))
    return hashlib.sha256(("|".join(words) + "#" + tables).encode("utf-8")).hexdigest()[:12]


def proposal_writer(proposals: list[dict], database: str) -> list[dict]:
    out = []
    for proposal in proposals:
        clean = {k: v for k, v in proposal.items()}
        clean["hash"] = proposal_hash(proposal)
        clean["database"] = database
        out.append(clean)
    return out
