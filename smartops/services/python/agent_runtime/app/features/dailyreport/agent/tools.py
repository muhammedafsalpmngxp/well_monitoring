"""The agents' tools: every one a fixed, read-only, deterministic service call (ported from app/agentic/tools.py).

THE BOUNDARY. An agent chooses WHICH tool to call and with WHAT arguments; the tool alone decides what comes back.
No tool accepts SQL, a column name or a formula from a model. Arguments are validated, not trusted: a well id must be
an integer, a limit is clamped to the tool's limit settings, an unknown filter is refused with a message the planner
can read (the tenant's dailyreport.tool_errors). A tool that fails returns its error as data, so one unavailable
source never ends a run; a configuration problem (a prompt, a query, the table allowlist) is raised to the admin.

What the planner is told about each tool is the tenant's dailyreport.tool_<name> prompt; the tool names, their
arguments and what they do are the engine.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Callable, Dict, List, Optional, Tuple

from app.features.common.db import DatabaseUnavailable
from app.features.dailyreport.errors import CONFIG_ERRORS, BadRequest
from app.features.dailyreport.models import QuantityStatus
from app.features.dailyreport.scope import ScopeRequest, build_scope_evidence

logger = logging.getLogger(__name__)


class ToolError(ValueError):
    """A tool was called outside its contract. The message is shown to the planner / writer."""


@dataclass
class ToolEnv:
    """What every tool call shares: the request, the report date and the tenant's today (for deadlines)."""

    ctx: Any
    report_date: date
    today: date

    def refuse(self, kind: str, **values: object) -> ToolError:
        return ToolError(self.ctx.texts.entry("tool_errors", kind, **values))


@dataclass
class ToolResult:
    tool: str
    args: Dict[str, Any]
    ok: bool
    result: Dict[str, Any] = field(default_factory=dict)
    error: Optional[str] = None
    duration_s: float = 0.0
    #: Audit material for the operator's panel only, never part of what a model sees.
    audit: Dict[str, Any] = field(default_factory=dict)

    def for_model(self) -> Dict[str, Any]:
        if not self.ok:
            return {"tool": self.tool, "args": self.args, "error": self.error}
        return {"tool": self.tool, "args": self.args, "result": self.result}


@dataclass
class Tool:
    name: str
    params: Tuple[str, ...]
    fn: Callable[[ToolEnv, Dict[str, Any]], Tuple[Dict[str, Any], Dict[str, Any]]]
    #: settings -> (default limit, max limit) shown to the planner as {DEFAULT_LIMIT} / {MAX_LIMIT}.
    limits: Optional[Callable[[Any], Tuple[int, int]]] = None


# ---------------------------------------------------------------------------------------------------------------
# argument helpers
# ---------------------------------------------------------------------------------------------------------------
def _int(env: ToolEnv, args: Dict[str, Any], name: str, *, required: bool = True) -> Optional[int]:
    value = args.get(name)
    if value is None or value == "":
        if required:
            raise env.refuse("required", NAME=name)
        return None
    if isinstance(value, bool):
        raise env.refuse("whole_number", NAME=name, VALUE=repr(value))
    try:
        return int(value)
    except (TypeError, ValueError):
        raise env.refuse("whole_number", NAME=name, VALUE=repr(value)) from None


def _limit(env: ToolEnv, args: Dict[str, Any], default: int, maximum: int) -> int:
    value = _int(env, args, "limit", required=False)
    return max(1, min(value or default, maximum))


def _dataset(env: ToolEnv):
    return env.ctx.daily.get_dataset(env.report_date)


def _scope(env: ToolEnv, **fields: Any):
    return build_scope_evidence(env.ctx, ScopeRequest(report_date=env.report_date, **fields), _dataset(env))


def _scope_result(env: ToolEnv, resolved) -> Dict[str, Any]:
    if not resolved.available:
        return {"available": False, "note": env.ctx.texts.get("tool_unavailable_note")}
    return {"available": True, "evidence": resolved.llm_evidence}


def _scope_audit(resolved) -> Dict[str, Any]:
    return {"evidence": resolved.evidence, "withheld": resolved.withheld, "sql_sources": resolved.sql_sources,
            "proof": resolved.proof, "proof_note": resolved.proof_note}


# ---------------------------------------------------------------------------------------------------------------
# the tools
# ---------------------------------------------------------------------------------------------------------------
def day_overview(env: ToolEnv, args: Dict[str, Any]):
    resolved = _scope(env, scope="day")
    return _scope_result(env, resolved), _scope_audit(resolved)


def well_overview(env: ToolEnv, args: Dict[str, Any]):
    well_id = _int(env, args, "well_id")
    resolved = _scope(env, scope="well", well_id=well_id)
    return _scope_result(env, resolved), _scope_audit(resolved)


def task_detail(env: ToolEnv, args: Dict[str, Any]):
    task_daily_id = _int(env, args, "task_daily_id")
    well_id = _int(env, args, "well_id", required=False)
    resolved = _scope(env, scope="task", task_daily_id=task_daily_id, well_id=well_id)
    return _scope_result(env, resolved), _scope_audit(resolved)


