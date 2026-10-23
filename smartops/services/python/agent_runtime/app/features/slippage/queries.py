"""The four verified Slippage queries, run from the SQL the request carries (request.queries, core.AiFeatureQuery).

No SQL lives here: each statement passes the SELECT-only gate and the feature's table allowlist (common/db.py) on
every run, parameters are BOUND (never interpolated), and the output is checked against the query's column contract,
because a query that computes everything correctly and names one column differently does not fail: it returns rows,
the consumer reads the name it expects, finds nothing, and reports blank.

  well_slippage      wells that failed at least one contractual milestone    one row per well
  activity_summary   distinct delayed activity codes per well               one row per well
  activity_delay     the tasks of ONE well (binds well_id)                  one row per task
  crew_availability  every crew holding open work, and whether it is free   one row per crew
"""
from __future__ import annotations

import re

from app.askdata.common.readonly import ReadOnlyViolation
from app.features.common import db
from app.features.common.context import current
from app.features.common.db import QueryResult
from app.features.slippage.errors import BadRequest
from app.features.slippage.settings import SlippageSettings

FEATURE_TITLE = "Well Slippage"

WELL_SLIPPAGE = "well_slippage"
ACTIVITY_SUMMARY = "activity_summary"
ACTIVITY_DELAY = "activity_delay"
CREW_AVAILABILITY = "crew_availability"
KEYS = (WELL_SLIPPAGE, ACTIVITY_SUMMARY, ACTIVITY_DELAY, CREW_AVAILABILITY)

# Answers about ONE well. Run without its bound well id it would answer about whichever well the SQL names, and its
# rows would be shown under another well's heading, so it is refused instead.
WELL_SCOPED = frozenset({ACTIVITY_DELAY})

_WHERE = "An admin can fix it under AI Settings > Ask Data & Features > Well Slippage."
# String literals, comments and quoted identifiers: a ? inside them is not a parameter.
_NOT_CODE = re.compile(r"'(?:[^']|'')*'|--[^\n]*|/\*.*?\*/|\[[^\]]*\]|\"(?:[^\"]|\"\")*\"", re.S)


def configured(key: str) -> bool:
    return key in current().request.queries


def placeholders(sql: str) -> int:
    """How many ``?`` parameters the statement binds."""
    return _NOT_CODE.sub(" ", sql).count("?")


def run(key: str, cfg: SlippageSettings, *, well_id: str | None = None) -> QueryResult:
    """Run one verified query; rows are JSON-safe (dates as ISO text, decimals as numbers)."""
    query = current().request.queries.get(key)
    if query is None:
        raise BadRequest(f"The Well Slippage query '{key}' is not configured. {_WHERE}")
    sql = query.sql.strip().rstrip(";").strip()

    if key in WELL_SCOPED and "well_id" not in query.params:
        raise BadRequest(f"The Well Slippage query '{key}' does not bind the well id, so it cannot be run for a chosen "
                         f"well. {_WHERE}")
    supplied = {"well_id": well_id}
    params = []
    for name in query.params:
        if name not in supplied:
            raise BadRequest(f"The Well Slippage query '{key}' needs a parameter '{name}' that this request cannot "
                             f"supply. {_WHERE}")
        if supplied[name] is None:
            raise BadRequest(f"wellId is required for the Well Slippage query '{key}'.")
        params.append(supplied[name])
    if placeholders(sql) != len(params):
        raise BadRequest(f"The Well Slippage query '{key}' declares {len(params)} parameter(s) but its SQL binds "
                         f"{placeholders(sql)}. {_WHERE}")

    try:
        result = db.query(sql, params, feature_title=FEATURE_TITLE, label=key, max_rows=cfg.query_max_rows,
                          timeout=cfg.query_timeout_seconds)
    except ReadOnlyViolation as exc:
        raise BadRequest(f"The Well Slippage query '{key}' is not a safe read-only SELECT ({exc}). {_WHERE}") from None

    absent = [c for c in query.columns if c not in result.columns]
    if absent:
        raise BadRequest(f"The Well Slippage query '{key}' no longer returns {', '.join(absent)}: the database or the "
                         f"query has changed since it was verified. {_WHERE}")
    return QueryResult(result.columns, db.jsonable_rows(result.rows), result.truncated)
