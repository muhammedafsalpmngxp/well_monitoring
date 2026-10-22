"""The deterministic crew plan. SQL decides every fact (which tasks are delayed and by how much, which crew is on each,
which crew type each activity needs, every crew's workload, availability and same-activity history); this module only

  * ranks the FREE crews with one fixed, documented rule,
  * compares, per crew type, the free crews with the delayed work that needs that type, and
  * shapes the results into the responses the page and the AI brief both use.

A crew is always a well.task_daily.crew_id with the crew type task_daily records for it, matched to the crew type the
activity needs (dbo.activity_master_csv) - never the ref.crew code text. Nothing here writes to the database or assigns
anything: every suggestion is advisory, for a planner to confirm. The AI narrates the result; it never picks a crew.
"""
from __future__ import annotations

import contextvars
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from typing import Any

from app.features.crew import queries
from app.features.crew.errors import WellNotFound
from app.features.crew.settings import CrewSettings

FREE = "FREE"
BUSY = "BUSY"
TEAM_BUSY = "TEAM_BUSY"          # another crew_id of the same supervisor is at work
INACTIVE = "INACTIVE"
STATUSES = (FREE, BUSY, TEAM_BUSY, INACTIVE)

# What the planner is asked to do for one delayed activity.
ACTION_ASSIGN = "ASSIGN_FREE_CREW"                 # no crew recorded on the task
ACTION_SUPPORT = "ADD_SUPPORT_CREW"                # crew is on it, work is late
ACTION_ASSIGNED_BUSY = "ASSIGNED_CREW_BUSY"        # not started; its crew (or team) is busy elsewhere
ACTION_MOBILISE = "MOBILISE_ASSIGNED_CREW"         # not started; its crew has nothing in progress
ACTION_CONFIRM = "CONFIRM_ASSIGNED_CREW"           # not started; its crew has no recent record
ACTION_UNRESOLVED = "CREW_TYPE_NOT_RESOLVED"       # no crew type known - nothing to match
ACTION_CLOSE_OUT = "CLOSE_OUT_RECORD"              # progress 100 %, record not closed - no crew needed

AWAITING_CLOSE_OUT = "AWAITING_CLOSE_OUT"

# Crew type coverage on the overview: free crews of a type against the delayed activities that need it.
COVER_NONE = "NO_FREE_CREW"        # delayed work, no free crew of the type
COVER_SHORT = "SHORT"              # fewer free crews than delayed activities
COVER_OK = "COVERED"               # at least one free crew per delayed activity
COVER_IDLE = "NO_DELAYED_WORK"     # no delayed work needs the type


def _rules(cfg: CrewSettings) -> dict[str, Any]:
    return {
        "crew_recent_days": cfg.crew_recent_days,
        "free_crew_definition": (
            "A crew (task_daily crew_id) whose task_daily crew type is the crew type this activity needs (activity "
            "master), whose whole team (every crew_id of the same supervisor) has no task in progress on any live "
            f"well and was recorded on a task within {cfg.crew_recent_days} days of the latest task record. Derived "
            "from task records only - there is no roster, leave, shift or location data."
        ),
        "ranking": ("Most completions of this same activity, then fewest queued (assigned, not started) tasks, then "
                    "most recently recorded."),
    }


# ============================================================
# FLEET OVERVIEW
# ============================================================

