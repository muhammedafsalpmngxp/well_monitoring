"""Daily Report endpoints (mounted by app/main.py at /api/agent-runtime/features/dailyreport).

Every body is a FeatureRequest (camelCase): the database, the AI provider, the dailyreport.* prompts, the settings,
the table allowlist and the seven verified queries come with each call. Responses keep the original application's
shapes (snake_case fields): routes_daily / routes_wells / routes_export / routes_agent, agentic edition.

    POST /summary        {reportDate, refresh}                          grouped summary (status -> WBS -> activity)
    POST /details        {reportDate}                                   every logical task of the date
    POST /group-details  {reportDate, wbs?, activityCode?, status?, uom?, refresh}   the rows behind one figure
    POST /well-activity  {reportDate, wellId?, refresh}                 per-well task activity (+ one well's tasks)
    POST /dates          {limit?}                                       recent dates with entries
    POST /well           {reportDate, wellId}                           one well's tasks (or its open work)
    POST /milestones     {windowDays?, today}                           upcoming / overdue lifecycle deadlines
    POST /export         {reportDate}                                   .xlsx workbook
    POST /agent/brief    {reportDate, scope: day|well|task, wellId?, taskDailyId?, today}
    POST /agent/ask      {reportDate, question, today}

Errors: bad input or something an admin must fix (prompt, setting, query, table) -> 400 {detail}; well not found ->
404; database or AI provider unavailable -> 503. An AI brief / answer never fails on the AI: it answers
``available: false`` with the reason and never fabricates text.
"""
from __future__ import annotations

import logging
import re
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, Callable, Dict, List, Optional
from urllib.parse import quote

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from app.askdata.common.readonly import ReadOnlyViolation
from app.features.common.access import AccessDenied
from app.features.common.context import FeatureRun, run_context
from app.features.common.db import DatabaseUnavailable
from app.features.common.llm import AiUnavailable
from app.features.common.models import FeatureRequest
from app.features.dailyreport.agent import service as agent_service
from app.features.dailyreport.context import FEATURE, ReportContext
from app.features.dailyreport.data import QueryConfigError
from app.features.dailyreport.errors import CONFIG_ERRORS, BadRequest, NotFound
from app.features.dailyreport.export import XLSX_MEDIA_TYPE
from app.features.dailyreport.models import DailyTask
from app.features.dailyreport.schemas import (
    ActivityGroupOut,
    DataQualityOut,
    DayTotalsOut,
    DetailResponse,
    GroupDetailsResponse,
    LogicalTaskOut,
    MilestoneAlertOut,
    MilestonesResponse,
    RecentDateOut,
    RecentDatesResponse,
    StatusGroupOut,
    SummaryResponse,
    TaskOut,
    WbsGroupOut,
    WellActivityResponse,
    WellDetailResponse,
    WellTaskActivityOut,
    WellTaskSummaryOut,
    quantity_str,
)
from app.features.dailyreport.settings import SettingsInvalid
from app.prompt_text import PromptMissing

log = logging.getLogger("agent_runtime.dailyreport")

router = APIRouter()

_BRIEF_SCOPES = ("day", "well", "task")


# ---------------------------------------------------------------------------------------------------------------
# request bodies
# ---------------------------------------------------------------------------------------------------------------
class SummaryRequest(FeatureRequest):
    report_date: date
    refresh: bool = False


class DetailsRequest(FeatureRequest):
    report_date: date


class GroupDetailsRequest(FeatureRequest):
    report_date: date
    wbs: Optional[str] = None             # '' selects tasks with no WBS
    activity_code: Optional[str] = None
    status: Optional[str] = None          # ON_PLAN | ABOVE_PLAN | BELOW_PLAN | NO_ACTUAL | NOT_VALIDATED
    uom: Optional[str] = None             # '' selects tasks with no UOM
    refresh: bool = False


class WellActivityRequest(FeatureRequest):
    report_date: date
    well_id: Optional[int] = None
    refresh: bool = False


class DatesRequest(FeatureRequest):
    limit: Optional[int] = None


class WellRequest(FeatureRequest):
    report_date: date
    well_id: int


class MilestonesRequest(FeatureRequest):
    window_days: Optional[int] = None
    today: date                           # the tenant's date: deadlines are evaluated against it


class ExportRequest(FeatureRequest):
    report_date: date


class BriefRequest(FeatureRequest):
    report_date: date
    scope: str = "day"
    well_id: Optional[int] = None
    task_daily_id: Optional[int] = None
    today: date


class AskRequest(FeatureRequest):
    report_date: date
    question: str
    today: date


