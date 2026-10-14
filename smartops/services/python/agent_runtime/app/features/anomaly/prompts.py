"""Every text this feature sends to a model is a tenant prompt (``anomaly.*``, AI Settings > AI Prompts). This module
names the keys, fills their {UPPER_CASE} placeholders (single pass, app.features.common.text.fill) and assembles the
system prompts the way the original engine did - the reference material (business rules, worked examples) cut to the
one rule being written, identically for the author and the reviewer.

Machine-computed diagnostics (contract violations, validator findings, measured observations) carry the values that
triggered them and stay in code; everything instructional is here, by key.
"""
from __future__ import annotations

import datetime as dt
from typing import Any

from app.features.anomaly.config import cfg
from app.features.common.context import current
from app.features.common.text import fill, fill_lines

P = "anomaly."

# ── System prompts and their building blocks ──
PLATFORM_PREAMBLE = P + "platform_preamble"
PROBE_CONTRACT = P + "probe_contract"
PROBE_PATTERNS = P + "probe_patterns"
TSQL_KNOWLEDGE = P + "tsql_knowledge"
MEASUREMENT_RULES = P + "measurement_rules"
GROUNDING_SYSTEM = P + "grounding_system"
AUTHOR_SYSTEM = P + "author_system"
VERIFIER_SYSTEM = P + "verifier_system"
SUMMARIZER_SYSTEM = P + "summarizer_system"
SCOUT_SYSTEM = P + "scout_system"
SCOUT_REPLY_FORMAT = P + "scout_reply_format"
BUSINESS_RULES = P + "business_rules"          # allowEmpty
FEW_SHOTS = P + "few_shots"                    # allowEmpty

# ── Message pieces ──
GROUNDING_USER = P + "grounding_user"
RULE_DECLARED_VALUES = P + "rule_declared_values"
RULE_MAPPING = P + "rule_mapping"
EXPANDED_GROUNDING_NOTE = P + "expanded_grounding_note"
COVERAGE_HEADER = P + "coverage_header"
COVERAGE_EXTERNAL_HEADER = P + "coverage_external_header"
AUTHOR_SCHEMA = P + "author_schema"
AUTHOR_PATTERNS = P + "author_patterns"
AUTHOR_RULE = P + "author_rule"
AUTHOR_SEED = P + "author_seed"
AUTHOR_CONCERNS = P + "author_concerns"
AUTHOR_FAMILY = P + "author_family"
AUTHOR_PREVIOUS = P + "author_previous"
AUTHOR_REJECTED_VALIDATION = P + "author_rejected_validation"
AUTHOR_REJECTED_EXEC = P + "author_rejected_exec"
AUTHOR_REJECTED_CONTRACT = P + "author_rejected_contract"
AUTHOR_REVIEWER_ALSO = P + "author_reviewer_also"
AUTHOR_REVIEWER_REJECTED = P + "author_reviewer_rejected"
AUTHOR_REWRITE = P + "author_rewrite"
AUTHOR_ATTEMPTS = P + "author_attempts"
AUTHOR_FINAL = P + "author_final"
VERIFIER_SCHEMA = P + "verifier_schema"
VERIFIER_HINTS = P + "verifier_hints"
VERIFIER_RULE = P + "verifier_rule"
VERIFIER_PROBE = P + "verifier_probe"
VERIFIER_RETURNED = P + "verifier_returned"
VERIFIER_CONCERNS = P + "verifier_concerns"
VERIFIER_ADVICE = P + "verifier_advice"
VERIFIER_HISTORY = P + "verifier_history"
VERIFIER_FINAL = P + "verifier_final"
VERIFIER_FAILED_FEEDBACK = P + "verifier_failed_feedback"
VERIFIER_UNREADABLE_FEEDBACK = P + "verifier_unreadable_feedback"
VERIFIER_NO_FIX_FEEDBACK = P + "verifier_no_fix_feedback"
TABLE_NO_COLUMNS = P + "table_no_columns"
TABLE_NO_ROWS = P + "table_no_rows"
TABLE_MORE = P + "table_more"
SUMMARY_NOTHING = P + "summary_nothing"
SUMMARIZER_HEADLINE = P + "summarizer_headline"
SUMMARIZER_FINDINGS = P + "summarizer_findings"
SUMMARIZER_FINDINGS_MORE = P + "summarizer_findings_more"
SUMMARIZER_NO_FINDINGS = P + "summarizer_no_findings"
SUMMARIZER_EXAMPLES = P + "summarizer_examples"
SUMMARIZER_EXAMPLE_FOR = P + "summarizer_example_for"
SUMMARIZER_NEAR_SATURATED = P + "summarizer_near_saturated"
SUMMARIZER_SATURATED = P + "summarizer_saturated"
SUMMARIZER_COVERAGE_GAPS = P + "summarizer_coverage_gaps"
SUMMARIZER_NOT_RUNNING = P + "summarizer_not_running"
SUMMARIZER_FINAL = P + "summarizer_final"
SCOUT_OBSERVATIONS = P + "scout_observations"
SCOUT_SCHEMA = P + "scout_schema"
SCOUT_COVERED = P + "scout_covered"
SCOUT_NOT_EXPRESSIBLE = P + "scout_not_expressible"
SCOUT_REFUSED = P + "scout_refused"
SCOUT_FINAL = P + "scout_final"