def overview(cfg: CrewSettings, *, fresh: bool = False) -> dict[str, Any]:
    """Every crew and its availability, capacity against delayed work per crew type, and the wells needing crews.
    The three fleet-wide queries run side by side."""
    jobs = {
        "board": (queries.BOARD, {"recent_days": cfg.crew_recent_days}),
        "demand": (queries.DEMAND, {}),
        "wells": (queries.WELLS, {}),
    }
    with ThreadPoolExecutor(max_workers=len(jobs)) as pool:
        futures = {name: pool.submit(contextvars.copy_context().run, queries.run, key, cfg, values, fresh=fresh)
                   for name, (key, values) in jobs.items()}
        results = {name: f.result() for name, f in futures.items()}

    crews = results["board"].rows
    demand = results["demand"].rows
    wells = results["wells"].rows

    counts = _status_counts(crews)
    types = _capacity(crews, demand)
    unresolved = next((d for d in demand if d.get("crew_type_id") is None), None)

    return {
        "as_of": date.today().isoformat(),
        "data_as_of": next((c["data_as_of"] for c in crews if c.get("data_as_of")), None),
        "rules": _rules(cfg),
        "kpis": {
            "crews": len(crews),
            "free": counts[FREE],
            "busy": counts[BUSY],
            "team_busy": counts[TEAM_BUSY],
            "inactive": counts[INACTIVE],
            "members": sum(c.get("members") or 0 for c in crews),
            "wells_with_delays": len(wells),
            "delayed_activities": sum(w.get("delayed_activities") or 0 for w in wells),
            "without_recorded_crew": sum(w.get("without_recorded_crew") or 0 for w in wells),
            "awaiting_close_out": sum(w.get("awaiting_close_out") or 0 for w in wells),
            "crew_types_short": sum(1 for t in types if t["coverage"] in (COVER_NONE, COVER_SHORT)),
            "crew_type_not_resolved": (unresolved or {}).get("delayed_activities") or 0,
        },
        "crew_types": types,
        "crews": crews,
        "wells": wells,
        "truncated": any(r.truncated for r in results.values()),
    }


def _capacity(crews: list[dict], demand: list[dict]) -> list[dict]:
    """One row per crew type: its crews by availability and the delayed work that needs it, with a coverage status.
    Types with crews but no delayed work and types with delayed work but no crew are both listed."""
    groups: dict[int, dict] = {}

    def group(type_id: int, code: Any, name: Any) -> dict:
        g = groups.get(type_id)
        if g is None:
            g = groups[type_id] = {
                "crew_type_id": type_id, "crew_type_code": code, "crew_type_name": name,
                "crews": 0, "free": 0, "busy": 0, "team_busy": 0, "inactive": 0, "members": 0,
                "queued_tasks": 0, "in_progress_tasks": 0,
                "delayed_activities": 0, "wells": 0, "without_recorded_crew": 0, "overdue": 0,
                "start_slipping": 0, "max_days_overdue": 0,
            }
        g["crew_type_code"] = g["crew_type_code"] or code
        g["crew_type_name"] = g["crew_type_name"] or name
        return g

    for crew in crews:
        if crew.get("crew_type_id") is None:
            continue
        g = group(crew["crew_type_id"], crew.get("crew_type_code"), crew.get("crew_type_name"))
        g["crews"] += 1
        g[crew["availability_status"].lower()] = g.get(crew["availability_status"].lower(), 0) + 1
        g["members"] += crew.get("members") or 0
        g["queued_tasks"] += crew.get("queued_tasks") or 0
        g["in_progress_tasks"] += crew.get("in_progress_tasks") or 0

    for d in demand:
        if d.get("crew_type_id") is None:
            continue
        g = group(d["crew_type_id"], d.get("crew_type_code"), d.get("crew_type_name"))
        for k in ("delayed_activities", "wells", "without_recorded_crew", "overdue", "start_slipping",
                  "max_days_overdue"):
            g[k] = d.get(k) or 0

    for g in groups.values():
        if not g["delayed_activities"]:
            g["coverage"] = COVER_IDLE
        elif g["free"] == 0:
            g["coverage"] = COVER_NONE
        elif g["free"] < g["delayed_activities"]:
            g["coverage"] = COVER_SHORT
        else:
            g["coverage"] = COVER_OK
        g["free_shortfall"] = max(g["delayed_activities"] - g["free"], 0)

    order = {COVER_NONE: 0, COVER_SHORT: 1, COVER_OK: 2, COVER_IDLE: 3}
    return sorted(groups.values(), key=lambda g: (order[g["coverage"]], -g["delayed_activities"],
                                                  -g["max_days_overdue"], g["crew_type_code"] or ""))


# ============================================================
# ONE WELL: DELAYED ACTIVITIES, THE CREW ON EACH, FREE CREWS
# ============================================================

