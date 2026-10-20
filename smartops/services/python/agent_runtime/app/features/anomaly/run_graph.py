"""The RUN stage: catalog_loader -> probe_runner -> scorer -> summarizer -> report_builder (ported nodes).

Strictly linear, no retries (there is no author to rewrite anything): a probe that fails is reported as failed. The
only branch is whether there is anything to run at all - and an empty run still produces a report saying so.
ONE model call per run (the summarizer), shown only aggregates and a few example rows, so its cost is flat.
"""
from __future__ import annotations

import base64
import contextvars
import hashlib
import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

from app.features.anomaly import catalog as staleness
from app.features.anomaly import dbio
from app.features.anomaly import prompts as pt
from app.features.anomaly.config import cfg
from app.features.anomaly.contract import (
    check_detail,
    check_summary,
    columns_of,
    nearly_saturated,
    sanity_concerns,
    summary_values,
)
from app.features.anomaly.model import SEVERITIES, SEVERITY_RANK, Probe, ProbeResult, Rule
from app.features.anomaly.report import spool as spool_store
from app.features.common import llm
from app.features.common.text import strip_think

log = logging.getLogger("agent_runtime.anomaly")


def _as_int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _as_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


# ── catalog_loader (deterministic): which probes this run will execute, and why the rest will not ──

def select_probes(catalog: dict[str, Probe], rules: dict[str, Rule], only: list[str] | None) -> list[Probe]:
    wanted = {r.strip().lower() for r in (only or []) if r.strip()}

    def chosen(probe: Probe) -> bool:
        if not wanted:
            return True
        rule = rules.get(probe.rule_id)
        return probe.rule_id.lower() in wanted or bool(rule and rule.family_id and rule.family_id.lower() in wanted)

    return [p for p in catalog.values() if chosen(p)]


def find_outdated(selected: list[Probe], rules: dict[str, Rule], fingerprint: str, signatures: dict[str, str],
                  meaning_of) -> dict[str, str]:
    """rule_id -> why its stored SQL can no longer be trusted (only for probes that would otherwise run)."""
    outdated: dict[str, str] = {}
    for probe in selected:
        if staleness.runnable_reason(probe, rules.get(probe.rule_id)):
            continue
        rule = rules.get(probe.rule_id)
        if rule is not None and probe.rule_hash and probe.rule_hash != rule.rule_hash:
            outdated[probe.rule_id] = "the rule definition changed since it was compiled"
            continue
        moved, why = staleness.structure_moved(probe, fingerprint, signatures)
        if moved:
            outdated[probe.rule_id] = why
            continue
        drifted, why = staleness.semantics_moved(probe, meaning_of(probe))
        if drifted:
            outdated[probe.rule_id] = why
    return outdated


def partition(selected: list[Probe], rules: dict[str, Rule], outdated: dict[str, str]) -> tuple[list[Probe], list[dict]]:
    """(probes that run, checks that will not - with the reason). A REJECTED rule is a decision, not a coverage gap,
    so it is left out of the report entirely; a disabled one is a real check switched off and is listed."""
    probes: list[Probe] = []
    not_running: list[dict[str, str]] = []
    for probe in selected:
        rule = rules.get(probe.rule_id)
        blocked = staleness.runnable_reason(probe, rule)
        if not blocked and probe.rule_id not in outdated:
            probes.append(probe)
            continue
        if rule is not None and rule.status == "rejected":
            continue
        if probe.rule_id in outdated:
            status = "stale"
        elif rule is not None and not rule.runnable:
            status = rule.status
        else:
            status = probe.status
        not_running.append({"rule_id": probe.rule_id, "title": getattr(rule, "title", ""), "status": status,
                            "reason": outdated.get(probe.rule_id) or blocked})
    probes.sort(key=lambda p: p.rule_id)
    not_running.sort(key=lambda n: n["rule_id"])
    return probes, not_running


# ── probe_runner (deterministic): SUMMARY always, DETAIL only when something was found ──

