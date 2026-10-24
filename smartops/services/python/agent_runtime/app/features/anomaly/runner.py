"""Drive a detection RUN: decide what may run (rebuilding stale probes when the settings allow), execute, score,
summarise and build the reports. The detail spool lives in a temporary directory deleted before returning.

Stale probes are NEVER executed: with autoCompile (and at most autoCompileMaxRules of them, and an AI provider) they
are rebuilt first; otherwise they are listed as not running, with the reason, and the report says so.
"""
from __future__ import annotations

import datetime as dt
import shutil
import tempfile
import time
from typing import Callable

from app.features.anomaly import introspect
from app.features.anomaly import prompts as pt
from app.features.anomaly.compiler import CoveredCheck, compile_rules
from app.features.anomaly.config import cfg
from app.features.anomaly.expand import expand_families
from app.features.anomaly.model import Probe, Rule
from app.features.anomaly.run_graph import (
    build_reports,
    find_outdated,
    partition,
    probe_runner,
    scorer,
    select_probes,
    summarizer,
    uncompiled,
)
from app.features.anomaly.schema_index import load_index
from app.features.anomaly.semantics import semantic_fingerprint
from app.features.common import llm
from app.features.common.context import current

Emit = Callable[[str, int, int, str], None]


def run(rules: list[Rule], catalog: dict[str, Probe], *, run_id: str, only: list[str] | None = None,
        formats: list[str] | None = None, covered: list[CoveredCheck] | None = None, emit: Emit | None = None,
        cancelled: Callable[[], bool] | None = None) -> dict:
    settings = cfg()
    emit = emit or (lambda *_: None)
    started = time.perf_counter()
    started_at = dt.datetime.now().astimezone().isoformat(timespec="seconds")
    db = current().request.db

    emit("introspect", 0, 1, "Reading the database description")
    picture = introspect.describe()
    index = load_index(picture.schema, picture.numeric_hints)
    expanded, _notes = expand_families(rules, index)
    rules_by_id = {r.rule_id: r for r in expanded}

    emit("catalog", 0, 1, "Checking the compiled probes")
    note = ""
    stale_list: list[dict] = []
    recompiled: list[str] = []
    catalog_changed = False
    outdated: dict[str, str] = {}
    selected = select_probes(catalog, rules_by_id, only)
    if not catalog:
        note = "No probes have been compiled yet. Compile the rules first."
    else:
        fingerprint, signatures, fp_notes = introspect.fingerprints()
        meaning: dict[tuple[str, ...], str] = {}

        def meaning_of(probe: Probe) -> str:
            if not probe.tables:
                return ""
            key = tuple(probe.tables)
            if key not in meaning:
                meaning[key] = semantic_fingerprint(key, picture.schema, picture.value_hints, picture.numeric_hints)
            return meaning[key]

        if fp_notes:
            note = " ".join(fp_notes) + " Every compiled probe is ASSUMED CURRENT for this run."
        outdated = find_outdated(selected, rules_by_id, fingerprint, signatures, meaning_of)
        stale_list = [{"ruleId": rule_id, "title": getattr(rules_by_id.get(rule_id), "title", ""), "reason": why,
                       "rebuilt": False} for rule_id, why in sorted(outdated.items())]
        if outdated:
            note = ((note + " ") if note else "") + (
                f"{len(outdated)} of {len(selected)} compiled probe(s) no longer match the database structure they "
                "were written against.")
            too_many = len(outdated) > settings.auto_compile_max_rules
            missing_prompts = pt.missing(pt.COMPILE_KEYS)
            if settings.auto_compile and not too_many and llm.available() and not missing_prompts:
                def compile_progress(done: int, total: int, label: str) -> None:
                    emit("compile", done, total, label)

                report = compile_rules(rules, catalog, picture, fingerprint, signatures, only=sorted(outdated),
                                       covered=covered, progress=compile_progress, cancelled=cancelled)
                catalog_changed = True
                still_bad = {rule_id: ((catalog.get(rule_id).error if catalog.get(rule_id) else "")
                                       or "it could not be recompiled against the current schema")
                             for rule_id in outdated
                             if not (catalog.get(rule_id) and catalog[rule_id].status == "active")}
                recompiled = sorted(set(outdated) - set(still_bad))
                for item in stale_list:
                    item["rebuilt"] = item["ruleId"] in recompiled
                note += (f" {len(recompiled)} were rebuilt automatically before this run ({report.llm_calls} LLM "
                         f"call(s), {report.seconds:.0f}s).")
                if still_bad:
                    note += f" {len(still_bad)} could not be rebuilt and did not run."
                if report.stopped_early:
                    note += f" The rebuild stopped early: {report.stopped_early}"
                outdated = still_bad
                selected = select_probes(catalog, rules_by_id, only)
            else:
                note += (" They were NOT run, because their stored SQL can no longer be trusted against this schema. "
                         "Compile the rules again to rebuild them")
                if too_many:
                    note += (f" (too many to rebuild automatically - {len(outdated)} exceeds the limit of "
                             f"{settings.auto_compile_max_rules}, which usually means the schema changed broadly "
                             "rather than drifted).")
                elif settings.auto_compile and not llm.available():
                    note += " (no AI provider is active, so they could not be rebuilt automatically)."
                elif settings.auto_compile and missing_prompts:
                    note += " (the compile prompts are not configured, so they could not be rebuilt automatically)."
                else:
                    note += " (or switch on automatic rebuilding in the Data Anomaly settings)."

    probes, not_running = partition(selected, rules_by_id, outdated)
    not_running = sorted(not_running + uncompiled(rules_by_id, catalog, only), key=lambda n: n["rule_id"])

    spool_dir = tempfile.mkdtemp(prefix="anomaly-run-")
    try:
        emit("probes", 0, len(probes), "Running the probes")
        results = probe_runner(probes, spool_dir, progress=lambda d, t, label: emit("probes", d, t, label),
                               cancelled=cancelled)
        emit("score", 0, 1, "Scoring")
        state: dict = {"run_id": run_id, "database_name": db.name, "results": results, "rules": rules_by_id,
                       "not_running": not_running, "catalog_stale": bool(outdated), "catalog_note": note}
        state.update(scorer(results, rules_by_id, not_running))
        emit("summary", 0, 1, "Writing the executive summary")
        state["summary"], _calls = summarizer(state)
        emit("report", 0, 1, "Building the reports")
        reports, report_errors = build_reports(state, formats or [])
    finally:
        shutil.rmtree(spool_dir, ignore_errors=True)

    result = {
        "run_id": run_id, "started_at": started_at, "database": {"name": db.name, "server": db.server},
        "seconds": round(time.perf_counter() - started, 1), "score": state["score"],
        "score_basis": state["score_basis"], "rule_set_fingerprint": state["rule_set_fingerprint"],
        "summary": state["summary"], "totals": state["totals"], "by_severity": state["by_severity"],
        "by_category": state["by_category"], "ranked": state["ranked"],
        "discovered_ranked": state["discovered_ranked"], "discovered_totals": state["discovered_totals"],
        "empty_scope": state["empty_scope"], "not_running": not_running,
        "failed": [{"rule_id": r.rule_id, "error": r.error} for r in results if not r.ok],
        "catalog_stale": bool(outdated), "catalog_note": note, "error": "", "reportErrors": report_errors,
        "staleProbes": stale_list, "reports": reports,
    }
    if catalog_changed:
        result["catalog"] = [p.to_dict() for p in catalog.values()]
        result["recompiled"] = recompiled
    return result
