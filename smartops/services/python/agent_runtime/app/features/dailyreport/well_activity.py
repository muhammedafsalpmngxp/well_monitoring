"""Well-level task activity: the front page's per-well task figures, and the same figures as AI evidence
(ported from well_activity_service.py).

Cost: one WELL_ACTIVITY query per report date for the counters, one WELL_DETAIL query (every live well at once) the
first time any well's tasks are needed -- never a query per well. Both are memoised for the request and cached
across requests by data.py. ``task_daily.progress`` is never read: its unit is undefined.
"""
from __future__ import annotations

import logging
from datetime import date
from typing import Any, Dict, List, Optional

from app.features.dailyreport import data
from app.features.dailyreport.models import DailyDataset, LogicalTask, TaskState, WellTaskActivity
from app.features.dailyreport.validation import as_date, to_int

logger = logging.getLogger(__name__)

#: Operator-facing labels of the queries behind the figures (the "show the SQL" panel; never sent to a model).
_SOURCE_LABELS = {
    data.WELL_ACTIVITY: "Counts on the well row (incomplete, ongoing, last task date)",
    data.WELL_DETAIL: "The individual tasks behind those counts (the proof table)",
}


class WellActivityService:
    def __init__(self, ctx) -> None:
        self._ctx = ctx

    # ------------------------------------------------------------------------------------------------------------
    def wells_for_date(self, report_date: date, dataset: DailyDataset) -> List[WellTaskActivity]:
        """Task activity for every live well with evidence as of the date. The "reported today" count is read from
        the day's own dataset, so it is by construction the number the well's drill-down shows."""
        rows = self._activity_rows(report_date)
        today_counts = _today_counts(dataset)
        wells = [_to_activity(row, today_counts) for row in rows]

        # A well that reported a task on the date is always listed, even if the two queries ever disagree.
        known = {well.well_id for well in wells}
        for well_id, count in sorted(today_counts.items()):
            if well_id not in known:
                wells.append(WellTaskActivity(
                    well_id=well_id, logical_task_count=0, completed_task_count=0, open_task_count=0,
                    incomplete_task_count=0, ongoing_task_count=0, not_started_task_count=0,
                    ended_not_completed_task_count=0, today_reported_task_count=count, last_task_date=report_date))
        wells.sort(key=lambda well: well.well_id)
        return wells

    def well_for_date(self, report_date: date, dataset: DailyDataset, well_id: int) -> Optional[WellTaskActivity]:
        for well in self.wells_for_date(report_date, dataset):
            if well.well_id == well_id:
                return well
        return None

    def incomplete_tasks(self, report_date: date, well_id: int) -> List[LogicalTask]:
        return list(self._detail_rows(report_date).get(well_id, []))

    # ------------------------------------------------------------------------------------------------------------
    def evidence(self, report_date: date, dataset: DailyDataset, well_id: int) -> Optional[Dict[str, Any]]:
        """The ``well_task_activity`` block of one well's AI evidence, or None when the well has no task evidence
        (a block of zeroes would claim it was measured)."""
        activity = self.well_for_date(report_date, dataset, well_id)
        if activity is None:
            return None
        texts = self._ctx.texts
        tasks = self.incomplete_tasks(report_date, well_id)
        ongoing = [task for task in tasks if task.task_state is TaskState.ONGOING]
        limit = self._ctx.settings.ongoing_task_sample_limit

        definitions: Dict[str, Any] = dict(texts.entries("well_activity_definitions"))
        definitions["task_states"] = texts.entries("task_state_definitions")
        payload: Dict[str, Any] = {
            "well_id": well_id,
            "as_of_report_date": report_date.isoformat(),
            "task_activity": {
                "today_reported_task_count": activity.today_reported_task_count,
                "has_task_on_report_date": activity.has_task_on_report_date,
                "open_task_count": activity.open_task_count,
                "incomplete_task_count": activity.incomplete_task_count,
                "ongoing_task_count": activity.ongoing_task_count,
                "completed_task_count": activity.completed_task_count,
                "logical_task_count": activity.logical_task_count,
                "last_task_date": activity.last_task_date.isoformat() if activity.last_task_date else None,
            },
            "task_state_summary": activity.task_state_counts,
            "ongoing_tasks": [_task_evidence(task) for task in ongoing[:limit]],
            "definitions": definitions,
            "constraints": texts.entries("well_activity_constraints"),
        }
        if len(ongoing) > len(payload["ongoing_tasks"]):
            payload["ongoing_tasks_truncated"] = {
                "included": len(payload["ongoing_tasks"]),
                "total": len(ongoing),
                "note": texts.get("well_ongoing_truncated_note"),
            }
        return payload

    def day_evidence(self, report_date: date, dataset: DailyDataset) -> Optional[Dict[str, Any]]:
        """Task activity across every live well, for the front-page day brief (the standing position behind the
        day's own reported figures), or None when no live well has task evidence."""
        wells = self.wells_for_date(report_date, dataset)
        if not wells:
            return None
        texts = self._ctx.texts
        reported = [well for well in wells if well.has_task_on_report_date]
        with_open_work = [well for well in wells if well.open_task_count]
        with_incomplete = [well for well in wells if well.incomplete_task_count]
        with_ongoing = [well for well in wells if well.ongoing_task_count]
        silent_with_open_work = [well for well in with_open_work if not well.has_task_on_report_date]

        # Busiest open work first; ties break on well_id so identical data gives identical evidence.
        ranked = sorted(with_open_work, key=lambda w: (-w.open_task_count, -w.ongoing_task_count, w.well_id))
        sample = ranked[:self._ctx.settings.top_wells_sample_limit]

        payload: Dict[str, Any] = {
            "as_of_report_date": report_date.isoformat(),
            "well_counts": {
                "with_task_evidence": len(wells),
                "reported_on_report_date": len(reported),
                "no_task_on_report_date": len(wells) - len(reported),
                "with_open_tasks": len(with_open_work),
                "with_incomplete_tasks": len(with_incomplete),
                "with_ongoing_tasks": len(with_ongoing),
                "with_open_tasks_and_nothing_reported": len(silent_with_open_work),
            },
            "task_counts": {
                "open_total": sum(w.open_task_count for w in wells),
                "incomplete_total": sum(w.incomplete_task_count for w in wells),
                "ongoing_total": sum(w.ongoing_task_count for w in wells),
                "not_started_total": sum(w.not_started_task_count for w in wells),
                "ended_not_completed_total": sum(w.ended_not_completed_task_count for w in wells),
            },
            "wells_with_most_open_work": [
                {
                    "well_id": well.well_id,
                    "open_task_count": well.open_task_count,
                    "incomplete_task_count": well.incomplete_task_count,
                    "ongoing_task_count": well.ongoing_task_count,
                    "today_reported_task_count": well.today_reported_task_count,
                    "last_task_date": well.last_task_date.isoformat() if well.last_task_date else None,
                }
                for well in sample
            ],
            "definitions": texts.entries("day_activity_definitions"),
            "constraints": texts.entries("day_activity_constraints"),
        }
        if len(ranked) > len(sample):
            payload["wells_with_most_open_work_truncated"] = {
                "included": len(sample),
                "total": len(ranked),
                "note": texts.get("day_wells_truncated_note"),
            }
        return payload

    # ---- showing the working (for the operator, never for the model) ---------------------------------------------
    def proof_rows(self, report_date: date, well_id: int) -> List[Dict[str, Any]]:
        """Every incomplete task behind one well's counts, with the reason it counts (its own columns restated)."""
        rows: List[Dict[str, Any]] = []
        for task in self.incomplete_tasks(report_date, well_id):
            rows.append({
                "well_id": task.well_id,
                "task_code": task.task_code,
                "schedule_id": task.schedule_id,
                "activity_code": task.activity_code,
                "description": task.activity_description,
                "wbs": task.wbs,
                "task_state": task.task_state.value,
                "counts_as_incomplete": task.task_state is not TaskState.ONGOING,
                "counts_as_ongoing": task.task_state is TaskState.ONGOING,
                "completed": bool(task.completed),
                "actual_start": task.actual_start,
                "actual_end": task.actual_end,
                "last_task_date": task.latest_action_on,
                "reason": reason(task),
            })
        return rows

    def sql_sources(self, report_date: date) -> List[Dict[str, Any]]:
        values = {"report_date": report_date}
        return [self._ctx.data.source(key, values, label) for key, label in _SOURCE_LABELS.items()]

    # ------------------------------------------------------------------------------------------------------------
    def _activity_rows(self, report_date: date) -> List[Dict[str, Any]]:
        return self._ctx.memo(("activity", report_date), lambda: self._ctx.data.rows(
            data.WELL_ACTIVITY, {"report_date": report_date}, report_date=report_date))

    def _detail_rows(self, report_date: date) -> Dict[int, List[LogicalTask]]:
        return self._ctx.memo(("activity_detail", report_date), lambda: self._load_detail(report_date))

    def _load_detail(self, report_date: date) -> Dict[int, List[LogicalTask]]:
        by_well: Dict[int, List[LogicalTask]] = {}
        for row in self._ctx.data.rows(data.WELL_DETAIL, {"report_date": report_date}, report_date=report_date):
            try:
                task = _to_task(row)
            except Exception:  # noqa: BLE001 - one bad row must not lose the well
                logger.exception("skipping unreadable well task row well_id=%s task_code=%s",
                                 row.get("well_id"), row.get("task_code"))
                continue
            by_well.setdefault(task.well_id, []).append(task)
        return by_well


