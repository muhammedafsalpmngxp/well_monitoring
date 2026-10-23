# Ported from twise-agentic db_assistant/src/agent/sub_agents/deep/nodes/_common.py (team repo); see app/askdata/README.md.
"""Small formatting helpers shared by nodes."""
from __future__ import annotations

from typing import Any

from app.askdata.prompts import msg
from app.askdata.state import AgentState
from app.askdata.settings import agent_settings
from app.askdata.common.text import rows_to_markdown  # noqa: F401 - shared; re-exported for the nodes


# A turn's rejections are kept for the record (core.AiTraces.rejections_json), bounded so a runaway retry loop or a
# huge query cannot bloat the answer the Tenant API stores.
MAX_REJECTIONS = 20
_REJECTION_SQL_MAX = 8000
_REJECTION_REASON_MAX = 2000


def with_rejection(state: AgentState, stage: str, reason: str, sqls: list[str] | None = None) -> list[dict[str, Any]]:
    """The turn's rejections plus this one: ``stage`` is verifier (the figures were judged not to answer the question),
    validator (the SQL checker refused it before it ran) or database (SQL Server error); one entry per query refused."""
    sub_question = state.get("sub_question") or state.get("question", "")
    added = [{"stage": stage, "sql": (sql or "")[:_REJECTION_SQL_MAX], "reason": (reason or "")[:_REJECTION_REASON_MAX],
              "sub_question": sub_question}
             for sql in (sqls if sqls else [state.get("sql", "")])]
    return (list(state.get("rejections") or []) + added)[:MAX_REJECTIONS]


def format_history(history: list[dict[str, str]] | None, max_turns: int | None = None) -> str:
    """Render the last few turns for multi-turn context (e.g. 'now group by month').

    max_turns defaults to agent_settings.history_turns (HISTORY_TURNS in .env). It used to be a hardcoded
    3 that silently overrode the API's own MAX_HISTORY_TURNS=6, so raising that constant had no
    effect — the tighter of the two always won. One setting now governs the whole chain.
    """
    if not history:
        return ""
    limit = agent_settings.history_turns if max_turns is None else max_turns
    recent = history[-limit:] if limit > 0 else []
    if not recent:
        return ""
    lines = [msg("history_header")]
    for turn in recent:
        u = turn.get("user", "").strip()
        a = turn.get("assistant", "").strip()
        if u:
            lines.append(msg("history_user", TEXT=u))
        if a:
            lines.append(msg("history_assistant", TEXT=a))
    lines.append("")
    return "\n".join(lines)


def history_for(state: AgentState) -> str:
    """The transcript for a DOWNSTREAM agent - empty unless this turn is a follow-up.

    Most questions stand on their own, and for those the transcript is dead weight in five
    prompts - two of which (sql_author, verifier) also carry the whole schema block and run on
    the MAIN model tier. Gating on the Orchestrator's is_followup flag keeps history where it
    earns its cost and drops it everywhere else.

    The Orchestrator must NOT use this: it calls format_history() directly, because it is the
    node that MAKES this decision and has to read the transcript to make it.

    Fails OPEN by construction - orchestrator_node defaults the flag to True, so an absent or
    unparseable verdict behaves exactly as it did before this gate existed.
    """
    if not state.get("is_followup"):
        return ""
    return format_history(state.get("history"))


# rows_to_markdown moved to twise_common/utils/text.py (identical implementation, shared by every agent).


def answer_steps(state: dict[str, Any]) -> list[dict[str, Any]]:
    """The query steps the answer was written from — the ONE rule for which data a user is shown.

    Verified: `steps` only. A step the Verifier rejected and the SQL Author then fixed was
    superseded; showing it would put data known to be wrong beside an answer that is right.
    Unverified: `steps + rejected_steps`, since the (flagged) answer was written from all of it.

    The synthesizer, the chart, the response's data table and the export token all take their
    data from here, so they cannot disagree with each other.
    """
    steps = list(state.get("steps") or [])
    if state.get("verify_ok", True):
        return steps
    return steps + list(state.get("rejected_steps") or [])


def render_steps(steps: list[dict[str, Any]] | None, max_rows: int = 200) -> str:
    """Render every gathered query step (SQL + its data) for the analyst/synthesizer.

    Includes an explicit truncation warning so the LLM never treats a capped sample as the
    whole picture.
    """
    if not steps:
        return msg("no_data")
    blocks: list[str] = []
    for i, step in enumerate(steps, 1):
        header = msg("step_header", N=i, QUESTION=step.get("sub_question", "")).rstrip()
        sql = step.get("sql", "")
        table = rows_to_markdown(step.get("columns", []), step.get("rows", []), max_rows=max_rows)
        warn = "\n\n" + msg("step_truncated") if step.get("truncated") else ""
        blocks.append(msg("step_block", HEADER=header, SQL=sql, TABLE=table, WARNING=warn))
    return "\n\n".join(blocks)
