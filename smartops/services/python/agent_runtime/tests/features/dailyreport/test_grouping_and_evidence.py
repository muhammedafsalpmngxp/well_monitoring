"""Grouping (no cross-unit totals), the representative evidence sample and the evidence payload (ported from the
original test_mapping_and_uom.py, test_evidence_sampling.py and test_api_and_llm.py's evidence checks)."""
from __future__ import annotations

from decimal import Decimal

from app.features.dailyreport.evidence import representative_sample
from app.features.dailyreport.grouping import GroupingService
from app.features.dailyreport.models import DailyDataset, DataQualityFlag, DayCounters, QuantityStatus
from app.features.dailyreport.texts import parse_entries
from app.features.dailyreport.validation import build_task
from tests.features.dailyreport.conftest import REPORT_DATE, make_row, prompts_with, report_context, seed_text


def _dataset(tasks) -> DailyDataset:
    return DailyDataset(report_date=REPORT_DATE, tasks=list(tasks), counters=DayCounters())


def _task(well_id, planned_actual, task_daily_id):
    planned, actual = planned_actual
    return build_task(make_row(task_daily_id=task_daily_id, well_id=well_id, planned=planned, actual_quantity=actual))


ON_PLAN, BELOW_PLAN, ABOVE_PLAN, NO_ACTUAL, NOT_VALIDATED = (10, 10), (10, 5), (10, 20), (10, None), (None, 10)


class TestGrouping:
    def test_different_units_are_never_added_together(self):
        tasks = [build_task(make_row(task_daily_id=1, uom_code="Km", planned=1, actual_quantity=1)),
                 build_task(make_row(task_daily_id=2, uom_code="M", planned=1000, actual_quantity=1000))]
        group = GroupingService().build(_dataset(tasks))[0]
        assert group.task_count == 2
        assert group.quantities_summable is False
        assert group.uom_codes == ["Km", "M"]
        assert group.planned_quantity is None and group.actual_quantity is None

    def test_quantities_are_summed_only_within_one_unit(self):
        tasks = [build_task(make_row(task_daily_id=1, uom_code="Joint", planned=10, actual_quantity=10)),
                 build_task(make_row(task_daily_id=2, uom_code="Joint", planned=5, actual_quantity=5)),
                 build_task(make_row(task_daily_id=3, uom_code="Joint", planned=5, actual_quantity=4)),
                 build_task(make_row(task_daily_id=4, uom_code="m3", planned=100, actual_quantity=90))]
        groups = {g.status.value: g for g in GroupingService().build(_dataset(tasks))}
        assert groups["ON_PLAN"].planned_quantity == Decimal(15)
        assert groups["BELOW_PLAN"].quantities_summable is False

    def test_status_sections_keep_definition_order(self):
        tasks = [_task(1, NO_ACTUAL, 1), _task(2, ABOVE_PLAN, 2), _task(3, ON_PLAN, 3)]
        assert [g.status for g in GroupingService().build(_dataset(tasks))] == [
            QuantityStatus.ON_PLAN, QuantityStatus.ABOVE_PLAN, QuantityStatus.NO_ACTUAL]

    def test_no_uom_at_all_still_totals(self):
        tasks = [build_task(make_row(task_daily_id=i, uom_id=None, uom_code=None, planned=5, actual_quantity=5))
                 for i in (1, 2)]
        group = GroupingService().build(_dataset(tasks))[0]
        assert group.quantities_summable is True and group.uom_code is None
        assert group.data_quality_counts[DataQualityFlag.MISSING_UOM.value] == 2

    def test_day_totals_carry_no_cross_unit_quantity(self):
        totals = GroupingService().day_totals(_dataset([_task(1, ON_PLAN, 1)]))
        assert "planned_quantity" not in totals
        assert totals["status_counts"]["ON_PLAN"] == 1 and totals["status_counts"]["NO_ACTUAL"] == 0


