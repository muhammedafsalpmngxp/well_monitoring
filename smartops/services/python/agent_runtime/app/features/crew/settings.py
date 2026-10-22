"""The Crew Management settings of one request (AI Settings > Ask Data & Features > Crew Management).

The Tenant API sends every key with every request; the runtime has no default of its own, so a missing or invalid
key stops the request with a message naming it.
"""
from __future__ import annotations

from typing import Any

from pydantic import ConfigDict, Field, ValidationError, field_validator

from app.features.crew.errors import BadRequest
from app.models import _Camel

_WHERE = "An admin can fix this under AI Settings > Ask Data & Features > Crew Management."


class CrewSettings(_Camel):
    model_config = ConfigDict(str_strip_whitespace=True)

    # Availability and ranking
    crew_recent_days: int = Field(ge=1)              # a team with no task record within this window is INACTIVE
    max_crews_per_activity: int = Field(ge=1)        # free crews recommended per delayed activity
    max_crews_per_type: int = Field(ge=1)            # free crews listed per crew type on a well's plan
    stale_record_days: int = Field(ge=1)             # older well records are flagged "as last recorded"

    # Queries
    cache_seconds: int = Field(ge=0)                 # fleet-wide results reused for this long (0 = never)
    query_max_rows: int = Field(ge=1)
    query_timeout_seconds: int = Field(ge=1)
    well_id_max_length: int = Field(ge=1)

    # AI brief (blank effort / verbosity: not sent, the provider's default)
    brief_temperature: float = Field(ge=0)
    brief_reasoning_effort: str
    brief_verbosity: str
    brief_max_tokens: int = Field(ge=1)

    @field_validator("brief_reasoning_effort", "brief_verbosity")
    @classmethod
    def _lower(cls, value: str) -> str:
        return value.lower()


def load(raw: dict[str, Any] | None) -> CrewSettings:
    """The request's settings, or BadRequest naming every missing / invalid key."""
    try:
        return CrewSettings.model_validate(raw or {})
    except ValidationError as exc:
        problems = []
        for err in exc.errors():
            name = str(err["loc"][0]) if err.get("loc") else "?"
            if err.get("type") == "missing":
                problems.append(f"'{name}' is missing")
            else:
                problems.append(f"'{name}' is not valid ({err.get('msg', 'invalid value')})")
        raise BadRequest("Crew Management settings: " + "; ".join(problems[:8]) + ". " + _WHERE) from None
