"""The resolved daily dataset for a report date, and its drill-down filters.

Two queries per report date (DAILY_DETAILS and DAILY_SUMMARY) produce the whole day; every drill-down level
(group, status, well, task) is served from that one dataset, so the summary and the rows behind it can never
disagree and drilling down never issues a query per well.
"""
from __future__ import annotations

import logging
from datetime import date
from typing import Dict, List, Optional

from app.features.common.parallel import run_parallel
from app.features.dailyreport import data
from app.features.dailyreport.errors import BadRequest
from app.features.dailyreport.models import DailyDataset, DailyTask, DayCounters, QuantityStatus
from app.features.dailyreport.validation import as_date, build_task

logger = logging.getLogger(__name__)


class DailyService:
    def __init__(self, ctx) -> None:
        self._ctx = ctx

    def get_dataset(self, report_date: date) -> DailyDataset:
        """The day's resolved evidence (loaded once per request; cached across requests by data.py)."""
        return self._ctx.memo(("dataset", report_date), lambda: self._load(report_date))

    def _load(self, report_date: date) -> DailyDataset:
        source = self._ctx.data
        values = {"report_date": report_date}
        # The two queries are independent: run them at the same time.
        rows, counter_rows = run_parallel([
            lambda: source.rows(data.DAILY_DETAILS, values, report_date=report_date),
            lambda: source.rows(data.DAILY_SUMMARY, values, report_date=report_date),
        ], self._ctx.settings.parallel_workers)
        for result in (rows, counter_rows):
            if isinstance(result, BaseException):
                raise result
        tasks: List[DailyTask] = []
        skipped = 0
        for row in rows:
            try:
                tasks.append(build_task(row))
            except Exception:  # noqa: BLE001 - one bad row must not lose the day
                skipped += 1
                logger.exception("skipping unreadable daily row id=%s", row.get("task_daily_id"))
        if skipped:
            logger.warning("%d daily row(s) could not be interpreted for %s", skipped, report_date)
        return DailyDataset(report_date=report_date, tasks=tasks, counters=_counters(counter_rows))

    def filter_tasks(self, dataset: DailyDataset, *, uom: Optional[str] = None, wbs: Optional[str] = None,
                     activity_code: Optional[str] = None, status: Optional[str] = None,
                     well_id: Optional[int] = None) -> List[DailyTask]:
        """Select tasks by group key and/or status. An empty string selects the explicit "not recorded" group."""
        status_value = parse_status(status)
        selected = []
        for task in dataset.tasks:
            if uom is not None and task.uom_key != uom:
                continue
            if wbs is not None and task.wbs_key != wbs:
                continue
            if activity_code is not None and task.activity_key != activity_code:
                continue
            if status_value is not None and task.quantity_status is not status_value:
                continue
            if well_id is not None and task.well_id != well_id:
                continue
            selected.append(task)
        return selected

    def recent_dates(self, limit: int) -> List[Dict[str, object]]:
        """Recent dates that carry daily entries, newest first (never cached: it is the date picker's list)."""
        rows = self._ctx.data.rows(data.ACTIVITY_DATES, {"limit": limit}, cached=False)
        return [{"report_date": as_date(row["report_date"]), "row_count": int(row["row_count"]),
                 "well_count": int(row["well_count"])} for row in rows]


def parse_status(status: Optional[str]) -> Optional[QuantityStatus]:
    if status is None or status.strip() == "":
        return None
    try:
        return QuantityStatus(status.strip().upper())
    except ValueError:
        valid = ", ".join(member.value for member in QuantityStatus)
        raise BadRequest(f"Unknown status {status!r}. Valid values: {valid}") from None


def _counters(counter_rows: list) -> DayCounters:
    if not counter_rows:
        return DayCounters()
    row = counter_rows[0]
    return DayCounters(
        raw_row_count=int(row.get("raw_row_count") or 0),
        raw_well_count=int(row.get("raw_well_count") or 0),
        raw_actual_entry_count=int(row.get("raw_actual_entry_count") or 0),
        invalid_json_row_count=int(row.get("invalid_json_row_count") or 0),
        unparseable_actual_row_count=int(row.get("unparseable_actual_row_count") or 0),
        logical_task_count=int(row.get("logical_task_count") or 0),
        multi_row_task_count=int(row.get("multi_row_task_count") or 0),
        duplicate_actual_task_count=int(row.get("duplicate_actual_task_count") or 0),
        superseded_row_count=int(row.get("superseded_row_count") or 0),
    )
