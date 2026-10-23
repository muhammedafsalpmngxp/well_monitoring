"""The compact, deterministic evidence payload a model is given for one scope (ported from evidence_service.py).

Everything in it was computed by SQL and validation.py; the model receives facts and classifications only. The
definition, constraint and note texts it reads are the tenant's prompts (the definitions, data_limits and notes prompts); how many tasks a
scope lists is a setting.
"""
from __future__ import annotations

from collections import OrderedDict
from decimal import Decimal
from typing import Any, Dict, List, Optional

from app.features.dailyreport.models import DailyDataset, DailyTask, QuantityStatus


def _q(value: Optional[Decimal]) -> Optional[str]:
    if value is None:
        return None
    return format(value.normalize(), "f")


def representative_sample(tasks: List[DailyTask], limit: int) -> List[DailyTask]:
    """Every present status first (outer axis), then as many distinct wells as possible within each status (inner
    axis), then the first ``limit``. Applied whether or not truncation is needed, so the order is always by status."""
    per_status_wells: Dict[QuantityStatus, "OrderedDict[int, List[DailyTask]]"] = {}
    for task in tasks:
        by_well = per_status_wells.setdefault(task.quantity_status, OrderedDict())
        by_well.setdefault(task.well_id, []).append(task)

    columns = [list(per_status_wells[status].values()) for status in QuantityStatus if status in per_status_wells]

    buckets: List[List[DailyTask]] = []
    row = 0
    while any(row < len(column) for column in columns):
        for column in columns:
            if row < len(column):
                buckets.append(column[row])
        row += 1

    ordered: List[DailyTask] = []
    round_index = 0
    while len(ordered) < limit:
        progressed = False
        for bucket in buckets:
            if round_index < len(bucket):
                ordered.append(bucket[round_index])
                progressed = True
                if len(ordered) >= limit:
                    return ordered
        if not progressed:
            break
        round_index += 1
    return ordered


class EvidenceService:
    def __init__(self, ctx) -> None:
        self._ctx = ctx

    def task_limit(self, scope: str) -> int:
        s = self._ctx.settings
        by_scope = {"task": s.evidence_task_limit_task, "well": s.evidence_task_limit_well}
        return max(1, min(by_scope.get(scope, s.evidence_task_limit_other), s.explain_max_wells))

    def build(self, dataset: DailyDataset, tasks: List[DailyTask], *, scope: str, uom: Optional[str] = None,
              wbs: Optional[str] = None, activity_code: Optional[str] = None, status: Optional[str] = None,
              well_id: Optional[int] = None) -> Dict[str, Any]:
        texts = self._ctx.texts
        status_counts = {member.value: 0 for member in QuantityStatus}
        planned_total: Optional[Decimal] = None
        actual_total: Optional[Decimal] = None
        uom_codes = {task.uom_code for task in tasks}
        wells = {task.well_id for task in tasks}
        quality_counts: Dict[str, int] = {}

        for task in tasks:
            status_counts[task.quantity_status.value] += 1
            if task.planned is not None:
                planned_total = (planned_total or Decimal(0)) + task.planned
            if task.actual_quantity is not None:
                actual_total = (actual_total or Decimal(0)) + task.actual_quantity
            for flag in task.data_quality_flags:
                quality_counts[flag.value] = quality_counts.get(flag.value, 0) + 1

        single_uom = len(uom_codes) == 1
        if not tasks:
            # One fact to state, not a summary full of zeroes the model would read out loud.
            summary: Dict[str, Any] = {
                "task_count": 0,
                "no_daily_entry": True,
                "note": texts.get("evidence_no_daily_entry_note"),
            }
        else:
            summary = {
                "well_count": len(wells),
                "task_count": len(tasks),
                "status_counts": status_counts,
                "planned_quantity": _q(planned_total) if single_uom else None,
                "actual_quantity": _q(actual_total) if single_uom else None,
                "quantities_summable": single_uom,
            }
        if tasks and not single_uom:
            summary["quantities_withheld_reason"] = texts.get("evidence_quantities_withheld")

        included = representative_sample(tasks, self.task_limit(scope))

        payload: Dict[str, Any] = {
            "report_date": dataset.report_date.isoformat(),
            "scope": scope,
            "group": {
                "status_filter": status,
                "wbs": wbs,
                "activity_code": activity_code,
                "well_id": well_id,
                "uom": uom if uom is not None else (next(iter(uom_codes)) if single_uom else None),
            },
            "summary": summary,
            "data_quality": {
                "flag_counts": quality_counts,
                "note": texts.get("evidence_data_quality_note"),
            },
            "status_definitions": texts.entries("evidence_status_definitions"),
            "crew_match_definitions": texts.entries("evidence_crew_match_definitions"),
            "date_status_definitions": texts.entries("evidence_date_status_definitions"),
            "constraints": texts.entries("evidence_constraints"),
            "tasks": [task_evidence(task) for task in included],
        }
        if not tasks:
            payload.pop("status_definitions", None)
            payload.pop("tasks", None)
        if len(tasks) > len(included):
            payload["tasks_truncated"] = {
                "included": len(included),
                "total": len(tasks),
                "note": texts.get("evidence_tasks_truncated_note"),
            }
        return payload


def task_evidence(task: DailyTask) -> Dict[str, Any]:
    return {
        "well_id": task.well_id,
        "task_code": task.task_code,
        "activity_code": task.activity_code,
        "activity_description": task.activity_description,
        "wbs": task.wbs,
        "crew_code": task.crew_code,
        "crew_type_code": task.crew_type_code,
        "uom": task.uom_code,
        "planned": _q(task.planned),
        "actual": _q(task.actual_quantity),
        "progress": _q(task.progress),
        "planned_start": task.planned_start.isoformat() if task.planned_start else None,
        "planned_end": task.planned_end.isoformat() if task.planned_end else None,
        "actual_start": task.actual_start.isoformat() if task.actual_start else None,
        "actual_end": task.actual_end.isoformat() if task.actual_end else None,
        "quantity_status": task.quantity_status.value,
        "mapping_status": task.mapping_status.value,
        "crew_match_status": task.crew_match_status.value,
        "start_date_status": task.start_date_status.value,
        "end_date_status": task.end_date_status.value,
        "data_quality_flags": [flag.value for flag in task.data_quality_flags],
        "ph_name": task.ph_name,
        "daily_completed": task.daily_completed,
    }