# ---------------------------------------------------------------------------------------------------------------
# plumbing
# ---------------------------------------------------------------------------------------------------------------
def _call(req: FeatureRequest, work: Callable[[ReportContext], Any]) -> Any:
    """Run ``work`` with the request's context; map the feature's errors to HTTP statuses."""
    run = FeatureRun(FEATURE, req)
    with run_context(run):
        try:
            return work(ReportContext(run))
        except HTTPException:
            raise
        except (PromptMissing, SettingsInvalid, QueryConfigError, AccessDenied, BadRequest) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from None
        except ReadOnlyViolation as exc:
            raise HTTPException(status_code=400, detail=f"A Daily Report query was refused by the read-only check: "
                                                        f"{exc}") from None
        except NotFound as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from None
        except (DatabaseUnavailable, AiUnavailable) as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from None


def _check_date(ctx: ReportContext, report_date: date) -> date:
    s = ctx.settings
    if not s.report_date_min <= report_date <= s.report_date_max:
        raise BadRequest(f"The report date {report_date.isoformat()} is outside the allowed range "
                         f"{s.report_date_min.isoformat()} to {s.report_date_max.isoformat()}.")
    return report_date


def _refresh(ctx: ReportContext, report_date: date, refresh: bool) -> None:
    """Refresh reloads the date's data and drops the AI answers written against the old copy, in the same breath."""
    if refresh:
        ctx.data.invalidate_date(report_date)


def _quantities(group) -> Dict[str, object]:
    return {
        "well_count": group.well_count,
        "task_count": group.task_count,
        "uom_code": group.uom_code,
        "uom_codes": group.uom_codes,
        "quantities_summable": group.quantities_summable,
        "planned_quantity": quantity_str(group.planned_quantity),
        "actual_quantity": quantity_str(group.actual_quantity),
        "data_quality_counts": group.data_quality_counts,
    }


def _status_out(status_group) -> StatusGroupOut:
    return StatusGroupOut(
        status=status_group.status.value,
        wbs_groups=[
            WbsGroupOut(
                status=wbs_group.status.value,
                wbs=wbs_group.wbs,
                activities=[ActivityGroupOut(status=a.status.value, wbs=a.wbs, activity_code=a.activity_code,
                                             activity_description=a.activity_description, **_quantities(a))
                            for a in wbs_group.sorted_activities()],
                **_quantities(wbs_group),
            )
            for wbs_group in status_group.sorted_wbs_groups()
        ],
        **_quantities(status_group),
    )


def _well_summaries(tasks: List[DailyTask]) -> List[WellTaskSummaryOut]:
    """Per-well roll-up of a filtered task list; quantities only when the well's tasks share one unit."""
    by_well: Dict[int, List[DailyTask]] = {}
    for task in tasks:
        by_well.setdefault(task.well_id, []).append(task)
    summaries: List[WellTaskSummaryOut] = []
    for well_id in sorted(by_well):
        well_tasks = by_well[well_id]
        status_counts: Dict[str, int] = {}
        planned: Optional[Decimal] = None
        actual: Optional[Decimal] = None
        for task in well_tasks:
            status_counts[task.quantity_status.value] = status_counts.get(task.quantity_status.value, 0) + 1
            if task.planned is not None:
                planned = (planned or Decimal(0)) + task.planned
            if task.actual_quantity is not None:
                actual = (actual or Decimal(0)) + task.actual_quantity
        uom_codes = {task.uom_code for task in well_tasks}
        single_uom = len(uom_codes) == 1
        summaries.append(WellTaskSummaryOut(
            well_id=well_id, task_count=len(well_tasks), status_counts=status_counts,
            planned_quantity=quantity_str(planned) if single_uom else None,
            actual_quantity=quantity_str(actual) if single_uom else None,
            uom_code=next(iter(uom_codes)) if single_uom else None,
        ))
    return summaries


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------------------------------------------
# the dashboard
# ---------------------------------------------------------------------------------------------------------------
@router.post("/summary")
def summary(req: SummaryRequest) -> Dict[str, Any]:
    """Grouped daily summary (status -> WBS -> activity), and whether the day is small enough for task cards."""
    def work(ctx: ReportContext):
        report_date = _check_date(ctx, req.report_date)
        _refresh(ctx, report_date, req.refresh)
        dataset = ctx.daily.get_dataset(report_date)
        threshold = ctx.settings.detail_view_task_threshold
        view_mode = "detail" if len(dataset.tasks) <= threshold else "grouped"
        return SummaryResponse(
            report_date=report_date,
            generated_at=_now(),
            totals=DayTotalsOut(**ctx.grouping.day_totals(dataset)),
            data_quality=DataQualityOut(**ctx.grouping.data_quality(dataset)),
            status_groups=[_status_out(group) for group in ctx.grouping.build(dataset)],
            view_mode=view_mode,
            detail_view_task_threshold=threshold,
            tasks=[TaskOut.from_task(task) for task in dataset.tasks] if view_mode == "detail" else [],
        ).model_dump(mode="json")
    return _call(req, work)


