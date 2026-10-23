"""Seed data and sample rows for the Crew Management tests (offline). The seed (prompts, settings, queries, access)
comes from tests/features/_seed.py; without it the tests are skipped."""
from __future__ import annotations

import copy
from typing import Any

import pytest

from tests.features import _seed

_FEATURE = _seed.feature_seed("crew")
SEED_PROMPTS: dict[str, str] = _seed.prompts("crew.")
SEED_PROMPT_DEFS: list[dict[str, Any]] = _seed.prompt_definitions("crew.")
SEED_SETTINGS: dict[str, Any] = {s["key"]: s["default"] for s in _FEATURE["settings"]}
SEED_SETTING_DEFS: list[dict[str, Any]] = _FEATURE["settings"]
SEED_QUERIES: dict[str, dict[str, Any]] = _seed.queries("crew")
SEED_QUERY_DEFS: list[dict[str, Any]] = _FEATURE["queries"]
SEED_ACCESS: dict[str, Any] = _FEATURE["access"]

requires_seed = pytest.mark.skipif(not (SEED_PROMPTS and SEED_SETTINGS and SEED_QUERIES),
                                   reason="Crew Management seed not found in the Tenant API seed file")

WELL = "35552"


def make_body(**overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "db": {"server": "sql.test", "name": "WellDb", "user": "reader", "password": "test-only"},
        "llm": {"provider": "openai", "baseUrl": "http://llm.test/v1", "model": "fake-main", "apiKey": "test-only"},
        "prompts": dict(SEED_PROMPTS),
        "settings": copy.deepcopy(SEED_SETTINGS),
        "access": copy.deepcopy(SEED_ACCESS),
        "queries": copy.deepcopy(SEED_QUERIES),
    }
    body.update(overrides)
    return body


# People counted once, as crew_board returns them: the five type-287 crews hold 20 crew places but 13 people.
TYPE_PEOPLE = {287: 13, 300: 4, 400: 4}
FLEET_PEOPLE = 18


def crew(crew_id: int, type_id: int, status: str, *, supervisor_id: int | None = None, queued: int = 0,
         days_since: int | None = 0, members: int = 4) -> dict[str, Any]:
    return {
        "crew_id": crew_id, "crew_type_id": type_id, "crew_type_code": f"CT-{type_id}", "crew_type_name": f"Type {type_id}",
        "supervisor_id": supervisor_id, "supervisor": None if supervisor_id is None else f"Sup {supervisor_id}",
        "members": members, "national_members": 1, "expat_members": members - 1,
        "tasks_recorded": 10, "in_progress_tasks": 1 if status == "BUSY" else 0, "queued_tasks": queued,
        "overdue_open_tasks": 0, "completed_tasks": 5, "open_wells": 1, "last_recorded_on": "2026-10-10",
        "data_as_of": "2026-10-12", "days_since_last_record": days_since, "team_in_progress_tasks": 0,
        "team_last_recorded_on": "2026-10-10", "availability_status": status,
        "type_people": TYPE_PEOPLE.get(type_id, members), "fleet_people": FLEET_PEOPLE,
    }


def board() -> list[dict[str, Any]]:
    return [
        crew(101, 287, "BUSY", supervisor_id=1),           # on the late task
        crew(201, 287, "FREE", supervisor_id=2, queued=2),
        crew(202, 287, "FREE", supervisor_id=3, queued=0),
        crew(203, 287, "FREE", supervisor_id=4, queued=0, days_since=9),
        crew(204, 287, "INACTIVE", supervisor_id=5),
        crew(301, 300, "TEAM_BUSY", supervisor_id=6),
        crew(401, 400, "FREE", supervisor_id=7),            # no delayed work needs type 400
    ]


