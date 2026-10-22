"""The deterministic crew plan: ranking, actions, reasons, shared teams, capacity vs demand, the fleet cache."""
from __future__ import annotations

import pytest

from app.features.crew import engine, queries
from app.features.crew.errors import BadRequest, WellNotFound
from tests.features.crew import _support as S

pytestmark = S.requires_seed


def _by_code(plan):
    return {a["task_code"]: a for a in plan["activities"]}


def test_free_crews_are_ranked_by_same_activity_experience_then_queue_then_recency(body, ctx):
    with ctx(body) as (_, cfg):
        plan = engine.build_well(S.WELL, cfg)
    late = _by_code(plan)["FLME1-1"]
    assert late["action"] == engine.ACTION_SUPPORT                    # crew 101 works on it, it is overdue
    assert [c["crew_id"] for c in late["recommended_crews"]] == [203, 202, 201]
    assert late["recommended_crews"][0]["activity_experience"]["completed_count"] == 5
    assert late["free_crews_available"] == 3                          # 204 is INACTIVE, 101 is the assigned crew


def test_actions_for_unassigned_unresolved_and_close_out(body, ctx):
    with ctx(body) as (_, cfg):
        acts = _by_code(engine.build_well(S.WELL, cfg))
    assert acts["FLME2-1"]["action"] == engine.ACTION_ASSIGN
    assert acts["FLME4-1"]["action"] == engine.ACTION_UNRESOLVED
    assert acts["FLME4-1"]["recommended_crews"] == [] and "not mapped" in acts["FLME4-1"]["no_recommendation_reason"]
    assert acts["FLME5-1"]["action"] == engine.ACTION_CLOSE_OUT and acts["FLME5-1"]["recommended_crews"] == []


def test_no_free_crew_gives_the_reason_with_the_counts(body, ctx):
    with ctx(body) as (_, cfg):
        acts = _by_code(engine.build_well(S.WELL, cfg))
    reason = acts["FLME3-1"]["no_recommendation_reason"]
    assert "None of the 1 crews" in reason and "1 whose team is busy" in reason


def test_the_number_of_recommended_crews_follows_the_setting(body, ctx):
    body["settings"]["maxCrewsPerActivity"] = 1
    with ctx(body) as (_, cfg):
        acts = _by_code(engine.build_well(S.WELL, cfg))
    assert [c["crew_id"] for c in acts["FLME1-1"]["recommended_crews"]] == [203]


def test_one_team_as_top_pick_for_several_activities_is_flagged(body, ctx, fake_db):
    # Crew 203 tops the welding activity it has done before; 202 (no history, more recent) tops the other one.
    # Under one supervisor they are the same people, so each recommendation says so.
    board = S.board()
    for c in board:
        if c["crew_id"] in (202, 203):
            c["supervisor_id"] = 9
    fake_db.rows[queries.BOARD] = board
    with ctx(body) as (_, cfg):
        acts = _by_code(engine.build_well(S.WELL, cfg))
    first, second = acts["FLME1-1"]["recommended_crews"][0], acts["FLME2-1"]["recommended_crews"][0]
    assert (first["crew_id"], second["crew_id"]) == (203, 202)
    assert first["same_team_top_pick_for"] == ["Activity FLME2-1"]
    assert second["same_team_top_pick_for"] == ["Activity FLME1-1"]


def test_different_teams_are_not_flagged(body, ctx):
    with ctx(body) as (_, cfg):
        acts = _by_code(engine.build_well(S.WELL, cfg))
    assert acts["FLME1-1"]["recommended_crews"][0]["same_team_top_pick_for"] == []


def test_summary_and_crew_type_plan(body, ctx):
    with ctx(body) as (_, cfg):
        plan = engine.build_well(S.WELL, cfg)
    assert plan["summary"] == {"delayed_activities": 4, "awaiting_close_out": 1, "overdue": 3, "start_slipping": 1,
                               "without_recorded_crew": 3, "crew_type_not_resolved": 1, "with_free_crew": 2,
                               "without_free_crew": 1, "max_days_overdue": 40}
    types = {t["crew_type_id"]: t for t in plan["crew_types"]}
    assert types[287]["free"] == 3 and types[287]["busy"] == 1 and types[287]["inactive"] == 1
    assert [c["crew_id"] for c in types[287]["free_crews"]] == [203, 202, 201]
    assert types[300]["team_busy"] == 1 and types[300]["free_crews"] == []


def test_unknown_well_and_completed_well(body, ctx, fake_db):
    with ctx(body) as (_, cfg):
        with pytest.raises(WellNotFound):
            engine.build_well("999", cfg)
    fake_db.rows[queries.WELL] = lambda p: [{**S.well_row(), "eng_completion_date": "2026-01-01"}]
    with ctx(body) as (_, cfg):
        plan = engine.build_well(S.WELL, cfg)
    assert plan["well_status"] == "COMPLETED" and plan["activities"] == []
    assert queries.DELAYED not in fake_db.keys_called()


def test_overview_compares_free_crews_with_the_delayed_work_per_type(body, ctx):
    with ctx(body) as (_, cfg):
        ov = engine.overview(cfg)
    types = {t["crew_type_id"]: t for t in ov["crew_types"]}
    assert types[287]["coverage"] == engine.COVER_SHORT and types[287]["free_shortfall"] == 2    # 3 free, 5 delayed
    assert types[300]["coverage"] == engine.COVER_NONE                                          # only team-busy
    assert types[500]["coverage"] == engine.COVER_NONE and types[500]["crews"] == 0             # no crew of the type
    assert types[400]["coverage"] == engine.COVER_IDLE                                          # free, nothing late
    assert [t["coverage"] for t in ov["crew_types"]][:2] == [engine.COVER_NONE, engine.COVER_NONE]
    k = ov["kpis"]
    assert (k["crews"], k["free"], k["busy"], k["team_busy"], k["inactive"]) == (7, 4, 1, 1, 1)
    assert k["crew_types_short"] == 3 and k["crew_type_not_resolved"] == 3 and k["wells_with_delays"] == 1
    assert ov["data_as_of"] == "2026-10-12"


def test_the_fleet_scan_is_reused_until_fresh(body, ctx, fake_db):
    with ctx(body) as (_, cfg):
        engine.overview(cfg)
        engine.build_well(S.WELL, cfg)
        assert fake_db.keys_called().count(queries.BOARD) == 1
        engine.overview(cfg, fresh=True)
        assert fake_db.keys_called().count(queries.BOARD) == 2
    body["settings"]["cacheSeconds"] = 0
    with ctx(body) as (_, cfg):
        engine.overview(cfg)
    assert fake_db.keys_called().count(queries.BOARD) == 3


def test_recent_days_is_bound_to_the_board(body, ctx, fake_db):
    body["settings"]["crewRecentDays"] = 45
    with ctx(body) as (_, cfg):
        engine.overview(cfg)
    assert [p for k, p in fake_db.calls if k == queries.BOARD] == [[45]]


def test_a_query_whose_columns_changed_is_refused(body, ctx):
    body["queries"][queries.WELLS]["columns"].append("no_such_column")
    with ctx(body) as (_, cfg):
        with pytest.raises(BadRequest, match="no longer returns no_such_column"):
            engine.overview(cfg)