def _run_summary(cur, probe: Probe, result: ProbeResult) -> bool:
    started = time.perf_counter()
    dbio.guard(probe.summary_sql)
    cur.execute(probe.summary_sql)
    columns = columns_of(cur.description)
    rows = cur.fetchmany(2)
    result.summary_seconds = time.perf_counter() - started
    problems = check_summary(columns, len(rows))
    if problems:
        result.ok = False
        result.error = "the stored probe no longer satisfies its contract: " + "; ".join(problems)
        return False
    values = summary_values(columns, list(rows[0]))
    result.scope_total = _as_int(values.get("scope_total"))
    result.anomaly_count = _as_int(values.get("anomaly_count"))
    result.anomaly_pct = _as_float(values.get("anomaly_pct"))
    worst = values.get("worst_severity_val")
    result.worst_severity_val = None if worst is None else _as_float(worst)
    result.concerns = sanity_concerns(values)
    return True


def _run_detail(cur, probe: Probe, result: ProbeResult, spool_dir: str) -> None:
    settings = cfg()
    started = time.perf_counter()
    dbio.guard(probe.detail_sql)
    cur.execute(probe.detail_sql)
    columns = columns_of(cur.description)
    result.detail_columns = columns
    problems = check_detail(columns)
    if problems:
        result.ok = False
        result.error = "the stored probe no longer satisfies its contract: " + "; ".join(problems)
        return
    spool = spool_store.Spool(spool_dir, probe.rule_id, columns)
    total = 0
    truncated = False
    try:
        while True:
            batch = cur.fetchmany(settings.fetch_batch)
            if not batch:
                break
            for raw in batch:
                if total >= settings.export_max_rows:
                    truncated = True
                    break
                row = list(raw)
                spool.write(row)
                if total < settings.report_rows:
                    result.detail_rows.append([spool_store.jsonable(v) for v in row])
                total += 1
            if truncated:
                break
    finally:
        spool.close()
    result.detail_total = total
    result.spool_path = spool.path
    result.spool_truncated = truncated
    result.detail_truncated = total > len(result.detail_rows)
    result.detail_seconds = time.perf_counter() - started
    if not truncated and total != result.anomaly_count:
        result.concerns.append(f"SUMMARY reports {result.anomaly_count} anomalies but DETAIL returned {total} rows. The "
                               "two queries disagree - they must apply the SAME condition at the SAME grain.")


def run_one(probe: Probe, spool_dir: str) -> ProbeResult:
    settings = cfg()
    result = ProbeResult(rule_id=probe.rule_id)
    conn = None
    try:
        conn = dbio.connect(timeout=settings.detail_timeout, read_uncommitted=settings.read_uncommitted)
        cur = conn.cursor()
        if not _run_summary(cur, probe, result):
            return result
        if result.anomaly_count <= 0:
            result.detail_skipped = True     # "not looked at" is never confused with "no rows found"
            return result
        _run_detail(cur, probe, result, spool_dir)
        return result
    except Exception as exc:  # noqa: BLE001 - one probe must never end the run
        result.ok = False
        result.error = dbio.error_text(exc) if not isinstance(exc, dbio.DatabaseUnavailable) else str(exc)
        return result
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:  # noqa: BLE001
                pass


def probe_runner(probes: list[Probe], spool_dir: str, progress=None, cancelled=None) -> list[ProbeResult]:
    """Every probe, bounded concurrency (scanning queries against a live database). Results in probe order."""
    if not probes:
        return []
    workers = max(1, min(cfg().run_concurrency, len(probes)))
    results: dict[str, ProbeResult] = {}
    pool = ThreadPoolExecutor(max_workers=workers)
    try:
        # Each worker runs in a copy of this context: the request, its settings and its usage list.
        futures = {pool.submit(contextvars.copy_context().run, run_one, p, spool_dir): p for p in probes}
        done = 0
        for future in as_completed(futures):
            probe = futures[future]
            results[probe.rule_id] = future.result()
            done += 1
            if progress is not None:
                progress(done, len(probes), probe.rule_id)      # raises when the caller has gone
            if cancelled is not None and cancelled():
                break
    finally:
        # Probes not yet started are dropped: a caller that stopped listening gets no further database load.
        pool.shutdown(wait=True, cancel_futures=True)
    return [results[p.rule_id] for p in probes if p.rule_id in results]