def activity(code: str, *, type_id: int | None, crew_id: int | None, delay: str, overdue: int,
             activity_code: str | None = None) -> dict[str, Any]:
    return {
        "task_code": code, "activity_id": code.split("-")[0], "activity_code": activity_code,
        "activity_description": f"Activity {code}", "wbs": "Location Construction", "target_start": "2026-08-01",
        "target_end": "2026-09-01", "actual_start": "2026-08-05" if delay == "OVERDUE_IN_PROGRESS" else None,
        "progress": 1 if delay == "AWAITING_CLOSE_OUT" else 0.4, "last_recorded_on": "2026-10-10",
        "well_last_recorded_on": "2026-10-10", "delay_status": delay, "days_overdue": overdue,
        "start_variance_days": 10, "assigned_crew_id": crew_id,
        "assigned_crew_supervisor": None if crew_id is None else "Sup 1", "activity_crew_code": "CT-287",
        "required_crew_type_id": type_id, "required_crew_type_code": None if type_id is None else f"CT-{type_id}",
        "required_crew_type_name": None if type_id is None else f"Type {type_id}",
        "required_crew_type_source": "ACTIVITY_MASTER" if type_id is not None else "NOT_RESOLVED",
    }


def delayed() -> list[dict[str, Any]]:
    return [
        activity("FLME1-1", type_id=287, crew_id=101, delay="OVERDUE_IN_PROGRESS", overdue=40, activity_code="A-WLD-01"),
        activity("FLME2-1", type_id=287, crew_id=None, delay="OVERDUE_NOT_STARTED", overdue=12, activity_code="A-WLD-02"),
        activity("FLME3-1", type_id=300, crew_id=None, delay="START_SLIPPING", overdue=0, activity_code="A-CIV-01"),
        activity("FLME4-1", type_id=None, crew_id=None, delay="OVERDUE_NOT_STARTED", overdue=3),
        activity("FLME5-1", type_id=287, crew_id=None, delay="AWAITING_CLOSE_OUT", overdue=5, activity_code="A-WLD-03"),
    ]


def experience() -> list[dict[str, Any]]:
    # Crew 203 has done the welding activity most often, so it ranks first although 202 has the same queue.
    return [
        {"crew_id": 203, "activity_code": "A-WLD-01", "completed_count": 5, "distinct_wells": 4,
         "typical_completion_days": 6.0, "average_completion_days": 6.5, "last_completed_on": "2026-09-01"},
        {"crew_id": 202, "activity_code": "A-WLD-01", "completed_count": 1, "distinct_wells": 1,
         "typical_completion_days": 9.0, "average_completion_days": 9.0, "last_completed_on": "2026-05-01"},
    ]


def well_row() -> dict[str, Any]:
    return {"well_id": int(WELL), "project_id": 7, "ex_rig_on_date": "2026-12-01", "rig_on_date": None,
            "ex_rig_off_date": None, "rig_off_date": None, "eng_completion_date": None}


def wells() -> list[dict[str, Any]]:
    return [{"well_id": int(WELL), "project_id": 7, "ex_rig_on_date": "2026-12-01", "rig_on_date": None,
             "delayed_activities": 4, "without_recorded_crew": 3, "awaiting_close_out": 1, "max_days_overdue": 40,
             "last_recorded_on": "2026-10-10"}]


def demand() -> list[dict[str, Any]]:
    return [
        {"crew_type_id": 287, "crew_type_code": "CT-287", "crew_type_name": "Type 287", "delayed_activities": 5,
         "wells": 2, "without_recorded_crew": 2, "overdue": 4, "start_slipping": 1, "max_days_overdue": 40},
        {"crew_type_id": 300, "crew_type_code": "CT-300", "crew_type_name": "Type 300", "delayed_activities": 1,
         "wells": 1, "without_recorded_crew": 1, "overdue": 0, "start_slipping": 1, "max_days_overdue": 0},
        {"crew_type_id": 500, "crew_type_code": "CT-500", "crew_type_name": "Type 500", "delayed_activities": 2,
         "wells": 1, "without_recorded_crew": 2, "overdue": 2, "start_slipping": 0, "max_days_overdue": 9},
        {"crew_type_id": None, "crew_type_code": None, "crew_type_name": None, "delayed_activities": 3,
         "wells": 2, "without_recorded_crew": 3, "overdue": 3, "start_slipping": 0, "max_days_overdue": 3},
    ]
