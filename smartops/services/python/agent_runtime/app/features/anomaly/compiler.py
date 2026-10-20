"""Drive the COMPILE stage: every rule that needs it, one at a time, through the compile graph.

ONE GRAPH INVOCATION PER RULE: a rule that fails fails ALONE (recorded with its error), each rule gets its own
budgets, and anything still valid is reused. ONE AUTHORED QUERY PER FAMILY: the member with the most data is
authored and reviewed; the rest are cloned from its {{token}} template, checked for leftover tokens and foreign
columns, and SMOKE-TESTED (summary only, short timeout) before being stored active. A failed author is replaced by
another member, up to family_author_attempts. THE CIRCUIT BREAKER (max_compile_calls) is checked BETWEEN rules, so
every rule is either finished or untouched.

Stateless: the catalog comes in (the Tenant API's) and the updated catalog goes out in the result.
"""
from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass, field
from typing import Callable

from app.features.anomaly import catalog as staleness
from app.features.anomaly.compile_graph import build_compile_graph, executor_node, now_iso
from app.features.anomaly.config import cfg
from app.features.anomaly.dbio import DatabaseUnavailable
from app.features.anomaly.expand import coverage_summary, expand_families, substitute, tokens_for, unfilled_tokens
from app.features.anomaly.introspect import Picture, probe_fingerprint
from app.features.anomaly.model import Probe, Rule
from app.features.anomaly import prompts as pt
from app.features.anomaly.schema_index import SchemaIndex, load_index
from app.features.anomaly.semantics import semantic_fingerprint
from app.features.common.context import current
from app.features.common.llm import AiUnavailable
from app.prompt_text import PromptMissing

log = logging.getLogger("agent_runtime.anomaly")

Progress = Callable[[int, int, str], None]

# A bracketed IDENTIFIER (short, one line) - never a span between two brackets inside text.
_BRACKETED = re.compile(r"\[([^\]\r\n]{1,128})\]")
_STRING_LITERAL = re.compile(r"N?'(?:[^']|'')*'")


class Cancelled(Exception):
    """The caller stopped listening; the compile stops at the next rule."""


@dataclass
class CompileReport:
    compiled: list[str] = field(default_factory=list)
    reused: list[str] = field(default_factory=list)
    failed: list[str] = field(default_factory=list)
    not_applicable: list[str] = field(default_factory=list)
    removed: list[str] = field(default_factory=list)
    duplicates: list[tuple[str, ...]] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    llm_calls: int = 0
    seconds: float = 0.0
    stopped_early: str = ""


@dataclass
class CoveredCheck:
    """A check another part of the application already makes (sent by the Tenant API)."""
    name: str
    table: str = ""
    description: str = ""


def covered_text(checks: list[CoveredCheck]) -> str:
    if not checks:
        return ""
    lines = [pt.text(pt.COVERAGE_EXTERNAL_HEADER)]
    for c in checks:
        where = f" ({c.table})" if c.table else ""
        lines.append(f"- {c.name}{where}" + (f": {c.description}" if c.description else ""))
    return "\n".join(lines)


def _seed_state(rule: Rule, fingerprint: str, picture: Picture, coverage: str, signatures: dict[str, str]) -> dict:
    return {
        "table_signatures": signatures, "rule_id": rule.rule_id, "title": rule.title, "body": rule.body,
        "category": rule.category, "tags": tuple(rule.tags or ()), "severity": rule.severity, "entity": rule.entity,
        "method": rule.method, "sql_mode": rule.sql_mode, "source": rule.source,
        "tolerance": rule.params.get("tolerance", ""), "params": dict(rule.params),
        "declared": rule.declared_values(),
        "expands_over": rule.expands_over,
        "placeholders": tokens_for(rule.expands_over) if rule.is_expanded else (),
        "summary_sql_template": "", "detail_sql_template": "", "rule_hash": rule.rule_hash,
        "structure_fingerprint": fingerprint, "seed_summary_sql": rule.summary_sql,
        "seed_detail_sql": rule.detail_sql, "schema": picture.schema, "value_hints": picture.value_hints,
        "numeric_hints": picture.numeric_hints, "patterns": pt.text(pt.PROBE_PATTERNS),
        # A family member IS the coverage; telling it not to re-express itself is meaningless.
        "coverage": "" if rule.is_expanded else coverage,
        "schema_block": picture.schema, "hint_block": "", "tables": [], "tried_sql": [], "concerns": [], "advice": [],
        "retry_count": 0, "verify_retry_count": 0, "feedback_history": [], "llm_calls": 0, "applicable": True,
    }


def foreign_columns(sql: str, tables: tuple[str, ...], index: SchemaIndex) -> list[str]:
    """Bracketed identifiers that are not a column of any table this clone reads (string literals removed first:
    a printed interval '[0, 1]' is TEXT). Nothing when the index cannot resolve a table - an unverifiable check
    must not fail a probe."""
    known: set[str] = set()
    for name in tables:
        table = index.tables.get(name)
        if table is None:
            return []
        known |= {c.name.lower() for c in table.columns}
    if not known:
        return []
    return sorted({m.group(1) for m in _BRACKETED.finditer(_STRING_LITERAL.sub("''", sql or ""))
                   if m.group(1).lower() not in known})


