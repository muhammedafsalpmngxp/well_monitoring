"""POST /advise-task and /advise-well: evidence assembly and ranking, the model call, reply normalisation, and the
errors (task not found, prompt missing, AI unavailable, refused table)."""
from __future__ import annotations

import pytest

from app.features.slippage import prompts
from tests.features.slippage import _support as S

pytestmark = S.requires_seed

TASK = "FLME1180-3035"


def advise_task(client, body, task_code=TASK, well_id=S.WELL, **extra):
    return client.post("/slippage/advise-task", json={**body, "wellId": well_id, "taskCode": task_code, **extra})


def advise_well(client, body, well_id=S.WELL, **extra):
    return client.post("/slippage/advise-well", json={**body, "wellId": well_id, **extra})


def codes(rows):
    return [r["task_code"] for r in rows]


def ids(rows):
    return [r["crew_id"] for r in rows]


# -- Task level ---------------------------------------------------------------------------------------------------


def test_task_advice_shape_evidence_and_usage(client, body, fake_db, fake_llm):
    r = advise_task(client, body)
    assert r.status_code == 200, r.text
    data = r.json()
    assert set(data) == {"well_id", "task_code", "generated_at", "model", "cached", "advice", "raw", "evidence",
                         "usage"}
    assert (data["well_id"], data["task_code"], data["cached"], data["raw"]) == (S.WELL, TASK, False, None)
    assert data["model"] == "fake-model"
    assert data["usage"] == [{"agent": "slippage.advisor_task", "model": "fake-model", "calls": 1, "input": 100,
                              "output": 20}]
    assert fake_db.keys_called() == ["activity_delay", "crew_availability", "well_slippage"]
    assert fake_db.calls[0] == ("activity_delay", [S.WELL])

    ev = data["evidence"]
    assert ev["task"]["wbs"] == "Location Construction"            # embedded whitespace collapsed
    assert ev["task"]["target_start"] == "2026-03-10"
    assert "well_id" not in ev["task"] and "action_on" not in ev["task"]   # only the advisor's task fields
    # earlier: late, planned to finish on or before this task's planned start, nearest first
    assert codes(ev["earlier_late_tasks"]) == ["A-3", "A-2", "A-6"]
    # same WBS: late, not already shown; A-5 is GREEN
    assert codes(ev["same_wbs_late_tasks"]) == ["A-4"]

    crew = ev["crew"]
    assert (crew["crew_type_id"], crew["assigned_crew_id"]) == (287, 101)
    assert crew["assigned"]["crew_id"] == 101 and crew["assigned"]["latest_action_on"] == "2026-09-01"
    # same type, AVAILABLE, not the assigned crew; least open work, fewest overdue, most recent; unknown load last
    assert ids(crew["available"]) == [202, 201, 203, 204]
    assert (crew["available_count"], crew["busy_count"], crew["type_total"], crew["note"]) == (4, 2, 6, None)

    well = ev["well"]
    assert (well["listed"], well["headline"], well["note"]) == (True, "SLIPPED - RIG ON", None)
    assert well["milestones"][0] == {"milestone": "FLAF issued", "owner": "PDO", "deadline": "2026-01-01",
                                     "actual": None, "status": "MISSED", "variance_days": 292}
    assert [m["milestone"] for m in well["milestones"]] == ["FLAF issued", "Pegging sheet issued", "Rig on", "Rig off"]
    assert well["milestones"][2]["variance_days"] == 202.0

    call = fake_llm.calls[0]
    assert call.system == S.ORIGINAL["advisor_task_system"].rstrip("\n")
    assert call.user == S.ref_render(S.WELL, ev)
    assert (call.temperature, call.effort, call.verbosity, call.fast, call.json_mode) == (0.2, "medium", "medium",
                                                                                          False, False)


