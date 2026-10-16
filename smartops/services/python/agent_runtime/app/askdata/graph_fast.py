# Ported from twise-agentic db_assistant/src/agent/sub_agents/fast/graph.py (team repo); see app/askdata/README.md.
"""Fast pipeline (Normal mode): orchestrator -> sql_author -> validator -> sqlcheck -> executor ->
synthesize -> [chart]. Built from the deep pipeline's node functions (sub_agents/deep/nodes)."""
from __future__ import annotations

from langgraph.graph import END, START, StateGraph

from app.askdata.settings import agent_settings
from app.askdata.nodes.chart import chart_node
from app.askdata.nodes.executor import executor_node
from app.askdata.nodes.finalize import chitchat_node, clarify_node
from app.askdata.nodes.orchestrator import orchestrator_node
from app.askdata.nodes.sql_author import sql_author_node
from app.askdata.nodes.synthesize import synthesize_node
from app.askdata.nodes.validator import validator_node
from app.askdata.tools.sqlcheck import log_check
from app.askdata.state import AgentState
from app.askdata.graph_deep import _route_after_synthesize


# ── Fast graph (Normal mode) ────────────────────────────────────────────────────
# A SEPARATE graph, deliberately. Adding `if mode == ...` branches inside build_graph() above
# would put mode logic in every routing function, where a mistake would change the thorough
# path's behaviour. Keeping them apart means build_graph() is provably untouched: `git diff` on
# it must show nothing, and the two graphs can be tested independently.
#
# It reuses the SAME node functions — no duplicated prompt building, so the two paths cannot
# drift apart. The nodes read state["mode"] to pick the cheap model tier.


def sqlcheck_node(state: AgentState) -> dict:
    """Normal mode's only review step: the deterministic schema-derived check.

    This runs ONLY in the fast graph, which has no Verifier. Its concerns used to be logged and
    then discarded (`return {}`), which meant the one mode that computed a risk signal was also
    the one mode that ignored it — and because a MISSING `verify_ok` is read as verified by both
    synthesize_node and the API, every Normal-mode answer was presented as verified when nothing
    had verified it.

    So the verdict is now reported. `verify_ok` is set EXPLICITLY either way, not just on failure:
    a retry that produces clean SQL has to be able to clear a flag an earlier attempt raised.
    A concern adds synthesize_node's "treat as indicative" caveat — it never blocks the answer,
    and the concern text itself is never shown to the user.
    """
    concerns = log_check(state.get("sql", ""), state.get("schema", ""), state.get("question", ""))
    return {"verify_ok": not concerns}


def _fast_route_after_orchestrator(state: AgentState) -> str:
    route = state.get("route", "sql")
    if route == "clarify":
        return "clarify"
    if route == "chitchat":
        return "chitchat"
    return "sql_author"


def _fast_route_after_validator(state: AgentState) -> str:
    # Unsafe or unparseable SQL is still retried — that guard is not a speed/accuracy trade, it
    # is what keeps the query read-only.
    if state.get("validation_error"):
        if state.get("retry_count", 0) <= agent_settings.max_sql_retries:
            return "sql_author"
        return "synthesize"
    return "executor"


def _fast_route_after_executor(state: AgentState) -> str:
    # A database error is a real failure worth one more attempt; everything else goes straight to
    # the answer. No Planner, no Analysis, no Verifier on this path.
    if state.get("exec_error") and state.get("retry_count", 0) <= agent_settings.max_sql_retries:
        return "sql_author"
    return "synthesize"


def build_fast_graph():
    """Normal mode: orchestrator -> sql_author -> validator -> executor -> synthesize -> [chart].

    Measured ~2-3s versus ~52s for the full graph. Correct on simple questions (8/8 in testing);
    weaker on complex ones, which is why the two modes are offered separately.
    """
    g = StateGraph(AgentState)
    g.add_node("orchestrator", orchestrator_node)
    g.add_node("sql_author", sql_author_node)
    g.add_node("validator", validator_node)
    g.add_node("sqlcheck", sqlcheck_node)
    g.add_node("executor", executor_node)
    g.add_node("synthesize", synthesize_node)
    g.add_node("chart", chart_node)
    g.add_node("clarify", clarify_node)
    g.add_node("chitchat", chitchat_node)

    g.add_edge(START, "orchestrator")
    g.add_conditional_edges(
        "orchestrator",
        _fast_route_after_orchestrator,
        {"clarify": "clarify", "chitchat": "chitchat", "sql_author": "sql_author"},
    )
    g.add_edge("sql_author", "validator")
    g.add_conditional_edges(
        "validator",
        _fast_route_after_validator,
        {"sql_author": "sql_author", "executor": "sqlcheck", "synthesize": "synthesize"},
    )
    g.add_edge("sqlcheck", "executor")
    g.add_conditional_edges(
        "executor",
        _fast_route_after_executor,
        {"sql_author": "sql_author", "synthesize": "synthesize"},
    )
    g.add_conditional_edges("synthesize", _route_after_synthesize, {"chart": "chart", END: END})
    g.add_edge("chart", END)
    g.add_edge("clarify", END)
    g.add_edge("chitchat", END)
    return g.compile()
