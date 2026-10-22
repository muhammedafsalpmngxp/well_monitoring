"""Slippage endpoints, mounted by app/main.py at /api/agent-runtime/features/slippage (behind the runtime API key).

  POST /query        {key, wellId?}             one verified query: {key, columns, rows, truncated}
  POST /advise-well  {wellId, fresh}            why is this well delayed, and how to overcome it (calls the model)
  POST /advise-task  {wellId, taskCode, fresh}  is this late task held up by another delay, and how to recover it

Every body is a FeatureRequest (db, llm, prompts, settings, access, queries; camelCase). Errors: bad input, a missing
setting / prompt / query, refused SQL or table -> 400; task not on the well -> 404; database or AI provider
unavailable -> 503. Messages are safe to show.
"""
from __future__ import annotations

import logging
from contextlib import contextmanager
from typing import Any, Iterator

from fastapi import APIRouter, HTTPException

from app.askdata.common.readonly import ReadOnlyViolation
from app.features.common.access import AccessDenied
from app.features.common.context import FeatureRun, run_context
from app.features.common.db import DatabaseUnavailable
from app.features.common.llm import AiUnavailable
from app.features.common.models import FeatureRequest
from app.features.slippage import advisor, queries, settings
from app.features.slippage.errors import AdvisorFailed, BadRequest, TaskNotFound
from app.features.slippage.settings import SlippageSettings
from app.prompt_text import PromptMissing

FEATURE = "slippage"

log = logging.getLogger("agent_runtime.slippage")
router = APIRouter()


class QueryRequest(FeatureRequest):
    key: str = ""
    well_id: str | int | None = None


class AdviseWellRequest(FeatureRequest):
    well_id: str | int | None = None
    fresh: bool = False


class AdviseTaskRequest(AdviseWellRequest):
    task_code: str | int | None = None


@contextmanager
def _feature(req: FeatureRequest) -> Iterator[tuple[FeatureRun, SlippageSettings]]:
    """The request's context and settings, with every Slippage error mapped to its HTTP status."""
    run = FeatureRun(FEATURE, req)
    try:
        with run_context(run):
            yield run, settings.load(req.settings)
    except TaskNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from None
    except PromptMissing as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    except (BadRequest, AccessDenied) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    except ReadOnlyViolation as exc:
        raise HTTPException(status_code=400, detail=f"Well Slippage refused a query that is not a safe read-only "
                                                    f"SELECT ({exc}).") from None
    except (DatabaseUnavailable, AiUnavailable, AdvisorFailed) as exc:
        log.warning("slippage: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc)) from None


def _identifier(value: Any, max_length: int, what: str) -> str:
    text = "" if value is None else str(value).strip()
    if not text or len(text) > max_length:
        raise BadRequest(f"Invalid {what}.")
    return text


@router.post("/query")
def run_query(req: QueryRequest) -> dict[str, Any]:
    """One of the four verified queries. activity_delay is per well: wellId is bound to its parameter."""
    with _feature(req) as (_, cfg):
        key = (req.key or "").strip()
        if key not in queries.KEYS:
            raise BadRequest(f"Unknown Well Slippage query '{key}'. Choose one of: {', '.join(queries.KEYS)}.")
        well_id = None
        if key in queries.WELL_SCOPED or req.well_id not in (None, ""):
            if key in queries.WELL_SCOPED and req.well_id in (None, ""):
                raise BadRequest(f"wellId is required for the Well Slippage query '{key}'.")
            well_id = _identifier(req.well_id, cfg.well_id_max_length, "well id")
        result = queries.run(key, cfg, well_id=well_id)
        return {"key": key, "columns": result.columns, "rows": result.rows, "truncated": result.truncated}


@router.post("/advise-well")
def advise_well(req: AdviseWellRequest) -> dict[str, Any]:
    """Why is this well delayed, and how could the delay be overcome? Calls the model unless an answer resting on
    the same data is stored (cached=true) or being computed."""
    with _feature(req) as (run, cfg):
        well_id = _identifier(req.well_id, cfg.well_id_max_length, "well id")
        result = advisor.suggest_well(well_id, cfg, fresh=req.fresh)
        return {**result, "usage": list(run.usage)}


@router.post("/advise-task")
def advise_task(req: AdviseTaskRequest) -> dict[str, Any]:
    """How could this late task be recovered, and is it late because of another delay? 404 when the task is not
    among the well's current tasks."""
    with _feature(req) as (run, cfg):
        well_id = _identifier(req.well_id, cfg.well_id_max_length, "well id")
        task_code = _identifier(req.task_code, cfg.task_code_max_length, "task code")
        result = advisor.suggest(well_id, task_code, cfg, fresh=req.fresh)
        return {**result, "usage": list(run.usage)}