def build_well(well_id: str, cfg: CrewSettings, *, fresh: bool = False) -> dict[str, Any]:
    wells = queries.run(queries.WELL, cfg, {"well_id": well_id}).rows
    if not wells:
        raise WellNotFound(f"Well {well_id} was not found.")

    well = wells[0]
    well_completed = well.get("eng_completion_date") is not None
    activities = [] if well_completed else queries.run(queries.DELAYED, cfg, {"well_id": well_id}).rows

    activity_codes = sorted({a["activity_code"] for a in activities if a.get("activity_code")})

    # The whole fleet's crews (one cached scan); only the needed types and the crews already on the tasks matter.
    type_ids = {a["required_crew_type_id"] for a in activities if a.get("required_crew_type_id") is not None}
    assigned_ids = {a["assigned_crew_id"] for a in activities if a.get("assigned_crew_id") is not None}
    crews = [c for c in queries.run(queries.BOARD, cfg, {"recent_days": cfg.crew_recent_days}, fresh=fresh).rows
             if c.get("crew_type_id") in type_ids or c["crew_id"] in assigned_ids] if activities else []

    experience_rows = (queries.run(queries.EXPERIENCE, cfg, {"activity_codes": json.dumps(activity_codes)}).rows
                       if activity_codes else [])
    experience = {(row["crew_id"], row["activity_code"]): row for row in experience_rows}

    crews_by_id = {crew["crew_id"]: crew for crew in crews}
    crews_by_type: dict[int, list[dict]] = {}
    for crew in crews:
        if crew.get("crew_type_id") is not None:
            crews_by_type.setdefault(crew["crew_type_id"], []).append(crew)

    shaped = [_shape_activity(a, crews_by_id, crews_by_type, experience, cfg) for a in activities]
    needs_crew = [a for a in shaped if a["action"] != ACTION_CLOSE_OUT]
    _mark_shared_teams(needs_crew)

    return {
        "well_id": well["well_id"],
        "project_id": well.get("project_id"),
        "well_status": "COMPLETED" if well_completed else "LIVE",
        "ex_rig_on_date": well.get("ex_rig_on_date"),
        "rig_on_date": well.get("rig_on_date"),
        "as_of": date.today().isoformat(),
        "data_as_of": next((c["data_as_of"] for c in crews if c.get("data_as_of")), None),
        "well_last_recorded_on": next(
            (a["well_last_recorded_on"] for a in activities if a.get("well_last_recorded_on")), None),
        "stale_record_days": cfg.stale_record_days,
        "rules": _rules(cfg),
        "summary": _summary(shaped),
        "activities": shaped,
        "crew_types": _crew_types(needs_crew, crews_by_type, experience, cfg),
    }


def _shape_activity(activity, crews_by_id, crews_by_type, experience, cfg: CrewSettings) -> dict:
    required_type = activity["required_crew_type_id"]
    assigned_id = activity["assigned_crew_id"]
    assigned_load = crews_by_id.get(assigned_id) if assigned_id is not None else None

    assigned_crew = {
        "recorded": assigned_id is not None,
        "crew_id": assigned_id,
        "supervisor": activity["assigned_crew_supervisor"],
        "availability_status": assigned_load["availability_status"] if assigned_load else None,
        "in_progress_tasks": assigned_load["in_progress_tasks"] if assigned_load else None,
        "queued_tasks": assigned_load["queued_tasks"] if assigned_load else None,
        "last_recorded_on": assigned_load["last_recorded_on"] if assigned_load else None,
    }

    close_out = activity["delay_status"] == AWAITING_CLOSE_OUT
    pool = crews_by_type.get(required_type, []) if required_type is not None else []
    free = [crew for crew in pool
            if crew["availability_status"] == FREE and crew["crew_id"] != assigned_id] if not close_out else []
    ranked = sorted(free, key=lambda crew: _rank_key(crew, [activity["activity_code"]], experience))
    recommended = [_candidate(crew, experience.get((crew["crew_id"], activity["activity_code"])))
                   for crew in ranked[: cfg.max_crews_per_activity]]

    return {
        "task_code": activity["task_code"],
        "activity_id": activity["activity_id"],
        "activity_code": activity["activity_code"],
        "activity_description": activity["activity_description"],
        "wbs": activity["wbs"],
        "target_start": activity["target_start"],
        "target_end": activity["target_end"],
        "actual_start": activity["actual_start"],
        "progress": activity["progress"],
        "last_recorded_on": activity["last_recorded_on"],
        "delay_status": activity["delay_status"],
        "days_overdue": activity["days_overdue"],
        "start_variance_days": activity["start_variance_days"],
        "assigned_crew": assigned_crew,
        "required_crew_type": {
            "crew_type_id": required_type,
            "crew_type_code": activity["required_crew_type_code"],
            "crew_type_name": activity["required_crew_type_name"],
            "source": activity["required_crew_type_source"],
            "activity_crew_code": activity["activity_crew_code"],
        },
        "action": _action(activity, assigned_crew),
        "recommended_crews": recommended,
        "free_crews_available": len(free),
        "no_recommendation_reason": None if recommended else _no_recommendation_reason(activity, pool, cfg),
    }