ALLOW_EMPTY = (BUSINESS_RULES, FEW_SHOTS)

_TABLE_KEYS = (TABLE_NO_COLUMNS, TABLE_NO_ROWS, TABLE_MORE, SUMMARY_NOTHING)
_RULE_KEYS = (RULE_DECLARED_VALUES, RULE_MAPPING)
COMPILE_KEYS: tuple[str, ...] = (
    PLATFORM_PREAMBLE, PROBE_CONTRACT, PROBE_PATTERNS, TSQL_KNOWLEDGE, MEASUREMENT_RULES, GROUNDING_SYSTEM,
    AUTHOR_SYSTEM, VERIFIER_SYSTEM, GROUNDING_USER, EXPANDED_GROUNDING_NOTE, COVERAGE_HEADER, COVERAGE_EXTERNAL_HEADER,
    AUTHOR_SCHEMA, AUTHOR_PATTERNS, AUTHOR_RULE, AUTHOR_SEED, AUTHOR_CONCERNS, AUTHOR_FAMILY, AUTHOR_PREVIOUS,
    AUTHOR_REJECTED_VALIDATION, AUTHOR_REJECTED_EXEC, AUTHOR_REJECTED_CONTRACT, AUTHOR_REVIEWER_ALSO,
    AUTHOR_REVIEWER_REJECTED, AUTHOR_REWRITE, AUTHOR_ATTEMPTS, AUTHOR_FINAL, VERIFIER_SCHEMA, VERIFIER_HINTS,
    VERIFIER_RULE, VERIFIER_PROBE, VERIFIER_RETURNED, VERIFIER_CONCERNS, VERIFIER_ADVICE, VERIFIER_HISTORY,
    VERIFIER_FINAL, VERIFIER_FAILED_FEEDBACK, VERIFIER_UNREADABLE_FEEDBACK, VERIFIER_NO_FIX_FEEDBACK,
) + _TABLE_KEYS + _RULE_KEYS
RUN_KEYS: tuple[str, ...] = (
    SUMMARIZER_SYSTEM, SUMMARIZER_HEADLINE, SUMMARIZER_FINDINGS, SUMMARIZER_FINDINGS_MORE, SUMMARIZER_NO_FINDINGS,
    SUMMARIZER_EXAMPLES, SUMMARIZER_EXAMPLE_FOR, SUMMARIZER_NEAR_SATURATED, SUMMARIZER_SATURATED,
    SUMMARIZER_COVERAGE_GAPS, SUMMARIZER_NOT_RUNNING, SUMMARIZER_FINAL,
) + _TABLE_KEYS
DISCOVER_KEYS: tuple[str, ...] = (
    SCOUT_SYSTEM, SCOUT_REPLY_FORMAT, SCOUT_OBSERVATIONS, SCOUT_SCHEMA, SCOUT_COVERED, SCOUT_NOT_EXPRESSIBLE,
    SCOUT_REFUSED, SCOUT_FINAL,
)


# ── Reading the tenant's texts ──

def text(key: str) -> str:
    """The tenant's text for ``key`` (raises PromptMissing naming it)."""
    return current().prompt(key)


def optional(key: str) -> str:
    """A text that may legitimately be empty (business rules, worked examples)."""
    return str(current().request.prompts.get(key) or "").strip()


def build(key: str, **values: Any) -> str:
    return fill(text(key), **values).strip()


def missing(keys) -> list[str]:
    from app.prompt_text import missing as _missing

    return _missing(current().request.prompts, [k for k in keys if k not in ALLOW_EMPTY])


# ── System prompts ──

