# Ported from twise-agentic db_assistant/src/agent/sub_agents/deep/nodes/planner.py (team repo); see app/askdata/README.md.
"""Planner agent — the ReAct controller: decide whether to run another query or answer."""
from __future__ import annotations

from typing import Any

from app.askdata.settings import agent_settings
from app.askdata.nodes._common import history_for
from app.askdata.prompts import current_prompts, msg
from app.askdata.state import AgentState
from app.askdata.llm import chat
from app.askdata.log import get_agent_logger
from app.askdata.common.text import extract_json

log = get_agent_logger("db_assistant")

# Preview caps. The Planner has to judge whether the right data came back, which row/column
# COUNTS alone cannot tell it — but a result can hold MAX_ROWS rows, so the sample is hard-capped
# rather than sized by the result. The rows are already in state; nothing extra is fetched.
PREVIEW_ROWS = 3
PREVIEW_COLS = 8
PREVIEW_CELL = 30


def _cell(value: Any) -> str:
    text = "" if value is None else " ".join(str(value).split())
    return text if len(text) <= PREVIEW_CELL else text[: PREVIEW_CELL - 3] + "..."


def _gathered_summary(steps: list[dict]) -> str:
    if not steps:
        return msg("planner_nothing")
    lines: list[str] = []
    for i, s in enumerate(steps, 1):
        columns = list(s.get("columns") or [])
        rows = list(s.get("rows") or [])
        # The true size stays on its own line — the sample below must never stand in for it.
        lines.append(msg("planner_step", N=i, QUESTION=s.get("sub_question", ""), ROWS=len(rows), COLS=len(columns)))
        if not columns:
            continue
        shown = columns[:PREVIEW_COLS]
        extra = " " + msg("planner_columns_extra", COUNT=len(columns) - len(shown)) if len(columns) > len(shown) else ""
        lines.append("   " + msg("planner_columns", COLUMNS=", ".join(str(c) for c in shown), EXTRA=extra))
        for row in rows[:PREVIEW_ROWS]:
            lines.append("   " + msg("planner_sample", VALUES=" | ".join(_cell(v) for v in list(row)[:PREVIEW_COLS])))
        if len(rows) > PREVIEW_ROWS:
            lines.append("   " + msg("planner_more_rows", COUNT=len(rows) - PREVIEW_ROWS))
    return "\n".join(lines)


def planner_node(state: AgentState) -> dict:
    steps = state.get("steps", [])

    # Must gather at least once before answering.
    if not steps:
        log.info("planner: first query")
        return {
            "next_action": "query",
            "sub_question": state.get("plan") or state["question"],
            "retry_count": 0,
            "validation_error": "",
            "exec_error": "",
            # A new sub-question starts clean, exactly like the two error fields above. The SQL
            # Author no longer clears this itself (it must survive a failed rewrite of the SAME
            # query), so without this a rejection on the PREVIOUS sub-question would be shown as
            # criticism of a query that no longer exists.
            "verify_feedback": "",
        }

    user = msg("planner", HISTORY=history_for(state), QUESTION=state["question"], GATHERED=_gathered_summary(steps),
               COUNT=state.get("query_count", 0), MAX=agent_settings.max_queries)
    data = extract_json(chat(current_prompts().PLANNER_SYSTEM, user, temperature=0.0, fast=True), default={"action": "answer"})
    action = str(data.get("action", "answer")).lower()

    if action == "query" and state.get("query_count", 0) < agent_settings.max_queries:
        sub_q = str(data.get("sub_question") or state["question"])
        log.info("planner: another query -> %s", sub_q)
        return {
            "next_action": "query",
            "sub_question": sub_q,
            "retry_count": 0,
            "validation_error": "",
            "exec_error": "",
            "verify_feedback": "",  # new sub-question starts clean — see the note above
        }
    log.info("planner: answer")
    return {"next_action": "answer"}