def _failed_probe(rule: Rule, fingerprint: str, error: str) -> Probe:
    return Probe(rule_id=rule.rule_id, status="failed", source=rule.source, rule_hash=rule.rule_hash,
                 structure_fingerprint=fingerprint, compiled_at=now_iso(), error=error)


def instantiate(rule: Rule, template: tuple[str, str] | None, fingerprint: str, signatures: dict[str, str],
                picture: Picture, index: SchemaIndex) -> Probe:
    """One family member's probe from its family's template: no model call, no round trip (the smoke test follows)."""
    if not template or not template[0].strip() or not template[1].strip():
        return _failed_probe(rule, fingerprint, "no member of this rule family could be authored - the family was "
                             f"tried on {cfg().family_author_attempts} different feature(s) and each attempt was "
                             "rejected or found inapplicable, so this member was never built")
    values = {**rule.params, "rule_id": rule.rule_id}
    summary_sql = substitute(template[0], values)
    detail_sql = substitute(template[1], values)
    leftover = unfilled_tokens(summary_sql) + unfilled_tokens(detail_sql)
    if leftover:
        return _failed_probe(rule, fingerprint, "the family's query still contains " + ", ".join(sorted(set(leftover)))
                             + " after substitution - it names a token this feature does not supply")
    tables = tuple(dict.fromkeys(value for key, value in rule.params.items() if key.endswith("table") and value))
    foreign = foreign_columns(summary_sql + "\n" + detail_sql, tables, index)
    if foreign:
        return _failed_probe(rule, fingerprint, "the family's query names " + ", ".join(foreign) + ", which exist(s) "
                             "in the table the query was written against but not in this one. The query must reference "
                             "only the columns supplied as tokens.")
    return Probe(
        rule_id=rule.rule_id, summary_sql=summary_sql, detail_sql=detail_sql, status="active", source=rule.source,
        rule_hash=rule.rule_hash, structure_fingerprint=fingerprint,
        table_fingerprint=probe_fingerprint(tables, signatures),
        semantic_fingerprint=semantic_fingerprint(tables, picture.schema, picture.value_hints, picture.numeric_hints),
        compiled_at=now_iso(), tables=tables,
        grounding_note=f"built from the query authored for {rule.family_id}, with this feature's names substituted in",
    )


def smoke_test(probe: Probe) -> str:
    """Run a cloned probe's SUMMARY once (short timeout). Returns the database's complaint, or ""."""
    result = executor_node({"rule_id": probe.rule_id, "summary_sql": probe.summary_sql, "detail_sql": "",
                            "smoke_test": True})
    return str(result.get("exec_error") or "")


def _usage_calls() -> int:
    return sum(int(u.get("calls", 1)) for u in current().usage)


