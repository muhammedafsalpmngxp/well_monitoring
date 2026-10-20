"""Recovery advisor: why is a well (or one of its tasks) late, and how could it be recovered?

Two questions, one agent:
  * suggest_well(): why is this WELL delayed, and how to overcome it.
  * suggest():      is THIS late task late because of another delay, and how could it be recovered.

It writes and runs no SQL of its own: it runs the tenant's verified queries (queries.py) and hands the model the
evidence. Three things keep a model's opinion from being mistaken for a verified figure:

  * THE EVIDENCE IS SELECTED HERE, IN PYTHON. The task, the other late tasks on the well, the well's milestones and
    the crews of the matching type all come from verified queries. The model reasons over them; it does not fetch or
    count anything.
  * THE ANSWER IS RETURNED BESIDE ITS EVIDENCE, so the page shows the two apart.
  * IT MAY ONLY NAME CREWS IT WAS GIVEN. A crew id (or, well level, a crew type) in an answer that is not among the
    candidates is flagged on the action (crew_unverified / type_unverified) and in the caveats.

An answer is reused only while what it rests on is unchanged (see _answer): the rows, the prompt texts, the settings
that shape the evidence and the model. The store is bounded (LRU, size and TTL from the settings) and keyed by the
database identity, so two tenants never share an answer.
"""
from __future__ import annotations

import hashlib
import json
import logging
import time
from collections import OrderedDict
from concurrent.futures import Future
from datetime import datetime, timezone
from threading import Lock
from typing import Any, Callable

from app.features.common import llm
from app.features.common.context import current
from app.features.common.db import QueryResult
from app.features.common.text import extract_json
from app.features.slippage import prompts, queries
from app.features.slippage.errors import AdvisorFailed, BadRequest, TaskNotFound
from app.features.slippage.settings import SlippageSettings

log = logging.getLogger("agent_runtime.slippage")

# The reply protocol of the two system prompts (what the page renders).
_VERDICTS = ("yes", "possibly", "no", "unknown")
_WELL_VERDICTS = ("yes", "at_risk", "no", "unknown")

# The task fields the model is shown (the activity_delay output contract). task_code stays so evidence can be cited
# unambiguously; the prompt tells the model to NAME the work by its WBS.
_TASK_FIELDS = (
    "task_code", "wbs", "activity_code", "crew_code", "crew_id", "crew_type_id",
    "target_start", "target_end", "actual_start", "actual_end",
    "start_status", "start_variance_days", "end_status", "end_variance_days",
    "execution_status", "schedule_risk", "progress_percent",
)

# Stored answers: key -> (fingerprint, stored at (monotonic), result). Answers being computed: (key, fingerprint).
_cache: OrderedDict[tuple, tuple[str, float, dict]] = OrderedDict()
_inflight: dict[tuple[tuple, str], Future] = {}
_lock = Lock()


def clear() -> None:
    """Drop every stored answer (tests; an operator restart does the same)."""
    with _lock:
        _cache.clear()


# -- Fingerprint and cache ------------------------------------------------------------------------------------------


def _canon(value: Any) -> Any:
    """An order-free form of a value, for fingerprinting: dict keys and list items sorted.

    ORDER MUST NOT COUNT AS A CHANGE. The activity query returns tied rows (same risk, same variances, same dates) in a
    different order on each run; fingerprinting the rendered prompt would make every click look like new data and pay
    for a model call each time."""
    if isinstance(value, dict):
        return {str(k): _canon(v) for k, v in sorted(value.items(), key=lambda kv: str(kv[0]))}
    if isinstance(value, (list, tuple)):
        items = [_canon(v) for v in value]
        return sorted(items, key=lambda v: json.dumps(v, sort_keys=True, default=str))
    return value


def _fingerprint(*parts: Any) -> str:
    """A hash of what an answer rests on: rows (not the prompt rendered from them), prompt texts, settings, model."""
    blob = json.dumps([_canon(p) for p in parts], sort_keys=True, default=str)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def _db_identity() -> tuple:
    db = current().request.db
    return (db.server.strip().lower(), db.port, db.name.strip().lower(), db.user.strip().lower())


def _model_identity() -> tuple | None:
    model = current().request.llm
    return (model.provider, model.base_url.rstrip("/"), model.model) if model else None