# ── scorer (deterministic): no model decides how bad the data is ──

def score_basis() -> str:
    weights = cfg().severity_weights
    return ("Score = 100 x (1 - the severity-weighted average share of examined records that were anomalous), over "
            "every check that examined at least one record. Severity weights: "
            + ", ".join(f"{name} {weight:g}" for name, weight in sorted(weights.items(), key=lambda kv: -kv[1]))
            + ". Checks that examined no records are excluded entirely and reported separately as coverage gaps. The "
              "score is a trend indicator - read it alongside the findings table, which carries the severity of "
              "individual problems.")


def _severity_of(rule) -> str:
    return getattr(rule, "severity", "medium") or "medium"


def _is_scored(rule) -> bool:
    """A probation rule runs and reports but counts towards NOTHING here. Missing rule: scored (the safe side)."""
    return bool(getattr(rule, "scored", True))


def rule_set_fingerprint(results: list, rules: dict) -> str:
    """Which checks (id + severity, every scored probe SELECTED to run) the score was computed from."""
    parts = [f"{r.rule_id}:{_severity_of(rules.get(r.rule_id))}" for r in results]
    return hashlib.sha256("|".join(sorted(parts)).encode("utf-8")).hexdigest()[:12] if parts else ""


def scorer(results: list[ProbeResult], rules: dict[str, Rule], not_running: list[dict]) -> dict:
    weights = cfg().severity_weights
    # A severity the weights do not name scores as "medium" (else the mean weight): it still counts, never as zero.
    default_weight = weights.get("medium", sum(weights.values()) / len(weights) if weights else 1.0)
    scored = [r for r in results if _is_scored(rules.get(r.rule_id))]
    probation = [r for r in results if not _is_scored(rules.get(r.rule_id))]
    fingerprint = rule_set_fingerprint(scored, rules)
    weighted_share = total_weight = 0.0
    by_severity: dict[str, int] = {s: 0 for s in SEVERITIES}
    by_category: dict[str, dict] = {}
    ranked: list[dict] = []
    examined = flagged = clean = 0
    empty_scope: list[str] = []
    for result in scored:
        rule = rules.get(result.rule_id)
        severity = _severity_of(rule)
        category = getattr(rule, "category", "Uncategorised") or "Uncategorised"
        if not result.ok:
            continue
        examined += result.scope_total
        flagged += result.anomaly_count
        if result.scope_total <= 0:
            empty_scope.append(result.rule_id)     # excluded from BOTH sides of the fraction
            continue
        weight = weights.get(severity, default_weight)
        share = result.anomaly_count / result.scope_total
        total_weight += weight
        weighted_share += weight * share
        if result.anomaly_count <= 0:
            clean += 1
            continue
        by_severity[severity] = by_severity.get(severity, 0) + 1
        bucket = by_category.setdefault(category, {"category": category, "rules": 0, "anomalies": 0})
        bucket["rules"] += 1
        bucket["anomalies"] += result.anomaly_count
        ranked.append({"rule_id": result.rule_id, "title": getattr(rule, "title", result.rule_id),
                       "category": category, "severity": severity, "scope_total": result.scope_total,
                       "anomaly_count": result.anomaly_count,
                       "anomaly_pct": result.anomaly_pct or round(100.0 * share, 4), "share": share,
                       "contribution": round(weight * share, 4), "detail_total": result.detail_total,
                       "concerns": list(result.concerns)})
    ranked.sort(key=lambda r: (SEVERITY_RANK.get(r["severity"], 9), -r["share"]))
    mean_share = (weighted_share / total_weight) if total_weight else 0.0
    score = max(0.0, min(100.0, 100.0 * (1.0 - mean_share)))
    totals = {"probes_run": len(scored), "probes_failed": sum(1 for r in scored if not r.ok), "probes_clean": clean,
              "probes_with_findings": len(ranked), "probes_empty_scope": len(empty_scope),
              "records_examined": examined, "records_flagged": flagged, "not_running": len(not_running or [])}
    discovered_ranked, discovered_totals = _tally(probation, rules)
    return {"score": round(score, 1), "score_basis": score_basis(), "rule_set_fingerprint": fingerprint,
            "totals": totals, "by_severity": by_severity,
            "by_category": sorted(by_category.values(), key=lambda c: -c["anomalies"]), "ranked": ranked,
            "empty_scope": empty_scope, "discovered_ranked": discovered_ranked,
            "discovered_totals": discovered_totals}


