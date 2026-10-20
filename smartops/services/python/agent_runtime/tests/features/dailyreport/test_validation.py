"""Classification of one daily row: quantity, mapping, UOM, crew match, dates and data-quality flags (ported from
the original test_quantity_validation.py, test_crew_match_and_date_validation.py and test_mapping_and_uom.py)."""
from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal

import pytest

from app.features.dailyreport.models import CrewMatchStatus, DataQualityFlag, DateStatus, MappingStatus, QuantityStatus
from app.features.dailyreport.validation import (
    build_task,
    classify_crew_match,
    classify_date,
    classify_mapping,
    classify_quantity,
)
from tests.features.dailyreport.conftest import REPORT_DATE, make_row


def d(value) -> Decimal:
    return Decimal(str(value))


class TestClassifyQuantity:
    def test_equal_is_on_plan(self):
        assert classify_quantity(d(15), d(15)) is QuantityStatus.ON_PLAN

    def test_above_and_below(self):
        assert classify_quantity(d(15), d(20)) is QuantityStatus.ABOVE_PLAN
        assert classify_quantity(d(15), d(10)) is QuantityStatus.BELOW_PLAN

    def test_no_actual_wins(self):
        assert classify_quantity(d(15), None) is QuantityStatus.NO_ACTUAL
        assert classify_quantity(None, None) is QuantityStatus.NO_ACTUAL
        assert classify_quantity(d(0), None) is QuantityStatus.NO_ACTUAL

    def test_planned_zero_with_actual_is_above_plan_not_an_error(self):
        assert classify_quantity(d(0), d(12)) is QuantityStatus.ABOVE_PLAN
        assert classify_quantity(d(0), d(0)) is QuantityStatus.ON_PLAN

    def test_missing_planned_is_not_validated(self):
        assert classify_quantity(None, d(5)) is QuantityStatus.NOT_VALIDATED

    @pytest.mark.parametrize("planned,actual", [("15.0000", "15"), ("15.30", "15.3"), ("0.0", "0")])
    def test_decimal_scale_does_not_affect_equality(self, planned, actual):
        assert classify_quantity(d(planned), d(actual)) is QuantityStatus.ON_PLAN

    def test_no_tolerance_is_applied(self):
        assert classify_quantity(d("15.0000"), d("14.9999")) is QuantityStatus.BELOW_PLAN


class TestQuantityOnBuiltTasks:
    def test_above_plan_carries_no_error_flag(self):
        task = build_task(make_row(planned=10, actual_quantity=14))
        assert task.quantity_status is QuantityStatus.ABOVE_PLAN
        assert task.data_quality_flags == []

    def test_missing_planned_is_flagged_and_not_validated(self):
        task = build_task(make_row(planned=None, actual_quantity=7))
        assert task.quantity_status is QuantityStatus.NOT_VALIDATED
        assert DataQualityFlag.MISSING_PLANNED in task.data_quality_flags

    def test_unparseable_actual_is_flagged_and_treated_as_no_actual(self):
        task = build_task(make_row(actual_quantity=None, actual_quantity_raw="not-a-number",
                                   actual_quantity_unparseable=1))
        assert task.quantity_status is QuantityStatus.NO_ACTUAL
        assert DataQualityFlag.UNPARSEABLE_ACTUAL_QUANTITY in task.data_quality_flags

    def test_invalid_daily_json_is_flagged_without_losing_the_task(self):
        task = build_task(make_row(actual_quantity=None, actual_quantity_raw=None, daily_data_json_valid=0,
                                   daily_data_json_invalid=1))
        assert DataQualityFlag.INVALID_DAILY_JSON in task.data_quality_flags
        assert task.well_id == 31474

    def test_duplicates_are_flagged_distinctly(self):
        assert DataQualityFlag.DUPLICATE_ACTUAL_ENTRY in build_task(
            make_row(group_row_count=3, group_actual_entry_count=2)).data_quality_flags
        multi = build_task(make_row(group_row_count=3, group_actual_entry_count=1)).data_quality_flags
        assert DataQualityFlag.MULTIPLE_TASK_ROWS in multi and DataQualityFlag.DUPLICATE_ACTUAL_ENTRY not in multi