_WELL_FILTERS = {"reported", "open_work", "no_report_with_open_work", "all"}


def list_wells(env: ToolEnv, args: Dict[str, Any]):
    """Wells with their figures as of the date, busiest first."""
    settings = env.ctx.settings
    which = str(args.get("filter") or "open_work").strip().lower()
    status = str(args.get("status") or "").strip().upper() or None
    if which not in _WELL_FILTERS:
        raise env.refuse("one_of", NAME="filter", OPTIONS=str(sorted(_WELL_FILTERS)))
    if status and status not in {member.value for member in QuantityStatus}:
        raise env.refuse("one_of", NAME="status", OPTIONS=str([m.value for m in QuantityStatus]))
    limit = _limit(env, args, settings.list_wells_default_limit, settings.list_wells_max_limit)

    dataset = _dataset(env)
    activity = env.ctx.activity.wells_for_date(env.report_date, dataset)
    status_by_well: Dict[int, Dict[str, int]] = {}
    for task in dataset.tasks:
        counts = status_by_well.setdefault(task.well_id, {})
        counts[task.quantity_status.value] = counts.get(task.quantity_status.value, 0) + 1

    rows = []
    for well in activity:
        reported = well.today_reported_task_count
        if which == "reported" and not reported:
            continue
        if which == "open_work" and not well.open_task_count:
            continue
        if which == "no_report_with_open_work" and (reported or not well.open_task_count):
            continue
        statuses = status_by_well.get(well.well_id, {})
        if status and not statuses.get(status):
            continue
        rows.append({
            "well_id": well.well_id,
            "reported_task_count_on_report_date": reported,
            "open_task_count": well.open_task_count,
            "incomplete_task_count": well.incomplete_task_count,
            "ongoing_task_count": well.ongoing_task_count,
            "last_task_date": well.last_task_date,
            "status_counts_on_report_date": statuses,
        })
    rows.sort(key=lambda r: (-r["reported_task_count_on_report_date"], -r["open_task_count"], r["well_id"]))
    return {"filter": which, "status": status, "matching_well_count": len(rows), "wells": rows[:limit],
            "shown": min(limit, len(rows))}, {}


def _alert_out(alert) -> Dict[str, Any]:
    return {"well_id": alert.well_id, "milestone": alert.label, "deadline_date": alert.deadline_date,
            "days_remaining": alert.days_remaining}


def milestones(env: ToolEnv, args: Dict[str, Any]):
    """Lifecycle deadlines, evaluated against the tenant's today."""
    settings = env.ctx.settings
    window = _int(env, args, "window_days", required=False)
    window = settings.milestone_window_days if window is None else max(0, min(window, settings.milestones_tool_max_window_days))
    well_id = _int(env, args, "well_id", required=False)
    limit = _limit(env, args, settings.milestones_tool_default_limit, settings.milestones_tool_max_limit)
    upcoming, overdue = env.ctx.milestones.upcoming_and_overdue(window, today=env.today)
    if well_id is not None:
        upcoming = [a for a in upcoming if a.well_id == well_id]
        overdue = [a for a in overdue if a.well_id == well_id]
    return {
        "evaluated_against": "today",
        "today": env.today,
        "window_days": window,
        "upcoming_count": len(upcoming),
        "upcoming": [_alert_out(a) for a in upcoming[:limit]],
        "overdue_count": len(overdue),
        "overdue": [_alert_out(a) for a in overdue[:limit]],
    }, {}


def deadline_pressure(env: ToolEnv, args: Dict[str, Any]):
    """Wells with open work before an upcoming deadline, or open work past an overdue one: a deterministic join of
    the milestone deadlines and the wells' open-task counts. It never says a task is late, delayed or at risk."""
    settings = env.ctx.settings
    window = settings.deadline_window_days
    limit = _limit(env, args, settings.deadline_pressure_default_limit, settings.deadline_pressure_max_limit)
    upcoming, overdue = env.ctx.milestones.upcoming_and_overdue(window, today=env.today)
    open_by_well = {well.well_id: well for well in env.ctx.activity.wells_for_date(env.report_date, _dataset(env))}

    def rows(alerts, condition):
        found = []
        for alert in alerts:
            well = open_by_well.get(alert.well_id)
            if well is None or not well.open_task_count:
                continue
            found.append({
                "well_id": alert.well_id,
                "milestone": alert.label,
                "deadline_date": alert.deadline_date,
                "days_remaining": alert.days_remaining,
                "open_task_count": well.open_task_count,
                "ongoing_task_count": well.ongoing_task_count,
                "incomplete_task_count": well.incomplete_task_count,
                "condition": condition,
            })
        return found

    before = rows(upcoming, "OPEN_WORK_BEFORE_UPCOMING_DEADLINE")
    past = rows(overdue, "OPEN_WORK_PAST_OVERDUE_DEADLINE")
    before.sort(key=lambda r: (r["days_remaining"], -r["open_task_count"]))
    past.sort(key=lambda r: (-r["open_task_count"], r["days_remaining"]))
    return {
        "rule": env.ctx.texts.fill("tool_deadline_rule", WINDOW_DAYS=window),
        "window_days": window,
        "open_work_before_upcoming_deadline_count": len(before),
        "open_work_before_upcoming_deadline": before[:limit],
        "open_work_past_overdue_deadline_count": len(past),
        "open_work_past_overdue_deadline": past[:limit],
    }, {}


