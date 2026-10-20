"""Dataset A: the grouped daily summary (validation status -> WBS -> activity), ported unchanged.

Aggregated from the same resolved tasks the detail returns, so every figure is traceable to its rows. Status sections
come out in QuantityStatus order. Quantities are summed only within one unit of measure: a group spanning several
reports ``quantities_summable = false`` and no totals. ``well_count`` counts distinct wells, ``task_count`` tasks.
"""
from __future__ import annotations

from decimal import Decimal
from typing import Dict, List, Optional, Set

from app.features.dailyreport.models import DailyDataset, DailyTask, DataQualityFlag, QuantityStatus


class _Aggregate:
    def __init__(self) -> None:
        self.task_count = 0
        self.data_quality_counts: Dict[str, int] = {}
        self._planned: Optional[Decimal] = None
        self._actual: Optional[Decimal] = None
        self._wells: Set[int] = set()
        self._uom_codes: Set[Optional[str]] = set()

    def _accumulate(self, task: DailyTask) -> None:
        self.task_count += 1
        self._wells.add(task.well_id)
        self._uom_codes.add(task.uom_code)
        if task.planned is not None:
            self._planned = (self._planned or Decimal(0)) + task.planned
        if task.actual_quantity is not None:
            self._actual = (self._actual or Decimal(0)) + task.actual_quantity
        for flag in task.data_quality_flags:
            self.data_quality_counts[flag.value] = self.data_quality_counts.get(flag.value, 0) + 1

    @property
    def well_count(self) -> int:
        return len(self._wells)

    @property
    def well_ids(self) -> List[int]:
        return sorted(self._wells)

    @property
    def quantities_summable(self) -> bool:
        """True when every task shares one unit ("not recorded" counts as a unit of its own)."""
        return len(self._uom_codes) == 1

    @property
    def uom_code(self) -> Optional[str]:
        return next(iter(self._uom_codes)) if self.quantities_summable else None

    @property
    def uom_codes(self) -> List[str]:
        return sorted(code for code in self._uom_codes if code is not None)

    @property
    def planned_quantity(self) -> Optional[Decimal]:
        return self._planned if self.quantities_summable else None

    @property
    def actual_quantity(self) -> Optional[Decimal]:
        return self._actual if self.quantities_summable else None


class ActivityGroup(_Aggregate):
    def __init__(self, status: QuantityStatus, wbs: Optional[str], activity_code: Optional[str],
                 activity_description: Optional[str]) -> None:
        super().__init__()
        self.status = status
        self.wbs = wbs
        self.activity_code = activity_code
        self.activity_description = activity_description

    def add(self, task: DailyTask) -> None:
        self._accumulate(task)


class WbsGroup(_Aggregate):
    def __init__(self, status: QuantityStatus, wbs: Optional[str]) -> None:
        super().__init__()
        self.status = status
        self.wbs = wbs
        self.activities: Dict[str, ActivityGroup] = {}

    def add(self, task: DailyTask) -> None:
        group = self.activities.get(task.activity_key)
        if group is None:
            group = ActivityGroup(self.status, task.wbs, task.activity_code, task.activity_description)
            self.activities[task.activity_key] = group
        group.add(task)
        self._accumulate(task)

    def sorted_activities(self) -> List[ActivityGroup]:
        """Busiest activity first; the unmapped bucket always last."""
        return sorted(self.activities.values(),
                      key=lambda g: (g.activity_code is None, -g.task_count, g.activity_code or ""))


class StatusGroup(_Aggregate):
    def __init__(self, status: QuantityStatus) -> None:
        super().__init__()
        self.status = status
        self.wbs_groups: Dict[str, WbsGroup] = {}

    def add(self, task: DailyTask) -> None:
        group = self.wbs_groups.get(task.wbs_key)
        if group is None:
            group = WbsGroup(self.status, task.wbs)
            self.wbs_groups[task.wbs_key] = group
        group.add(task)
        self._accumulate(task)

    def sorted_wbs_groups(self) -> List[WbsGroup]:
        """Busiest work category first; the unmapped bucket always last."""
        return sorted(self.wbs_groups.values(), key=lambda g: (g.wbs is None, -g.task_count, g.wbs or ""))


class GroupingService:
    def build(self, dataset: DailyDataset) -> List[StatusGroup]:
        """Status groups in QuantityStatus order; a status with no tasks has no section."""
        groups: Dict[str, StatusGroup] = {}
        for task in dataset.tasks:
            group = groups.get(task.status_key)
            if group is None:
                group = StatusGroup(task.quantity_status)
                groups[task.status_key] = group
            group.add(task)
        return [groups[member.value] for member in QuantityStatus if member.value in groups]

    def day_totals(self, dataset: DailyDataset) -> Dict[str, object]:
        """Day-level totals. No quantity: summing across units would need a conversion no rule defines."""
        status_counts = {member.value: 0 for member in QuantityStatus}
        wells: Set[int] = set()
        for task in dataset.tasks:
            status_counts[task.quantity_status.value] += 1
            wells.add(task.well_id)
        return {"task_count": len(dataset.tasks), "well_count": len(wells), "status_counts": status_counts}

    def data_quality(self, dataset: DailyDataset) -> Dict[str, object]:
        counts: Dict[str, int] = {}
        for task in dataset.tasks:
            for flag in task.data_quality_flags:
                counts[flag.value] = counts.get(flag.value, 0) + 1
        counters = dataset.counters
        return {
            "flag_counts": counts,
            "affected_task_count": sum(1 for task in dataset.tasks if task.data_quality_flags),
            "raw_row_count": counters.raw_row_count,
            "logical_task_count": len(dataset.tasks),
            "superseded_row_count": counters.superseded_row_count,
            "multi_row_task_count": counters.multi_row_task_count,
            "duplicate_actual_task_count": counters.duplicate_actual_task_count,
            "invalid_json_row_count": counters.invalid_json_row_count,
            "unparseable_actual_row_count": counters.unparseable_actual_row_count,
        }

    @staticmethod
    def unmapped_flags() -> List[str]:
        return [DataQualityFlag.UNMAPPED_ACTIVITY.value, DataQualityFlag.UNMAPPED_WBS.value,
                DataQualityFlag.UNMAPPED_DESCRIPTION.value, DataQualityFlag.UNMAPPED_CREW.value]
