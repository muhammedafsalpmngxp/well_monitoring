"""Seed data, sample rows and the ORIGINAL advisor's message renderers for the Slippage tests (offline).

The seed (prompts, settings, queries, access) comes from tests/features/_seed.py: the Tenant API's seed files, or the
not-yet-merged fragments in AGENTIC_FRAGMENTS=<dir>/slippage/. Without either the Slippage tests are skipped.
"""
from __future__ import annotations

import copy
import datetime as dt
import json
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest

from tests.features import _seed

SEED_PROMPTS: dict[str, str] = _seed.prompts("slippage.")
_FEATURE = _seed.feature_seed("slippage")
SEED_SETTINGS: dict[str, Any] = {s["key"]: s["default"] for s in _FEATURE["settings"]}
SEED_SETTING_DEFS: list[dict[str, Any]] = _FEATURE["settings"]
SEED_QUERIES: dict[str, dict[str, Any]] = _seed.queries("slippage")
SEED_QUERY_DEFS: list[dict[str, Any]] = _FEATURE["queries"]
SEED_ACCESS: dict[str, Any] = _FEATURE["access"]
SEED_PROMPT_DEFS: list[dict[str, Any]] = _seed.prompt_definitions("slippage.")

requires_seed = pytest.mark.skipif(
    not (SEED_PROMPTS and SEED_SETTINGS and SEED_QUERIES),
    reason="Slippage seed not found: merge it into the Tenant API seed files or set AGENTIC_FRAGMENTS=<fragments dir>",
)

ORIGINAL = json.loads((Path(__file__).parent / "fixtures" / "original_advisor_prompts.json").read_text(encoding="utf-8"))

WELL = "35552"
OTHER_WELL = "4000"
D = dt.date


def make_body(**overrides: Any) -> dict[str, Any]:
    """A request body as the Tenant API sends it (camelCase), with the seed's prompts, settings, access and queries."""
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


# -- Sample rows ---------------------------------------------------------------------------------------------------

ACTIVITY_COLUMNS = SEED_QUERIES["activity_delay"]["columns"] if SEED_QUERIES else []
CREW_COLUMNS = SEED_QUERIES["crew_availability"]["columns"] if SEED_QUERIES else []
WELL_COLUMNS = SEED_QUERIES["well_slippage"]["columns"] if SEED_QUERIES else []
SUMMARY_COLUMNS = SEED_QUERIES["activity_summary"]["columns"] if SEED_QUERIES else []


def task(code: str, *, wbs, crew_id, crew_type_id, target_start, target_end, risk, end_variance=None,
         start_variance=None, execution="IN_PROGRESS", end_status="OVERDUE", start_status="START_DELAYED",
         progress=Decimal("0.5")) -> dict[str, Any]:
    return {
        "well_id": int(WELL), "task_code": code, "action_on": dt.datetime(2026, 10, 1, 8, 30),
        "activity_id": code.split("-")[0], "activity_code": "AC-" + code, "wbs": wbs, "crew_code": "LCC-0803",
        "crew_id": crew_id, "crew_type_id": crew_type_id, "target_start": target_start, "target_end": target_end,
        "actual_start": None, "actual_end": None, "start_status": start_status, "start_variance_days": start_variance,
        "end_status": end_status, "end_variance_days": end_variance, "execution_status": execution,
        "schedule_risk": risk, "progress_percent": None if progress is None else progress * 100,
    }


def tasks() -> list[dict[str, Any]]:
    """Well 35552, most urgent first (as the verified query orders them)."""
    return [
        task("FLME1180-3035", wbs="Location\n  Construction", crew_id=101, crew_type_id=287, target_start=D(2026, 3, 10),
             target_end=D(2026, 3, 20), risk="RED", end_variance=30, start_variance=2),
        task("A-2", wbs="Location Construction", crew_id=102, crew_type_id=287, target_start=D(2026, 3, 1),
             target_end=D(2026, 3, 5), risk="RED", end_variance=10, execution="NOT_STARTED_LATE"),
        task("A-4", wbs="Location Construction", crew_id=103, crew_type_id=287, target_start=D(2026, 3, 25),
             target_end=D(2026, 4, 1), risk="RED", end_variance=3, end_status="DUE_TODAY"),
        task("A-6", wbs=None, crew_id=None, crew_type_id=None, target_start=None, target_end=D(2026, 2, 1),
             risk="RED", end_variance=5),
        task("A-3", wbs="Flowline", crew_id=None, crew_type_id=300, target_start=D(2026, 3, 2),
             target_end=D(2026, 3, 9), risk="AMBER_START_SLIPPING", execution="NOT_STARTED_LATE",
             end_status="IN_PROGRESS_NOT_LATE"),
        task("A-5", wbs="Location Construction", crew_id=104, crew_type_id=287, target_start=D(2026, 2, 1),
             target_end=D(2026, 3, 1), risk="GREEN", end_variance=-2, execution="COMPLETED",
             end_status="COMPLETED_EARLY"),
    ]