def test_task_advice_is_normalised_and_unknown_crews_flagged(client, body):
    advice = advise_task(client, body).json()["advice"]
    assert advice["summary"].startswith("It is late")
    assert advice["caused_by_other_delay"] == "possibly"
    assert advice["causes"] == [
        {"cause": "A-2 overran", "evidence": "A-2 RED +10 d", "confidence": "high"},
        {"cause": "plain cause", "evidence": "", "confidence": ""},
    ]
    assert advice["actions"] == [
        {"action": "Move crew 202 here", "crew_id": 202, "rationale": "least loaded"},
        # the assigned crew is not among the AVAILABLE candidates
        {"action": "Keep crew 101", "crew_id": "101", "rationale": "assigned", "crew_unverified": True},
        {"action": "Re-sequence", "crew_id": None, "rationale": "no crew"},
        {"action": "free text action", "crew_id": None, "rationale": ""},
    ]
    assert advice["checks"] == ["Is crew 202 on site?"]
    assert advice["caveats"] == [
        "Available does not mean on site.",
        "Crew 101 was not among the available crews of this type the agent was given. Do not act on it without "
        "checking.",
    ]


@pytest.mark.parametrize("verdict, expected", [("YES", "yes"), (" no ", "no"), ("maybe", "unknown"), (None, "unknown"),
                                               ("at_risk", "unknown")])
def test_task_verdict_is_clamped(client, body, fake_llm, verdict, expected):
    fake_llm.reply = '{"summary": "s", "caused_by_other_delay": %s}' % ("null" if verdict is None else f'"{verdict}"')
    assert advise_task(client, body).json()["advice"]["caused_by_other_delay"] == expected


def test_unreadable_reply_is_returned_raw(client, body, fake_llm):
    fake_llm.reply = "  I would start A-2 now.  "
    data = advise_task(client, body).json()
    assert data["advice"] is None and data["raw"] == "I would start A-2 now."
    fake_llm.reply = '{"checks": ["only checks"]}'                  # JSON, but neither summary nor actions
    data = advise_task(client, body, fresh=True).json()
    assert data["advice"] is None and data["raw"] == '{"checks": ["only checks"]}'


def test_evidence_limits_come_from_the_settings(client, body):
    body["settings"].update(maxRelated=1, maxCandidates=2)
    ev = advise_task(client, body).json()["evidence"]
    assert codes(ev["earlier_late_tasks"]) == ["A-3"]
    assert codes(ev["same_wbs_late_tasks"]) == ["A-2"]               # no longer shown as earlier
    assert ids(ev["crew"]["available"]) == [202, 201]
    assert ev["crew"]["available_count"] == 4


def test_task_not_on_the_well_is_404(client, body, fake_llm):
    r = advise_task(client, body, task_code="NOPE-1")
    assert r.status_code == 404
    assert r.json()["detail"] == "Task NOPE-1 is not among well 35552's current tasks."
    assert fake_llm.calls == []


@pytest.mark.parametrize("task_code", ["", "   ", "T" * 101])
def test_invalid_task_code_is_400(client, body, fake_db, task_code):
    r = advise_task(client, body, task_code=task_code)
    assert r.status_code == 400 and r.json()["detail"] == "Invalid task code."
    assert fake_db.calls == []


def test_invalid_well_id_is_400(client, body, fake_db):
    assert advise_task(client, body, well_id="").status_code == 400
    assert advise_well(client, body, well_id="w" * 51).status_code == 400
    assert fake_db.calls == []


def test_task_without_crew_type_has_a_note(client, body, fake_llm):
    ev = advise_task(client, body, task_code="A-6").json()["evidence"]
    note = body["prompts"]["slippage.note_task_no_crew_type"]
    assert ev["crew"]["note"] == note and ev["crew"]["assigned"] is None and ev["crew"]["available"] == []
    user = fake_llm.calls[0].user
    assert user == S.ref_render(S.WELL, ev)
    assert "(not found in crew availability, or the task records no crew)" in user and "NOTE: " + note in user


def test_crew_type_without_crews_has_a_note(client, body, fake_db):
    fake_db.activity[S.WELL][1]["crew_type_id"] = 777
    ev = advise_task(client, body, task_code="A-2").json()["evidence"]
    assert ev["crew"]["note"] == body["prompts"]["slippage.note_no_crew_of_type"]
    assert ev["crew"]["type_total"] == 0
    assert ev["crew"]["assigned"]["crew_id"] == 102                  # the assigned crew's own load is still shown


def test_crew_availability_not_configured(client, body, fake_db, fake_llm):
    del body["queries"]["crew_availability"]
    ev = advise_task(client, body).json()["evidence"]
    assert ev["crew"]["note"] == body["prompts"]["slippage.note_crews_unavailable"]
    assert "crew_availability" not in fake_db.keys_called()
    assert fake_llm.calls[0].user == S.ref_render(S.WELL, ev)


