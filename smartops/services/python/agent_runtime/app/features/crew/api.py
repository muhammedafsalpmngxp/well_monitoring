"""Crew Management endpoints, mounted by app/main.py at /api/agent-runtime/features/crew (behind the runtime API key).

  POST /overview  {fresh}            every crew and its availability, capacity vs delayed work per crew type, and the
                                     live wells with delayed activities (no AI)
  POST /well      {wellId, fresh}    one well's delayed activities, the crew on each, the free crews to approach (no AI)
  POST /brief     {wellId}           the same plan plus an AI brief that narrates it (calls the model)

Every body is a FeatureRequest (db, llm, prompts, settings, access, queries; camelCase). Errors: bad input, a missing
setting / prompt / query, refused SQL or table -> 400; unknown well -> 404; database or AI provider unavailable -> 503.
Messages are safe to show.
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
from app.features.crew import brief, engine, settings
from app.features.crew.errors import BadRequest, WellNotFound
from app.features.crew.settings import CrewSettings
from app.prompt_text import PromptMissing

FEATURE = "crew"

log = logging.getLogger("agent_runtime.crew")
router = APIRouter()


class OverviewRequest(FeatureRequest):
    fresh: bool = False


class WellRequest(FeatureRequest):
    well_id: str | int | None = None
    fresh: bool = False


@contextmanager
def _feature(req: FeatureRequest) -> Iterator[tuple[FeatureRun, CrewSettings]]:
    """The request's context and settings, with every Crew Management error mapped to its HTTP status."""
    run = FeatureRun(FEATURE, req)
    try:
        with run_context(run):
            yield run, settings.load(req.settings)
    except WellNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from None
    except PromptMissing as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    except (BadRequest, AccessDenied) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    except ReadOnlyViolation as exc:
        raise HTTPException(status_code=400, detail=f"Crew Management refused a query that is not a safe read-only "
                                                    f"SELECT ({exc}).") from None
    except (DatabaseUnavailable, AiUnavailable) as exc:
        log.warning("crew: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc)) from None


def _well_id(value: Any, cfg: CrewSettings) -> str:
    """Well ids are whole numbers (well.well_master.well_id); anything else is refused before it reaches SQL."""
    text = "" if value is None else str(value).strip()
    if not text or len(text) > cfg.well_id_max_length or not text.isdigit() or int(text) <= 0:
        raise BadRequest("Invalid well id: use the well's number.")
    return text


@router.post("/overview")
def overview(req: OverviewRequest) -> dict[str, Any]:
    with _feature(req) as (_, cfg):
        return engine.overview(cfg, fresh=req.fresh)


@router.post("/well")
def well(req: WellRequest) -> dict[str, Any]:
    with _feature(req) as (_, cfg):
        return engine.build_well(_well_id(req.well_id, cfg), cfg, fresh=req.fresh)


@router.post("/brief")
def well_brief(req: WellRequest) -> dict[str, Any]:
    """The well's crew plan with an AI brief. A provider failure is reported in brief_error, not as an error."""
    with _feature(req) as (run, cfg):
        plan = engine.build_well(_well_id(req.well_id, cfg), cfg, fresh=req.fresh)
        written = brief.write(plan, cfg)
        return {"well_id": plan["well_id"], **written, "plan": plan, "usage": list(run.usage)}