def crew_options(env: ToolEnv, args: Dict[str, Any]):
    """The crew evidence for one task, exactly as SQL ranked it."""
    task_daily_id = _int(env, args, "task_daily_id")
    task = next((t for t in _dataset(env).tasks if t.task_daily_id == task_daily_id), None)
    if task is None:
        raise env.refuse("no_task", TASK_DAILY_ID=task_daily_id, REPORT_DATE=env.report_date.isoformat())
    suggestion = env.ctx.crew.build(well_id=task.well_id, task_code=task.task_code, report_date=env.report_date)
    return {"well_id": task.well_id, "task_code": task.task_code, "activity_description": task.activity_description,
            "crew_suggestion": suggestion, "advisory_only": True}, {}


def data_quality(env: ToolEnv, args: Dict[str, Any]):
    """The day's data-quality flags, grouped (counts only; the flags were raised by validation)."""
    settings = env.ctx.settings
    limit = _limit(env, args, settings.data_quality_default_limit, settings.data_quality_max_limit)
    dataset = _dataset(env)
    by_flag: Dict[str, Dict[str, Any]] = {}
    for task in dataset.tasks:
        for flag in task.data_quality_flags:
            entry = by_flag.setdefault(flag.value, {"task_count": 0, "wells": set(), "activities": {}})
            entry["task_count"] += 1
            entry["wells"].add(task.well_id)
            label = task.activity_description or task.task_code or "unknown"
            entry["activities"][label] = entry["activities"].get(label, 0) + 1
    flags = []
    for name, entry in sorted(by_flag.items(), key=lambda kv: -kv[1]["task_count"]):
        top = sorted(entry["activities"].items(), key=lambda kv: -kv[1])[:limit]
        flags.append({"flag": name, "task_count": entry["task_count"], "well_count": len(entry["wells"]),
                      "most_affected": [{"activity": a, "task_count": c} for a, c in top]})
    return {"report_date": env.report_date, "reported_task_count": len(dataset.tasks), "flag_count": len(flags),
            "flags": flags, "note": env.ctx.texts.get("tool_data_quality_note")}, {}


TOOLS: Dict[str, Tool] = {tool.name: tool for tool in (
    Tool("day_overview", (), day_overview),
    Tool("well_overview", ("well_id",), well_overview),
    Tool("task_detail", ("task_daily_id", "well_id"), task_detail),
    Tool("list_wells", ("filter", "status", "limit"), list_wells,
         lambda s: (s.list_wells_default_limit, s.list_wells_max_limit)),
    Tool("milestones", ("window_days", "well_id", "limit"), milestones,
         lambda s: (s.milestones_tool_default_limit, s.milestones_tool_max_limit)),
    Tool("deadline_pressure", ("limit",), deadline_pressure,
         lambda s: (s.deadline_pressure_default_limit, s.deadline_pressure_max_limit)),
    Tool("crew_options", ("task_daily_id",), crew_options),
    Tool("data_quality", ("limit",), data_quality,
         lambda s: (s.data_quality_default_limit, s.data_quality_max_limit)),
)}


def catalog(ctx) -> List[Dict[str, Any]]:
    """What the planner is shown: names, the tenant's descriptions and argument meanings. An argument the tenant's
    text describes but the tool does not take is not shown."""
    out = []
    for tool in TOOLS.values():
        default, maximum = tool.limits(ctx.settings) if tool.limits else ("", "")
        description, args = ctx.texts.tool(tool.name, DEFAULT_LIMIT=default, MAX_LIMIT=maximum)
        out.append({"name": tool.name, "description": description,
                    "args": {name: meaning for name, meaning in args.items() if name in tool.params}})
    return out


def run_tool(env: ToolEnv, name: str, args: Optional[Dict[str, Any]] = None) -> ToolResult:
    """Run one tool. A refusal or a data failure comes back as data; a configuration error is raised."""
    args = dict(args or {})
    started = time.perf_counter()
    tool = TOOLS.get(name)
    if tool is None:
        return ToolResult(name, args, ok=False, error=env.refuse("unknown_tool", TOOL=repr(name)).args[0])
    try:
        result, audit = tool.fn(env, args)
        return ToolResult(name, args, ok=True, result=result, audit=audit, duration_s=time.perf_counter() - started)
    except ToolError as exc:
        return ToolResult(name, args, ok=False, error=str(exc), duration_s=time.perf_counter() - started)
    except CONFIG_ERRORS:
        raise
    except Exception as exc:  # noqa: BLE001 - one failed source must not end a run
        logger.exception("daily report agent tool %s failed", name)
        detail = str(exc) if isinstance(exc, (DatabaseUnavailable, BadRequest)) else type(exc).__name__
        return ToolResult(name, args, ok=False, error=env.ctx.texts.entry("tool_errors", "failed", DETAIL=detail),
                          duration_s=time.perf_counter() - started)
