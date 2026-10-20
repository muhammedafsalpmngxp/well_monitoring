"""HTTP endpoints of Data Anomaly, mounted by app/main.py at /api/agent-runtime/features/anomaly.

Long operations (compile, run, discover) are server-sent events: any number of ``progress`` {stage, done, total,
label}, then exactly one ``result`` or ``error`` {message} (``ping`` while quiet, from app.streaming.with_heartbeat).
proposal-to-rule and introspect return JSON. Everything a request needs comes with it (rules, catalog, decided
proposals, prompts, settings, access); nothing is kept. Concurrency is per request: the Tenant API enforces
single-flight per tenant.

Problems found BEFORE the work starts are HTTP errors (bad settings, prompts or input -> 400; no AI provider or
database -> 503). Problems during the work are the stream's ``error`` event. Messages are safe to show.
"""
from __future__ import annotations

import logging
import queue
import threading

from app import trace
from typing import Any, Callable, Iterator, Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import Field

from app.askdata.common.readonly import ReadOnlyViolation
from app.features.anomaly import FEATURE, TITLE, introspect
from app.features.anomaly import prompts as pt
from app.features.anomaly.compiler import Cancelled, CoveredCheck, compile_rules
from app.features.anomaly.config import AnomalySettings, SettingsInvalid, parse, use
from app.features.anomaly.dbio import DatabaseUnavailable
from app.features.anomaly.model import load_catalog, load_rules
from app.features.anomaly.schema_index import load_index
from app.features.common.access import AccessDenied
from app.features.common.context import FeatureRun, run_context
from app.features.common.llm import AiUnavailable
from app.features.common.models import FeatureRequest
from app.models import _Camel
from app.prompt_text import PromptMissing, missing as missing_prompts
from app.streaming import sse, with_heartbeat

router = APIRouter()
log = logging.getLogger("agent_runtime.anomaly")

_SAFE = (SettingsInvalid, PromptMissing, AiUnavailable, DatabaseUnavailable, AccessDenied, ReadOnlyViolation)


# ── Request bodies ──

class CoveredCheckIn(_Camel):
    name: str = Field(min_length=1)
    table: str = ""
    description: str = ""


class _RulesRequest(FeatureRequest):
    rules: list[dict[str, Any]] = []
    catalog: list[dict[str, Any]] = []
    covered_checks: list[CoveredCheckIn] = []

    def covered(self) -> list[CoveredCheck]:
        return [CoveredCheck(c.name, c.table, c.description) for c in self.covered_checks]


class CompileRequest(_RulesRequest):
    rule_ids: list[str] | None = None
    force: bool = False
    retry_failed: bool = False


class RunRequest(_RulesRequest):
    rule_ids: list[str] | None = None
    formats: list[Literal["xlsx", "docx"]] = ["xlsx", "docx"]
    run_id: str = Field(min_length=1, max_length=100)


class DecidedProposals(_Camel):
    accepted: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []


class DiscoverRequest(_RulesRequest):
    proposals: DecidedProposals = DecidedProposals()
    max_proposals: int | None = Field(default=None, ge=1, le=50)


class ProposalToRuleRequest(FeatureRequest):
    proposal: dict[str, Any]
    rule_id: str | None = None
    status: Literal["probation", "active", "rejected"] = "probation"
    reason: str = ""
    rules: list[dict[str, Any]] = []        # only to allocate the next free id when ruleId is not given


class IntrospectRequest(FeatureRequest):
    refresh: bool = False


# ── Shared plumbing ──

def _prepare(req: FeatureRequest, keys: tuple[str, ...], need_llm: bool) -> AnomalySettings:
    """Everything that can be refused before the work starts, as HTTP errors."""
    try:
        settings = parse(req.settings)
    except SettingsInvalid as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    if not (req.access.included_tables or req.access.allowed_schemas):
        raise HTTPException(status_code=400, detail=f"{TITLE} is not set up yet: an admin chooses the tables it may "
                                                    f"read under Settings > AI Settings > {TITLE}.")
    if need_llm and req.llm is None:
        raise HTTPException(status_code=503, detail="No AI provider is active for this tenant. An admin can add one "
                                                    "under Settings > AI Providers.")
    if req.llm is not None:
        absent = missing_prompts(req.prompts, [k for k in keys if k not in pt.ALLOW_EMPTY])
        if absent:
            raise HTTPException(status_code=400, detail=f"{TITLE} cannot run: these AI prompts are not configured for "
                                                        f"this tenant: {', '.join(absent)}. An admin can restore them "
                                                        "under Settings > AI Prompts.")
    return settings


