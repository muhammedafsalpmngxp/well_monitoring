"""Crew suggestion evidence for one task (ported from crew_suggestion_service.py and schemas/crew_suggestion.py).

Eligibility, history, ranking and availability are all decided in the CREW_SUGGESTION query. This only shapes its
one row and picks the plain "why no crew was suggested" reason (the tenant's dailyreport.crew_no_suggestion_reasons).
Advisory only: nothing is written, no crew is assigned.

Exactly one of ``suggested_crew`` (eligible, a candidate: a replacement candidate for a stalled task),
``consult_crew`` (in progress, a candidate: someone to ask, never a replacement) or ``no_suggestion_reason``
(eligible, no candidate) is present, or none of them (completed, or in progress with nobody to point to).
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any, Dict, Optional

from pydantic import BaseModel

from app.features.dailyreport import data
from app.features.dailyreport.validation import as_date, to_int


class CurrentCrewEvidence(BaseModel):
    crew_id: Optional[int] = None
    #: False only when no crew is recorded on the task record (never "no crew was assigned").
    recorded: bool
    crew_type: Optional[str] = None
    supervisor: Optional[str] = None


class HistoricalCrewEvidence(BaseModel):
    crew_id: int
    crew_type: Optional[str] = None
    supervisor: Optional[str] = None
    historical_completed_task_count: int
    distinct_completed_well_count: int
    completed_on_incomplete_well_count: int
    completed_on_completed_well_count: int
    #: Median duration in days ("typical"); never confused with the mean below.
    typical_completion_days: Optional[float] = None
    average_completion_days: Optional[float] = None
    shortest_completion_days: Optional[int] = None
    longest_completion_days: Optional[int] = None
    most_recent_success_date: Optional[date] = None
    evidence_strength: str
    derived_availability: str


class CrewSuggestionEvidence(BaseModel):
    eligible: bool
    suppression_reason: Optional[str] = None
    suppression_code: Optional[str] = None
    current_crew: CurrentCrewEvidence
    suggested_crew: Optional[HistoricalCrewEvidence] = None
    consult_crew: Optional[HistoricalCrewEvidence] = None
    no_suggestion_reason: Optional[str] = None


def _number(value: Any) -> Optional[float]:
    if value is None:
        return None
    return float(value) if isinstance(value, (Decimal, int, float)) else float(str(value))


class CrewSuggestionService:
    def __init__(self, ctx) -> None:
        self._ctx = ctx

    def build(self, *, well_id: int, task_code: Optional[str], report_date: date) -> Optional[Dict[str, Any]]:
        """The ``crew_suggestion`` evidence of one task, or None when the task cannot be resolved (not an error)."""
        if not task_code:
            return None
        rows = self._ctx.data.rows(data.CREW_SUGGESTION,
                                   {"report_date": report_date, "well_id": well_id, "task_code": task_code},
                                   report_date=report_date)
        if not rows:
            return None
        evidence = self.to_evidence(rows[0])
        out = evidence.model_dump(mode="json")
        for optional_key in ("suggested_crew", "consult_crew", "no_suggestion_reason"):
            if out.get(optional_key) is None:
                out.pop(optional_key, None)
        return out

    @staticmethod
    def _candidate(row: Dict[str, Any]) -> HistoricalCrewEvidence:
        return HistoricalCrewEvidence(
            crew_id=int(row["candidate_crew_id"]),
            crew_type=row.get("candidate_crew_type"),
            supervisor=row.get("candidate_crew_supervisor"),
            historical_completed_task_count=int(row["historical_completed_task_count"]),
            distinct_completed_well_count=int(row["distinct_completed_well_count"]),
            completed_on_incomplete_well_count=int(row["completed_on_incomplete_well_count"]),
            completed_on_completed_well_count=int(row["completed_on_completed_well_count"]),
            typical_completion_days=_number(row.get("typical_completion_days")),
            average_completion_days=_number(row.get("average_completion_days")),
            shortest_completion_days=to_int(row.get("shortest_completion_days")),
            longest_completion_days=to_int(row.get("longest_completion_days")),
            most_recent_success_date=as_date(row.get("most_recent_success_date")),
            evidence_strength=row["evidence_strength"],
            derived_availability=row["derived_availability"],
        )

    def to_evidence(self, row: Dict[str, Any]) -> CrewSuggestionEvidence:
        texts = self._ctx.texts
        eligible = bool(row.get("crew_suggestion_eligible"))
        suppression_code = row.get("crew_suggestion_suppression_code")
        has_candidate = row.get("candidate_crew_id") is not None

        current_crew = CurrentCrewEvidence(
            crew_id=to_int(row.get("current_crew_id")),
            recorded=row.get("current_crew_id") is not None,
            crew_type=row.get("current_crew_type"),
            supervisor=row.get("current_crew_supervisor"),
        )
        suggested_crew = consult_crew = None
        no_suggestion_reason = None
        if eligible:
            if has_candidate:
                suggested_crew = self._candidate(row)
            elif row.get("activity_code") is None:
                no_suggestion_reason = texts.entry("crew_no_suggestion_reasons", "unmapped_activity")
            elif not row.get("historical_crew_candidate_count"):
                no_suggestion_reason = texts.entry("crew_no_suggestion_reasons", "no_history")
            elif not row.get("available_crew_candidate_count"):
                no_suggestion_reason = texts.entry("crew_no_suggestion_reasons", "all_busy")
        elif suppression_code == self._ctx.settings.crew_in_progress_code and has_candidate:
            consult_crew = self._candidate(row)

        return CrewSuggestionEvidence(
            eligible=eligible,
            suppression_reason=row.get("crew_suggestion_suppression_reason"),
            suppression_code=suppression_code,
            current_crew=current_crew,
            suggested_crew=suggested_crew,
            consult_crew=consult_crew,
            no_suggestion_reason=no_suggestion_reason,
        )