def test_well_slippage_not_configured_means_milestones_unknown(client, body, fake_llm):
    del body["queries"]["well_slippage"]
    ev = advise_task(client, body).json()["evidence"]
    assert ev["well"] == {"listed": None, "headline": None, "milestones": [],
                          "note": body["prompts"]["slippage.note_milestones_unavailable"]}
    assert "WELL MILESTONES: unknown - " in fake_llm.calls[0].user
    assert fake_llm.calls[0].user == S.ref_render(S.WELL, ev)


def test_well_not_in_the_listing(client, body, fake_db, fake_llm):
    fake_db.activity["777"] = S.tasks()[:2]
    ev = advise_task(client, body, well_id="777").json()["evidence"]
    assert ev["well"] == {"listed": False, "headline": None, "milestones": [], "note": None}
    assert "this well is NOT in the slippage listing" in fake_llm.calls[0].user


def test_task_data_without_crew_columns(client, body, fake_db):
    body["queries"]["activity_delay"]["columns"] = []
    fake_db.columns_override["activity_delay"] = [c for c in S.ACTIVITY_COLUMNS if c not in ("crew_id", "crew_type_id")]
    ev = advise_task(client, body).json()["evidence"]
    assert ev["crew"]["note"] == body["prompts"]["slippage.note_task_no_crew_columns"]


def test_milestones_setting_must_match_the_listing_columns(client, body, fake_llm):
    body["settings"]["milestones"] = body["settings"]["milestones"] + ["spud|Spud|PDO"]
    r = advise_task(client, body)
    assert r.status_code == 400 and "spud_deadline" in r.json()["detail"]
    assert fake_llm.calls == []


def test_vocabulary_comes_from_the_settings(client, body, fake_db, fake_llm):
    body["settings"].update(riskRed="LATE_END", crewAvailable="FREE")
    for t in fake_db.activity[S.WELL]:
        if t["schedule_risk"] == "RED":
            t["schedule_risk"] = "LATE_END"
    fake_db.results["crew_availability"][1][2]["availability_status"] = "FREE"      # crew 201 only
    ev = advise_task(client, body).json()["evidence"]
    assert codes(ev["earlier_late_tasks"]) == ["A-3", "A-2", "A-6"]
    assert ids(ev["crew"]["available"]) == [201]
    assert "- schedule_risk: LATE_END = the planned END is missed" in fake_llm.calls[0].system
    assert "across EVERY such well: FREE = none of that work has started" in fake_llm.calls[0].system


# -- Well level ---------------------------------------------------------------------------------------------------


def test_well_advice_shape_and_evidence(client, body, fake_db, fake_llm):
    r = advise_well(client, body)
    assert r.status_code == 200, r.text
    data = r.json()
    assert set(data) == {"well_id", "generated_at", "model", "cached", "advice", "raw", "evidence", "usage"}
    assert data["usage"][0]["agent"] == "slippage.advisor_well" and data["cached"] is False
    assert fake_db.keys_called() == ["activity_delay", "crew_availability", "well_slippage"]

    ev = data["evidence"]
    assert ev["tasks"] == {"total": 6, "late": 5, "red": 4, "amber": 1, "not_started_late": 2, "in_progress": 3,
                           "completed": 1, "due_today": 1}
    assert ev["late_by_wbs"] == [
        {"wbs": "Location Construction", "late_tasks": 3, "red": 3, "not_started_late": 1, "crew_type_ids": ["287"],
         "worst_overrun_days": 30.0},
        {"wbs": "(unmapped)", "late_tasks": 1, "red": 1, "not_started_late": 0, "crew_type_ids": [],
         "worst_overrun_days": 5.0},
        {"wbs": "Flowline", "late_tasks": 1, "red": 0, "not_started_late": 1, "crew_type_ids": ["300"],
         "worst_overrun_days": None},
    ]
    groups = ev["late_by_crew_type"]
    assert [g["crew_type_id"] for g in groups] == ["287", "300", None]      # no type recorded: last
    g287 = groups[0]
    assert list(g287) == ["crew_type_id", "late_tasks", "wbs", "unassigned_late_tasks", "worst_overrun_days",
                          "assigned_crews", "available_count", "busy_count", "type_total", "candidates"]
    assert (g287["late_tasks"], g287["wbs"], g287["unassigned_late_tasks"], g287["worst_overrun_days"]) == (
        3, ["Location Construction"], 0, 30.0)
    assert ids(g287["assigned_crews"]) == [101, 102]                         # 103 holds no open work
    assert ids(g287["candidates"]) == [202, 201, 203, 204]
    assert (g287["available_count"], g287["busy_count"], g287["type_total"]) == (4, 2, 6)
    assert ids(groups[1]["candidates"]) == [301] and groups[1]["unassigned_late_tasks"] == 1
    assert groups[2]["candidates"] == [] and groups[2]["type_total"] == 0
    assert codes(ev["most_urgent"]) == ["FLME1180-3035", "A-2", "A-4", "A-6", "A-3"]
    assert ev["crew_note"] is None
    assert ev["well"]["listed"] is True

    call = fake_llm.calls[0]
    assert call.system == S.ORIGINAL["advisor_well_system"].rstrip("\n")
    assert call.user == S.ref_render_well(S.WELL, ev)


