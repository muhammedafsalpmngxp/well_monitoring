"""The Crew Management brief's texts: every word the model is sent comes from the tenant's crew.* prompts
(core.AiPrompt, AI Settings > AI Prompts), filled here in one pass ({UPPER_CASE} placeholders, app.prompt_text.fill).

  rules           the crew rules: the authoritative meaning of every field of the evidence ({RULES})
  brief_task      what the brief must contain and its format ({TASK})
  brief_system    the system message: {RULES} {TASK}
  brief_message   the user message: {EVIDENCE} (the well's crew plan as JSON)
"""
from __future__ import annotations

from app.features.common.context import current
from app.prompt_text import PromptMissing, fill, missing

PREFIX = "crew."
NAMES = ("rules", "brief_task", "brief_system", "brief_message")
KEYS = tuple(PREFIX + n for n in NAMES)


def require() -> None:
    """Every brief prompt is configured (raises PromptMissing naming the first that is not)."""
    absent = missing(current().request.prompts, KEYS)
    if absent:
        raise PromptMissing(absent[0])


def text(name: str) -> str:
    return current().prompt(PREFIX + name)


def system() -> str:
    return fill(text("brief_system"), RULES=text("rules"), TASK=text("brief_task"))


def message(evidence: str) -> str:
    return fill(text("brief_message"), EVIDENCE=evidence)
