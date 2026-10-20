"""Response shapes, as the original app/schemas/daily.py returned them (snake_case fields).

Quantities cross the wire as strings so the exact decimal the database returned reaches the browser unrounded.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Dict, List, Optional

from pydantic import BaseModel, Field

from app.features.dailyreport.models import DailyTask, LogicalTask, MilestoneAlert, WellTaskActivity


def decimal_to_str(value: Optional[Decimal]) -> Optional[str]:
    if value is None:
        return None
    normalised = value.normalize()
    if normalised == normalised.to_integral_value():
        try:
            return str(normalised.quantize(Decimal(1)))
        except Exception:  # noqa: BLE001
            return format(normalised, "f")
    return format(normalised, "f")


def quantity_str(value: Optional[Decimal]) -> Optional[str]:
    return None if value is None else format(value.normalize(), "f")


class TaskOut(BaseModel):
    """One logical daily task (the detail dataset row)."""

    task_daily_id: int
    well_id: int
    action_on: date
    schedule_id: Optional[int] = None
    task_code: Optional[str] = None
    activity_id: Optional[str] = None
    activity_code: Optional[str] = None
    activity_description: Optional[str] = None
    wbs: Optional[str] = None
    crew_code: Optional[str] = None
    uom_id: Optional[int] = None
    uom_code: Optional[str] = None
    activity_uom: Optional[str] = None
    crew_id: Optional[int] = None
    crew_type_name: Optional[str] = None
    crew_type_code: Optional[str] = None
    crew_instance_code: Optional[str] = None
    crew_supervisor: Optional[str] = None
    crew_employees: List[str] = Field(default_factory=list)
    planned_start: Optional[date] = None
    planned_end: Optional[date] = None
    actual_start: Optional[date] = None
    actual_end: Optional[date] = None
    planned: Optional[str] = None
    actual_quantity: Optional[str] = None
    progress: Optional[str] = None
    daily_completed: Optional[bool] = None
    ph_name: Optional[str] = None
    quantity_status: str
    mapping_status: str
    crew_match_status: str
    start_date_status: str
    end_date_status: str
    data_quality_flags: List[str] = []
    group_row_count: int = 1
    group_actual_entry_count: int = 0

    @classmethod
    def from_task(cls, task: DailyTask) -> "TaskOut":
        return cls(
            task_daily_id=task.task_daily_id, well_id=task.well_id, action_on=task.action_on,
            schedule_id=task.schedule_id, task_code=task.task_code, activity_id=task.activity_id,
            activity_code=task.activity_code, activity_description=task.activity_description, wbs=task.wbs,
            crew_code=task.crew_code, uom_id=task.uom_id, uom_code=task.uom_code, activity_uom=task.activity_uom,
            crew_id=task.crew_id, crew_type_name=task.crew_type_name, crew_type_code=task.crew_type_code,
            crew_instance_code=task.crew_instance_code, crew_supervisor=task.crew_supervisor,
            crew_employees=task.crew_employees, planned_start=task.planned_start, planned_end=task.planned_end,
            actual_start=task.actual_start, actual_end=task.actual_end, planned=decimal_to_str(task.planned),
            actual_quantity=decimal_to_str(task.actual_quantity), progress=decimal_to_str(task.progress),
            daily_completed=task.daily_completed, ph_name=task.ph_name,
            quantity_status=task.quantity_status.value, mapping_status=task.mapping_status.value,
            crew_match_status=task.crew_match_status.value, start_date_status=task.start_date_status.value,
            end_date_status=task.end_date_status.value,
            data_quality_flags=[flag.value for flag in task.data_quality_flags],
            group_row_count=task.group_row_count, group_actual_entry_count=task.group_actual_entry_count,
        )


class GroupQuantitiesMixin(BaseModel):
    """Totals only when every task shares one unit; a null total means "not summable here", never zero."""

    well_count: int
    task_count: int
    uom_code: Optional[str] = None
    uom_codes: List[str] = Field(default_factory=list)
    quantities_summable: bool = True
    planned_quantity: Optional[str] = None
    actual_quantity: Optional[str] = None
    data_quality_counts: Dict[str, int] = {}


class ActivityGroupOut(GroupQuantitiesMixin):
    activity_code: Optional[str] = None
    activity_description: Optional[str] = None
    wbs: Optional[str] = None
    status: str


class WbsGroupOut(GroupQuantitiesMixin):
    wbs: Optional[str] = None
    status: str
    activities: List[ActivityGroupOut] = []


class StatusGroupOut(GroupQuantitiesMixin):
    status: str
    wbs_groups: List[WbsGroupOut] = []


class DayTotalsOut(BaseModel):
    task_count: int
    well_count: int
    status_counts: Dict[str, int]


class DataQualityOut(BaseModel):
    flag_counts: Dict[str, int] = {}
    affected_task_count: int = 0
    raw_row_count: int = 0
    logical_task_count: int = 0
    superseded_row_count: int = 0
    multi_row_task_count: int = 0
    duplicate_actual_task_count: int = 0
    invalid_json_row_count: int = 0
    unparseable_actual_row_count: int = 0


class SummaryResponse(BaseModel):
    report_date: date
    generated_at: str
    totals: DayTotalsOut
    data_quality: DataQualityOut
    status_groups: List[StatusGroupOut]
    view_mode: str
    detail_view_task_threshold: int
    tasks: List[TaskOut] = []


class DetailResponse(BaseModel):
    report_date: date
    task_count: int
    tasks: List[TaskOut]


class WellTaskSummaryOut(BaseModel):
    well_id: int
    task_count: int
    status_counts: Dict[str, int]
    planned_quantity: Optional[str] = None
    actual_quantity: Optional[str] = None
    uom_code: Optional[str] = None


class LogicalTaskOut(BaseModel):
    """One logical task in its latest recorded state as of the report date (never carries progress)."""

    well_id: int
    schedule_id: Optional[int] = None
    task_code: Optional[str] = None
    task_state: str
    last_task_date: Optional[date] = None
    actual_start: Optional[date] = None
    actual_end: Optional[date] = None
    completed: Optional[bool] = None
    activity_id: Optional[str] = None
    activity_code: Optional[str] = None
    activity_description: Optional[str] = None
    wbs: Optional[str] = None

    @classmethod
    def from_task(cls, task: LogicalTask) -> "LogicalTaskOut":
        return cls(well_id=task.well_id, schedule_id=task.schedule_id, task_code=task.task_code,
                   task_state=task.task_state.value, last_task_date=task.latest_action_on,
                   actual_start=task.actual_start, actual_end=task.actual_end, completed=task.completed,
                   activity_id=task.activity_id, activity_code=task.activity_code,
                   activity_description=task.activity_description, wbs=task.wbs)


class WellTaskActivityOut(BaseModel):
    well_id: int
    today_reported_task_count: int
    has_task_on_report_date: bool
    open_task_count: int
    incomplete_task_count: int
    ongoing_task_count: int
    not_started_task_count: int
    ended_not_completed_task_count: int
    completed_task_count: int
    logical_task_count: int
    task_state_counts: Dict[str, int] = {}
    last_task_date: Optional[date] = None

    @classmethod
    def from_activity(cls, activity: WellTaskActivity) -> "WellTaskActivityOut":
        return cls(
            well_id=activity.well_id, today_reported_task_count=activity.today_reported_task_count,
            has_task_on_report_date=activity.has_task_on_report_date, open_task_count=activity.open_task_count,
            incomplete_task_count=activity.incomplete_task_count, ongoing_task_count=activity.ongoing_task_count,
            not_started_task_count=activity.not_started_task_count,
            ended_not_completed_task_count=activity.ended_not_completed_task_count,
            completed_task_count=activity.completed_task_count, logical_task_count=activity.logical_task_count,
            task_state_counts=activity.task_state_counts, last_task_date=activity.last_task_date,
        )


class WellActivityResponse(BaseModel):
    report_date: date
    well_count: int
    wells: List[WellTaskActivityOut]
    tasks: List[LogicalTaskOut] = []


class GroupDetailsResponse(BaseModel):
    report_date: date
    filters: Dict[str, Optional[str]]
    task_count: int
    well_count: int
    wells: List[WellTaskSummaryOut]
    tasks: List[TaskOut]


class WellDetailResponse(BaseModel):
    report_date: date
    well_id: int
    task_count: int
    tasks: List[TaskOut]
    #: Set only when the well reported nothing on the date but is a live well with task evidence.
    activity: Optional[WellTaskActivityOut] = None
    open_tasks: List[LogicalTaskOut] = []


class RecentDateOut(BaseModel):
    report_date: date
    row_count: int
    well_count: int


class RecentDatesResponse(BaseModel):
    dates: List[RecentDateOut]


class MilestoneAlertOut(BaseModel):
    well_id: int
    milestone: str
    milestone_label: str
    deadline_date: date
    days_remaining: int
    overdue: bool
    pegged_date: Optional[date] = None
    flaf_issue_date: Optional[date] = None
    ex_rig_on_date: Optional[date] = None
    rig_on_date: Optional[date] = None
    ex_rig_off_date: Optional[date] = None
    rig_off_date: Optional[date] = None

    @classmethod
    def from_alert(cls, alert: MilestoneAlert) -> "MilestoneAlertOut":
        return cls(well_id=alert.well_id, milestone=alert.milestone, milestone_label=alert.label,
                   deadline_date=alert.deadline_date, days_remaining=alert.days_remaining, overdue=alert.overdue,
                   pegged_date=alert.pegged_date, flaf_issue_date=alert.flaf_issue_date,
                   ex_rig_on_date=alert.ex_rig_on_date, rig_on_date=alert.rig_on_date,
                   ex_rig_off_date=alert.ex_rig_off_date, rig_off_date=alert.rig_off_date)


class MilestonesResponse(BaseModel):
    generated_at: str
    window_days: int
    upcoming: List[MilestoneAlertOut]
    overdue_count: int
    overdue: List[MilestoneAlertOut]