def compile_rules(rules: list[Rule], catalog: dict[str, Probe], picture: Picture, fingerprint: str,
                  signatures: dict[str, str], *, only: list[str] | None = None, force: bool = False,
                  retry_failed: bool = False, covered: list[CoveredCheck] | None = None,
                  progress: Progress | None = None, cancelled: Callable[[], bool] | None = None,
                  errors: list[str] | None = None) -> CompileReport:
    """Compile every rule that needs it into ``catalog`` (mutated in place). Returns what happened."""
    settings = cfg()
    started = time.perf_counter()
    calls_before = _usage_calls()
    report = CompileReport(errors=list(errors or []))
    index = load_index(picture.schema, picture.numeric_hints)

    rules, notes = expand_families(rules, index)
    report.errors += notes
    if only:
        wanted = {r.strip().lower() for r in only if r.strip()}
        rules = [r for r in rules if r.rule_id.lower() in wanted or (r.family_id and r.family_id.lower() in wanted)]
    runnable = [r for r in rules if r.runnable]
    if not only:
        # RUNNABLE ids only: a rule switched off must eventually lose its probe, not be blocked on every run.
        report.removed = staleness.prune_removed(catalog, {r.rule_id for r in runnable})

    coverage = "\n\n".join(p for p in (
        coverage_summary(sorted({r.expands_over for r in rules if r.is_expanded and r.expands_over}),
                         pt.text(pt.COVERAGE_HEADER)),
        covered_text(covered or []),
    ) if p)

    meaning_cache: dict[tuple[str, ...], str] = {}

    def meaning_of(probe: Probe | None) -> str:
        if probe is None or not probe.tables:
            return ""
        key = tuple(probe.tables)
        if key not in meaning_cache:
            meaning_cache[key] = semantic_fingerprint(key, picture.schema, picture.value_hints, picture.numeric_hints)
        return meaning_cache[key]

    def stale(rule: Rule) -> tuple[bool, str]:
        existing = catalog.get(rule.rule_id)
        return staleness.is_stale(existing, rule, fingerprint, retry_failed, signatures, meaning_of(existing))

    # The member chosen to author its family is the one with the MOST DATA (an empty table examines nothing, no
    # template is produced, and every sibling would fail with it).
    by_id = {r.rule_id: r for r in runnable}

    def rows_behind(rule: Rule) -> int:
        best = 0
        for key, value in rule.params.items():
            if key.endswith("table"):
                table = index.tables.get(value)
                best = max(best, (table.row_count or 0) if table else 0)
        return best

    authors: dict[str, str] = {}
    for rule in runnable:
        if rule.is_expanded:
            current_author = authors.get(rule.family_id)
            if current_author is None or rows_behind(rule) > rows_behind(by_id[current_author]):
                authors[rule.family_id] = rule.rule_id
    family_attempts = {family: 1 for family in authors}
    templates: dict[str, tuple[str, str]] = {}
    if authors:
        chosen = set(authors.values())
        runnable = sorted(runnable, key=lambda r: 0 if r.rule_id in chosen else 1)
    if not force:
        # A family is re-authored only when one of its members needs rebuilding.
        settled = {family for family in authors
                   if not any(stale(r)[0] for r in runnable if r.family_id == family)}
        authors = {f: r for f, r in authors.items() if f not in settled}

    graph = build_compile_graph()
    total = len(runnable)
    for position, rule in enumerate(runnable, 1):
        if cancelled is not None and cancelled():
            raise Cancelled()
        if progress is not None:
            progress(position - 1, total, rule.rule_id)

        if rule.is_expanded and rule.family_id in authors:
            if authors[rule.family_id] != rule.rule_id:
                if rule.family_id not in templates:
                    # The designated author failed: promote THIS member (a different feature is a genuinely
                    # different query), bounded by family_author_attempts.
                    tried = family_attempts.get(rule.family_id, 0)
                    if tried < settings.family_author_attempts:
                        family_attempts[rule.family_id] = tried + 1
                        authors[rule.family_id] = rule.rule_id
                    else:
                        catalog[rule.rule_id] = instantiate(rule, None, fingerprint, signatures, picture, index)
                        report.failed.append(rule.rule_id)
                        continue
                else:
                    probe = instantiate(rule, templates.get(rule.family_id), fingerprint, signatures, picture, index)
                    if probe.status == "active":
                        try:
                            exec_error = smoke_test(probe)
                        except DatabaseUnavailable as exc:
                            report.stopped_early = str(exc)
                            break
                        if exec_error:
                            probe = _failed_probe(rule, fingerprint, "the family's query does not run against this "
                                                  f"feature - the database reported: {exec_error}")
                    catalog[rule.rule_id] = probe
                    (report.compiled if probe.status == "active" else report.failed).append(rule.rule_id)
                    continue
        elif not force:
            is_stale, why = stale(rule)
            if not is_stale and rule.rule_id in catalog:
                report.reused.append(rule.rule_id)
                continue
            if why:
                log.info("anomaly compile: %s needs rebuilding - %s", rule.rule_id, why)

        needs_llm = not rule.is_expanded or rule.rule_id in authors.values()
        spent = _usage_calls() - calls_before
        if needs_llm and spent >= settings.max_compile_calls:
            report.stopped_early = (f"the compile budget of {settings.max_compile_calls} LLM calls was reached; "
                                    f"{total - position + 1} rule(s) were not compiled")
            break

        state = _seed_state(rule, fingerprint, picture, coverage, signatures)
        try:
            final = graph.invoke(state, config={"recursion_limit": settings.recursion_limit})
        except (DatabaseUnavailable, AiUnavailable, PromptMissing) as exc:
            # Nothing about THIS rule is wrong: stop, and keep everything compiled so far.
            report.stopped_early = str(exc)
            break
        except Exception as exc:  # noqa: BLE001 - one rule must never abort the compile
            log.warning("anomaly compile: %s raised %s", rule.rule_id, type(exc).__name__)
            catalog[rule.rule_id] = _failed_probe(rule, fingerprint,
                                                  f"the compile graph raised {type(exc).__name__}: {exc}"[:2000])
            report.failed.append(rule.rule_id)
            continue

        probe = final.get("probe")
        if rule.is_expanded and final.get("summary_sql_template") and probe is not None and probe.status == "active":
            templates[rule.family_id] = (final["summary_sql_template"], final.get("detail_sql_template", ""))
        if probe is None:
            catalog[rule.rule_id] = _failed_probe(rule, fingerprint, "the compile finished without producing a probe")
            report.failed.append(rule.rule_id)
            continue
        catalog[rule.rule_id] = probe
        if probe.status == "active":
            report.compiled.append(rule.rule_id)
        elif probe.status == "not_applicable":
            report.not_applicable.append(rule.rule_id)
        else:
            report.failed.append(rule.rule_id)

    if progress is not None and not report.stopped_early:
        progress(total, total, "")
    report.duplicates = staleness.duplicate_probes(catalog)
    report.llm_calls = _usage_calls() - calls_before
    report.seconds = time.perf_counter() - started
    return report