def _answer(key: tuple, fresh: bool, cfg: SlippageSettings, gather: Callable, ask: Callable) -> dict:
    """Serve a stored answer while what it rests on is unchanged, join one already being computed, or ask.

    EXPIRY IS BY DATA. gather() runs the verified queries on every request (the cheap part, against tens of seconds
    for the model) and returns (evidence, prompt, fingerprint). A stored answer is served only while the fingerprint
    is the same (and it is younger than the TTL), so an answer is never older than the figures beside it.

    THE JOIN: a request for the same key and the SAME data while an answer is being computed waits for that call
    instead of paying for its own (a double click, a panel closed and reopened mid-answer, two people on one well).
    `fresh` skips the stored answer, not a call in flight: that call started after the stored answer was refused, so
    it is already the fresh answer being asked for. A failure is not stored: every waiting caller gets the same
    exception, and the next request tries again. The wait is bounded by the provider timeout.
    """
    evidence, prompt, version = gather()
    flight = (key, version)
    ttl, size = cfg.advice_cache_ttl_seconds, cfg.advice_cache_size
    with _lock:
        hit = _cache.get(key)
        if hit and (ttl <= 0 or time.monotonic() - hit[1] >= ttl):
            _cache.pop(key, None)
            hit = None
        if not fresh and hit and hit[0] == version:
            _cache.move_to_end(key)
            return {**hit[2], "cached": True}
        pending = _inflight.get(flight)
        leader = pending is None
        if leader:
            pending = _inflight[flight] = Future()

    if not leader:
        log.info("slippage advisor: %s is already being answered; waiting for that call", key[1:])
        return dict(pending.result())          # generated for this request's moment: not reported as cached
    if hit and not fresh:
        log.info("slippage advisor: %s changed since the stored answer; asking again", key[1:])

    try:
        result = ask(evidence, prompt)
    except BaseException as exc:
        with _lock:
            _inflight.pop(flight, None)
        pending.set_exception(exc)
        raise
    with _lock:
        if ttl > 0 and size > 0:
            _cache[key] = (version, time.monotonic(), result)
            _cache.move_to_end(key)
            while len(_cache) > size:
                _cache.popitem(last=False)
        else:
            _cache.pop(key, None)
        _inflight.pop(flight, None)
    pending.set_result(result)
    return result


def _ask_model(system: str, message: str, cfg: SlippageSettings, agent: str) -> tuple[str, str]:
    """(reply, model) of one advisor call. A provider failure is AdvisorFailed (safe message, class name only)."""
    try:
        reply = llm.chat(system, message, agent=agent, temperature=cfg.advisor_temperature,
                         effort=cfg.advisor_reasoning_effort, verbosity=cfg.advisor_verbosity)
    except llm.AiUnavailable:
        raise
    except Exception as exc:  # noqa: BLE001 - a provider's error text is for the log, not the page
        log.warning("slippage advisor: the AI provider failed (%s)", type(exc).__name__, exc_info=True)
        raise AdvisorFailed(f"The AI provider could not answer ({type(exc).__name__}). Try again.") from None
    run = current()
    model = next((u["model"] for u in reversed(run.usage) if u.get("agent") == f"{run.feature}.{agent}"), None)
    return reply, model or (run.request.llm.model if run.request.llm else "")


def _check_ready() -> None:
    if not llm.available():
        raise llm.AiUnavailable("No AI provider is active for this tenant. An admin can add one under "
                                "Settings > AI Providers.")
    prompts.require()


# -- Small helpers --------------------------------------------------------------------------------------------------


def _clean(value: Any) -> Any:
    """Collapse whitespace in text (WBS names carry embedded newlines) and leave the rest alone."""
    return " ".join(value.split()) if isinstance(value, str) else value


def _day(value: Any) -> str | None:
    """A date as YYYY-MM-DD: comparable as a string, and compact in a prompt."""
    if value in (None, ""):
        return None
    return str(value)[:10]


def _same(a: Any, b: Any) -> bool:
    """Id equality across the shapes the JSON layer produces: 12, "12" and 12.0 are one crew."""
    if a in (None, "") or b in (None, ""):
        return False
    try:
        return float(a) == float(b)
    except (TypeError, ValueError):
        return str(a).strip() == str(b).strip()


def _count(value: Any) -> float:
    """A count for sorting. Missing sorts last: unknown load is not zero load."""
    try:
        return float(value)
    except (TypeError, ValueError):
        return float("inf")