@router.post("/details")
def details(req: DetailsRequest) -> Dict[str, Any]:
    """Every logical daily task of the date (dataset B)."""
    def work(ctx: ReportContext):
        report_date = _check_date(ctx, req.report_date)
        dataset = ctx.daily.get_dataset(report_date)
        return DetailResponse(report_date=report_date, task_count=len(dataset.tasks),
                              tasks=[TaskOut.from_task(task) for task in dataset.tasks]).model_dump(mode="json")
    return _call(req, work)


@router.post("/group-details")
def group_details(req: GroupDetailsRequest) -> Dict[str, Any]:
    """The wells and tasks behind one summary figure; with no filter, the whole day's per-well roll-up."""
    def work(ctx: ReportContext):
        report_date = _check_date(ctx, req.report_date)
        _refresh(ctx, report_date, req.refresh)
        dataset = ctx.daily.get_dataset(report_date)
        tasks = ctx.daily.filter_tasks(dataset, uom=req.uom, wbs=req.wbs, activity_code=req.activity_code,
                                       status=req.status)
        return GroupDetailsResponse(
            report_date=report_date,
            filters={"status": req.status, "wbs": req.wbs, "activity_code": req.activity_code, "uom": req.uom},
            task_count=len(tasks),
            well_count=len({task.well_id for task in tasks}),
            wells=_well_summaries(tasks),
            tasks=[TaskOut.from_task(task) for task in tasks],
        ).model_dump(mode="json")
    return _call(req, work)


@router.post("/well-activity")
def well_activity(req: WellActivityRequest) -> Dict[str, Any]:
    """Per-well task activity as of the date; with wellId, that well only and the incomplete tasks behind it."""
    def work(ctx: ReportContext):
        report_date = _check_date(ctx, req.report_date)
        _refresh(ctx, report_date, req.refresh)
        dataset = ctx.daily.get_dataset(report_date)
        wells = ctx.activity.wells_for_date(report_date, dataset)
        tasks: List[LogicalTaskOut] = []
        if req.well_id is not None:
            wells = [well for well in wells if well.well_id == req.well_id]
            tasks = [LogicalTaskOut.from_task(t) for t in ctx.activity.incomplete_tasks(report_date, req.well_id)]
        return WellActivityResponse(report_date=report_date, well_count=len(wells),
                                    wells=[WellTaskActivityOut.from_activity(w) for w in wells],
                                    tasks=tasks).model_dump(mode="json")
    return _call(req, work)


@router.post("/dates")
def dates(req: DatesRequest) -> Dict[str, Any]:
    """Recent dates that carry daily entries, for the date picker."""
    def work(ctx: ReportContext):
        s = ctx.settings
        limit = s.dates_default_limit if req.limit is None else req.limit
        if not 1 <= limit <= s.dates_max_limit:
            raise BadRequest(f"limit must be between 1 and {s.dates_max_limit}.")
        rows = ctx.daily.recent_dates(limit)
        return RecentDatesResponse(dates=[RecentDateOut(**row) for row in rows]).model_dump(mode="json")
    return _call(req, work)


@router.post("/well")
def well(req: WellRequest) -> Dict[str, Any]:
    """One well's daily tasks on the date. A live well with no entry on the date but task evidence up to it is not
    an error: its task activity and open tasks are returned instead. Only a well with no evidence at all is 404."""
    def work(ctx: ReportContext):
        report_date = _check_date(ctx, req.report_date)
        dataset = ctx.daily.get_dataset(report_date)
        tasks = ctx.daily.filter_tasks(dataset, well_id=req.well_id)
        activity = None
        open_tasks = []
        if not tasks:
            try:
                activity = ctx.activity.well_for_date(report_date, dataset, req.well_id)
                if activity is not None:
                    open_tasks = ctx.activity.incomplete_tasks(report_date, req.well_id)
            except (DatabaseUnavailable, *CONFIG_ERRORS):
                raise
            except Exception:  # noqa: BLE001 - fall back to the plain "no records" answer
                log.exception("well task-activity lookup failed for well %s", req.well_id)
        if not tasks and activity is None:
            raise NotFound(f"No daily task records for well {req.well_id} on {report_date.isoformat()}. The well may "
                           "be completed, may have no entry for this date, or may not exist.")
        return WellDetailResponse(
            report_date=report_date, well_id=req.well_id, task_count=len(tasks),
            tasks=[TaskOut.from_task(task) for task in tasks],
            activity=WellTaskActivityOut.from_activity(activity) if activity is not None else None,
            open_tasks=[LogicalTaskOut.from_task(task) for task in open_tasks],
        ).model_dump(mode="json")
    return _call(req, work)