def author_system(rule_text: str, tags: tuple[str, ...] = (), conditions: set[str] | None = None) -> str:
    """The author's system prompt, carrying only the business rules and worked examples this rule needs."""
    from app.features.anomaly.context import prune_examples, prune_reference

    few_shots = optional(FEW_SHOTS)
    return fill_lines(
        text(AUTHOR_SYSTEM),
        PLATFORM_PREAMBLE=text(PLATFORM_PREAMBLE), PROBE_CONTRACT=text(PROBE_CONTRACT),
        TSQL_KNOWLEDGE=text(TSQL_KNOWLEDGE), MEASUREMENT_RULES=text(MEASUREMENT_RULES),
        BUSINESS_RULES=prune_reference(optional(BUSINESS_RULES), rule_text, tags, "business_rules"),
        # No conditions (nothing known about the rule's traps): the examples go whole, the safe default.
        FEW_SHOTS=prune_examples(few_shots, conditions) if conditions else few_shots,
        SAMPLE_ROWS=cfg().sample_rows,
    ).strip()


def verifier_system(rule_text: str, tags: tuple[str, ...] = ()) -> str:
    """The reviewer's system prompt, with the SAME business rules the author was shown (same pruning function)."""
    from app.features.anomaly.context import prune_reference

    return fill_lines(
        text(VERIFIER_SYSTEM),
        BUSINESS_RULES=prune_reference(optional(BUSINESS_RULES), rule_text, tags, "business_rules"),
        SAMPLE_ROWS=cfg().sample_rows,
    ).strip()


def scout_system(max_proposals: int) -> str:
    return (fill_lines(text(SCOUT_SYSTEM), MAX_PROPOSALS=max_proposals, BUSINESS_RULES=optional(BUSINESS_RULES),
                       SAMPLE_ROWS=cfg().sample_rows).strip()
            + "\n\n" + text(SCOUT_REPLY_FORMAT))


# ── Rendering results for a prompt (bounded: the only places a database result becomes prompt text) ──

def cell(value: Any) -> str:
    if value is None:
        return "NULL"          # explicit: an agent must be able to tell a null from a blank
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, dt.datetime):
        return value.strftime("%Y-%m-%d %H:%M")
    if isinstance(value, dt.date):
        return value.isoformat()
    limit = cfg().max_cell_chars
    value_text = str(value).replace("|", "/").replace("\n", " ").strip()
    return value_text if len(value_text) <= limit else value_text[: limit - 1] + "…"


def rows_to_table(columns: list[str], rows: list[list[Any]], max_rows: int | None = None) -> str:
    """A compact pipe-separated table, capped at ``max_rows`` (default: the sample cap)."""
    if not columns:
        return text(TABLE_NO_COLUMNS)
    if not rows:
        return text(TABLE_NO_ROWS)
    limit = cfg().sample_rows if max_rows is None else max_rows
    lines = [" | ".join(str(c) for c in columns)]
    lines += [" | ".join(cell(v) for v in row) for row in rows[:limit]]
    if len(rows) > limit:
        lines.append(build(TABLE_MORE, COUNT=len(rows) - limit))
    return "\n".join(lines)


def summary_line(columns: list[str], row: list[Any] | None) -> str:
    if not columns or not row:
        return text(SUMMARY_NOTHING)
    return ", ".join(f"{c}={cell(v)}" for c, v in zip(columns, row))


def numbered(items: list[str]) -> str:
    return "\n".join(f"{i}. {item}" for i, item in enumerate(items, 1))


def rule_brief(state: dict) -> str:
    """The rule as both agents read it - identity, metadata, EVERY declared value (labelled as declared, so the
    reviewer can tell them from an invented constant), the grounding note, and the prose."""
    tolerance = state.get("tolerance") or ""
    parts = [
        f"RULE {state.get('rule_id', '')} - {state.get('title', '')}",
        f"category: {state.get('category', '')} | severity: {state.get('severity', '')} | "
        f"entity: {state.get('entity', '')} | method: {state.get('method', '')}"
        + (f" | tolerance: {tolerance}" if tolerance else ""),
    ]
    declared = {k: v for k, v in (state.get("declared") or {}).items() if k != "tolerance" and str(v).strip()}
    if declared:
        parts.append(text(RULE_DECLARED_VALUES))
        parts.extend(f"  {key} = {value}" for key, value in sorted(declared.items()))
    if state.get("grounding_note"):
        parts.append(build(RULE_MAPPING, NOTE=state["grounding_note"]))
    body = (state.get("body") or "").strip()
    if body:
        parts.append("")
        parts.append(body)
    return "\n".join(parts)
