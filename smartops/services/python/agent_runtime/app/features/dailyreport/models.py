"""Domain objects of the daily morning brief (ported from the original app/models/daily.py and app/models/wells.py).

The status enums are the engine's own classifications, computed once in validation.py; neither the UI nor a model
recomputes them. Definition order is display order.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from enum import Enum
from typing import List, Optional


class QuantityStatus(str, Enum):
    ON_PLAN = "ON_PLAN"
    ABOVE_PLAN = "ABOVE_PLAN"
    BELOW_PLAN = "BELOW_PLAN"
    NO_ACTUAL = "NO_ACTUAL"
    #: An actual was reported but there is no planned quantity to compare it against.
    NOT_VALIDATED = "NOT_VALIDATED"


class MappingStatus(str, Enum):
    MAPPED = "MAPPED"
    UNMAPPED_ACTIVITY = "UNMAPPED_ACTIVITY"
    UNMAPPED_DESCRIPTION = "UNMAPPED_DESCRIPTION"
    UNMAPPED_WBS = "UNMAPPED_WBS"
    UNMAPPED_CREW = "UNMAPPED_CREW"


class CrewMatchStatus(str, Enum):
    """The WBS-planned crew (crew_code) against the type of the crew recorded on the task (crew_type_code)."""

    MATCHED = "MATCHED"
    MISMATCHED = "MISMATCHED"
    NOT_COMPARABLE = "NOT_COMPARABLE"


class DateStatus(str, Enum):
    """One reported actual date against its planned date (start against start, end against end)."""

    ON_TIME = "ON_TIME"
    EARLY = "EARLY"
    LATE = "LATE"
    NO_ACTUAL = "NO_ACTUAL"
    NOT_VALIDATED = "NOT_VALIDATED"


class DataQualityFlag(str, Enum):
    UNMAPPED_ACTIVITY = "UNMAPPED_ACTIVITY"
    UNMAPPED_DESCRIPTION = "UNMAPPED_DESCRIPTION"
    UNMAPPED_WBS = "UNMAPPED_WBS"
    UNMAPPED_CREW = "UNMAPPED_CREW"
    MISSING_UOM = "MISSING_UOM"
    INVALID_DAILY_JSON = "INVALID_DAILY_JSON"
    UNPARSEABLE_ACTUAL_QUANTITY = "UNPARSEABLE_ACTUAL_QUANTITY"
    DUPLICATE_ACTUAL_ENTRY = "DUPLICATE_ACTUAL_ENTRY"
    MULTIPLE_TASK_ROWS = "MULTIPLE_TASK_ROWS"
    MISSING_PLANNED = "MISSING_PLANNED"
    MALFORMED_TASK_CODE = "MALFORMED_TASK_CODE"
    #: actual_end recorded earlier than actual_start.
    INVALID_DATE_SEQUENCE = "INVALID_DATE_SEQUENCE"


@dataclass
class DailyTask:
    """One logical daily task on the report date, for one live well."""

    task_daily_id: int
    well_id: int
    action_on: date
    schedule_id: Optional[int]
    task_code: Optional[str]
    activity_id: Optional[str]
    activity_code: Optional[str]
    activity_description: Optional[str]
    wbs: Optional[str]
    crew_code: Optional[str]
    uom_id: Optional[int]
    uom_code: Optional[str]
    #: Reference UOM from the activity master; never used for grouping or quantities (uom_code is).
    activity_uom: Optional[str]
    crew_id: Optional[int]
    crew_type_id: Optional[int]
    crew_type_name: Optional[str]
    crew_type_code: Optional[str]
    crew_instance_code: Optional[str]
    crew_supervisor: Optional[str]
    planned_start: Optional[date]
    planned_end: Optional[date]
    actual_start: Optional[date]
    actual_end: Optional[date]
    planned: Optional[Decimal]
    progress: Optional[Decimal]
    actual_quantity: Optional[Decimal]
    actual_quantity_raw: Optional[str]
    daily_completed: Optional[bool]
    ph_name: Optional[str]
    quantity_status: QuantityStatus
    mapping_status: MappingStatus
    crew_match_status: CrewMatchStatus
    start_date_status: DateStatus
    end_date_status: DateStatus
    data_quality_flags: List[DataQualityFlag] = field(default_factory=list)
    group_row_count: int = 1
    group_actual_entry_count: int = 0
    crew_employees: List[str] = field(default_factory=list)

    @property
    def status_key(self) -> str:
        return self.quantity_status.value

    @property
    def uom_key(self) -> str:
        return self.uom_code or ""

    @property
    def wbs_key(self) -> str:
        return self.wbs or ""

    @property
    def activity_key(self) -> str:
        return self.activity_code or ""

    @property
    def group_key(self) -> tuple:
        return (self.status_key, self.wbs_key, self.activity_key)


@dataclass
class DayCounters:
    """Day-level raw counters from the DAILY_SUMMARY query (pre-grain-resolution)."""

    raw_row_count: int = 0
    raw_well_count: int = 0
    raw_actual_entry_count: int = 0
    invalid_json_row_count: int = 0
    unparseable_actual_row_count: int = 0
    logical_task_count: int = 0
    multi_row_task_count: int = 0
    duplicate_actual_task_count: int = 0
    superseded_row_count: int = 0


@dataclass
class DailyDataset:
    report_date: date
    tasks: List[DailyTask]
    counters: DayCounters


@dataclass
class MilestoneAlert:
    """One outstanding milestone for one live well, evaluated against the request's ``today``.

    ``days_remaining`` is signed: negative = overdue, zero = due today. ``milestone`` is the code the MILESTONES
    query returns; ``label`` its display name (setting milestoneLabels).
    """

    well_id: int
    milestone: str
    label: str
    deadline_date: date
    days_remaining: int
    pegged_date: Optional[date]
    flaf_issue_date: Optional[date]
    ex_rig_on_date: Optional[date]
    rig_on_date: Optional[date]
    ex_rig_off_date: Optional[date]
    rig_off_date: Optional[date]

    @property
    def overdue(self) -> bool:
        return self.days_remaining < 0


class TaskState(str, Enum):
    """A logical task's latest recorded state as of the report date, classified in SQL (WELL_DETAIL) from
    completed / actual_start / actual_end. Never from progress."""

    COMPLETED = "COMPLETED"
    ONGOING = "ONGOING"
    NOT_STARTED = "NOT_STARTED"
    ENDED_NOT_COMPLETED = "ENDED_NOT_COMPLETED"


@dataclass
class LogicalTask:
    well_id: int
    schedule_id: Optional[int]
    task_code: Optional[str]
    task_state: TaskState
    latest_action_on: Optional[date]
    actual_start: Optional[date]
    actual_end: Optional[date]
    completed: Optional[bool]
    activity_id: Optional[str] = None
    activity_code: Optional[str] = None
    activity_description: Optional[str] = None
    wbs: Optional[str] = None


@dataclass
class WellTaskActivity:
    """One live well's task activity as of the report date:
    open = incomplete + ongoing, logical = open + completed (disjoint counts)."""

    well_id: int
    logical_task_count: int
    completed_task_count: int
    open_task_count: int
    incomplete_task_count: int
    ongoing_task_count: int
    not_started_task_count: int
    ended_not_completed_task_count: int
    today_reported_task_count: int
    last_task_date: Optional[date]

    @property
    def has_task_on_report_date(self) -> bool:
        return self.today_reported_task_count > 0

    @property
    def task_state_counts(self) -> "dict[str, int]":
        return {
            TaskState.COMPLETED.value: self.completed_task_count,
            TaskState.ONGOING.value: self.ongoing_task_count,
            TaskState.NOT_STARTED.value: self.not_started_task_count,
            TaskState.ENDED_NOT_COMPLETED.value: self.ended_not_completed_task_count,
        }
