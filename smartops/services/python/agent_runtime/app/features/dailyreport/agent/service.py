"""Running the agent graph and shaping its answer (ported from app/agentic/service.py).

The response keeps the classic explain fields (available, explanation, cached, evidence, sql_sources, proof, ...)
so every existing panel renders an agent answer unchanged, and adds the plan, the trace, the verifier's verdict and
the models each role used. ``usage`` lists the model calls made (the Tenant API logs them).
"""
from __future__ import annotations

import time
from datetime import date
from typing import Any, Dict, Iterable, Optional

from app.features.dailyreport.agent.graph import AgentGraph, AgentState, Events
from app.features.dailyreport.data import ANSWER_CACHE, date_tag

#: Which tool's audit material fills the classic evidence / SQL / proof drawers.
_PRIMARY_TOOL = {"day": "day_overview", "well": "well_overview", "task": "task_detail"}

#: Shown when the graph ended without an answer and without a reason (never expected; never fabricated).
_NO_ANSWER = "No answer could be produced."


def _respond(ctx, state: AgentState, *, kind: str, scope: Optional[str], started: float) -> Dict[str, Any]:
    results = state.get("results", [])
    primary_name = _PRIMARY_TOOL.get(scope or "")
    primary = next((r for r in results if r.tool == primary_name and r.ok), None)
    audit = primary.audit if primary is not None else {}
    draft = state.get("draft")
    verification = state.get("verification") or {}
    return {
        "report_date": state["report_date"],
        "kind": kind,
        "scope": scope,
        "question": state.get("question"),
        "available": bool(draft),
        "explanation": draft,
        "error": None if draft else state.get("error") or _NO_ANSWER,
        "model": (state.get("models") or {}).get("writer"),
        "models": state.get("models") or {},
        "cached": bool(state.get("cached")),
        "verified": bool(verification.get("passed")) if draft else False,
        # The content hash of a verified answer, for the Tenant API to save it (core.AiFeatureAnswer) and send it back.
        "answer_key": state.get("answer_key") if draft and verification.get("passed") else None,
        "verification": verification,
        "revisions": state.get("revisions", 0),
        "plan": state.get("plan", []),
        "trace": state.get("trace", []),
        "tool_results": [r.for_model() for r in results],
        "evidence": audit.get("evidence") or {"tool_results": [r.for_model() for r in results]},
        "evidence_withheld_from_model": audit.get("withheld", []),
        "sql_sources": audit.get("sql_sources", []),
        "proof": audit.get("proof", []),
        "proof_note": audit.get("proof_note"),
        "duration_s": round(time.perf_counter() - started, 2),
        "usage": list(ctx.run.usage),
    }


def remember(ctx, report_date: date, known: Iterable[Any]) -> int:
    """Verified answers the Tenant API saved (core.AiFeatureAnswer) go back into the answer cache, so a restart of
    this service loses none. Each is keyed by the content hash of everything it rests on (the data included), so one
    written on other data is never reused. Returns how many were taken."""
    s = ctx.settings
    if not s.answer_cache_ttl_seconds:
        return 0
    taken = 0
    for answer in known:
        if not answer.key or not answer.draft or ANSWER_CACHE.get(answer.key, s.answer_cache_ttl_seconds) is not None:
            continue
        ANSWER_CACHE.put(answer.key, {"draft": answer.draft, "verification": answer.verification or {"passed": True},
                                      "model": answer.model},
                         tag=date_tag(ctx.data.identity, report_date), ttl_seconds=s.answer_cache_ttl_seconds,
                         max_entries=s.answer_cache_max_entries)
        taken += 1
    return taken


def brief(ctx, report_date: date, *, today: date, scope: str = "day", well_id: Optional[int] = None,
          task_daily_id: Optional[int] = None, known: Iterable[Any] = (), events: Optional[Events] = None) -> Dict[str, Any]:
    """The dashboard's AI summaries, produced by the agent graph with a fixed plan."""
    started = time.perf_counter()
    remember(ctx, report_date, known)
    state = AgentGraph(ctx, report_date, today, events).invoke({
        "kind": "brief", "report_date": report_date, "scope": scope, "well_id": well_id,
        "task_daily_id": task_daily_id, "question": "", "revisions": 0, "trace": [], "models": {},
    })
    return _respond(ctx, state, kind="brief", scope=scope, started=started)


def ask(ctx, report_date: date, question: str, *, today: date, known: Iterable[Any] = (),
        events: Optional[Events] = None) -> Dict[str, Any]:
    """An open question about the report date, planned by the planner agent."""
    started = time.perf_counter()
    remember(ctx, report_date, known)
    state = AgentGraph(ctx, report_date, today, events).invoke({
        "kind": "ask", "report_date": report_date, "question": question.strip(), "revisions": 0, "trace": [],
        "models": {},
    })
    return _respond(ctx, state, kind="ask", scope=None, started=started)