def crew(crew_id, crew_type_id, open_tasks, in_progress, overdue, latest, status) -> dict[str, Any]:
    return {"crew_id": crew_id, "crew_type_id": crew_type_id, "open_tasks": open_tasks,
            "in_progress_tasks": in_progress, "overdue_tasks": overdue, "wells_with_open_tasks": 1,
            "wells_in_progress": 1 if in_progress else 0, "latest_action_on": latest, "availability_status": status}


def crews() -> list[dict[str, Any]]:
    return [
        crew(101, 287, 5, 2, 1, D(2026, 9, 1), "BUSY"),
        crew(102, 287, 2, 1, 0, D(2026, 9, 2), "BUSY"),
        crew(201, 287, 1, 0, 0, D(2026, 5, 1), "AVAILABLE"),
        crew(202, 287, 1, 0, 0, D(2026, 6, 1), "AVAILABLE"),
        crew(203, 287, 3, 0, 2, D(2026, 9, 1), "AVAILABLE"),
        crew(204, 287, None, 0, 0, D(2026, 9, 1), "AVAILABLE"),
        crew(301, 300, 2, 0, 1, D(2026, 8, 1), "AVAILABLE"),
        crew(999, 555, 1, 0, 0, D(2026, 8, 1), "AVAILABLE"),
    ]


def well_rows() -> list[dict[str, Any]]:
    def row(well_id, headline, flaf_status, flaf_var):
        return {
            "well_id": well_id,
            "flaf_deadline": D(2026, 1, 1), "flaf_actual": None, "flaf_status": flaf_status,
            "flaf_variance_days": flaf_var,
            "pegging_deadline": D(2026, 2, 1), "pegging_actual": D(2026, 1, 20), "pegging_status": "AHEAD_OF_SCHEDULE",
            "pegging_variance_days": -12,
            "rig_on_deadline": D(2026, 4, 1), "rig_on_actual": None, "rig_on_status": "MISSED",
            "rig_on_variance_days": Decimal("202"),
            "rig_off_deadline": None, "rig_off_actual": None, "rig_off_status": "DATA_QUALITY_ISSUE",
            "rig_off_variance_days": None,
            "well_slippage_status": headline,
        }
    return [row(int(WELL), "SLIPPED - RIG ON", "MISSED", 292), row(int(OTHER_WELL), "SLIPPED - FLAF", "DELAYED", 4)]


def summary_rows() -> list[dict[str, Any]]:
    return [{"well_id": int(WELL), "delayed_activity_codes": 4}, {"well_id": int(OTHER_WELL), "delayed_activity_codes": 1}]


TASK_REPLY = json.dumps({
    "summary": "It is late because A-2 ran over. Move crew 202 onto it.",
    "caused_by_other_delay": " Possibly ",
    "causes": [{"cause": "A-2 overran", "evidence": "A-2 RED +10 d", "confidence": "HIGH"}, "plain cause"],
    "actions": [
        {"action": "Move crew 202 here", "crew_id": 202, "rationale": "least loaded"},
        {"action": "Keep crew 101", "crew_id": "101", "rationale": "assigned"},
        {"action": "Re-sequence", "crew_id": "null", "rationale": "no crew"},
        "free text action",
    ],
    "checks": ["Is crew 202 on site?"],
    "caveats": ["Available does not mean on site."],
})