def reason(task: LogicalTask) -> str:
    """Why this task is counted the way it is, in the record's own terms (operator panel only)."""
    seen = f"latest record {task.latest_action_on.isoformat()}" if task.latest_action_on else "latest record"
    if task.task_state is TaskState.ONGOING:
        return (f"Not completed ({seen}); actual start "
                f"{task.actual_start.isoformat() if task.actual_start else 'recorded'} "
                "and no actual end recorded, so it counts as ongoing.")
    if task.task_state is TaskState.NOT_STARTED:
        return (f"Not completed ({seen}); no actual start and no actual end recorded, "
                "so it counts as incomplete rather than ongoing.")
    if task.task_state is TaskState.ENDED_NOT_COMPLETED:
        return (f"Not completed ({seen}), although an actual end of "
                f"{task.actual_end.isoformat() if task.actual_end else 'unknown'} is "
                "recorded. Both are reported as they stand; it counts as incomplete rather than ongoing.")
    return f"Recorded as completed ({seen})."


def _task_evidence(task: LogicalTask) -> Dict[str, Any]:
    return {
        "task_code": task.task_code,
        "schedule_id": task.schedule_id,
        "activity_code": task.activity_code,
        "activity_description": task.activity_description,
        "wbs": task.wbs,
        "task_state": task.task_state.value,
        "actual_start": task.actual_start.isoformat() if task.actual_start else None,
        "actual_end": task.actual_end.isoformat() if task.actual_end else None,
        "completed": bool(task.completed),
        "last_task_date": task.latest_action_on.isoformat() if task.latest_action_on else None,
    }


