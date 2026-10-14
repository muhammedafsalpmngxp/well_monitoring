"""The Slippage advisor's texts: every word the model is sent comes from the tenant's slippage.* prompts
(core.AiPrompt, AI Settings > AI Prompts), filled here in one pass ({UPPER_CASE} placeholders, app.prompt_text.fill).

  business_rules, scenarios, task_glossary   the grounding documents ({RISK_RED}, {END_STATUSES}, ... in the
                                             glossary come from the vocabulary settings)
  advisor_grounding                          {BUSINESS_RULES} {SCENARIOS} {TASK_GLOSSARY}, shared by both systems
  advisor_task_system, advisor_well_system   the two system prompts ({GROUNDING})
  advisor_task_message, advisor_well_message the user messages, filled with the evidence as JSON lines
  msg_*                                      the variable parts of those messages
  note_*                                     evidence notes (also shown on the page beside the answer)

Layout rule of the messages: an empty optional block ({NOTE}) leaves no extra blank line (three or more newlines
are folded into one blank line), so the filled message equals what the original advisor sent.
"""
from __future__ import annotations

import json
import re
from typing import Any

from app.features.common.context import current
from app.features.common.text import fill
from app.features.slippage.settings import SlippageSettings
from app.prompt_text import PromptMissing, missing

PREFIX = "slippage."
NAMES = (
    "business_rules", "scenarios", "task_glossary", "advisor_grounding",
    "advisor_task_system", "advisor_well_system", "advisor_task_message", "advisor_well_message",
    "msg_task_milestones_listed", "msg_task_milestones_not_listed", "msg_task_milestones_unknown",
    "msg_well_milestones_listed", "msg_well_milestones_not_listed", "msg_well_milestones_unknown",
    "msg_note", "msg_none", "msg_no_late_tasks", "msg_assigned_crew_missing",
    "note_milestones_unavailable", "note_task_no_crew_columns", "note_crews_unavailable", "note_task_no_crew_type",
    "note_no_crew_of_type", "note_well_no_crew_columns",
)
KEYS = tuple(PREFIX + n for n in NAMES)

_BLANK_RUN = re.compile(r"\n{3,}")


def require() -> None:
    """Every advisor prompt is configured (raises PromptMissing naming the first that is not)."""
    absent = missing(current().request.prompts, KEYS)
    if absent:
        raise PromptMissing(absent[0])


def text(name: str) -> str:
    return current().prompt(PREFIX + name)


def texts() -> dict[str, str]:
    """Every advisor prompt text, for an answer's fingerprint."""
    return {name: text(name) for name in NAMES}


def _lines(rows: list[dict]) -> str:
    return "\n".join(json.dumps(r, ensure_ascii=False, default=str) for r in rows)


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, default=str)


def _layout(message: str) -> str:
    return _BLANK_RUN.sub("\n\n", message)


# -- System prompts ---------------------------------------------------------------------------------------------


def grounding(cfg: SlippageSettings) -> str:
    glossary = fill(
        text("task_glossary"),
        RISK_RED=cfg.risk_red, RISK_AMBER_START_SLIPPING=cfg.risk_amber_start_slipping,
        RISK_AMBER_START_DELAYED=cfg.risk_amber_start_delayed, RISK_GREEN=cfg.risk_green,
        END_STATUSES=" | ".join(cfg.end_statuses), START_STATUSES=" | ".join(cfg.start_statuses),
        EXECUTION_STATUSES=" | ".join(cfg.execution_statuses),
        CREW_AVAILABLE=cfg.crew_available, CREW_BUSY=cfg.crew_busy,
    )
    return fill(text("advisor_grounding"), BUSINESS_RULES=text("business_rules"), SCENARIOS=text("scenarios"),
                TASK_GLOSSARY=glossary)


def task_system(cfg: SlippageSettings) -> str:
    return fill(text("advisor_task_system"), GROUNDING=grounding(cfg))


def well_system(cfg: SlippageSettings) -> str:
    return fill(text("advisor_well_system"), GROUNDING=grounding(cfg))


# -- User messages ----------------------------------------------------------------------------------------------


def _milestones(level: str, well: dict) -> str:
    """The milestone block: listed (with its milestones), not listed (none failed), or unknown (not measured)."""
    if well["listed"] is True:
        return fill(text(f"msg_{level}_milestones_listed"), HEADLINE=str(well["headline"]),
                    MILESTONE_LINES=_lines(well["milestones"]))
    if well["listed"] is False:
        return text(f"msg_{level}_milestones_not_listed")
    return fill(text(f"msg_{level}_milestones_unknown"), NOTE=str(well["note"]))


def _note(note: str | None) -> str:
    return fill(text("msg_note"), NOTE=note) if note else ""


def task_message(well_id: str, evidence: dict) -> str:
    well, crew = evidence["well"], evidence["crew"]
    none = text("msg_none")
    return _layout(fill(
        text("advisor_task_message"),
        WELL_ID=well_id,
        TASK=_json(evidence["task"]),
        EARLIER_LATE_TASKS=_lines(evidence["earlier_late_tasks"]) or none,
        SAME_WBS_LATE_TASKS=_lines(evidence["same_wbs_late_tasks"]) or none,
        MILESTONES=_milestones("task", well),
        ASSIGNED_CREW_ID=str(crew["assigned_crew_id"]),
        ASSIGNED_CREW=_json(crew["assigned"]) if crew["assigned"] else text("msg_assigned_crew_missing"),
        CREW_TYPE_ID=str(crew["crew_type_id"]),
        AVAILABLE_COUNT=str(crew["available_count"]),
        BUSY_COUNT=str(crew["busy_count"]),
        TYPE_TOTAL=str(crew["type_total"]),
        AVAILABLE_CREWS=_lines(crew["available"]) or none,
        NOTE=_note(crew["note"]),
    ))


def well_message(well_id: str, evidence: dict) -> str:
    no_late = text("msg_no_late_tasks")
    return _layout(fill(
        text("advisor_well_message"),
        WELL_ID=well_id,
        MILESTONES=_milestones("well", evidence["well"]),
        TASK_TALLY=json.dumps(evidence["tasks"]),
        LATE_BY_WBS=_lines(evidence["late_by_wbs"]) or no_late,
        LATE_BY_CREW_TYPE=_lines(evidence["late_by_crew_type"]) or no_late,
        MOST_URGENT=_lines(evidence["most_urgent"]) or text("msg_none"),
        NOTE=_note(evidence["crew_note"]),
    ))