def _tally(results: list[ProbeResult], rules: dict) -> tuple[list[dict], dict]:
    """Rank and total the rules on trial WITHOUT a score: unvetted rules make no claim about the data's health."""
    ranked: list[dict] = []
    examined = flagged = 0
    for result in results:
        if not result.ok:
            continue
        examined += result.scope_total
        flagged += result.anomaly_count
        if result.scope_total <= 0 or result.anomaly_count <= 0:
            continue
        rule = rules.get(result.rule_id)
        ranked.append({"rule_id": result.rule_id, "title": getattr(rule, "title", result.rule_id),
                       "category": getattr(rule, "category", "Uncategorised") or "Uncategorised",
                       "severity": _severity_of(rule), "status": getattr(rule, "status", ""),
                       "scope_total": result.scope_total, "anomaly_count": result.anomaly_count,
                       "anomaly_pct": result.anomaly_pct or round(100.0 * result.anomaly_count / result.scope_total, 4),
                       "share": result.anomaly_count / result.scope_total, "detail_total": result.detail_total,
                       "concerns": list(result.concerns)})
    ranked.sort(key=lambda r: (SEVERITY_RANK.get(r["severity"], 9), -r["share"]))
    return ranked, {"probes_run": len(results), "probes_failed": sum(1 for r in results if not r.ok),
                    "probes_with_findings": len(ranked), "records_examined": examined, "records_flagged": flagged}


# ── summarizer (LLM, the run's only call) - never fails the run ──

def _findings_table(ranked: list[dict]) -> tuple[str, str]:
    limit = cfg().summarizer_max_listed
    rows = [f"{row['severity']} | {row['anomaly_count']:,} | {row['scope_total']:,} | {float(row['anomaly_pct']):.2f}% | "
            f"{row['title']}" for row in ranked[:limit]]
    more = ""
    if len(ranked) > limit:
        rest = ranked[limit:]
        more = pt.build(pt.SUMMARIZER_FINDINGS_MORE, COUNT=len(rest),
                        RECORDS=f"{sum(r['anomaly_count'] for r in rest):,}")
    return "\n".join(rows), more


def _examples(ranked: list[dict], results: list[ProbeResult]) -> str:
    settings = cfg()
    by_id = {r.rule_id: r for r in results}
    blocks: list[str] = []
    for row in ranked[: settings.summarizer_sample_rules]:
        result = by_id.get(row["rule_id"])
        if result is None or not result.detail_rows:
            continue
        blocks.append(pt.build(pt.SUMMARIZER_EXAMPLE_FOR, TITLE=row["title"],
                               TABLE=pt.rows_to_table(result.detail_columns, result.detail_rows,
                                                      max_rows=settings.summarizer_sample_rows)))
    return "\n\n".join(blocks)


def deterministic_summary(state: dict) -> str:
    """The fallback when no model is available: plain, accurate, obviously machine-written."""
    ranked = state.get("ranked") or []
    totals = state.get("totals") or {}
    if not ranked:
        return (f"{totals.get('probes_run', 0)} checks ran and none found anything to report. "
                f"{totals.get('records_examined', 0):,} records were examined.")
    lines = [f"{len(ranked)} of {totals.get('probes_run', 0)} checks found problems, affecting "
             f"{totals.get('records_flagged', 0):,} of {totals.get('records_examined', 0):,} records examined. The "
             f"most serious are:"]
    for row in ranked[: cfg().fallback_summary_top]:
        lines.append(f"- {row['title']} ({row['severity']}): {row['anomaly_count']:,} records, "
                     f"{float(row['anomaly_pct']):.2f}% of those checked.")
    return "\n".join(lines)


