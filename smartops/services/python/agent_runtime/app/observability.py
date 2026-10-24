"""Langfuse tracing of the runtime's AI calls. Optional: on only when LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY are
set; without them nothing here does anything, and a Langfuse failure never reaches a request.

One trace per unit of work, named after its endpoint (ask-data, agent-run, slippage-advisor, eval-judge, ...):
  - Ask Data and agent runs: ``traced_events`` around the event stream (input: the question, output: the answer)
  - Agentic Features: the request's first ``run_context`` (app/features/common/context.py)
  - any other AI call: a trace of its own, named after the endpoint
Each AI call inside is a generation from Langfuse's LangChain CallbackHandler (``ai_call``): model, messages, tokens,
time, and errors.

Never sent: database connections, API keys, request bodies. Text that looks like a password or key is masked.

The trace is a ContextVar, like the Agentic Features' run: set it INSIDE the generator or function that does the
work (with_heartbeat runs generators on another thread). Threads must copy the context (contextvars.copy_context).

Environment:
    LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY   the Langfuse project's API keys (Settings > API Keys)
    LANGFUSE_BASE_URL                          the Langfuse server, e.g. http://localhost:3000
    LANGFUSE_TRACING_ENVIRONMENT               development (default) | staging | production
    LANGFUSE_SAMPLE_RATE                       share of traces sent, 0..1 (default 1)
"""
from __future__ import annotations

import logging
import os
import re
import threading
from contextlib import contextmanager
from contextvars import ContextVar, Token
from dataclasses import dataclass
from typing import Any, Iterator

log = logging.getLogger("agent_runtime.observability")

_API = "/api/agent-runtime/"
# Endpoints whose path alone is not a good trace name.
_NAMES = {"askdata-ask": "ask-data", "run": "agent-run", "resume": "agent-resume"}

_ROUTE: ContextVar[str] = ContextVar("langfuse_route", default="")
_UNIT: ContextVar["Unit | None"] = ContextVar("langfuse_unit", default=None)

_client: Any = None
_failed = False
_lock = threading.Lock()


# ── Masking ────────────────────────────────────────────────────────────────────────────────────────────────────────

_SECRET = re.compile(r"(?i)\b(password|pwd|api[_-]?key|secret)(\s*[=:]\s*)[^;,\s\"']+")
_KEY = re.compile(r"\b(sk|pk)-[A-Za-z0-9_-]{12,}")


def mask(*, data: Any, **_: Any) -> Any:
    """Langfuse's mask hook: every string sent, with password=... / api_key: ... values and sk-/pk- keys replaced."""
    if isinstance(data, str):
        return _KEY.sub(r"\1-***", _SECRET.sub(r"\1\2***", data))
    if isinstance(data, dict):
        return {k: mask(data=v) for k, v in data.items()}
    if isinstance(data, (list, tuple)):
        return [mask(data=v) for v in data]
    return data


# ── Client ─────────────────────────────────────────────────────────────────────────────────────────────────────────

def enabled() -> bool:
    return bool(os.environ.get("LANGFUSE_PUBLIC_KEY") and os.environ.get("LANGFUSE_SECRET_KEY"))


def client() -> Any:
    """The Langfuse client, or None when tracing is off (no keys, or it could not start: logged once)."""
    global _client, _failed
    if _client is not None:
        return _client
    if _failed or not enabled():
        return None
    with _lock:
        if _client is None and not _failed:
            try:
                from langfuse import Langfuse

                _client = Langfuse(environment=os.environ.get("LANGFUSE_TRACING_ENVIRONMENT") or "development",
                                   mask=mask)
            except Exception:  # noqa: BLE001 - tracing is optional
                log.exception("Langfuse could not start: AI calls are not traced")
                _failed = True
    return _client


def _safe(fn: Any, *args: Any, **kwargs: Any) -> None:
    try:
        fn(*args, **kwargs)
    except Exception:  # noqa: BLE001 - tracing never breaks a request
        log.debug("Langfuse call failed", exc_info=True)


# ── Trace names ────────────────────────────────────────────────────────────────────────────────────────────────────

def route_name(path: str) -> str:
    """/api/agent-runtime/features/slippage/advisor -> slippage-advisor; askdata/ask -> ask-data."""
    name = path.split(_API, 1)[-1].strip("/").removeprefix("features/").replace("/", "-")
    return _NAMES.get(name, name)