def aggregate_usage(usage: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One row per (agent, model), in first-call order."""
    rows: dict[tuple[str, str], dict[str, Any]] = {}
    for call in usage:
        key = (call.get("agent", ""), call.get("model", ""))
        row = rows.setdefault(key, {"agent": key[0], "model": key[1], "calls": 0, "input": 0, "output": 0})
        row["calls"] += int(call.get("calls", 1))
        row["input"] += int(call.get("input", 0))
        row["output"] += int(call.get("output", 0))
    return list(rows.values())


Work = Callable[[Callable[[str, int, int, str], None], Callable[[], bool]], dict[str, Any]]


def _events(req: FeatureRequest, settings: AnomalySettings, operation: str, work: Work) -> Iterator[tuple[str, dict]]:
    """Runs ``work`` on a worker thread inside the request's context and relays its progress. When the caller stops
    reading, the next progress call raises Cancelled and the work stops (no further model or database calls)."""
    run = FeatureRun(feature=FEATURE, request=req)
    events: queue.Queue = queue.Queue()
    stop = threading.Event()
    end = object()

    def emit(stage: str, done: int, total: int, label: str) -> None:
        if stop.is_set():
            raise Cancelled()
        trace.node("Data Anomaly", stage, f"{done}/{total} {label}".strip())
        events.put(("progress", {"stage": stage, "done": done, "total": total, "label": label}))

    def worker() -> None:
        try:
            with run_context(run), use(settings):
                result = work(emit, stop.is_set)
            if result is not None:
                result["usage"] = aggregate_usage(run.usage)
                events.put(("result", result))
        except Cancelled:
            pass
        except _SAFE as exc:
            events.put(("error", {"message": str(exc)}))
        except Exception as exc:  # noqa: BLE001 - reported, without internals
            log.exception("anomaly %s failed", operation)
            events.put(("error", {"message": f"The {operation} failed unexpectedly ({type(exc).__name__})."}))
        finally:
            events.put(end)

    threading.Thread(target=worker, name=f"anomaly-{operation}", daemon=True).start()
    try:
        while True:
            item = events.get()
            if item is end:
                return
            yield item
    finally:
        stop.set()


def _stream(req: FeatureRequest, settings: AnomalySettings, operation: str, work: Work) -> StreamingResponse:
    return StreamingResponse((sse(name, data) for name, data in with_heartbeat(_events(req, settings, operation, work))),
                             media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


def _json(req: FeatureRequest, settings: AnomalySettings, fn: Callable[[], dict[str, Any]]) -> dict[str, Any]:
    run = FeatureRun(feature=FEATURE, request=req)
    try:
        with run_context(run), use(settings):
            return fn()
    except (DatabaseUnavailable, AiUnavailable) as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from None
    except (SettingsInvalid, PromptMissing, AccessDenied, ReadOnlyViolation, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None


# ── Endpoints ──

@router.post("/compile")
def compile_endpoint(req: CompileRequest) -> StreamingResponse:
    """Compile the rules into probes. Result: the whole catalog after this compile plus what happened."""
    settings = _prepare(req, pt.COMPILE_KEYS, need_llm=True)

    def work(emit, cancelled) -> dict[str, Any]:
        rules, errors = load_rules(req.rules)
        catalog = load_catalog(req.catalog)
        emit("introspect", 0, 1, "Reading the database description")
        picture = introspect.describe()
        emit("fingerprint", 0, 1, "Reading the structure fingerprints")
        fingerprint, signatures, notes = introspect.fingerprints()
        report = compile_rules(rules, catalog, picture, fingerprint, signatures, only=req.rule_ids, force=req.force,
                               retry_failed=req.retry_failed, covered=req.covered(),
                               progress=lambda done, total, label: emit("compile", done, total, label),
                               cancelled=cancelled, errors=errors + notes)
        return {"catalog": [p.to_dict() for p in catalog.values()], "compiled": report.compiled,
                "reused": report.reused, "failed": report.failed, "notApplicable": report.not_applicable,
                "removed": report.removed, "duplicates": [list(g) for g in report.duplicates],
                "llmCalls": report.llm_calls, "seconds": round(report.seconds, 1),
                "stoppedEarly": report.stopped_early, "errors": report.errors}

    return _stream(req, settings, "compile", work)


@router.post("/run")
def run_endpoint(req: RunRequest) -> StreamingResponse:
    """Execute the compiled probes, score, summarise and build the reports (base64)."""
    settings = _prepare(req, pt.RUN_KEYS, need_llm=False)

    def work(emit, cancelled) -> dict[str, Any]:
        from app.features.anomaly.runner import run

        rules, _errors = load_rules(req.rules)
        return run(rules, load_catalog(req.catalog), run_id=req.run_id, only=req.rule_ids, formats=list(req.formats),
                   covered=req.covered(), emit=emit, cancelled=cancelled)

    return _stream(req, settings, "run", work)


@router.post("/discover")
def discover_endpoint(req: DiscoverRequest) -> StreamingResponse:
    """Propose new checks grounded in measured facts (nothing is written: proposals go out in the result)."""
    settings = _prepare(req, pt.DISCOVER_KEYS, need_llm=True)

    def work(emit, cancelled) -> dict[str, Any]:
        from app.features.anomaly.discovery import discover

        rules, _errors = load_rules(req.rules)
        return discover(rules, load_catalog(req.catalog), accepted=req.proposals.accepted,
                        rejected=req.proposals.rejected, max_proposals=req.max_proposals,
                        covered_checks=req.covered(), emit=emit)

    return _stream(req, settings, "discovery", work)


@router.post("/proposal-to-rule")
def proposal_to_rule_endpoint(req: ProposalToRuleRequest) -> dict[str, Any]:
    """The rule dict a decided proposal becomes (probation / active when accepted, rejected when refused)."""
    try:
        settings = parse(req.settings)
    except SettingsInvalid as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None

    def fn() -> dict[str, Any]:
        from app.features.anomaly.discovery import proposal_to_rule

        existing = [str(r.get("ruleId") or "") for r in req.rules if isinstance(r, dict)]
        if req.rule_id and req.rule_id.strip() in existing:
            raise ValueError(f"The rule id {req.rule_id.strip()} is already in use.")
        return {"rule": proposal_to_rule(req.proposal, req.rule_id, req.status, req.reason, existing).to_dict()}

    return _json(req, settings, fn)


@router.post("/introspect")
def introspect_endpoint(req: IntrospectRequest) -> dict[str, Any]:
    """Describe the database (cached; ``refresh`` rebuilds): a summary for the UI and the tests."""
    settings = _prepare(req, (), need_llm=False)

    def fn() -> dict[str, Any]:
        picture = introspect.describe(refresh=req.refresh)
        fingerprint, signatures, notes = introspect.fingerprints()
        index = load_index(picture.schema, picture.numeric_hints)
        return {
            "schemaChars": len(picture.schema), "valueHintsChars": len(picture.value_hints),
            "numericHintsChars": len(picture.numeric_hints), "tables": len(index.tables),
            "emptyTables": sum(1 for t in index.tables.values() if t.row_count == 0),
            "foreignKeys": len(index.foreign_keys), "grainMarkers": len(index.duplicate_keys),
            "tablesWithStats": sum(1 for t in index.tables.values() if t.stats),
            "fingerprint": fingerprint, "tableSignatures": len(signatures), "fromCache": picture.from_cache,
            "cacheKey": introspect.cache_dir().name, "notes": picture.notes + notes,
            "tableList": [{"name": t.name, "rows": t.row_count, "columns": len(t.columns)}
                          for t in index.tables.values()],
        }

    return _json(req, settings, fn)