def _today_counts(dataset: DailyDataset) -> Dict[int, int]:
    counts: Dict[int, int] = {}
    for task in dataset.tasks:
        counts[task.well_id] = counts.get(task.well_id, 0) + 1
    return counts


def _to_activity(row: Dict[str, Any], today_counts: Dict[int, int]) -> WellTaskActivity:
    well_id = int(row["well_id"])
    return WellTaskActivity(
        well_id=well_id,
        logical_task_count=int(row.get("logical_task_count") or 0),
        completed_task_count=int(row.get("completed_task_count") or 0),
        open_task_count=int(row.get("open_task_count") or 0),
        incomplete_task_count=int(row.get("incomplete_task_count") or 0),
        ongoing_task_count=int(row.get("ongoing_task_count") or 0),
        not_started_task_count=int(row.get("not_started_task_count") or 0),
        ended_not_completed_task_count=int(row.get("ended_not_completed_task_count") or 0),
        today_reported_task_count=today_counts.get(well_id, 0),
        last_task_date=as_date(row.get("last_task_date")),
    )


def _to_task(row: Dict[str, Any]) -> LogicalTask:
    return LogicalTask(
        well_id=int(row["well_id"]),
        schedule_id=to_int(row.get("schedule_id")),
        task_code=row.get("task_code"),
        task_state=TaskState(str(row["task_state"]).strip().upper()),
        latest_action_on=as_date(row.get("latest_action_on")),
        actual_start=as_date(row.get("actual_start")),
        actual_end=as_date(row.get("actual_end")),
        completed=None if row.get("completed") is None else bool(row["completed"]),
        activity_id=row.get("activity_id"),
        activity_code=row.get("activity_code"),
        activity_description=row.get("activity_description"),
        wbs=row.get("wbs"),
    )
