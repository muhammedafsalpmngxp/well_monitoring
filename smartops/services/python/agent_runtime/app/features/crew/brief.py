"""The crew brief: one model call that narrates the deterministic crew plan of one well (engine.build_well).

The model receives the crew rules and the task as the system message and the plan as JSON evidence. It never picks a
crew: the ranked recommendations are already in the evidence. After the call every crew id and every code-like token
in the brief is checked against the evidence, and any the model was not given is returned as
``unverified_references`` so the page can warn about it. A provider failure does not fail the request: the plan is
returned with ``brief_error``.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any

from app.features.common import llm
from app.features.crew import prompts
from app.features.crew.settings import CrewSettings

log = logging.getLogger("agent_runtime.crew")

# Fields the model does not need: task_code is an internal key (activities are named by description / code), the rest
# are internal ids. crew_id is KEPT - it is how every crew is named.
_DROP_KEYS = {"task_code", "progress", "crew_type_id", "supervisor_id", "project_id", "stale_record_days"}

# A crew id as the brief writes it: "Crew 10293", "crew_id 10293", "crew id: 10293".
_CREW_ID_TOKEN = re.compile(r"\bcrew(?:[ _]?id)?\s*[:#]?\s*(\d+)\b", re.IGNORECASE)
# An activity / crew-type-like code: three or more segments joined by '-' or '_', with a digit.
_CODE_TOKEN = re.compile(r"\b[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+){2,}\b")
_DATE_TOKEN = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _slim(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _slim(v) for k, v in value.items() if k not in _DROP_KEYS}
    if isinstance(value, list):
        return [_slim(v) for v in value]
    return value


def _strings(value: Any, out: set) -> set:
    if isinstance(value, dict):
        for v in value.values():
            _strings(v, out)
    elif isinstance(value, list):
        for v in value:
            _strings(v, out)
    elif isinstance(value, str):
        out.add(value)
    return out


def _crew_ids(value: Any, out: set) -> set:
    if isinstance(value, dict):
        for k, v in value.items():
            if k == "crew_id" and v is not None:
                out.add(str(v))
            else:
                _crew_ids(v, out)
    elif isinstance(value, list):
        for v in value:
            _crew_ids(v, out)
    return out


def unverified_references(brief: str, plan: dict) -> list[str]:
    """Crew ids and code-like tokens in the brief that appear nowhere in the evidence."""
    known_crews = _crew_ids(plan, set())
    known = _strings(plan, set())
    found: list[str] = []
    for crew_id in _CREW_ID_TOKEN.findall(brief or ""):
        label = f"crew {crew_id}"
        if crew_id not in known_crews and label not in found:
            found.append(label)
    for token in _CODE_TOKEN.findall(brief or ""):
        if not any(ch.isdigit() for ch in token):
            continue
        if _DATE_TOKEN.match(token) or token in known or token in found:
            continue
        found.append(token)
    return found


def write(plan: dict, cfg: CrewSettings) -> dict[str, Any]:
    """{brief, brief_error, unverified_references}. Raises AiUnavailable (no provider) and PromptMissing; any other
    provider failure becomes brief_error so the plan is still shown."""
    prompts.require()
    if not llm.available():
        raise llm.AiUnavailable("No AI provider is active for this tenant. An admin can add one under "
                                "Settings > AI Providers.")
    evidence = json.dumps(_slim(plan), indent=2, default=str, ensure_ascii=False)
    try:
        reply = llm.chat(prompts.system(), prompts.message(evidence), agent="brief",
                         temperature=cfg.brief_temperature, effort=cfg.brief_reasoning_effort,
                         verbosity=cfg.brief_verbosity, max_tokens=cfg.brief_max_tokens)
    except llm.AiUnavailable:
        raise
    except Exception:                                   # noqa: BLE001 - provider errors vary; never fail the plan
        log.warning("crew brief: the AI provider failed", exc_info=True)
        return {"brief": None, "unverified_references": [],
                "brief_error": "The AI provider could not write the brief. Try again in a moment."}
    brief = (reply or "").strip()
    if not brief:
        return {"brief": None, "unverified_references": [], "brief_error": "The AI returned an empty brief. Try again."}
    return {"brief": brief, "brief_error": None, "unverified_references": unverified_references(brief, plan)}