class TestMapping:
    def test_fully_mapped(self):
        task = build_task(make_row())
        assert task.mapping_status is MappingStatus.MAPPED
        assert task.data_quality_flags == []
        assert task.crew_employees == ["Ali", "Omar"]

    def test_unmapped_activity_is_exposed_not_filled(self):
        task = build_task(make_row(activity_code=None, activity_description=None, wbs=None, crew_code=None))
        assert task.mapping_status is MappingStatus.UNMAPPED_ACTIVITY
        assert DataQualityFlag.UNMAPPED_ACTIVITY in task.data_quality_flags
        assert task.wbs is None and task.crew_code is None

    @pytest.mark.parametrize("field,status", [("wbs", MappingStatus.UNMAPPED_WBS),
                                              ("activity_description", MappingStatus.UNMAPPED_DESCRIPTION),
                                              ("crew_code", MappingStatus.UNMAPPED_CREW)])
    def test_the_first_break_in_the_chain_is_reported(self, field, status):
        assert build_task(make_row(**{field: None})).mapping_status is status

    def test_task_code_without_a_dash_is_malformed(self):
        task = build_task(make_row(task_code="FLME1180", activity_id=None, activity_code=None,
                                   activity_description=None, wbs=None, crew_code=None))
        assert DataQualityFlag.MALFORMED_TASK_CODE in task.data_quality_flags

    def test_classify_mapping_is_whitespace_aware(self):
        assert classify_mapping("FLME1180", "  ", "desc", "wbs", "crew") is MappingStatus.UNMAPPED_ACTIVITY

    def test_whitespace_runs_are_collapsed(self):
        assert build_task(make_row(wbs="Straightline\n  Welding")).wbs == "Straightline Welding"


class TestUom:
    def test_missing_uom_is_flagged_and_stays_visible(self):
        task = build_task(make_row(uom_id=None, uom_code=None, activity_uom="Section"))
        assert DataQualityFlag.MISSING_UOM in task.data_quality_flags
        assert task.uom_key == ""
        assert task.uom_code is None and task.activity_uom == "Section"   # never substituted


class TestCrewMatch:
    def test_matching_and_tolerant(self):
        assert classify_crew_match("MWS0602", "MWS0602") is CrewMatchStatus.MATCHED
        assert classify_crew_match(" mws0602 ", "MWS0602") is CrewMatchStatus.MATCHED

    def test_mismatched(self):
        assert classify_crew_match("MWS0602", "FCE-0402") is CrewMatchStatus.MISMATCHED

    @pytest.mark.parametrize("planned,actual", [(None, "MWS0602"), ("MWS0602", None), (None, None)])
    def test_either_side_missing_is_not_comparable(self, planned, actual):
        assert classify_crew_match(planned, actual) is CrewMatchStatus.NOT_COMPARABLE

    def test_on_built_tasks(self):
        assert build_task(make_row(crew_type_code="FCE-0402")).crew_match_status is CrewMatchStatus.MISMATCHED
        assert build_task(make_row(crew_id=None, crew_type_code=None)).crew_match_status \
            is CrewMatchStatus.NOT_COMPARABLE


class TestDates:
    def test_classification(self):
        assert classify_date(REPORT_DATE, REPORT_DATE) is DateStatus.ON_TIME
        assert classify_date(REPORT_DATE, REPORT_DATE - timedelta(days=2)) is DateStatus.EARLY
        assert classify_date(REPORT_DATE, REPORT_DATE + timedelta(days=2)) is DateStatus.LATE
        assert classify_date(REPORT_DATE, None) is DateStatus.NO_ACTUAL
        assert classify_date(None, None) is DateStatus.NO_ACTUAL
        assert classify_date(None, REPORT_DATE) is DateStatus.NOT_VALIDATED

    def test_end_before_start_is_flagged(self):
        task = build_task(make_row(actual_start=REPORT_DATE, actual_end=REPORT_DATE - timedelta(days=1)))
        assert DataQualityFlag.INVALID_DATE_SEQUENCE in task.data_quality_flags
        assert DataQualityFlag.INVALID_DATE_SEQUENCE not in build_task(make_row(actual_end=None)).data_quality_flags

    def test_three_independent_verdicts(self):
        task = build_task(make_row(planned=10, actual_quantity=10, crew_type_code="FCE-0402", planned_end=REPORT_DATE,
                                   actual_end=REPORT_DATE + timedelta(days=1)))
        assert task.quantity_status is QuantityStatus.ON_PLAN
        assert task.crew_match_status is CrewMatchStatus.MISMATCHED
        assert task.end_date_status is DateStatus.LATE

    def test_datetime_columns_are_read_as_their_day(self):
        task = build_task(make_row(action_on=datetime(2026, 8, 1, 0, 0), actual_start=datetime(2026, 8, 1, 7, 30)))
        assert task.action_on == REPORT_DATE
        assert task.start_date_status is DateStatus.ON_TIME
