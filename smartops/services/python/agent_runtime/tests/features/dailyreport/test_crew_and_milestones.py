"""Crew suggestion shaping and milestone windowing (ported from the original test_crew_suggestion.py and
test_milestones.py, the Python halves)."""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any, Dict

import pytest

from app.features.dailyreport import data
from tests.features.dailyreport.conftest import REPORT_DATE, report_context, seed_prompts
from app.features.dailyreport.texts import parse_entries

_NO_CANDIDATE = dict(candidate_crew_id=None, candidate_crew_type=None, candidate_crew_supervisor=None,
                     historical_completed_task_count=None, distinct_completed_well_count=None,
                     completed_on_incomplete_well_count=None, completed_on_completed_well_count=None,
                     typical_completion_days=None, average_completion_days=None, shortest_completion_days=None,
                     longest_completion_days=None, most_recent_success_date=None, evidence_strength=None,
                     derived_availability=None)


def crew_row(**overrides: Any) -> Dict[str, Any]:
    """A CREW_SUGGESTION row for an eligible task with one strong suggested crew (synthetic ids)."""
    row: Dict[str, Any] = {
        "target_well_id": 90001, "target_task_code": "ZZZZ0001-90001", "activity_id": "ZZZZ0001",
        "activity_code": "Z-Z-TST-001", "wbs": "Synthetic Test WBS", "crew_suggestion_eligible": 1,
        "crew_suggestion_suppression_reason": None, "crew_suggestion_suppression_code": None,
        "current_crew_id": None, "current_crew_type": None, "current_crew_supervisor": None,
        "candidate_crew_id": 55501, "candidate_crew_type": "Synthetic Crew Type",
        "candidate_crew_supervisor": "A. Synthetic Supervisor", "historical_completed_task_count": 6,
        "distinct_completed_well_count": 6, "completed_on_incomplete_well_count": 2,
        "completed_on_completed_well_count": 4, "typical_completion_days": 3.0, "average_completion_days": 4.5,
        "shortest_completion_days": 1, "longest_completion_days": 12, "most_recent_success_date": date(2026, 5, 1),
        "evidence_strength": "STRONG_HISTORY", "derived_availability": "NO_CURRENT_UNFINISHED_TASK",
        "historical_crew_candidate_count": 3, "available_crew_candidate_count": 1,
    }
    row.update(overrides)
    return row


def _build(fake_db, row, task_code="ZZZZ0001-90001", **ctx_overrides):
    fake_db.set(data.CREW_SUGGESTION, [row] if row is not None else [])
    with report_context(**ctx_overrides) as ctx:
        return ctx.crew.build(well_id=90001, task_code=task_code, report_date=REPORT_DATE)


