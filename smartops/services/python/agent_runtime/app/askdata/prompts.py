"""The Ask Data prompts for ONE run (twise db_assistant/src/prompts/system_prompts.py, per agent).

Every text comes from the run's prompt texts (`AskDataRun.texts`), which the Tenant API sends from the tenant's
database (core.AiSettings.prompts_json, Settings > AI Prompts):

  askdata.<name>       the node system prompts and their shared parts (platform_preamble, answer_rules,
                       sql_knowledge, sql_rules, <node>_system), plus business_rules and few_shots
  askdata.msg.<name>   the instructions each node adds to its message (retry notes, chart rules, labels)

Composition is unchanged: the MAX_ROWS substitution and the business-rules / few-shots injection. An agent's own
Knowledge Source replaces business_rules / few_shots for that agent. {{ORG_NAME}} in a prompt is ASKDATA_ORG_NAME.
The SQL safety checks are code (nodes/validator.py, tools/access.py), not prompts, so no edit can weaken them.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Mapping

from app.askdata.settings import current_run
from app.prompt_text import fill, text

ORG_NAME = os.environ.get("ASKDATA_ORG_NAME", "Al-Tasnim")

SYSTEM_NAMES = ("platform_preamble", "answer_rules", "sql_knowledge", "sql_rules", "orchestrator_system",
                "planner_system", "sql_author_system", "analysis_system", "synthesize_system", "verifier_system",
                "chitchat_system")
KNOWLEDGE_NAMES = ("business_rules", "few_shots")
MESSAGE_NAMES = (
    "history_header", "history_user", "history_assistant", "step_header", "step_block", "step_truncated", "no_data",
    "table_no_columns", "table_no_rows", "table_more",
    "orchestrator", "planner", "planner_nothing", "planner_step", "planner_columns", "planner_columns_extra",
    "planner_sample", "planner_more_rows", "sql_schema", "sql_already", "sql_request", "sql_plan", "sql_chart",
    "sql_chart_numeric_donut", "sql_chart_numeric", "sql_retry_validator", "sql_retry_exec", "sql_retry_verifier",
    "sql_retry_verifier_previous", "sql_tried", "sql_final", "analysis", "verifier_schema", "verifier_question",
    "verifier_data", "verifier_analysis", "verifier_concerns", "verifier_concern", "verifier_final",
    "verifier_unreadable", "synth_no_data", "synth_no_data_error", "synth_question", "synth_data", "synth_analysis",
    "synth_unverified", "synth_final", "chitchat", "chitchat_entities",
)
# Every key one Ask Data run needs; checked before the run starts.
KEYS = (tuple(f"askdata.{n}" for n in SYSTEM_NAMES + KNOWLEDGE_NAMES)
        + tuple(f"askdata.msg.{n}" for n in MESSAGE_NAMES))


def _load(texts: Mapping[str, str], name: str) -> str:
    return text(texts, f"askdata.{name}").replace("{{ORG_NAME}}", ORG_NAME)   # a placeholder no column can match


def knowledge(texts: Mapping[str, str], name: str, own: str | None) -> str:
    """The agent's own business_rules / few_shots when it set them, else the tenant's."""
    return own if own else text(texts, f"askdata.{name}")


@dataclass(frozen=True)
class PromptSet:
    ORCHESTRATOR_SYSTEM: str
    PLANNER_SYSTEM: str
    SQL_AUTHOR_SYSTEM: str
    ANALYSIS_SYSTEM: str
    SYNTHESIZE_SYSTEM: str
    VERIFIER_SYSTEM: str
    CHITCHAT_SYSTEM: str

    def label(self, system: str) -> str:
        """Which node a call is for, by prompt identity (as twise's llm_client does)."""
        for name, value in self.__dict__.items():
            if value is system:
                return name.removesuffix("_SYSTEM").lower()
        return "agent"


def build_prompts(max_rows: int, business_rules: str, few_shots: str, texts: Mapping[str, str]) -> PromptSet:
    def limits(t: str) -> str:
        return t.replace("MAX_ROWS", str(max_rows))

    preamble = _load(texts, "platform_preamble")
    answer_rules = _load(texts, "answer_rules")
    answer_tail = f"{answer_rules}\n\n{business_rules}" if business_rules else answer_rules

    sql_author = _load(texts, "sql_author_system")
    for slot, value in (("{PLATFORM_PREAMBLE}", preamble), ("{SQL_KNOWLEDGE}", limits(_load(texts, "sql_knowledge"))),
                        ("{BUSINESS_RULES}", business_rules), ("{SQL_RULES}", _load(texts, "sql_rules")),
                        ("{FEW_SHOTS}", few_shots)):
        sql_author = sql_author.replace(slot, value)

    return PromptSet(
        ORCHESTRATOR_SYSTEM=preamble + "\n\n" + _load(texts, "orchestrator_system"),
        PLANNER_SYSTEM=_load(texts, "planner_system"),
        SQL_AUTHOR_SYSTEM=sql_author.strip(),
        ANALYSIS_SYSTEM=preamble + "\n\n" + _load(texts, "analysis_system") + "\n\n" + answer_tail,
        SYNTHESIZE_SYSTEM=preamble + "\n\n" + _load(texts, "synthesize_system") + "\n\n" + answer_tail,
        VERIFIER_SYSTEM=limits(preamble + "\n\n" + _load(texts, "verifier_system") + "\n\n" + answer_tail),
        CHITCHAT_SYSTEM=_load(texts, "chitchat_system"),
    )


def current_prompts() -> PromptSet:
    return current_run().prompts


def msg(name: str, **values: object) -> str:
    """A node's message template askdata.msg.<name>, with its placeholders filled."""
    return fill(text(current_run().texts, f"askdata.msg.{name}"), **values)
