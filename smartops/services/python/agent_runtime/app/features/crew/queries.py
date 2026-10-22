"""The verified Crew Management queries, run from the SQL the request carries (request.queries, core.AiFeatureQuery).

No SQL lives here: each statement passes the SELECT-only gate and the feature's table allowlist (common/db.py) on
every run, parameters are BOUND by name in the order the query declares them (never interpolated), and the output is
checked against the query's column contract.

  crew_wells               live wells with delayed activities (the well picker)        one row per well
  crew_well                one well's dates and status (binds well_id)                 one row
  crew_delayed_activities  the delayed tasks of ONE live well (binds well_id)          one row per task
  crew_board               every crew: type, team, workload, availability              one row per crew
                           (binds recent_days)
  crew_type_demand         delayed work per required crew type, all live wells         one row per crew type
  crew_experience          completions per crew and activity (binds activity_codes)    one row per crew x activity

The fleet-wide queries (crew_wells, crew_board, crew_type_demand) scan every task record, so their results are kept
for ``cache_seconds`` per database and parameters: the overview and every well opened after it reuse one scan.
"""
from __future__ import annotations

import re
import threading
import time
from typing import Any

from app.askdata.common.readonly import ReadOnlyViolation
from app.features.common import db
from app.features.common.context import current
from app.features.common.db import QueryResult
from app.features.crew.errors import BadRequest
from app.features.crew.settings import CrewSettings

FEATURE_TITLE = "Crew Management"

WELLS = "crew_wells"
WELL = "crew_well"
DELAYED = "crew_delayed_activities"
BOARD = "crew_board"
DEMAND = "crew_type_demand"
EXPERIENCE = "crew_experience"
KEYS = (WELLS, WELL, DELAYED, BOARD, DEMAND, EXPERIENCE)

# The parameters each query may declare, and what supplies them.
PARAMS = {"well_id", "recent_days", "activity_codes"}
CACHED = frozenset({WELLS, BOARD, DEMAND})

_WHERE = "An admin can fix it under AI Settings > Ask Data & Features > Crew Management."
# String literals, comments and quoted identifiers: a ? inside them is not a parameter.
_NOT_CODE = re.compile(r"'(?:[^']|'')*'|--[^\n]*|/\*.*?\*/|\[[^\]]*\]|\"(?:[^\"]|\"\")*\"", re.S)

_cache: dict[tuple, tuple[float, QueryResult]] = {}
_lock = threading.Lock()


def placeholders(sql: str) -> int:
    """How many ``?`` parameters the statement binds."""
    return _NOT_CODE.sub(" ", sql).count("?")


def clear() -> None:
    with _lock:
        _cache.clear()


def run(key: str, cfg: CrewSettings, values: dict[str, Any] | None = None, *, fresh: bool = False) -> QueryResult:
    """Run one verified query with its named parameters; rows are JSON-safe (dates as ISO text, decimals as numbers).
    ``fresh`` skips the cache for the fleet-wide queries (the result is stored again)."""
    run_ = current()
    query = run_.request.queries.get(key)
    if query is None:
        raise BadRequest(f"The Crew Management query '{key}' is not configured. {_WHERE}")
    sql = query.sql.strip().rstrip(";").strip()

    values = values or {}
    params = []
    for name in query.params:
        if name not in PARAMS or name not in values:
            raise BadRequest(f"The Crew Management query '{key}' needs a parameter '{name}' that this request cannot "
                             f"supply. {_WHERE}")
        params.append(values[name])
    if placeholders(sql) != len(params):
        raise BadRequest(f"The Crew Management query '{key}' declares {len(params)} parameter(s) but its SQL binds "
                         f"{placeholders(sql)}. {_WHERE}")

    target = run_.request.db
    cache_key = (key, sql, tuple(params), target.server, target.port, target.name, target.user)
    if key in CACHED and cfg.cache_seconds > 0 and not fresh:
        with _lock:
            hit = _cache.get(cache_key)
        if hit and hit[0] > time.monotonic():
            return hit[1]

    try:
        result = db.query(sql, params, feature_title=FEATURE_TITLE, label=key, max_rows=cfg.query_max_rows,
                          timeout=cfg.query_timeout_seconds)
    except ReadOnlyViolation as exc:
        raise BadRequest(f"The Crew Management query '{key}' is not a safe read-only SELECT ({exc}). {_WHERE}") \
            from None

    absent = [c for c in query.columns if c not in result.columns]
    if absent:
        raise BadRequest(f"The Crew Management query '{key}' no longer returns {', '.join(absent)}: the database or "
                         f"the query has changed since it was verified. {_WHERE}")
    shaped = QueryResult(result.columns, db.jsonable_rows(result.rows), result.truncated)

    if key in CACHED and cfg.cache_seconds > 0:
        with _lock:
            _cache[cache_key] = (time.monotonic() + cfg.cache_seconds, shaped)
            if len(_cache) > 64:                                      # a few tenants x a few queries; drop the oldest
                for stale in sorted(_cache, key=lambda k: _cache[k][0])[: len(_cache) - 64]:
                    del _cache[stale]
    return shaped
