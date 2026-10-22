# Ported from twise-agentic db_assistant/src/agent/sub_agents/deep/nodes/sql_author.py (team repo); see app/askdata/README.md.
"""SQL Author agent — writes one read-only T-SQL SELECT for the current sub-question."""
from __future__ import annotations

import re

from app.askdata.nodes._common import history_for
from app.askdata.prompts import current_prompts, msg
from app.askdata.state import AgentState
from app.askdata.llm import chat
from app.askdata.log import get_agent_logger
from app.askdata.common.text import extract_sql
from app.askdata.settings import current_run
from app.askdata.tools import knowledge, value_match

log = get_agent_logger("db_assistant")

_WS = re.compile(r"\s+")


def normalize_sql(sql: str) -> str:
    """Whitespace/case-insensitive form, for recognising a query we have already run.

    Only used to detect repeats — never to alter what is executed. Collapse whitespace BEFORE
    trimming the trailing semicolon, otherwise "SELECT 1 ;" keeps a trailing space and compares
    unequal to "SELECT 1".
    """
    return _WS.sub(" ", (sql or "")).strip().rstrip(";").strip().lower()


def _already_gathered(steps: list[dict]) -> str:
    if not steps:
        return ""
    done = "; ".join(f"'{s.get('sub_question','')}'" for s in steps)
    return "\n" + msg("sql_already", DONE=done) + "\n"


def sql_author_node(state: AgentState) -> dict:
    target = state.get("sub_question") or state["question"]
    matches = state.get("value_matches") or value_match.awaited(current_run().value_matches)[0]
    settings = current_run().settings
    terms = knowledge.definitions(f"{state['question']} {target}", settings)
    learned = knowledge.examples_block(state["question"], settings.examples)
    parts = [
        msg("sql_schema"),
        state.get("schema", ""),
        "",
        history_for(state),
        _already_gathered(state.get("steps", [])),
        "\n" + learned if learned else "",
        "\n" + terms if terms else "",
        "\n" + matches if matches else "",
        msg("sql_request", TARGET=target),
    ]
    # Carry the orchestrator's plan (data needed + requested result size) on the single-query path.
    if not state.get("sub_question") and state.get("plan"):
        parts.append(msg("sql_plan", PLAN=state["plan"]))
    # A chart needs a breakdown to plot; a scalar cannot be charted.
    if state.get("wants_chart"):
        # A donut/pie can only show ONE metric's share per slice. "one or more" numeric columns
        # is correct for a bar chart but was letting the model add a helpful extra column (e.g. a
        # computed percentage) for a donut request — which then forces a downgrade to a bar chart,
        # since two numeric columns can't both be plotted as one ring.
        numeric_rule = msg("sql_chart_numeric_donut" if state.get("chart_type") == "donut" else "sql_chart_numeric")
        parts.append("\n" + msg("sql_chart", NUMERIC_RULE=numeric_rule))
    if state.get("validation_error"):
        parts.append("\n" + msg("sql_retry_validator", ERROR=state["validation_error"]))
    if state.get("exec_error"):
        parts.append("\n" + msg("sql_retry_exec", ERROR=state["exec_error"]))
    if state.get("verify_feedback"):
        # Show the exact SQL being criticised. Without it the writer had to infer which query the
        # feedback referred to, and frequently re-emitted the same one.
        previous = state.get("sql", "")
        shown = "\n\n" + msg("sql_retry_verifier_previous", SQL=previous) if previous else ""
        parts.append("\n" + msg("sql_retry_verifier", PREVIOUS=shown, FEEDBACK=state["verify_feedback"]))
    if state.get("tried_sql"):
        parts.append("\n" + msg("sql_tried", COUNT=len(state["tried_sql"])))
    parts.append("\n" + msg("sql_final"))

    # Normal mode writes SQL on the cheap tier: measured 8/8 identical results on simple questions
    # at ~1.2s vs ~4.2s. Any other mode (including unset) keeps the main model exactly as before.
    sql = extract_sql(
        chat(
            current_prompts().SQL_AUTHOR_SYSTEM,
            "\n".join(p for p in parts if p),
            temperature=0.0,
            fast=state.get("mode") == "normal",
        )
    )
    log.info("SQL[q%d try%d]: %s", state.get("query_count", 0) + 1, state.get("retry_count", 0), sql.replace("\n", " "))
    # `verify_feedback` is deliberately NOT cleared here. It is the Verifier's semantic
    # instruction, and it stays valid until the Verifier next rules on the rewrite. Clearing it
    # at this point dropped it the moment the rewrite tripped the validator or the database: the
    # NEXT attempt then saw only the syntax error, lost the reason the query was rejected, and
    # was free to drift back to the SQL that had already been rejected. The Verifier clears it
    # itself once it has judged the new query.
    return {
        "sql": sql,
        "validation_error": "",
        "exec_error": "",
        "tried_sql": state.get("tried_sql", []) + [normalize_sql(sql)],
    }