def _action(activity, assigned_crew) -> str:
    if activity["delay_status"] == AWAITING_CLOSE_OUT:
        return ACTION_CLOSE_OUT
    if activity["required_crew_type_id"] is None:
        return ACTION_UNRESOLVED
    if not assigned_crew["recorded"]:
        return ACTION_ASSIGN
    if activity["delay_status"] == "OVERDUE_IN_PROGRESS":
        return ACTION_SUPPORT
    status = assigned_crew["availability_status"]
    if status in (BUSY, TEAM_BUSY):
        return ACTION_ASSIGNED_BUSY
    if status == FREE:
        return ACTION_MOBILISE
    return ACTION_CONFIRM


def _no_recommendation_reason(activity, pool, cfg: CrewSettings) -> str:
    if activity["delay_status"] == AWAITING_CLOSE_OUT:
        return ("Progress is recorded as 100% but the task record is not closed - it needs closing out, not a crew.")
    if activity["required_crew_type_id"] is None:
        return ("The activity is not mapped to a crew type in the activity master, and no crew type is recorded on "
                "the task, so no crew can be matched.")

    type_label = activity["required_crew_type_code"] or f"crew type {activity['required_crew_type_id']}"
    counts = _status_counts(pool)
    if not pool:
        return f"No crew has been recorded on any {type_label} activity, so none can be suggested."

    free_ids = {crew["crew_id"] for crew in pool if crew["availability_status"] == FREE}
    if free_ids and free_ids == {activity["assigned_crew_id"]}:
        return f"The only free {type_label} crew is the one already recorded on this task."

    return (f"None of the {len(pool)} crews recorded on {type_label} work is free: {counts[BUSY]} busy with work in "
            f"progress, {counts[TEAM_BUSY]} whose team is busy under another crew id, {counts[INACTIVE]} with no team "
            f"task record in the last {cfg.crew_recent_days} days.")


# ============================================================
# RANKING - one fixed rule, applied identically everywhere
# ============================================================

def _rank_key(crew, activity_codes, experience):
    """Most same-activity completions first, then fewest queued tasks, then most recently recorded, then crew_id so
    the order is always the same."""
    completed = sum(experience.get((crew["crew_id"], code), {}).get("completed_count", 0)
                    for code in activity_codes if code)
    days_since = crew["days_since_last_record"]
    return (-completed, crew["queued_tasks"], days_since if days_since is not None else float("inf"), crew["crew_id"])


def _candidate(crew, activity_experience) -> dict:
    return {
        "crew_id": crew["crew_id"],
        "supervisor_id": crew["supervisor_id"],
        "supervisor": crew["supervisor"],
        "availability_status": crew["availability_status"],
        "members": crew.get("members"),
        "queued_tasks": crew["queued_tasks"],
        "completed_tasks": crew["completed_tasks"],
        "tasks_recorded": crew["tasks_recorded"],
        "last_recorded_on": crew["last_recorded_on"],
        "days_since_last_record": crew["days_since_last_record"],
        "activity_experience": ({
            "completed_count": activity_experience["completed_count"],
            "distinct_wells": activity_experience["distinct_wells"],
            "typical_completion_days": activity_experience["typical_completion_days"],
            "average_completion_days": activity_experience["average_completion_days"],
            "last_completed_on": activity_experience["last_completed_on"],
        } if activity_experience else None),
    }