WELL_REPLY = "Here is my answer:\n```json\n" + json.dumps({
    "description": "Rig-on missed by 202 days. PDO owns it. Start A-2 now.",
    "delayed": " AT_RISK ",
    "why_delayed": [{"reason": "Rig on missed", "evidence": "rig_on MISSED +202 d", "owner": "PDO",
                     "confidence": "Medium"}, "loose reason"],
    "actions": [
        {"priority": 1, "action": "Reinforce Location Construction", "crew_type_id": 287, "crew_id": 202,
         "rationale": "free"},
        {"action": "Relieve crew 101", "crew_type_id": "287", "crew_id": "101"},
        {"action": "Borrow crew 999", "crew_type_id": 555, "crew_id": 999},
        {"priority": "high", "action": "Escalate to PDO", "crew_id": "None", "crew_type_id": ""},
    ],
    "checks": ["Rig schedule"],
    "caveats": [],
}) + "\n```"


# -- The ORIGINAL advisor's message renderers (api/advisor.py _render / _render_well), copied verbatim ---------------


def ref_lines(rows: list[dict]) -> str:
    return "\n".join(json.dumps(r, ensure_ascii=False, default=str) for r in rows)


def ref_render(well_id: str, evidence: dict) -> str:
    well, crew = evidence["well"], evidence["crew"]
    parts = [
        "WELL " + well_id,
        "",
        "THE TASK IN QUESTION:",
        json.dumps(evidence["task"], ensure_ascii=False, default=str),
        "",
        "OTHER LATE TASKS ON THIS WELL PLANNED TO FINISH BEFORE THIS ONE STARTS "
        "(nearest first; timing only - the data holds no dependency links):",
        ref_lines(evidence["earlier_late_tasks"]) or "(none)",
        "",
        "OTHER LATE TASKS IN THE SAME WBS:",
        ref_lines(evidence["same_wbs_late_tasks"]) or "(none)",
        "",
    ]
    if well["listed"] is True:
        parts += ["WELL MILESTONES (headline: " + str(well["headline"]) + "):",
                  ref_lines(well["milestones"]), ""]
    elif well["listed"] is False:
        parts += ["WELL MILESTONES: this well is NOT in the slippage listing, which holds only wells "
                  "that failed a milestone - so no contractual milestone has failed.", ""]
    else:
        parts += ["WELL MILESTONES: unknown - " + str(well["note"]), ""]

    parts += [
        "ASSIGNED CREW (crew_id " + str(crew["assigned_crew_id"]) + ") - ITS WORKLOAD ACROSS THE FLEET:",
        json.dumps(crew["assigned"], ensure_ascii=False, default=str) if crew["assigned"]
        else "(not found in crew availability, or the task records no crew)",
        "",
        "AVAILABLE CREWS OF THIS TYPE (crew_type_id " + str(crew["crew_type_id"]) + "): "
        + str(crew["available_count"]) + " available, " + str(crew["busy_count"]) + " busy, of "
        + str(crew["type_total"]) + ". The best candidates - name ONLY these:",
        ref_lines(crew["available"]) or "(none)",
    ]
    if crew["note"]:
        parts += ["", "NOTE: " + crew["note"]]
    parts += ["", "Answer both questions now, as the JSON."]
    return "\n".join(parts)


def ref_render_well(well_id: str, evidence: dict) -> str:
    well = evidence["well"]
    parts = ["WELL " + well_id, ""]
    if well["listed"] is True:
        parts += ["CONTRACTUAL MILESTONES (headline: " + str(well["headline"]) + "):",
                  ref_lines(well["milestones"]), ""]
    elif well["listed"] is False:
        parts += ["CONTRACTUAL MILESTONES: this well is NOT in the slippage listing, which holds only "
                  "wells that failed a milestone - so no contractual milestone has failed.", ""]
    else:
        parts += ["CONTRACTUAL MILESTONES: unknown - " + str(well["note"]), ""]

    parts += [
        "TASK TALLY (latest record per task):",
        json.dumps(evidence["tasks"]),
        "",
        "LATE WORK BY WBS (worst first):",
        ref_lines(evidence["late_by_wbs"]) or "(no late tasks)",
        "",
        "LATE WORK BY CREW TYPE - with the assigned crews' fleet load and the best FREE crews of the "
        "same type (name ONLY these candidates, under their own type):",
        ref_lines(evidence["late_by_crew_type"]) or "(no late tasks)",
        "",
        "MOST URGENT LATE TASKS (most urgent first):",
        ref_lines(evidence["most_urgent"]) or "(none)",
    ]
    if evidence["crew_note"]:
        parts += ["", "NOTE: " + evidence["crew_note"]]
    parts += ["", "Answer both questions now, as the JSON."]
    return "\n".join(parts)