@router.post("/milestones")
def milestones(req: MilestonesRequest) -> Dict[str, Any]:
    """Live wells approaching (or past) a lifecycle deadline, evaluated against the tenant's today."""
    def work(ctx: ReportContext):
        s = ctx.settings
        window = s.milestone_window_days if req.window_days is None else req.window_days
        if window < 0:
            raise BadRequest("windowDays must be zero or more.")
        upcoming, overdue = ctx.milestones.upcoming_and_overdue(window, today=req.today)
        return MilestonesResponse(
            generated_at=_now(),
            window_days=window,
            upcoming=[MilestoneAlertOut.from_alert(a) for a in upcoming],
            overdue_count=len(overdue),
            overdue=[MilestoneAlertOut.from_alert(a) for a in overdue[: s.milestone_overdue_display_limit]],
        ).model_dump(mode="json")
    return _call(req, work)


_UNSAFE_FILENAME = re.compile(r"[^A-Za-z0-9._-]+")


@router.post("/export")
def export(req: ExportRequest) -> Response:
    """The date's detailed records as an .xlsx download (built in memory; nothing is written anywhere)."""
    def work(ctx: ReportContext):
        report_date = _check_date(ctx, req.report_date)
        dataset = ctx.daily.get_dataset(report_date)
        content = ctx.export.build_workbook(dataset)
        filename = _UNSAFE_FILENAME.sub("_", ctx.export.filename(report_date))
        return Response(content=content, media_type=XLSX_MEDIA_TYPE, headers={
            "Content-Disposition": f'attachment; filename="{filename}"; filename*=UTF-8\'\'{quote(filename)}'})
    return _call(req, work)


# ---------------------------------------------------------------------------------------------------------------
# the agents
# ---------------------------------------------------------------------------------------------------------------
@router.post("/agent/brief")
def agent_brief(req: BriefRequest) -> Dict[str, Any]:
    """The dashboard's AI summaries (day / well / task): fixed tool plan, writer, deterministic verifier."""
    def work(ctx: ReportContext):
        report_date = _check_date(ctx, req.report_date)
        scope = (req.scope or "day").strip().lower()
        if scope not in _BRIEF_SCOPES:
            raise BadRequest(f"The agent brief covers {', '.join(_BRIEF_SCOPES)}, not {scope!r}.")
        if scope == "well" and req.well_id is None:
            raise BadRequest("wellId is required for a well brief.")
        if scope == "task" and req.task_daily_id is None:
            raise BadRequest("taskDailyId is required for a task brief.")
        try:
            return agent_service.brief(ctx, report_date, today=req.today, scope=scope, well_id=req.well_id,
                                       task_daily_id=req.task_daily_id)
        except CONFIG_ERRORS:
            raise
        except Exception as exc:  # noqa: BLE001 - the dashboard must survive anything here
            log.exception("daily report agent brief failed")
            return {"report_date": report_date, "kind": "brief", "scope": scope, "available": False,
                    "error": f"The agent could not complete this summary ({type(exc).__name__}).", "evidence": {},
                    "usage": list(ctx.run.usage)}
    return _call(req, work)


@router.post("/agent/ask")
def agent_ask(req: AskRequest) -> Dict[str, Any]:
    """An open question about one report date, planned by the planner agent over the read-only tools."""
    def work(ctx: ReportContext):
        report_date = _check_date(ctx, req.report_date)
        s = ctx.settings
        question = req.question.strip()
        if not s.question_min_length <= len(question) <= s.question_max_length:
            raise BadRequest(f"The question must be {s.question_min_length} to {s.question_max_length} characters.")
        try:
            return agent_service.ask(ctx, report_date, question, today=req.today)
        except CONFIG_ERRORS:
            raise
        except Exception as exc:  # noqa: BLE001
            log.exception("daily report agent question failed")
            return {"report_date": report_date, "kind": "ask", "question": question, "available": False,
                    "error": f"The agent could not answer this question ({type(exc).__name__}).", "evidence": {},
                    "usage": list(ctx.run.usage)}
    return _call(req, work)
