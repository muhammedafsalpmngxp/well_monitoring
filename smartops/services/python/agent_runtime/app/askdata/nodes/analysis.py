# Ported from twise-agentic db_assistant/src/agent/sub_agents/deep/nodes/analysis.py (team repo); see app/askdata/README.md.
"""Analysis agent — LLM analyzes the retrieved data (calculations, predictions, trends)."""
from __future__ import annotations

from app.askdata.settings import agent_settings
from app.askdata.nodes._common import history_for, render_steps
from app.askdata.prompts import current_prompts, msg
from app.askdata.state import AgentState
from app.askdata.llm import chat
from app.askdata.log import get_agent_logger
from app.askdata.common.text import strip_think

log = get_agent_logger("db_assistant")


def analysis_node(state: AgentState) -> dict:
    data = render_steps(state.get("steps"), max_rows=agent_settings.max_rows)
    # History resolves follow-ups ("and for the other cluster?") that would otherwise be analysed as if they were
    # standalone questions.
    user = msg("analysis", HISTORY=history_for(state), QUESTION=state["question"], DATA=data)
    log.info("analysis over %d step(s)", len(state.get("steps", [])))
    return {"analysis": strip_think(chat(current_prompts().ANALYSIS_SYSTEM, user, temperature=0.2))}
