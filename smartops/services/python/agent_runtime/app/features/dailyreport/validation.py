"""Deterministic validation: the single source of the daily classification rules (ported unchanged).

Not implemented, on purpose (daily_report_rules.md section 7 defines none of them): a quantity tolerance, whether a
quantity difference is an error, any UOM conversion, the meaning of task_daily.required. A percentage variance is
never computed.
"""
from __future__ import annotations

import datetime as _dt
import re
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, List, Optional

from app.features.dailyreport.models import (
    CrewMatchStatus,
    DailyTask,
    DataQualityFlag,
    DateStatus,
    MappingStatus,
    QuantityStatus,
)


def classify_quantity(planned: Optional[Decimal], actual: Optional[Decimal]) -> QuantityStatus:
    """actual NULL -> NO_ACTUAL; planned NULL -> NOT_VALIDATED; then equal / above / below, compared exactly."""
    if actual is None:
        return QuantityStatus.NO_ACTUAL
    if planned is None:
        return QuantityStatus.NOT_VALIDATED
    if actual == planned:
        return QuantityStatus.ON_PLAN
    if actual > planned:
        return QuantityStatus.ABOVE_PLAN
    return QuantityStatus.BELOW_PLAN


def classify_mapping(activity_id: Optional[str], activity_code: Optional[str], activity_description: Optional[str],
                     wbs: Optional[str], crew_code: Optional[str]) -> MappingStatus:
    """How far the task_code -> activity -> WBS / crew chain resolved; the first break in the chain is reported."""
    if not _has_text(activity_code):
        return MappingStatus.UNMAPPED_ACTIVITY
    if not _has_text(wbs):
        return MappingStatus.UNMAPPED_WBS
    if not _has_text(activity_description):
        return MappingStatus.UNMAPPED_DESCRIPTION
    if not _has_text(crew_code):
        return MappingStatus.UNMAPPED_CREW
    return MappingStatus.MAPPED


def classify_crew_match(crew_code: Optional[str], crew_type_code: Optional[str]) -> CrewMatchStatus:
    """Case-insensitive, trimmed exact comparison; either side missing is NOT_COMPARABLE, never guessed."""
    if not _has_text(crew_code) or not _has_text(crew_type_code):
        return CrewMatchStatus.NOT_COMPARABLE
    if crew_code.strip().casefold() == crew_type_code.strip().casefold():
        return CrewMatchStatus.MATCHED
    return CrewMatchStatus.MISMATCHED


def classify_date(planned: Optional[_dt.date], actual: Optional[_dt.date]) -> DateStatus:
    """Same shape as classify_quantity: no actual -> NO_ACTUAL, no plan -> NOT_VALIDATED; EARLY / LATE are facts."""
    if actual is None:
        return DateStatus.NO_ACTUAL
    if planned is None:
        return DateStatus.NOT_VALIDATED
    if actual == planned:
        return DateStatus.ON_TIME
    if actual < planned:
        return DateStatus.EARLY
    return DateStatus.LATE


def collect_data_quality_flags(row: Dict[str, Any], task: DailyTask) -> List[DataQualityFlag]:
    flags: List[DataQualityFlag] = []

    if task.mapping_status is MappingStatus.UNMAPPED_ACTIVITY:
        flags.append(DataQualityFlag.UNMAPPED_ACTIVITY)
    else:
        if not _has_text(task.wbs):
            flags.append(DataQualityFlag.UNMAPPED_WBS)
        if not _has_text(task.activity_description):
            flags.append(DataQualityFlag.UNMAPPED_DESCRIPTION)
        if not _has_text(task.crew_code):
            flags.append(DataQualityFlag.UNMAPPED_CREW)

    if not _has_text(task.task_code) or not _has_text(task.activity_id):
        flags.append(DataQualityFlag.MALFORMED_TASK_CODE)

    if not _has_text(task.uom_code):
        flags.append(DataQualityFlag.MISSING_UOM)

    if int(row.get("daily_data_json_invalid") or 0) == 1:
        flags.append(DataQualityFlag.INVALID_DAILY_JSON)

    if int(row.get("actual_quantity_unparseable") or 0) == 1:
        flags.append(DataQualityFlag.UNPARSEABLE_ACTUAL_QUANTITY)

    if int(row.get("group_actual_entry_count") or 0) > 1:
        flags.append(DataQualityFlag.DUPLICATE_ACTUAL_ENTRY)
    elif int(row.get("group_row_count") or 1) > 1:
        flags.append(DataQualityFlag.MULTIPLE_TASK_ROWS)

    if task.planned is None:
        flags.append(DataQualityFlag.MISSING_PLANNED)

    if task.actual_start is not None and task.actual_end is not None and task.actual_end < task.actual_start:
        flags.append(DataQualityFlag.INVALID_DATE_SEQUENCE)

    return flags


