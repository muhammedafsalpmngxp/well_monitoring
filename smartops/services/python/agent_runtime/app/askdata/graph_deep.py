# Ported from twise-agentic db_assistant/src/agent/sub_agents/deep/graph.py (team repo); see app/askdata/README.md.
"""Assemble the LangGraph AI-orchestration state machine (multi-query ReAct + verifier loop)."""
from __future__ import annotations

from langgraph.graph import END, START, StateGraph

from app.askdata.settings import agent_settings
from app.askdata.nodes.analysis import analysis_node
from app.askdata.nodes.chart import chart_node
from app.askdata.nodes.executor import executor_node
from app.askdata.nodes.finalize import chitchat_node, clarify_node
from app.askdata.nodes.orchestrator import orchestrator_node
from app.askdata.nodes.planner import planner_node
from app.askdata.nodes.sql_author import sql_author_node
from app.askdata.nodes.synthesize import synthesize_node
from app.askdata.nodes.validator import validator_node
from app.askdata.nodes.verifier import verifier_node
from app.askdata.state import AgentState


def _has_rows(state: AgentState) -> bool:
    return any(s.get("rows") for s in (state.get("steps") or []))


def _answer_target(state: AgentState) -> str:
    # The Verifier now checks the data/analysis before any answer is written (see verifier.py),
    # so both paths lead to it, never straight to "synthesize".
    #
    # Analysis is skipped when no rows came back: it reasons OVER retrieved rows, so with none
    # there is nothing to reason about. Measured on a real question that returned zero rows, it
    # still spent 146s producing prose about an empty result. Skipping cannot cost accuracy —
    # analysis of no data has no findings to lose.
    if state.get("needs_analysis") and _has_rows(state):
        return "analysis"
    return "verifier"


def _route_after_orchestrator(state: AgentState) -> str:
    route = state.get("route", "sql")
    if route == "clarify":
        return "clarify"
    if route == "chitchat":
        return "chitchat"
    # Only use the Planner/ReAct loop for genuinely multi-query questions; otherwise go straight
    # to the SQL Author (saves ~2 LLM calls on the common single-query case, no accuracy change).
    return "planner" if state.get("multi_step") else "sql_author"


def _route_after_planner(state: AgentState) -> str:
    if state.get("next_action") == "query" and state.get("query_count", 0) < agent_settings.max_queries:
        return "sql_author"
    return _answer_target(state)


def _repeated_sql(state: AgentState) -> bool:
    """True when the SQL Author re-emitted a query already tried, AFTER a Verifier rejection.

    Identical SQL returns identical data, so re-verifying it cannot produce a different verdict —
    it only burns time (72s across three laps, observed).

    Gated on verify_retry_count deliberately: a repeat following a *transient* DB error (deadlock,
    dropped connection) is a legitimate retry that may well succeed the second time, and must not
    be short-circuited.
    """
    if state.get("verify_retry_count", 0) < 1:
        return False
    tried = state.get("tried_sql") or []
    return len(tried) > 1 and tried[-1] in tried[:-1]


def _route_after_validator(state: AgentState) -> str:
    if state.get("validation_error"):
        if state.get("retry_count", 0) <= agent_settings.max_sql_retries:
            return "sql_author"
        return _answer_target(state) if state.get("steps") else "synthesize"
    # Cheapest possible exit from a loop that cannot converge — no LLM call, no DB round trip.
    if _repeated_sql(state):
        return "synthesize"
    return "executor"


def _route_after_executor(state: AgentState) -> str:
    if state.get("exec_error"):
        if state.get("retry_count", 0) <= agent_settings.max_sql_retries:
            return "sql_author"
        return _answer_target(state) if state.get("steps") else "synthesize"
    # Multi-step questions loop back through the Planner; single-query questions go straight to
    # analysis/synthesis.
    return "planner" if state.get("multi_step") else _answer_target(state)


def _route_after_verifier(state: AgentState) -> str:
    # Rejected data goes back to the SQL Author for a real fix (new SQL, new data).
    #
    # This uses its OWN budget (VERIFY_RETRIES), not the Validator/Executor's MAX_SQL_RETRIES.
    # Sharing one counter meant a couple of unrelated syntax errors earlier in the turn could
    # leave the Verifier with zero rewrites — it would reject, and be overruled immediately.
    if not state.get("verify_ok") and state.get("verify_retry_count", 0) <= agent_settings.verify_retries:
        return "sql_author"
    return "synthesize"


def _route_after_synthesize(state: AgentState) -> str:
    return "chart" if state.get("wants_chart") else END


def build_graph():
    g = StateGraph(AgentState)
    g.add_node("orchestrator", orchestrator_node)
    g.add_node("planner", planner_node)
    g.add_node("sql_author", sql_author_node)
    g.add_node("validator", validator_node)
    g.add_node("executor", executor_node)
    g.add_node("analysis", analysis_node)
    g.add_node("synthesize", synthesize_node)
    g.add_node("verifier", verifier_node)
    g.add_node("chart", chart_node)
    g.add_node("clarify", clarify_node)
    g.add_node("chitchat", chitchat_node)

    g.add_edge(START, "orchestrator")
    g.add_conditional_edges(
        "orchestrator",
        _route_after_orchestrator,
        {"clarify": "clarify", "chitchat": "chitchat", "planner": "planner", "sql_author": "sql_author"},
    )
    g.add_conditional_edges(
        "planner",
        _route_after_planner,
        {"sql_author": "sql_author", "analysis": "analysis", "verifier": "verifier"},
    )
    g.add_edge("sql_author", "validator")
    g.add_conditional_edges(
        "validator",
        _route_after_validator,
        {
            "sql_author": "sql_author",
            "executor": "executor",
            "analysis": "analysis",
            "verifier": "verifier",
            "synthesize": "synthesize",
        },
    )
    g.add_conditional_edges(
        "executor",
        _route_after_executor,
        {
            "sql_author": "sql_author",
            "planner": "planner",
            "analysis": "analysis",
            "verifier": "verifier",
            "synthesize": "synthesize",
        },
    )
    g.add_edge("analysis", "verifier")
    g.add_conditional_edges(
        "verifier", _route_after_verifier, {"sql_author": "sql_author", "synthesize": "synthesize"}
    )
    g.add_conditional_edges("synthesize", _route_after_synthesize, {"chart": "chart", END: END})
    g.add_edge("chart", END)
    g.add_edge("clarify", END)
    g.add_edge("chitchat", END)
    return g.compile()