def test_well_advice_is_normalised_and_unknown_crews_and_types_flagged(client, body):
    advice = advise_well(client, body).json()["advice"]
    assert advice["delayed"] == "at_risk"
    assert advice["why_delayed"] == [
        {"reason": "Rig on missed", "evidence": "rig_on MISSED +202 d", "owner": "PDO", "confidence": "medium"},
        {"reason": "loose reason", "evidence": "", "owner": "unknown", "confidence": ""},
    ]
    assert advice["actions"] == [
        {"priority": 1, "action": "Reinforce Location Construction", "crew_type_id": 287, "crew_id": 202,
         "rationale": "free"},
        {"priority": 2, "action": "Relieve crew 101", "crew_type_id": "287", "crew_id": "101", "rationale": ""},
        {"priority": 3, "action": "Borrow crew 999", "crew_type_id": 555, "crew_id": 999, "rationale": "",
         "crew_unverified": True, "type_unverified": True},
        {"priority": 4, "action": "Escalate to PDO", "crew_type_id": None, "crew_id": None, "rationale": ""},
    ]
    assert advice["caveats"] == [
        "Crew 999 was not among the crews the agent was given. Do not act on it without checking.",
        "Crew type 555 does not carry any of this well's late work in the evidence. Check before acting.",
    ]


def test_well_verdict_is_clamped(client, body, fake_llm):
    fake_llm.reply = '{"description": "d", "delayed": "possibly"}'
    assert advise_well(client, body).json()["advice"]["delayed"] == "unknown"


def test_well_limits_come_from_the_settings(client, body):
    body["settings"].update(maxUrgent=2, maxGroups=1, maxTypeCandidates=1, maxAssigned=1)
    ev = advise_well(client, body).json()["evidence"]
    assert codes(ev["most_urgent"]) == ["FLME1180-3035", "A-2"]
    assert [g["wbs"] for g in ev["late_by_wbs"]] == ["Location Construction"]
    (group,) = ev["late_by_crew_type"]
    assert ids(group["candidates"]) == [202] and ids(group["assigned_crews"]) == [101]
    assert group["available_count"] == 4


def test_well_without_late_work(client, body, fake_db, fake_llm):
    fake_db.activity[S.WELL] = [t for t in S.tasks() if t["schedule_risk"] == "GREEN"]
    ev = advise_well(client, body).json()["evidence"]
    assert ev["late_by_wbs"] == [] and ev["late_by_crew_type"] == [] and ev["most_urgent"] == []
    user = fake_llm.calls[0].user
    assert user == S.ref_render_well(S.WELL, ev)
    assert "LATE WORK BY WBS (worst first):\n(no late tasks)" in user


def test_well_task_data_without_crew_columns_skips_crews(client, body, fake_db, fake_llm):
    body["queries"]["activity_delay"]["columns"] = []
    fake_db.columns_override["activity_delay"] = [c for c in S.ACTIVITY_COLUMNS if c not in ("crew_id", "crew_type_id")]
    ev = advise_well(client, body).json()["evidence"]
    assert ev["crew_note"] == body["prompts"]["slippage.note_well_no_crew_columns"]
    assert "crew_availability" not in fake_db.keys_called()
    assert fake_llm.calls[0].user == S.ref_render_well(S.WELL, ev)


