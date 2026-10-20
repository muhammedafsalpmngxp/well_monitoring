"""The deterministic evidence for one scope (day / well / task, or a slice of the day), shared by the agents' tools
(ported from explain_evidence.py). Never calls a model.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Dict, List, Optional

from app.features.dailyreport.errors import CONFIG_ERRORS
from app.features.dailyreport.models import DailyTask

logger = logging.getLogger(__name__)


@dataclass
class ScopeRequest:
    report_date: date
    scope: str = "day"
    uom: Optional[str] = None
    wbs: Optional[str] = None
    activity_code: Optional[str] = None
    status: Optional[str] = None
    well_id: Optional[int] = None
    task_daily_id: Optional[int] = None

    def is_filtered(self) -> bool:
        return any(value is not None for value in (self.uom, self.wbs, self.activity_code, self.status,
                                                   self.well_id, self.task_daily_id))

    def is_front_page_day(self) -> bool:
        return self.scope == "day" and not self.is_filtered()


@dataclass
class ScopeEvidence:
    """``available`` is False only when there is nothing at all to explain."""

    available: bool
    evidence: Dict[str, Any] = field(default_factory=dict)
    #: The evidence as the model may see it: a block with nothing to say is withheld.
    llm_evidence: Dict[str, Any] = field(default_factory=dict)
    withheld: List[str] = field(default_factory=list)
    sql_sources: List[Dict[str, Any]] = field(default_factory=list)
    proof: List[Dict[str, Any]] = field(default_factory=list)
    proof_note: Optional[str] = None
    tasks: List[DailyTask] = field(default_factory=list)


def build_scope_evidence(ctx, request: ScopeRequest, dataset) -> ScopeEvidence:
    """Resolve one scope to its evidence (BadRequest for a filter the dataset rejects, e.g. an unknown status).

    A failing supporting source (task activity, crew suggestion) is logged and left out, never the end of the
    scope's own evidence. Configuration problems (a prompt, a query or a table an admin must fix) are raised.
    """
    tasks: List[DailyTask] = ctx.daily.filter_tasks(dataset, uom=request.uom, wbs=request.wbs,
                                                     activity_code=request.activity_code, status=request.status,
                                                     well_id=request.well_id)
    if request.task_daily_id is not None:
        tasks = [task for task in tasks if task.task_daily_id == request.task_daily_id]

    well_activity = None
    day_activity = None
    proof_rows: List[dict] = []
    if request.scope == "well" and request.well_id is not None:
        try:
            well_activity = ctx.activity.evidence(request.report_date, dataset, request.well_id)
            proof_rows = ctx.activity.proof_rows(request.report_date, request.well_id)
        except CONFIG_ERRORS:
            raise
        except Exception:  # noqa: BLE001 - this must never break the well's own evidence
            logger.exception("well task-activity evidence failed; continuing without it")
    elif request.is_front_page_day():
        try:
            day_activity = ctx.activity.day_evidence(request.report_date, dataset)
        except CONFIG_ERRORS:
            raise
        except Exception:  # noqa: BLE001 - this must never break the day's own evidence
            logger.exception("day task-activity evidence failed; continuing without it")

    if not tasks and well_activity is None and day_activity is None:
        return ScopeEvidence(available=False)

    evidence = ctx.evidence.build(dataset, tasks, scope=request.scope, uom=request.uom, wbs=request.wbs,
                                  activity_code=request.activity_code, status=request.status,
                                  well_id=request.well_id)
    if well_activity is not None:
        evidence["well_task_activity"] = well_activity
    if day_activity is not None:
        evidence["live_well_task_activity"] = day_activity

    # Crew suggestion rides inside a single-task scope's evidence only.
    if request.scope == "task" and len(tasks) == 1:
        try:
            crew_suggestion = ctx.crew.build(well_id=tasks[0].well_id, task_code=tasks[0].task_code,
                                             report_date=request.report_date)
        except CONFIG_ERRORS:
            raise
        except Exception:  # noqa: BLE001 - this must never break the task's own evidence
            logger.exception("crew suggestion evidence failed; continuing without it")
            crew_suggestion = None
        if crew_suggestion is not None:
            evidence["crew_suggestion"] = crew_suggestion

    # Evidence with nothing to say never reaches the model.
    llm_evidence = evidence
    withheld: List[str] = []
    crew = evidence.get("crew_suggestion")
    if isinstance(crew, dict) and not (crew.get("suggested_crew") or crew.get("consult_crew")
                                       or crew.get("no_suggestion_reason")):
        withheld.append("crew_suggestion")
        llm_evidence = {key: value for key, value in evidence.items() if key != "crew_suggestion"}

    sql_sources: List[Dict[str, Any]] = []
    if well_activity is not None or day_activity is not None:
        sql_sources = ctx.activity.sql_sources(request.report_date)

    shown = proof_rows[:ctx.settings.proof_row_limit]
    proof_note = None
    if len(proof_rows) > len(shown):
        proof_note = (f"Showing the first {len(shown)} of {len(proof_rows)} incomplete tasks. "
                      "The counts above cover all of them.")

    return ScopeEvidence(available=True, evidence=evidence, llm_evidence=llm_evidence, withheld=withheld,
                         sql_sources=sql_sources, proof=shown, proof_note=proof_note, tasks=tasks)