class TestCrewSuggestion:
    def test_suggested_crew_carries_full_evidence(self, fake_db):
        evidence = _build(fake_db, crew_row())
        assert evidence["eligible"] is True and evidence["suppression_reason"] is None
        suggested = evidence["suggested_crew"]
        assert suggested["crew_id"] == 55501
        assert (suggested["typical_completion_days"], suggested["average_completion_days"]) == (3.0, 4.5)
        assert suggested["most_recent_success_date"] == "2026-05-01"
        assert "consult_crew" not in evidence and "no_suggestion_reason" not in evidence
        assert fake_db.calls[-1] == (data.CREW_SUGGESTION, [REPORT_DATE, 90001, "ZZZZ0001-90001"])

    def test_null_crew_is_not_recorded_rather_than_not_assigned(self, fake_db):
        current = _build(fake_db, crew_row())["current_crew"]
        assert current == {"crew_id": None, "recorded": False, "crew_type": None, "supervisor": None}

    def test_a_completed_task_gets_nothing_to_suggest(self, fake_db):
        evidence = _build(fake_db, crew_row(crew_suggestion_eligible=0, crew_suggestion_suppression_code="COMPLETED",
                                            crew_suggestion_suppression_reason="Task already completed.",
                                            **_NO_CANDIDATE))
        assert evidence["eligible"] is False
        assert not {"suggested_crew", "consult_crew", "no_suggestion_reason"} & set(evidence)

    def test_in_progress_with_a_candidate_names_a_crew_to_consult_never_a_replacement(self, fake_db):
        evidence = _build(fake_db, crew_row(crew_suggestion_eligible=0, crew_suggestion_suppression_code="IN_PROGRESS"))
        assert "suggested_crew" not in evidence
        assert evidence["consult_crew"]["crew_id"] == 55501

    def test_the_in_progress_code_is_the_tenants_vocabulary(self, fake_db):
        row = crew_row(crew_suggestion_eligible=0, crew_suggestion_suppression_code="UNDERWAY")
        assert "consult_crew" in _build(fake_db, row, settings={"crewInProgressCode": "UNDERWAY"})
        assert "consult_crew" not in _build(fake_db, row)

    @pytest.mark.parametrize("overrides,kind", [
        (dict(activity_code=None, historical_crew_candidate_count=0, available_crew_candidate_count=0),
         "unmapped_activity"),
        (dict(historical_crew_candidate_count=0, available_crew_candidate_count=0), "no_history"),
        (dict(historical_crew_candidate_count=4, available_crew_candidate_count=0), "all_busy"),
    ])
    def test_no_suitable_crew_gives_the_tenants_reason(self, fake_db, overrides, kind):
        evidence = _build(fake_db, crew_row(candidate_crew_id=None, **overrides))
        reasons = parse_entries(seed_prompts()["dailyreport.crew_no_suggestion_reasons"])
        assert evidence["no_suggestion_reason"] == reasons[kind]
        assert "suggested_crew" not in evidence

    def test_an_unresolvable_task_or_blank_code_gives_none(self, fake_db):
        assert _build(fake_db, None) is None
        assert _build(fake_db, crew_row(), task_code="") is None
        assert fake_db.count(data.CREW_SUGGESTION) == 1      # the blank code never reached the database


TODAY = date(2026, 9, 14)


def milestone_row(well_id, milestone, days, **overrides):
    row = {"well_id": well_id, "milestone": milestone, "deadline_date": TODAY + timedelta(days=days),
           "pegged_date": None, "flaf_issue_date": None, "ex_rig_on_date": None, "rig_on_date": None,
           "ex_rig_off_date": None, "rig_off_date": None}
    row.update(overrides)
    return row


class TestMilestones:
    def _split(self, fake_db, rows, window=7, **ctx_overrides):
        fake_db.set(data.MILESTONES, rows)
        with report_context(**ctx_overrides) as ctx:
            return ctx.milestones.upcoming_and_overdue(window, today=TODAY)

    def test_within_window_is_upcoming_soonest_first(self, fake_db):
        upcoming, overdue = self._split(fake_db, [milestone_row(1, "PEGGING", 3), milestone_row(2, "RIG_ON", 1),
                                                  milestone_row(3, "FLAF", 7), milestone_row(4, "FLAF", 8)])
        assert overdue == []
        assert [(a.well_id, a.days_remaining) for a in upcoming] == [(2, 1), (1, 3), (3, 7)]

    def test_due_today_is_upcoming_and_past_is_overdue_most_recent_first(self, fake_db):
        upcoming, overdue = self._split(fake_db, [milestone_row(1, "RIG_OFF", 0), milestone_row(2, "PEGGING", -30),
                                                  milestone_row(3, "FLAF", -1), milestone_row(4, "RIG_ON", -400)])
        assert [a.well_id for a in upcoming] == [1] and upcoming[0].overdue is False
        assert [a.well_id for a in overdue] == [3, 2, 4] and all(a.overdue for a in overdue)

    def test_labels_come_from_the_settings_and_an_unnamed_code_is_shown_as_is(self, fake_db):
        upcoming, _ = self._split(fake_db, [milestone_row(1, "RIG_ON", 2), milestone_row(2, "SPUD", 3)])
        assert [a.label for a in upcoming] == ["Rig-on", "SPUD"]
        upcoming, _ = self._split(fake_db, [milestone_row(1, "RIG_ON", 2)],
                                  settings={"milestoneLabels": ["RIG_ON=Rig on location"]})
        assert upcoming[0].label == "Rig on location"

    def test_today_is_the_requests_not_the_servers(self, fake_db):
        fake_db.set(data.MILESTONES, [milestone_row(1, "RIG_ON", 2)])
        with report_context() as ctx:
            upcoming, _ = ctx.milestones.upcoming_and_overdue(7, today=TODAY + timedelta(days=1))
        assert upcoming[0].days_remaining == 1