class TestRepresentativeSample:
    def test_every_present_status_appears_even_when_one_dominates(self):
        tasks = [_task(w, ON_PLAN, w) for w in range(1, 31)]
        tasks += [_task(1001, ABOVE_PLAN, 1001), _task(1002, BELOW_PLAN, 1002), _task(1003, NO_ACTUAL, 1003),
                  _task(1004, NOT_VALIDATED, 1004)]
        assert {t.quantity_status for t in representative_sample(tasks, 5)} == set(QuantityStatus)

    def test_wells_are_spread_not_clustered(self):
        tasks = [_task(1, ON_PLAN, n) for n in range(10)] + [_task(w, ON_PLAN, 100 + w) for w in range(2, 7)]
        assert {t.well_id for t in representative_sample(tasks, 6)} == {1, 2, 3, 4, 5, 6}

    def test_limit_and_determinism(self):
        tasks = [_task(w, ON_PLAN, w) for w in range(1, 51)]
        assert len(representative_sample(tasks, 10)) == 10
        assert len(representative_sample(tasks, 1)) == 1
        first = [t.task_daily_id for t in representative_sample(tasks, 4)]
        assert first == [t.task_daily_id for t in representative_sample(tasks, 4)]


class TestEvidencePayload:
    def test_definitions_constraints_and_notes_are_the_tenants_texts(self):
        with report_context() as ctx:
            tasks = [_task(1, ON_PLAN, 1)]
            payload = ctx.evidence.build(_dataset(tasks), tasks, scope="day")
        assert payload["status_definitions"] == parse_entries(seed_text("evidence_status_definitions"))
        assert list(payload["status_definitions"]) == [s.value for s in QuantityStatus]
        assert payload["constraints"]["quantity_tolerance"] == "not defined in the business rules"
        assert payload["data_quality"]["note"] == seed_text("evidence_data_quality_note")
        assert "crew_match_definitions" in payload and "date_status_definitions" in payload
        assert payload["tasks"][0]["crew_match_status"] == "MATCHED"

    def test_a_changed_definition_reaches_the_evidence(self):
        with report_context(prompts=prompts_with(evidence_status_definitions="ON_PLAN: Same as the plan.")) as ctx:
            tasks = [_task(1, ON_PLAN, 1)]
            payload = ctx.evidence.build(_dataset(tasks), tasks, scope="day")
        assert payload["status_definitions"] == {"ON_PLAN": "Same as the plan."}

    def test_mixed_units_withhold_totals_and_say_why(self):
        tasks = [build_task(make_row(task_daily_id=1, uom_code="Joint")),
                 build_task(make_row(task_daily_id=2, uom_code="m3"))]
        with report_context() as ctx:
            payload = ctx.evidence.build(_dataset(tasks), tasks, scope="day")
        assert payload["summary"]["planned_quantity"] is None
        assert payload["summary"]["quantities_withheld_reason"] == seed_text("evidence_quantities_withheld")

    def test_an_empty_scope_states_one_fact_not_zeroes(self):
        with report_context() as ctx:
            payload = ctx.evidence.build(_dataset([]), [], scope="well", well_id=30349)
        assert payload["summary"]["no_daily_entry"] is True
        assert "well_count" not in payload["summary"]
        assert "tasks" not in payload and "status_definitions" not in payload

    def test_the_task_sample_size_comes_from_the_settings(self):
        tasks = [_task(w, ON_PLAN, w) for w in range(1, 21)]
        with report_context(settings={"evidenceTaskLimitOther": 3}) as ctx:
            payload = ctx.evidence.build(_dataset(tasks), tasks, scope="day")
        assert len(payload["tasks"]) == 3
        assert payload["tasks_truncated"]["total"] == 20
        with report_context(settings={"evidenceTaskLimitWell": 50, "explainMaxWells": 4}) as ctx:
            assert len(ctx.evidence.build(_dataset(tasks), tasks, scope="well")["tasks"]) == 4

    def test_the_evidence_carries_classifications_never_sql(self):
        tasks = [_task(1, ON_PLAN, 1)]
        with report_context() as ctx:
            text = str(ctx.evidence.build(_dataset(tasks), tasks, scope="day")).lower()
        assert "select " not in text and "task_daily as td" not in text