def summarizer(state: dict) -> tuple[str, int]:
    """(executive summary, model calls). Every figure it is given was computed by the scorer."""
    settings = cfg()
    if not llm.available():
        return deterministic_summary(state), 0
    ranked = state.get("ranked") or []
    totals = state.get("totals") or {}
    parts = [pt.build(pt.SUMMARIZER_HEADLINE, SCORE=state.get("score", 0), PROBES_RUN=totals.get("probes_run", 0),
                      WITH_FINDINGS=totals.get("probes_with_findings", 0), CLEAN=totals.get("probes_clean", 0),
                      FAILED=totals.get("probes_failed", 0), EXAMINED=f"{totals.get('records_examined', 0):,}",
                      FLAGGED=f"{totals.get('records_flagged', 0):,}")]
    if ranked:
        rows, more = _findings_table(ranked)
        parts.append(pt.build(pt.SUMMARIZER_FINDINGS, ROWS=rows) + (("\n" + more) if more else ""))
    else:
        parts.append(pt.text(pt.SUMMARIZER_NO_FINDINGS))
    examples = _examples(ranked, state.get("results") or [])
    if examples:
        parts.append(pt.build(pt.SUMMARIZER_EXAMPLES, SAMPLE_ROWS=settings.summarizer_sample_rows, EXAMPLES=examples))
    names = settings.summarizer_caveat_names
    saturated = [r for r in ranked if r.get("scope_total") and r["anomaly_count"] == r["scope_total"]]
    near = [r for r in ranked if nearly_saturated(r.get("anomaly_count"), r.get("scope_total"))]
    if near:
        parts.append(pt.build(pt.SUMMARIZER_NEAR_SATURATED, COUNT=len(near), NAMED=", ".join(
            f"{r['title']} ({r['anomaly_count']:,} of {r['scope_total']:,})" for r in near[:names])))
    if saturated:
        parts.append(pt.build(pt.SUMMARIZER_SATURATED, COUNT=len(saturated), NAMED=", ".join(
            f"{r['title']} ({r['anomaly_count']:,})" for r in saturated[:names])))
    if state.get("empty_scope"):
        parts.append(pt.build(pt.SUMMARIZER_COVERAGE_GAPS, COUNT=len(state["empty_scope"])))
    if state.get("not_running"):
        parts.append(pt.build(pt.SUMMARIZER_NOT_RUNNING, COUNT=len(state["not_running"])))
    parts.append(pt.text(pt.SUMMARIZER_FINAL))
    try:
        summary = strip_think(llm.chat(pt.text(pt.SUMMARIZER_SYSTEM), "\n\n".join(parts), agent="summarizer",
                                       temperature=settings.summarizer_temperature,
                                       fast=settings.summarizer_tier == "fast"))
    except Exception as exc:  # noqa: BLE001 - never lose a complete set of findings over prose
        log.warning("anomaly summary: the model call failed (%s) - using a plain summary", type(exc).__name__)
        return deterministic_summary(state), 0
    return (summary or deterministic_summary(state)), 1


# ── report_builder (deterministic): each format fails alone ──

def build_reports(state: dict, formats: list[str]) -> tuple[dict[str, str], list[str]]:
    """{format: base64 file}, errors. A failure in one format never costs the other."""
    from app.features.anomaly.report import docx_report, xlsx_report

    builders = {"xlsx": (xlsx_report.build, "the Excel workbook"), "docx": (docx_report.build, "the Word document")}
    wanted = [f for f in (formats or []) if f in builders] or list(builders)
    files: dict[str, str] = {}
    errors: list[str] = []
    for fmt in wanted:
        build, label = builders[fmt]
        try:
            files[fmt] = base64.b64encode(build(state)).decode("ascii")
        except Exception as exc:  # noqa: BLE001 - one format must not cost the other
            log.warning("anomaly report: %s could not be written (%s)", label, type(exc).__name__)
            errors.append(f"{label} could not be written ({type(exc).__name__})")
    return files, errors