def _number(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _key(value: Any) -> str | None:
    """One comparable form of an id: 287, "287" and 287.0 all become "287"; empty becomes None."""
    if value in (None, ""):
        return None
    n = _number(value)
    return str(int(n)) if n is not None and n == int(n) else str(value).strip()


def _nullish(value: Any) -> Any:
    return None if value in (None, "", "null", "None") else value


def _as_list(value: Any) -> list:
    if isinstance(value, list):
        return value
    return [] if value in (None, "") else [value]


def _worst(values) -> float | None:
    """The largest overrun. Nulls are skipped, never read as 0: unmeasured is not on time."""
    nums = [n for n in (_number(v) for v in values) if n is not None]
    return max(nums) if nums else None


def _slim(task: dict) -> dict:
    return {f: _clean(task.get(f)) for f in _TASK_FIELDS if f in task}


def _is_late(task: dict, cfg: SlippageSettings) -> bool:
    risk = str(task.get("schedule_risk") or "")
    return risk == cfg.risk_red or risk.startswith(cfg.risk_amber_prefix)


def _rank_free(free: list[dict]) -> None:
    """Most room first: least open work, then fewest overdue, then most recently recorded (a crew no one has recorded
    for months may not be working at all). Two stable sorts give that order."""
    free.sort(key=lambda c: _day(c.get("latest_action_on")) or "", reverse=True)
    free.sort(key=lambda c: (_count(c.get("open_tasks")), _count(c.get("overdue_tasks"))))


# -- Shared evidence ------------------------------------------------------------------------------------------------


def _complete(key: str, cfg: SlippageSettings, well_id: str | None = None) -> QueryResult:
    """A verified query's result, refused when the row limit cut it: evidence missing rows would be wrong, not just
    short (a well cut from the slippage listing would be reported to the model as having failed no milestone)."""
    result = queries.run(key, cfg, well_id=well_id)
    if result.truncated:
        raise BadRequest(f"The Slippage query '{key}' returned more than {cfg.query_max_rows} rows, so the advisor's "
                         "evidence would be incomplete. An admin can raise the query row limit under Settings > "
                         "AI Settings > Slippage.")
    return result


def _activity(well_id: str, cfg: SlippageSettings) -> list[dict]:
    """The well's tasks, most urgent first (the verified query's own order)."""
    return _complete(queries.ACTIVITY_DELAY, cfg, well_id).rows


def _crew_rows(cfg: SlippageSettings) -> list[dict] | None:
    """Crew availability, or None when the query is not configured."""
    if not queries.configured(queries.CREW_AVAILABILITY):
        return None
    return _complete(queries.CREW_AVAILABILITY, cfg).rows


def _crews_for(tasks: list[dict], crews: list[dict] | None) -> list[dict]:
    """The crew rows an answer about these tasks can depend on, for its fingerprint: the crews assigned to them and
    every crew of a crew type they need. A change to a crew of an unrelated type cannot alter the answer."""
    if not crews:
        return []
    types = {_key(t.get("crew_type_id")) for t in tasks} - {None}
    ids = {_key(t.get("crew_id")) for t in tasks} - {None}
    return [c for c in crews if _key(c.get("crew_type_id")) in types or _key(c.get("crew_id")) in ids]


def _well(well_id: str, cfg: SlippageSettings) -> dict:
    """The well's contractual milestones.

    `listed` is three-valued on purpose. False: the well is not in the slippage listing, which holds only wells that
    FAILED a milestone, so none has failed. None: the listing could not be read, so nothing is known. Collapsing the two
    would tell the agent a well is on track when it was simply not measured."""
    if not queries.configured(queries.WELL_SLIPPAGE):
        return {"listed": None, "headline": None, "milestones": [], "note": prompts.text("note_milestones_unavailable")}
    result = _complete(queries.WELL_SLIPPAGE, cfg)
    milestones = cfg.milestone_list
    absent = [f"{m.prefix}_{part}" for m in milestones for part in ("deadline", "actual", "status", "variance_days")
              if f"{m.prefix}_{part}" not in result.columns]
    if absent:
        raise BadRequest(f"The Slippage milestones setting names columns the well slippage query does not return "
                         f"({', '.join(absent)}). An admin can fix it under Settings > AI Settings > Slippage.")
    for row in result.rows:
        if _same(row.get("well_id"), well_id):
            return {
                "listed": True,
                "headline": row.get("well_slippage_status"),
                "milestones": [
                    {
                        "milestone": m.label,
                        "owner": m.owner,
                        "deadline": _day(row.get(m.prefix + "_deadline")),
                        "actual": _day(row.get(m.prefix + "_actual")),
                        "status": row.get(m.prefix + "_status"),
                        "variance_days": row.get(m.prefix + "_variance_days"),
                    }
                    for m in milestones
                ],
                "note": None,
            }
    return {"listed": False, "headline": None, "milestones": [], "note": None}


# -- Task level -----------------------------------------------------------------------------------------------------


def _related(task: dict, tasks: list[dict], cfg: SlippageSettings) -> tuple[list[dict], list[dict]]:
    """Other LATE tasks on the well that could plausibly have held this one up. Timing only (the data holds no
    dependency links, and the prompt says so):
      * earlier: planned to FINISH on or before this task's planned START (its planned end when it has no planned
        start), nearest first;
      * same WBS: other late work in the same WBS, which usually shares a sequence and a crew type."""
    code = task.get("task_code")
    anchor = _day(task.get("target_start")) or _day(task.get("target_end"))
    wbs = _clean(task.get("wbs"))
    others = [t for t in tasks if t.get("task_code") != code and _is_late(t, cfg)]

    earlier: list[dict] = []
    if anchor:
        earlier = [t for t in others if _day(t.get("target_end")) and _day(t.get("target_end")) <= anchor]
        earlier.sort(key=lambda t: _day(t.get("target_end")) or "", reverse=True)
    earlier = earlier[:cfg.max_related]

    shown = {t.get("task_code") for t in earlier}
    same_wbs = [
        t for t in others
        if wbs and _clean(t.get("wbs")) == wbs and t.get("task_code") not in shown
    ][:cfg.max_related]
    return [_slim(t) for t in earlier], [_slim(t) for t in same_wbs]


def _crews(task: dict, crews: list[dict] | None, cfg: SlippageSettings) -> dict:
    """The crew side: the assigned crew's own load, and free crews of the SAME type (crew type decides who can do the
    work, so candidates are filtered on crew_type_id first, and the assigned crew is left out of its own list)."""
    out: dict[str, Any] = {
        "crew_type_id": task.get("crew_type_id"),
        "assigned_crew_id": task.get("crew_id"),
        "assigned": None,
        "available": [],
        "available_count": 0,
        "busy_count": 0,
        "type_total": 0,
        "note": None,
    }
    if "crew_type_id" not in task:
        out["note"] = prompts.text("note_task_no_crew_columns")
        return out
    if crews is None:
        out["note"] = prompts.text("note_crews_unavailable")
        return out

    out["assigned"] = next((c for c in crews if _same(c.get("crew_id"), task.get("crew_id"))), None)

    crew_type = task.get("crew_type_id")
    if crew_type in (None, ""):
        out["note"] = prompts.text("note_task_no_crew_type")
        return out

    same_type = [c for c in crews if _same(c.get("crew_type_id"), crew_type)]
    free = [
        c for c in same_type
        if c.get("availability_status") == cfg.crew_available
        and not _same(c.get("crew_id"), task.get("crew_id"))
    ]
    _rank_free(free)

    out["available"] = free[:cfg.max_candidates]
    out["available_count"] = len(free)
    out["busy_count"] = sum(1 for c in same_type if c.get("availability_status") != cfg.crew_available)
    out["type_total"] = len(same_type)
    if not same_type:
        out["note"] = prompts.text("note_no_crew_of_type")
    return out


def _normalise(parsed: Any, crew: dict) -> dict | None:
    """The reply in the shape the page renders, with any crew it was not given flagged. None when the reply is not
    the JSON asked for: the caller then returns the raw text, so the page shows what the agent said."""
    if not isinstance(parsed, dict) or not (parsed.get("summary") or parsed.get("actions")):
        return None

    allowed = [c.get("crew_id") for c in crew.get("available") or []]
    caveats = [str(c) for c in _as_list(parsed.get("caveats"))]

    actions = []
    for item in _as_list(parsed.get("actions")):
        if not isinstance(item, dict):
            item = {"action": str(item)}
        crew_id = item.get("crew_id")
        if crew_id in ("", "null", "None"):
            crew_id = None
        entry: dict[str, Any] = {
            "action": str(item.get("action") or ""),
            "crew_id": crew_id,
            "rationale": str(item.get("rationale") or ""),
        }
        if crew_id is not None and not any(_same(crew_id, a) for a in allowed):
            entry["crew_unverified"] = True
            caveats.append("Crew " + str(crew_id) + " was not among the available crews of this type the agent "
                           "was given. Do not act on it without checking.")
        actions.append(entry)

    causes = []
    for item in _as_list(parsed.get("causes")):
        if isinstance(item, dict):
            causes.append({
                "cause": str(item.get("cause") or ""),
                "evidence": str(item.get("evidence") or ""),
                "confidence": str(item.get("confidence") or "").lower(),
            })
        else:
            causes.append({"cause": str(item), "evidence": "", "confidence": ""})

    verdict = str(parsed.get("caused_by_other_delay") or "unknown").strip().lower()
    return {
        "summary": str(parsed.get("summary") or ""),
        "caused_by_other_delay": verdict if verdict in _VERDICTS else "unknown",
        "causes": causes,
        "actions": actions,
        "checks": [str(c) for c in _as_list(parsed.get("checks"))],
        "caveats": caveats,
    }


def suggest(well_id: str, task_code: str, cfg: SlippageSettings, fresh: bool = False) -> dict:
    """Advise on one late task. Reused while what it rests on is unchanged, unless `fresh`."""
    _check_ready()
    well_id, task_code = str(well_id).strip(), str(task_code).strip()
    key = (_db_identity(), "task", well_id, task_code)

    def gather() -> tuple[dict, tuple[str, str], str]:
        tasks = _activity(well_id, cfg)
        task = next((t for t in tasks if str(t.get("task_code") or "").strip() == task_code), None)
        if task is None:
            raise TaskNotFound("Task " + task_code + " is not among well " + well_id + "'s current tasks.")
        crews = _crew_rows(cfg)
        earlier, same_wbs = _related(task, tasks, cfg)
        well = _well(well_id, cfg)
        evidence = {
            "task": _slim(task),
            "earlier_late_tasks": earlier,
            "same_wbs_late_tasks": same_wbs,
            "well": well,
            "crew": _crews(task, crews, cfg),
        }
        system = prompts.task_system(cfg)
        # Every task on the well, not just the ones shown: the related lists are cut to a limit, and which rows make
        # the cut depends on the rest.
        version = _fingerprint(system, prompts.texts(), cfg.answer_affecting(), _model_identity(), tasks, well,
                               _crews_for([task], crews))
        return evidence, (system, prompts.task_message(well_id, evidence)), version

    def ask(evidence: dict, prompt: tuple[str, str]) -> dict:
        started = time.perf_counter()
        raw, model = _ask_model(prompt[0], prompt[1], cfg, "advisor_task")
        advice = _normalise(extract_json(raw), evidence["crew"])
        log.info("slippage advisor: well %s task %s answered in %.1fs (%s, %d candidate crew(s))", well_id,
                 task_code, time.perf_counter() - started, "parsed" if advice else "UNPARSED, returning raw text",
                 len(evidence["crew"]["available"]))
        return {
            "well_id": well_id,
            "task_code": task_code,
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "model": model,
            "cached": False,
            "advice": advice,
            "raw": None if advice else (raw or "").strip(),    # only when the reply was not the JSON asked for
            "evidence": evidence,
        }

    return _answer(key, fresh, cfg, gather, ask)


# -- Well level -----------------------------------------------------------------------------------------------------


def _tally(tasks: list[dict], cfg: SlippageSettings) -> dict:
    def count(test) -> int:
        return sum(1 for t in tasks if test(t))

    return {
        "total": len(tasks),
        "late": count(lambda t: _is_late(t, cfg)),
        "red": count(lambda t: t.get("schedule_risk") == cfg.risk_red),
        "amber": count(lambda t: str(t.get("schedule_risk") or "").startswith(cfg.risk_amber_prefix)),
        "not_started_late": count(lambda t: t.get("execution_status") == cfg.exec_not_started_late),
        "in_progress": count(lambda t: t.get("execution_status") == cfg.exec_in_progress),
        "completed": count(lambda t: t.get("execution_status") == cfg.exec_completed),
        "due_today": count(lambda t: t.get("end_status") == cfg.end_due_today),
    }


def _late_by_wbs(late: list[dict], cfg: SlippageSettings) -> list[dict]:
    """Where the late work sits, worst WBS first."""
    groups: dict[str, dict] = {}
    for t in late:
        name = _clean(t.get("wbs")) or "(unmapped)"
        g = groups.setdefault(name, {
            "wbs": name, "late_tasks": 0, "red": 0, "not_started_late": 0,
            "_overruns": [], "crew_type_ids": [],
        })
        g["late_tasks"] += 1
        g["red"] += int(t.get("schedule_risk") == cfg.risk_red)
        g["not_started_late"] += int(t.get("execution_status") == cfg.exec_not_started_late)
        g["_overruns"].append(t.get("end_variance_days"))
        crew_type = _key(t.get("crew_type_id"))
        if crew_type and crew_type not in g["crew_type_ids"]:
            g["crew_type_ids"].append(crew_type)
    out = []
    for g in groups.values():
        g["worst_overrun_days"] = _worst(g.pop("_overruns"))
        out.append(g)
    out.sort(key=lambda g: (-g["red"], -g["late_tasks"], g["wbs"]))
    return out[:cfg.max_groups]


def _late_by_crew_type(late: list[dict], crews: list[dict] | None, cfg: SlippageSettings) -> list[dict]:
    """The late work grouped by crew TYPE (the unit that decides who can take it over) with, per type, the fleet load
    of the crews assigned to it and the best free crews of that type. Late tasks with no crew type recorded are kept
    as their own group, so the answer can say how much late work cannot be matched to any crew."""
    groups: dict[str | None, dict] = {}
    for t in late:
        crew_type = _key(t.get("crew_type_id"))
        g = groups.setdefault(crew_type, {
            "crew_type_id": crew_type, "late_tasks": 0, "_overruns": [], "wbs": [],
            "_crew_ids": [], "unassigned_late_tasks": 0,
        })
        g["late_tasks"] += 1
        g["_overruns"].append(t.get("end_variance_days"))
        wbs = _clean(t.get("wbs"))
        if wbs and wbs not in g["wbs"]:
            g["wbs"].append(wbs)
        crew = _key(t.get("crew_id"))
        if crew is None:
            g["unassigned_late_tasks"] += 1
        elif crew not in g["_crew_ids"]:
            g["_crew_ids"].append(crew)

    out = []
    for crew_type, g in groups.items():
        assigned_ids = set(g.pop("_crew_ids"))
        entry = {
            **g,
            "worst_overrun_days": _worst(g.pop("_overruns")),
            "assigned_crews": [],
            "available_count": 0,
            "busy_count": 0,
            "type_total": 0,
            "candidates": [],
        }
        entry.pop("_overruns", None)
        if crews is not None and crew_type is not None:
            same_type = [c for c in crews if _key(c.get("crew_type_id")) == crew_type]
            entry["assigned_crews"] = [
                c for c in crews if _key(c.get("crew_id")) in assigned_ids
            ][:cfg.max_assigned]
            free = [
                c for c in same_type
                if c.get("availability_status") == cfg.crew_available
                and _key(c.get("crew_id")) not in assigned_ids
            ]
            _rank_free(free)                    # same ranking as the task level
            entry["candidates"] = free[:cfg.max_type_candidates]
            entry["available_count"] = len(free)
            entry["busy_count"] = sum(1 for c in same_type if c.get("availability_status") != cfg.crew_available)
            entry["type_total"] = len(same_type)
        out.append(entry)

    # Most late work first; the "no crew type recorded" group last, whatever its size.
    out.sort(key=lambda g: (g["crew_type_id"] is None, -g["late_tasks"]))
    return out[:cfg.max_groups]


def _crew_table(tasks: list[dict], cfg: SlippageSettings) -> tuple[list[dict] | None, str | None]:
    """Crew availability, or None with the reason it cannot be used."""
    if tasks and "crew_type_id" not in tasks[0]:
        return None, prompts.text("note_well_no_crew_columns")
    crews = _crew_rows(cfg)
    if crews is None:
        return None, prompts.text("note_crews_unavailable")
    return crews, None


def _normalise_well(parsed: Any, evidence: dict) -> dict | None:
    """The reply in the shape the page renders, flagging crews and crew types it was not given."""
    if not isinstance(parsed, dict) or not (parsed.get("description") or parsed.get("actions")):
        return None

    groups = evidence["late_by_crew_type"]
    known_types = {g["crew_type_id"] for g in groups if g["crew_type_id"] is not None}
    known_crews = {_key(c.get("crew_id")) for g in groups for c in g["candidates"] + g["assigned_crews"]}
    caveats = [str(c) for c in _as_list(parsed.get("caveats"))]

    actions = []
    for index, item in enumerate(_as_list(parsed.get("actions")), 1):
        if not isinstance(item, dict):
            item = {"action": str(item)}
        crew_id, crew_type = _nullish(item.get("crew_id")), _nullish(item.get("crew_type_id"))
        priority = item.get("priority")
        entry: dict[str, Any] = {
            "priority": priority if isinstance(priority, (int, float)) else index,
            "action": str(item.get("action") or ""),
            "crew_type_id": crew_type,
            "crew_id": crew_id,
            "rationale": str(item.get("rationale") or ""),
        }
        if crew_id is not None and _key(crew_id) not in known_crews:
            entry["crew_unverified"] = True
            caveats.append("Crew " + str(crew_id) + " was not among the crews the agent was given. "
                           "Do not act on it without checking.")
        if crew_type is not None and _key(crew_type) not in known_types:
            entry["type_unverified"] = True
            caveats.append("Crew type " + str(crew_type) + " does not carry any of this well's late "
                           "work in the evidence. Check before acting.")
        actions.append(entry)

    reasons = []
    for item in _as_list(parsed.get("why_delayed")):
        if isinstance(item, dict):
            reasons.append({
                "reason": str(item.get("reason") or ""),
                "evidence": str(item.get("evidence") or ""),
                "owner": str(item.get("owner") or "unknown"),
                "confidence": str(item.get("confidence") or "").lower(),
            })
        else:
            reasons.append({"reason": str(item), "evidence": "", "owner": "unknown", "confidence": ""})

    verdict = str(parsed.get("delayed") or "unknown").strip().lower()
    return {
        "description": str(parsed.get("description") or ""),
        "delayed": verdict if verdict in _WELL_VERDICTS else "unknown",
        "why_delayed": reasons,
        "actions": actions,
        "checks": [str(c) for c in _as_list(parsed.get("checks"))],
        "caveats": caveats,
    }


def suggest_well(well_id: str, cfg: SlippageSettings, fresh: bool = False) -> dict:
    """Why is this well delayed, and how could it be overcome. Reused while what it rests on is unchanged."""
    _check_ready()
    well_id = str(well_id).strip()
    key = (_db_identity(), "well", well_id)

    def gather() -> tuple[dict, tuple[str, str], str]:
        tasks = _activity(well_id, cfg)               # most urgent first, so the head of `late` is the worst
        late = [t for t in tasks if _is_late(t, cfg)]
        crews, crew_note = _crew_table(tasks, cfg)
        well = _well(well_id, cfg)
        evidence = {
            "well": well,
            "tasks": _tally(tasks, cfg),
            "late_by_wbs": _late_by_wbs(late, cfg),
            "late_by_crew_type": _late_by_crew_type(late, crews, cfg),
            "most_urgent": [_slim(t) for t in late[:cfg.max_urgent]],
            "crew_note": crew_note,
        }
        system = prompts.well_system(cfg)
        # The rows, not the rendered evidence: which late tasks make the cut, and the order of the groups, move with
        # the query's tie order even when no data has changed (see _canon).
        version = _fingerprint(system, prompts.texts(), cfg.answer_affecting(), _model_identity(), tasks, well,
                               _crews_for(late, crews), crew_note)
        return evidence, (system, prompts.well_message(well_id, evidence)), version

    def ask(evidence: dict, prompt: tuple[str, str]) -> dict:
        started = time.perf_counter()
        raw, model = _ask_model(prompt[0], prompt[1], cfg, "advisor_well")
        advice = _normalise_well(extract_json(raw), evidence)
        log.info("slippage advisor: well %s (well level) answered in %.1fs (%s, %d late task(s))", well_id,
                 time.perf_counter() - started, "parsed" if advice else "UNPARSED, returning raw text",
                 evidence["tasks"]["late"])
        return {
            "well_id": well_id,
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "model": model,
            "cached": False,
            "advice": advice,
            "raw": None if advice else (raw or "").strip(),
            "evidence": evidence,
        }

    return _answer(key, fresh, cfg, gather, ask)