def set_route(path: str) -> Token:
    """The request's path, for trace names (the HTTP middleware sets it; streams and threads copy it)."""
    return _ROUTE.set(path)


def reset_route(token: Token) -> None:
    _ROUTE.reset(token)


# ── Units of work ──────────────────────────────────────────────────────────────────────────────────────────────────

@dataclass
class Unit:
    """One trace: its root observation and the attributes every observation in it carries."""
    span: Any
    attributes: dict[str, Any]

    @property
    def trace_context(self) -> dict[str, str]:
        return {"trace_id": self.span.trace_id, "parent_span_id": self.span.id}


def current() -> Unit | None:
    return _UNIT.get()


@contextmanager
def adopt(unit: Unit | None) -> Iterator[Unit | None]:
    """Continue a trace opened elsewhere (a feature's step on a thread of its own)."""
    token = _UNIT.set(unit)
    try:
        yield unit
    finally:
        _UNIT.reset(token)


@contextmanager
def unit(name: str | None = None, *, input: Any = None, session_id: str | None = None, tags: tuple[str, ...] = (),
         metadata: dict[str, str] | None = None) -> Iterator[Unit | None]:
    """A trace for the work inside; the one already open when there is one; None when tracing is off."""
    lf = client()
    if lf is None or _UNIT.get() is not None:
        yield _UNIT.get()
        return
    name = name or route_name(_ROUTE.get()) or "agent-runtime"
    attributes = {k: v for k, v in {"trace_name": name, "session_id": session_id,
                                    "tags": [t for t in tags if t] or None, "metadata": metadata}.items() if v}
    try:
        from langfuse import propagate_attributes

        with propagate_attributes(**attributes):
            span = lf.start_observation(name=name, as_type="agent", input=input)
    except Exception:  # noqa: BLE001 - tracing is optional
        log.debug("Langfuse trace could not start", exc_info=True)
        yield None
        return
    opened = Unit(span, attributes)
    token = _UNIT.set(opened)
    try:
        yield opened
    except GeneratorExit:
        _safe(span.update, level="WARNING", status_message="Stopped: the caller stopped reading.")
        raise
    except BaseException as exc:
        _safe(span.update, level="ERROR", status_message=str(exc)[:500])
        raise
    finally:
        _UNIT.reset(token)
        _safe(span.end)


@contextmanager
def ai_call(name: str) -> Iterator[dict[str, Any]]:
    """The LangChain config of one AI call: {} when tracing is off, otherwise the Langfuse handler that records it
    as a generation of the current trace (or of a trace of its own, named after the endpoint)."""
    with unit() as opened:
        config: dict[str, Any] = {}
        attributes: dict[str, Any] = {}
        if opened is not None:
            try:
                from langfuse.langchain import CallbackHandler

                config = {"callbacks": [CallbackHandler(trace_context=opened.trace_context)], "run_name": name}
                attributes = opened.attributes
            except Exception:  # noqa: BLE001 - tracing is optional
                log.debug("Langfuse handler could not start", exc_info=True)
        if not config:
            yield config
            return
        from langfuse import propagate_attributes

        with propagate_attributes(**attributes):
            yield config


def _output(name: str, data: dict[str, Any]) -> Any:
    if name == "error":
        return data.get("message")
    if name == "approval":
        return "Waiting for a person's approval."
    return data.get("answer") or data.get("output")


def traced_events(events: Iterator[tuple[str, dict[str, Any]]], name: str | None = None, *, input: Any = None,
                  session_id: str | None = None, tags: tuple[str, ...] = (),
                  metadata: dict[str, str] | None = None) -> Iterator[tuple[str, dict[str, Any]]]:
    """An (event, data) stream inside one trace; the trace's output is the answer of its done event (or the error)."""
    if client() is None:
        yield from events
        return
    with unit(name, input=input, session_id=session_id, tags=tags, metadata=metadata) as opened:
        for event, data in events:
            if opened is not None and event in ("done", "error", "approval"):
                level = {"level": "ERROR", "status_message": str(data.get("message"))[:500]} if event == "error" else {}
                _safe(opened.span.update, output=_output(event, data), **level)
            yield event, data
