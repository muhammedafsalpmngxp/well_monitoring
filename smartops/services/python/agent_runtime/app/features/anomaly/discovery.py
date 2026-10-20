"""Drive DISCOVER, and turn a decided proposal into a rule (ported from the original discovery.py / discoveries.py).

Stateless: what is already covered (the rules, the compiled outcomes, checks made elsewhere) and what a person
already refused come IN; the proposals go OUT. Accept / Reject are the Tenant API's to record - this module only
formats the rule a decision produces (``proposal_to_rule``), exactly as the original wrote it into discovered.md.
"""
from __future__ import annotations

import datetime as dt
import time
from typing import Any, Callable

from app.features.anomaly import introspect
from app.features.anomaly.compiler import CoveredCheck
from app.features.anomaly.config import cfg
from app.features.anomaly.discover_graph import (
    context_builder,
    dedup_filter,
    evidence_check,
    proposal_writer,
    scout,
)
from app.features.anomaly.expand import expand_families
from app.features.anomaly.markdown import next_free_id
from app.features.anomaly.model import SEVERITIES, Discovery, Probe, Rule
from app.features.anomaly.schema_index import load_index
from app.features.common.context import current

Emit = Callable[[str, int, int, str], None]
STAGES = ("context_builder", "scout", "evidence_check", "dedup_filter", "proposal_writer")


def _decided(items: list[dict[str, Any]] | None) -> list[dict[str, str]]:
    out = []
    for item in items or []:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or "").strip()
        if title:
            out.append({"rule_id": str(item.get("ruleId") or item.get("rule_id") or ""), "title": title,
                        "reason": str(item.get("reason") or "")})
    return out


def discover(rules: list[Rule], catalog: dict[str, Probe], *, accepted: list[dict] | None = None,
             rejected: list[dict] | None = None, max_proposals: int | None = None,
             covered_checks: list[CoveredCheck] | None = None, emit: Emit | None = None) -> dict:
    emit = emit or (lambda *_: None)
    started = time.perf_counter()
    calls_before = sum(int(u.get("calls", 1)) for u in current().usage)
    limit = max(1, int(max_proposals or cfg().discover_max_proposals))

    emit("context_builder", 0, len(STAGES), "Measuring the database")
    picture = introspect.describe()
    index = load_index(picture.schema, picture.numeric_hints)
    expanded, _notes = expand_families(rules, index)
    observations = context_builder(picture, index)

    compiled = {p.rule_id: p.status for p in catalog.values()}
    covered = [{"rule_id": r.rule_id, "title": r.title, "category": r.category, "tags": ", ".join(r.tags or ()),
                "status": r.status, "compiled_status": compiled.get(r.rule_id, "")}
               for r in expanded if r.status != "rejected"]
    known_titles = {c["title"].strip().lower() for c in covered}
    for item in _decided(accepted):
        if item["title"].lower() not in known_titles:
            covered.append({**item, "category": "", "tags": "", "status": "accepted", "compiled_status": ""})
    for check in covered_checks or []:
        covered.append({"rule_id": "", "title": check.name, "category": check.table,
                        "tags": check.description, "status": "covered elsewhere", "compiled_status": ""})
    refused = [{"rule_id": r.rule_id, "title": r.title, "reason": (r.discovery.reason if r.discovery else "")}
               for r in expanded if r.status == "rejected"]
    refused_titles = {r["title"].strip().lower() for r in refused}
    refused += [r for r in _decided(rejected) if r["title"].lower() not in refused_titles]

    dropped: list[dict] = []
    error = ""
    proposals: list[dict] = []
    if observations:       # nothing measured: zero proposals is the honest answer, not an error
        emit("scout", 1, len(STAGES), "Asking the Scout")
        proposals, error, _calls = scout(observations, picture.schema, covered, refused, limit)
        if proposals:
            emit("evidence_check", 2, len(STAGES), "Checking the evidence")
            proposals = evidence_check(proposals, observations, dropped)
            emit("dedup_filter", 3, len(STAGES), "Dropping what is covered or refused")
            proposals = dedup_filter(proposals, covered, refused, dropped)
    emit("proposal_writer", 4, len(STAGES), "Recording the proposals")
    proposals = proposal_writer(proposals, current().request.db.name)
    emit("done", len(STAGES), len(STAGES), "")
    return {"proposals": proposals, "dropped": dropped, "observations": len(observations), "error": error,
            "seconds": round(time.perf_counter() - started, 1),
            "llmCalls": sum(int(u.get("calls", 1)) for u in current().usage) - calls_before}


def _clean(value: Any) -> str:
    return " ".join(str(value or "").split())


def proposal_to_rule(proposal: dict[str, Any], rule_id: str | None, status: str, reason: str = "",
                     existing_ids: list[str] | None = None) -> Rule:
    """The rule an accepted (or refused) proposal becomes - the original discoveries.render, as a rule dict.

    probation by default upstream: it RUNS, so it is judged on what it finds, and counts towards nothing until a
    person promotes it. A refused proposal becomes a ``rejected`` rule so the Scout cannot propose it again."""
    settings = cfg()
    if status not in ("probation", "active", "rejected"):
        raise ValueError(f"a proposal can become a probation, active or rejected rule, not {status!r}")
    rule_id = (rule_id or "").strip()
    if not rule_id:
        prefix = settings.discovered_rule_id_prefix
        used = [r for r in (existing_ids or []) if r.startswith(prefix) and r[len(prefix):].isdigit()]
        rule_id = next_free_id(used) if used else f"{prefix}01"
    severity = _clean(proposal.get("severity")).lower() or "medium"
    if severity not in SEVERITIES:
        severity = "medium"
    tags = proposal.get("tags") or []
    if isinstance(tags, str):
        tags = tags.split(",")
    body = "\n".join([
        f"Wrong: {_clean(proposal.get('what_is_wrong'))}",
        f"Matters: {_clean(proposal.get('why_it_matters'))}",
        f"Detect: {_clean(proposal.get('how_to_detect'))}",
        "Never flag: " + (_clean(proposal.get("do_not_flag")) or settings.proposal_no_exclusions_text),
    ])
    title = _clean(proposal.get("title"))
    if not title:
        raise ValueError("the proposal has no title")
    return Rule(
        rule_id=rule_id, title=title, category=_clean(proposal.get("category")) or "Uncategorised",
        severity=severity, entity=_clean(proposal.get("entity")) or "row", method="rule", sql_mode="authored",
        status=status, source="discovered", tags=tuple(_clean(t) for t in tags if _clean(t)), body=body,
        discovery=Discovery(
            evidence=_clean(proposal.get("evidence")),
            discovered_from=_clean(proposal.get("database")) or current().request.db.name,
            decided=dt.date.today().isoformat(), reason=_clean(reason),
            observation_id=_clean(proposal.get("observation_id")),
            observation_fact=_clean(proposal.get("observation_fact")), proposal_hash=_clean(proposal.get("hash")),
        ),
    )
