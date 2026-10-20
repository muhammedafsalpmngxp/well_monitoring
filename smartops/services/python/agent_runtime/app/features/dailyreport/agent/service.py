"""Running the agent graph and shaping its answer (ported from app/agentic/service.py).

The response keeps the classic explain fields (available, explanation, cached, evidence, sql_sources, proof, ...)
so every existing panel renders an agent answer unchanged, and adds the plan, the trace, the verifier's verdict and
the models each role used. ``usage`` lists the model calls made (the Tenant API logs them).
"""
from __future__ import annotations

import time
from datetime import date
from typing import Any, Dict, Optional

from app.features.dailyreport.agent.graph import AgentGraph, AgentState

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


def brief(ctx, report_date: date, *, today: date, scope: str = "day", well_id: Optional[int] = None,
          task_daily_id: Optional[int] = None) -> Dict[str, Any]:
    """The dashboard's AI summaries, produced by the agent graph with a fixed plan."""
    started = time.perf_counter()
    state = AgentGraph(ctx, report_date, today).invoke({
        "kind": "brief", "report_date": report_date, "scope": scope, "well_id": well_id,
        "task_daily_id": task_daily_id, "question": "", "revisions": 0, "trace": [], "models": {},
    })
    return _respond(ctx, state, kind="brief", scope=scope, started=started)


def ask(ctx, report_date: date, question: str, *, today: date) -> Dict[str, Any]:
    """An open question about the report date, planned by the planner agent."""
    started = time.perf_counter()
    state = AgentGraph(ctx, report_date, today).invoke({
        "kind": "ask", "report_date": report_date, "question": question.strip(), "revisions": 0, "trace": [],
        "models": {},
    })
    return _respond(ctx, state, kind="ask", scope=None, started=started)
