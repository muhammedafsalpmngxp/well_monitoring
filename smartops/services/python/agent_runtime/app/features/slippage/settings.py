"""The Slippage settings of one request (Settings > AI Settings > Slippage).

The Tenant API sends every key with every request; the runtime has no default of its own, so a missing or invalid
key stops the request with a message naming it. Limits, the advisor's model tuning, the status vocabularies the
advisor logic relies on and the contractual milestones all live here, not in code.
"""
from __future__ import annotations

import re
from typing import Any, NamedTuple

from pydantic import ConfigDict, Field, ValidationError, field_validator

from app.features.slippage.errors import BadRequest
from app.models import _Camel

_PREFIX = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_WHERE = "An admin can fix this under Settings > AI Settings > Slippage."


class Milestone(NamedTuple):
    """One contractual milestone: the well slippage query returns <prefix>_deadline, _actual, _status and
    _variance_days for it."""
    prefix: str
    label: str
    owner: str


def _text() -> Any:
    return Field(min_length=1)


class SlippageSettings(_Camel):
    model_config = ConfigDict(str_strip_whitespace=True)

    # Advisor: how much evidence the model sees, and how long an answer is reused.
    max_related: int = Field(ge=0)
    max_candidates: int = Field(ge=0)
    max_urgent: int = Field(ge=0)
    max_groups: int = Field(ge=0)
    max_type_candidates: int = Field(ge=0)
    max_assigned: int = Field(ge=0)
    advice_cache_ttl_seconds: int = Field(ge=0)
    advice_cache_size: int = Field(ge=0)

    # Queries
    query_max_rows: int = Field(ge=1)
    query_timeout_seconds: int = Field(ge=1)
    well_id_max_length: int = Field(ge=1)
    task_code_max_length: int = Field(ge=1)

    # AI (blank effort / verbosity: not sent, the provider's default)
    advisor_temperature: float = Field(ge=0)
    advisor_reasoning_effort: str
    advisor_verbosity: str

    # Vocabulary: the values the verified queries report in
    risk_red: str = _text()
    risk_amber_prefix: str = _text()
    risk_amber_start_slipping: str = _text()
    risk_amber_start_delayed: str = _text()
    risk_green: str = _text()
    start_statuses: list[str] = Field(min_length=1)
    end_statuses: list[str] = Field(min_length=1)
    execution_statuses: list[str] = Field(min_length=1)
    end_due_today: str = _text()
    exec_not_started_late: str = _text()
    exec_in_progress: str = _text()
    exec_completed: str = _text()
    crew_available: str = _text()
    crew_busy: str = _text()
    milestones: list[str] = Field(min_length=1)

    @field_validator("advisor_reasoning_effort", "advisor_verbosity")
    @classmethod
    def _lower(cls, value: str) -> str:
        return value.lower()

    @field_validator("start_statuses", "end_statuses", "execution_statuses", "milestones")
    @classmethod
    def _no_blank_items(cls, value: list[str]) -> list[str]:
        items = [v.strip() for v in value]
        if any(not v for v in items):
            raise ValueError("an entry is blank")
        return items

    @field_validator("milestones")
    @classmethod
    def _milestone_format(cls, value: list[str]) -> list[str]:
        for entry in value:
            parts = [p.strip() for p in entry.split("|")]
            if len(parts) != 3 or not all(parts):
                raise ValueError(f"'{entry}' is not 'column prefix|label|owner'")
            if not _PREFIX.match(parts[0]):
                raise ValueError(f"'{parts[0]}' is not a column prefix (letters, digits and _)")
        return value

    @property
    def milestone_list(self) -> list[Milestone]:
        return [Milestone(*(p.strip() for p in entry.split("|"))) for entry in self.milestones]

    def answer_affecting(self) -> dict[str, Any]:
        """The settings an advisor answer depends on (evidence limits, vocabulary, model tuning): part of its
        fingerprint, so changing one is never answered from an answer reasoned under the old value."""
        return self.model_dump(by_alias=True, exclude={"advice_cache_ttl_seconds", "advice_cache_size",
                                                       "query_timeout_seconds", "well_id_max_length",
                                                       "task_code_max_length"})


def load(raw: dict[str, Any] | None) -> SlippageSettings:
    """The request's settings, or BadRequest naming every missing / invalid key."""
    try:
        return SlippageSettings.model_validate(raw or {})
    except ValidationError as exc:
        problems = []
        for err in exc.errors():
            name = str(err["loc"][0]) if err.get("loc") else "?"
            if err.get("type") == "missing":
                problems.append(f"'{name}' is missing")
            else:
                problems.append(f"'{name}' is not valid ({err.get('msg', 'invalid value')})")
        raise BadRequest("Slippage settings: " + "; ".join(problems[:8]) + ". " + _WHERE) from None