def test_well_with_crew_availability_not_configured(client, body):
    del body["queries"]["crew_availability"]
    ev = advise_well(client, body).json()["evidence"]
    assert ev["crew_note"] == body["prompts"]["slippage.note_crews_unavailable"]
    assert ev["late_by_crew_type"][0]["candidates"] == []


# -- Errors -------------------------------------------------------------------------------------------------------


@pytest.mark.parametrize("path", ["advise-task", "advise-well"])
@pytest.mark.parametrize("text", [None, "   "])
def test_prompt_missing_is_400_naming_it(client, body, fake_db, fake_llm, path, text):
    if text is None:
        del body["prompts"]["slippage.msg_none"]
    else:
        body["prompts"]["slippage.msg_none"] = text
    r = client.post(f"/slippage/{path}", json={**body, "wellId": S.WELL, "taskCode": TASK})
    assert r.status_code == 400
    assert "'slippage.msg_none'" in r.json()["detail"]
    assert fake_db.calls == [] and fake_llm.calls == []


@pytest.mark.parametrize("path", ["advise-task", "advise-well"])
def test_no_ai_provider_is_503_before_any_query(client, body, fake_db, path):
    body["llm"] = None
    r = client.post(f"/slippage/{path}", json={**body, "wellId": S.WELL, "taskCode": TASK})
    assert r.status_code == 503
    assert "No AI provider is active" in r.json()["detail"]
    assert fake_db.calls == []


def test_provider_failure_is_503_without_its_text(client, body, fake_llm):
    fake_llm.error = RuntimeError("upstream said: key sk-test-123 rejected")
    r = advise_task(client, body)
    assert r.status_code == 503
    assert r.json()["detail"] == "The AI provider could not answer (RuntimeError). Try again."


def test_table_not_allowed_refuses_the_advisor(client, body, fake_db, fake_llm):
    body["access"]["includedTables"] = [t for t in body["access"]["includedTables"] if t != "dbo.activity_master_csv"]
    r = advise_well(client, body)
    assert r.status_code == 400 and "dbo.activity_master_csv" in r.json()["detail"]
    assert fake_db.calls == [] and fake_llm.calls == []


def test_database_unavailable_is_503(client, body, fake_db, fake_llm):
    fake_db.unavailable = True
    r = advise_task(client, body)
    assert r.status_code == 503 and fake_llm.calls == []


@pytest.mark.parametrize("max_rows, key", [(5, "activity_delay"), (7, "crew_availability")])
def test_evidence_cut_by_the_row_limit_is_refused(client, body, fake_llm, max_rows, key):
    body["settings"]["queryMaxRows"] = max_rows                     # 6 tasks, 8 crews
    for path in ("advise-task", "advise-well"):
        r = client.post(f"/slippage/{path}", json={**body, "wellId": S.WELL, "taskCode": TASK})
        assert r.status_code == 400
        assert f"'{key}' returned more than {max_rows} rows" in r.json()["detail"]
    assert fake_llm.calls == []


def test_missing_setting_is_400(client, body):
    del body["settings"]["maxRelated"]
    r = advise_task(client, body)
    assert r.status_code == 400 and "'maxRelated' is missing" in r.json()["detail"]


# -- Message layout -----------------------------------------------------------------------------------------------


def test_messages_equal_the_original_for_every_milestone_and_note_case(client, body, ctx):
    task_ev = advise_task(client, body).json()["evidence"]
    well_ev = advise_well(client, body).json()["evidence"]
    unknown = {"listed": None, "headline": None, "milestones": [], "note": "Listing not readable."}
    not_listed = {"listed": False, "headline": None, "milestones": [], "note": None}
    with ctx(body):
        for well in (task_ev["well"], unknown, not_listed):
            for note in (None, "Crew data is missing."):
                ev = {**task_ev, "well": well, "crew": {**task_ev["crew"], "note": note, "assigned": None}}
                assert prompts.task_message(S.WELL, ev) == S.ref_render(S.WELL, ev)
                wev = {**well_ev, "well": well, "crew_note": note, "most_urgent": []}
                assert prompts.well_message(S.WELL, wev) == S.ref_render_well(S.WELL, wev)
