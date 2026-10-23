"""Well task activity: the front page's per-well figures, the evidence behind a well / day brief, the proof rows and
the query cost (ported from the original test_well_activity.py, Python half)."""
from __future__ import annotations

import json
from datetime import date

from app.features.dailyreport import data
from app.features.dailyreport.texts import parse_entries
from tests.features.dailyreport.conftest import (
    REPORT_DATE,
    activity_row,
    detail_row,
    make_row,
    report_context,
    seed_text,
)


def _setup(fake_db, *, activity=None, detail=None, tasks=None):
    fake_db.set(data.WELL_ACTIVITY, activity if activity is not None else [activity_row()])
    fake_db.set(data.WELL_DETAIL, detail if detail is not None else [])
    fake_db.set(data.DAILY_DETAILS, tasks or [])
    fake_db.set(data.DAILY_SUMMARY, [])


class TestFigures:
    def test_counts_are_reported_as_the_query_returned_them(self, fake_db):
        _setup(fake_db)
        with report_context() as ctx:
            well = ctx.activity.wells_for_date(REPORT_DATE, ctx.daily.get_dataset(REPORT_DATE))[0]
        assert (well.open_task_count, well.incomplete_task_count, well.ongoing_task_count) == (4, 2, 2)
        assert well.open_task_count == well.incomplete_task_count + well.ongoing_task_count
        assert well.task_state_counts == {"COMPLETED": 6, "ONGOING": 2, "NOT_STARTED": 1, "ENDED_NOT_COMPLETED": 1}
        assert well.last_task_date == date(2026, 7, 30)

    def test_the_report_date_count_is_the_resolved_logical_grain(self, fake_db):
        _setup(fake_db, tasks=[make_row(task_daily_id=1), make_row(task_daily_id=2, task_code="FLME1190-31474"),
                               make_row(task_daily_id=3, well_id=999)])
        with report_context() as ctx:
            wells = {w.well_id: w for w in ctx.activity.wells_for_date(REPORT_DATE, ctx.daily.get_dataset(REPORT_DATE))}
        assert wells[31474].today_reported_task_count == 2
        # A well that reported today is listed even if the counters missed it.
        assert wells[999].today_reported_task_count == 1 and wells[999].last_task_date == REPORT_DATE

    def test_expanding_many_wells_costs_one_query_not_one_per_well(self, fake_db):
        _setup(fake_db, activity=[activity_row(well_id=w) for w in (1, 2, 3)],
               detail=[detail_row(well_id=w) for w in (1, 2, 3)])
        with report_context() as ctx:
            for well_id in (1, 2, 3):
                assert len(ctx.activity.incomplete_tasks(REPORT_DATE, well_id)) == 1
        assert fake_db.count(data.WELL_DETAIL) == 1

    def test_results_are_reused_across_requests_until_refresh(self, fake_db):
        _setup(fake_db)
        for _ in range(2):
            with report_context() as ctx:
                ctx.activity.wells_for_date(REPORT_DATE, ctx.daily.get_dataset(REPORT_DATE))
        assert fake_db.count(data.WELL_ACTIVITY) == 1
        with report_context() as ctx:
            ctx.data.invalidate_date(REPORT_DATE)
            ctx.activity.wells_for_date(REPORT_DATE, ctx.daily.get_dataset(REPORT_DATE))
        assert fake_db.count(data.WELL_ACTIVITY) == 2

    def test_a_zero_ttl_turns_the_cache_off(self, fake_db):
        _setup(fake_db)
        for _ in range(2):
            with report_context(settings={"datasetCacheTtlSeconds": 0}) as ctx:
                ctx.daily.get_dataset(REPORT_DATE)
        assert fake_db.count(data.DAILY_DETAILS) == 2

    def test_another_database_never_shares_cached_rows(self, fake_db):
        _setup(fake_db)
        with report_context() as ctx:
            ctx.daily.get_dataset(REPORT_DATE)
        with report_context(db={"server": "other", "name": "otherdb", "user": "u", "password": "p"}) as ctx:
            ctx.daily.get_dataset(REPORT_DATE)
        assert fake_db.count(data.DAILY_DETAILS) == 2

    def test_an_unreadable_detail_row_never_loses_the_rest_of_the_well(self, fake_db):
        _setup(fake_db, detail=[detail_row(task_state="NOT_A_STATE"), detail_row(task_code="FLME1190-31474")])
        with report_context() as ctx:
            assert [t.task_code for t in ctx.activity.incomplete_tasks(REPORT_DATE, 31474)] == ["FLME1190-31474"]