def build_task(row: Dict[str, Any]) -> DailyTask:
    """One DAILY_DETAILS row as a classified DailyTask."""
    planned = to_decimal(row.get("planned"))
    actual = to_decimal(row.get("actual_quantity"))
    activity_id = clean(row.get("activity_id"))
    activity_code = clean(row.get("activity_code"))
    activity_description = clean(row.get("activity_description"))
    wbs = clean(row.get("wbs"))
    crew_code = clean(row.get("crew_code"))
    crew_type_code = clean(row.get("crew_type_code"))
    planned_start = as_date(row.get("planned_start"))
    planned_end = as_date(row.get("planned_end"))
    actual_start = as_date(row.get("actual_start"))
    actual_end = as_date(row.get("actual_end"))

    task = DailyTask(
        task_daily_id=int(row["task_daily_id"]),
        well_id=int(row["well_id"]),
        action_on=as_date(row["action_on"]),
        schedule_id=to_int(row.get("schedule_id")),
        task_code=clean(row.get("task_code")),
        activity_id=activity_id,
        activity_code=activity_code,
        activity_description=activity_description,
        wbs=wbs,
        crew_code=crew_code,
        uom_id=to_int(row.get("uom_id")),
        uom_code=clean(row.get("uom_code")),
        activity_uom=clean(row.get("activity_uom")),
        crew_id=to_int(row.get("crew_id")),
        crew_type_id=to_int(row.get("crew_type_id")),
        crew_type_name=clean(row.get("crew_type_name")),
        crew_type_code=crew_type_code,
        crew_instance_code=clean(row.get("crew_instance_code")),
        crew_supervisor=clean(row.get("crew_supervisor")),
        crew_employees=to_name_list(row.get("crew_employee_names")),
        planned_start=planned_start,
        planned_end=planned_end,
        actual_start=actual_start,
        actual_end=actual_end,
        planned=planned,
        progress=to_decimal(row.get("progress")),
        actual_quantity=actual,
        actual_quantity_raw=clean(row.get("actual_quantity_raw")),
        daily_completed=to_bool(row.get("daily_completed")),
        ph_name=clean(row.get("ph_name")),
        quantity_status=classify_quantity(planned, actual),
        mapping_status=classify_mapping(activity_id, activity_code, activity_description, wbs, crew_code),
        crew_match_status=classify_crew_match(crew_code, crew_type_code),
        start_date_status=classify_date(planned_start, actual_start),
        end_date_status=classify_date(planned_end, actual_end),
        group_row_count=int(row.get("group_row_count") or 1),
        group_actual_entry_count=int(row.get("group_actual_entry_count") or 0),
    )
    task.data_quality_flags = collect_data_quality_flags(row, task)
    return task


# ---------------------------------------------------------------------------------------------------------------
# conversion helpers: tolerant of one malformed value, never of a silent one
# ---------------------------------------------------------------------------------------------------------------
def _has_text(value: Optional[str]) -> bool:
    return value is not None and str(value).strip() != ""


def clean(value: Any) -> Optional[str]:
    """Trim and collapse internal whitespace; empty becomes None (one WBS never shows as two wrapped groups)."""
    if value is None:
        return None
    text = re.sub(r"\s+", " ", str(value)).strip()
    return text or None


def to_decimal(value: Any) -> Optional[Decimal]:
    if value is None:
        return None
    if isinstance(value, Decimal):
        return value
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return None


def to_name_list(value: Any) -> List[str]:
    if value is None:
        return []
    return [name.strip() for name in str(value).split(",") if name.strip()]


def to_int(value: Any) -> Optional[int]:
    if value is None:
        return None
    try:
        return int(value)
    except (ValueError, TypeError):
        return None


def to_bool(value: Any) -> Optional[bool]:
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float, Decimal)):
        return bool(value)
    text = str(value).strip().lower()
    if text in {"true", "1", "yes"}:
        return True
    if text in {"false", "0", "no"}:
        return False
    return None


def as_date(value: Any) -> Optional[_dt.date]:
    """A database date value as a date: a datetime keeps its calendar day, ISO text is parsed."""
    if value is None:
        return None
    if isinstance(value, _dt.datetime):
        return value.date()
    if isinstance(value, _dt.date):
        return value
    text = str(value).strip()
    if not text:
        return None
    return _dt.date.fromisoformat(text[:10])
