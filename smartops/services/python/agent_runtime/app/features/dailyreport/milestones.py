"""Outstanding well milestones split into "upcoming" and "overdue" (ported from milestone_service.py).

The MILESTONES query returns raw evidence (which milestones are outstanding and their deadline). This module owns
one judgement, the window, which is a setting. "Today" is the tenant's date sent with the request, never the
server's clock.
"""
from __future__ import annotations

from datetime import date
from typing import Any, Dict, List, Tuple

from app.features.dailyreport import data
from app.features.dailyreport.models import MilestoneAlert
from app.features.dailyreport.validation import as_date


class MilestoneService:
    def __init__(self, ctx) -> None:
        self._ctx = ctx

    def _outstanding_rows(self) -> List[Dict[str, Any]]:
        return self._ctx.memo(("milestones",), lambda: self._ctx.data.rows(data.MILESTONES, {}))

    def warm(self) -> None:
        """Loads the outstanding milestones ahead of the tools that read them."""
        self._outstanding_rows()

    def upcoming_and_overdue(self, window_days: int, *, today: date) -> Tuple[List[MilestoneAlert], List[MilestoneAlert]]:
        """``upcoming``: 0 <= days_remaining <= window_days, soonest first. ``overdue``: days_remaining < 0, most
        recently missed first (kept apart so a long backlog never buries what is still approaching)."""
        alerts = [self._alert(row, today) for row in self._outstanding_rows() if row.get("deadline_date") is not None]
        upcoming = sorted((a for a in alerts if 0 <= a.days_remaining <= window_days), key=lambda a: a.days_remaining)
        overdue = sorted((a for a in alerts if a.days_remaining < 0), key=lambda a: a.days_remaining, reverse=True)
        return upcoming, overdue

    def _alert(self, row: Dict[str, Any], today: date) -> MilestoneAlert:
        deadline = as_date(row["deadline_date"])
        code = str(row["milestone"]).strip()
        return MilestoneAlert(
            well_id=int(row["well_id"]),
            milestone=code,
            label=self._ctx.settings.milestone_label(code),
            deadline_date=deadline,
            days_remaining=(deadline - today).days,
            pegged_date=as_date(row.get("pegged_date")),
            flaf_issue_date=as_date(row.get("flaf_issue_date")),
            ex_rig_on_date=as_date(row.get("ex_rig_on_date")),
            rig_on_date=as_date(row.get("rig_on_date")),
            ex_rig_off_date=as_date(row.get("ex_rig_off_date")),
            rig_off_date=as_date(row.get("rig_off_date")),
        )