class TestWellEvidence:
    def test_the_figures_definitions_and_constraints(self, fake_db):
        _setup(fake_db, detail=[detail_row(), detail_row(task_code="X-1", task_state="NOT_STARTED", actual_start=None)])
        with report_context() as ctx:
            evidence = ctx.activity.evidence(REPORT_DATE, ctx.daily.get_dataset(REPORT_DATE), 31474)
        assert evidence["task_activity"]["open_task_count"] == 4
        assert [t["task_state"] for t in evidence["ongoing_tasks"]] == ["ONGOING"]
        definitions = dict(evidence["definitions"])
        assert definitions.pop("task_states") == parse_entries(seed_text("task_state_definitions"))
        assert definitions == parse_entries(seed_text("well_activity_definitions"))
        assert evidence["constraints"] == parse_entries(seed_text("well_activity_constraints"))
        assert "progress" not in json.dumps(evidence["ongoing_tasks"])

    def test_a_well_with_no_task_evidence_gets_no_invented_zeros(self, fake_db):
        _setup(fake_db, activity=[])
        with report_context() as ctx:
            assert ctx.activity.evidence(REPORT_DATE, ctx.daily.get_dataset(REPORT_DATE), 31474) is None

    def test_a_long_ongoing_list_is_sampled_without_losing_the_total(self, fake_db):
        _setup(fake_db, detail=[detail_row(task_code=f"T-{i}") for i in range(5)])
        with report_context(settings={"ongoingTaskSampleLimit": 2}) as ctx:
            evidence = ctx.activity.evidence(REPORT_DATE, ctx.daily.get_dataset(REPORT_DATE), 31474)
        assert len(evidence["ongoing_tasks"]) == 2
        assert evidence["ongoing_tasks_truncated"] == {
            "included": 2, "total": 5, "note": seed_text("well_ongoing_truncated_note")}

    def test_the_same_evidence_serialises_identically_twice(self, fake_db):
        _setup(fake_db, detail=[detail_row()])
        dumps = []
        for _ in range(2):
            with report_context() as ctx:
                evidence = ctx.activity.evidence(REPORT_DATE, ctx.daily.get_dataset(REPORT_DATE), 31474)
                dumps.append(json.dumps(evidence, sort_keys=True, default=str))
        assert dumps[0] == dumps[1]


class TestDayOverview:
    WELLS = [activity_row(well_id=1, open_task_count=9, incomplete_task_count=5, ongoing_task_count=4),
             activity_row(well_id=2, open_task_count=1, incomplete_task_count=1, ongoing_task_count=0),
             activity_row(well_id=3, open_task_count=0, incomplete_task_count=0, ongoing_task_count=0),
             activity_row(well_id=4, open_task_count=9, incomplete_task_count=9, ongoing_task_count=0)]

    def test_it_counts_every_live_well_not_only_the_reporting_ones(self, fake_db):
        _setup(fake_db, activity=self.WELLS, tasks=[make_row(well_id=2)])
        with report_context() as ctx:
            day = ctx.activity.day_evidence(REPORT_DATE, ctx.daily.get_dataset(REPORT_DATE))
        assert day["well_counts"]["with_task_evidence"] == 4
        assert day["well_counts"]["reported_on_report_date"] == 1
        assert day["well_counts"]["with_open_tasks_and_nothing_reported"] == 2
        assert day["task_counts"]["open_total"] == 19
        # Ranked by open work, ties by ongoing then well id; a well with no open work is never an example.
        assert [w["well_id"] for w in day["wells_with_most_open_work"]] == [1, 4, 2]

    def test_a_long_list_is_sampled_without_losing_the_total(self, fake_db):
        _setup(fake_db, activity=self.WELLS)
        with report_context(settings={"topWellsSampleLimit": 1}) as ctx:
            day = ctx.activity.day_evidence(REPORT_DATE, ctx.daily.get_dataset(REPORT_DATE))
        assert len(day["wells_with_most_open_work"]) == 1
        assert day["wells_with_most_open_work_truncated"]["total"] == 3

    def test_no_well_evidence_at_all_returns_nothing(self, fake_db):
        _setup(fake_db, activity=[])
        with report_context() as ctx:
            assert ctx.activity.day_evidence(REPORT_DATE, ctx.daily.get_dataset(REPORT_DATE)) is None


class TestProofAndSql:
    def test_each_reason_restates_the_record(self, fake_db):
        _setup(fake_db, detail=[
            detail_row(),
            detail_row(task_code="B", task_state="NOT_STARTED", actual_start=None),
            detail_row(task_code="C", task_state="ENDED_NOT_COMPLETED", actual_end=date(2026, 7, 25)),
        ])
        with report_context() as ctx:
            proof = ctx.activity.proof_rows(REPORT_DATE, 31474)
        assert [(p["counts_as_ongoing"], p["counts_as_incomplete"]) for p in proof] == [
            (True, False), (False, True), (False, True)]
        assert "actual start 2026-07-20" in proof[0]["reason"] and "ongoing" in proof[0]["reason"]
        assert "no actual start" in proof[1]["reason"]
        assert "2026-07-25" in proof[2]["reason"]
        assert all("progress" not in p for p in proof)

    def test_the_queries_are_offered_as_executed_with_the_date_bound(self, fake_db):
        with report_context() as ctx:
            sources = ctx.activity.sql_sources(REPORT_DATE)
            expected = [ctx.run.request.queries[data.WELL_ACTIVITY].sql, ctx.run.request.queries[data.WELL_DETAIL].sql]
        assert [s["sql"] for s in sources] == expected
        assert all(s["parameters"] == ["? 1  report date = 2026-08-01"] for s in sources)
        assert all("2026-08-01" not in s["sql"] for s in sources)
        assert all("not-a-secret" not in json.dumps(s) for s in sources)