def _mark_shared_teams(activities) -> None:
    """When one supervisor's team is the top pick for several activities, say so on each of them: crew_ids of one
    supervisor are the same people, so the team can take that work in sequence, or the next recommended crew can share
    it."""
    top_by_team: dict = {}
    for activity in activities:
        if activity["recommended_crews"]:
            top = activity["recommended_crews"][0]
            if top["supervisor_id"] is not None:
                top_by_team.setdefault(top["supervisor_id"], []).append(activity)

    for activity in activities:
        for crew in activity["recommended_crews"]:
            crew["same_team_top_pick_for"] = [
                other["activity_description"] or other["wbs"] or other["activity_id"]
                for other in top_by_team.get(crew["supervisor_id"], []) if other is not activity
            ]


def _status_counts(pool) -> dict:
    counts = {status: 0 for status in STATUSES}
    for crew in pool:
        counts[crew["availability_status"]] = counts.get(crew["availability_status"], 0) + 1
    return counts


# ============================================================
# WELL-LEVEL VIEWS
# ============================================================

def _summary(all_activities) -> dict:
    activities = [a for a in all_activities if a["action"] != ACTION_CLOSE_OUT]
    return {
        "delayed_activities": len(activities),
        "awaiting_close_out": len(all_activities) - len(activities),
        "overdue": sum(1 for a in activities if a["delay_status"] != "START_SLIPPING"),
        "start_slipping": sum(1 for a in activities if a["delay_status"] == "START_SLIPPING"),
        "without_recorded_crew": sum(1 for a in activities if not a["assigned_crew"]["recorded"]),
        "crew_type_not_resolved": sum(1 for a in activities if a["action"] == ACTION_UNRESOLVED),
        "with_free_crew": sum(1 for a in activities if a["recommended_crews"]),
        "without_free_crew": sum(1 for a in activities
                                 if not a["recommended_crews"] and a["action"] != ACTION_UNRESOLVED),
        "max_days_overdue": max((a["days_overdue"] for a in activities), default=0),
    }


def _crew_types(activities, crews_by_type, experience, cfg: CrewSettings) -> list[dict]:
    """The delayed work grouped by the crew type it needs, with the best free crews of that type for ALL of this
    well's delayed activities of that type."""
    groups: dict[int, dict] = {}
    for activity in activities:
        crew_type = activity["required_crew_type"]
        type_id = crew_type["crew_type_id"]
        if type_id is None:
            continue
        group = groups.setdefault(type_id, {
            "crew_type_id": type_id,
            "crew_type_code": crew_type["crew_type_code"],
            "crew_type_name": crew_type["crew_type_name"],
            "delayed_activities": 0,
            "max_days_overdue": 0,
            "_codes": set(),
            "_assigned": set(),
        })
        group["delayed_activities"] += 1
        group["max_days_overdue"] = max(group["max_days_overdue"], activity["days_overdue"] or 0)
        if activity["activity_code"]:
            group["_codes"].add(activity["activity_code"])
        if activity["assigned_crew"]["crew_id"] is not None:
            group["_assigned"].add(activity["assigned_crew"]["crew_id"])

    out = []
    for type_id, group in groups.items():
        codes = sorted(group.pop("_codes"))
        assigned = group.pop("_assigned")
        pool = crews_by_type.get(type_id, [])
        counts = _status_counts(pool)
        free = sorted((c for c in pool if c["availability_status"] == FREE and c["crew_id"] not in assigned),
                      key=lambda crew: _rank_key(crew, codes, experience))
        group.update({
            "free": counts[FREE],
            "busy": counts[BUSY],
            "team_busy": counts[TEAM_BUSY],
            "inactive": counts[INACTIVE],
            "free_crews": [
                {**_candidate(crew, None),
                 "completed_this_wells_activities": sum(
                     experience.get((crew["crew_id"], code), {}).get("completed_count", 0) for code in codes)}
                for crew in free[: cfg.max_crews_per_type]
            ],
        })
        out.append(group)

    out.sort(key=lambda g: (-g["delayed_activities"], -g["max_days_overdue"], g["crew_type_code"] or ""))
    return out
