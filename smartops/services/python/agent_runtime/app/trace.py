"""Readable terminal logs of what the agent runtime does: each request, each graph node and agent step, each AI call
(model, time, tokens) and each SQL query (rows, time), for Ask Data, agents and the Agentic Features.

Output goes to the terminal through ``rich`` when it is installed (plain lines otherwise). Logging only: nothing here
changes a run's flow or its results, and a logging failure never reaches a request. No secrets are written: no
passwords, API keys or prompt texts; SQL text is shortened.

Environment:
    AGENT_LOG_LEVEL   DEBUG | INFO (default) | WARNING  - DEBUG adds catalogue reads and full SQL
    AGENT_LOG_SQL     1 (default) shows the SQL of each query (shortened), 0 hides it
    AGENT_LOG_RICH    1 (default) uses rich when installed, 0 plain lines
    AGENT_LOG_WIDTH   terminal width for rich (default: auto)
"""
from __future__ import annotations

import logging
import os
import re
import time
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any, Iterator

log = logging.getLogger("agent_runtime.trace")

# Who is calling the model right now ("askdata.sql_author", "anomaly.verifier", "agent.final"...).
_LABEL: ContextVar[str] = ContextVar("agent_trace_label", default="")

# Libraries whose INFO lines are noise next to ours.
_QUIET = ("httpx", "httpcore", "openai", "urllib3", "langchain", "langchain_core", "langchain_openai", "langgraph",
          "sqlglot", "asyncio", "multipart", "python_multipart", "watchfiles")

_configured = False


def setup() -> None:
    """Send the runtime's own loggers (agent_runtime.*, askdata.*, app.*) to the terminal. Idempotent."""
    global _configured
    if _configured:
        return
    _configured = True
    level = getattr(logging, os.environ.get("AGENT_LOG_LEVEL", "INFO").upper(), logging.INFO)
    handler: logging.Handler
    if os.environ.get("AGENT_LOG_RICH", "1") != "0":
        try:
            from rich.console import Console
            from rich.logging import RichHandler

            width = int(os.environ["AGENT_LOG_WIDTH"]) if os.environ.get("AGENT_LOG_WIDTH", "").isdigit() else None
            handler = RichHandler(console=Console(stderr=True, width=width), show_path=False, markup=True,
                                  rich_tracebacks=True, tracebacks_show_locals=False, log_time_format="[%H:%M:%S]")
            handler.setFormatter(logging.Formatter("%(message)s"))
        except ImportError:
            handler = _plain()
    else:
        handler = _plain()
    handler.setLevel(level)
    for name in ("agent_runtime", "askdata", "app"):
        lg = logging.getLogger(name)
        lg.setLevel(level)
        if not any(getattr(h, "_agent_trace", False) for h in lg.handlers):
            handler._agent_trace = True  # type: ignore[attr-defined]
            lg.addHandler(handler)
        # propagate stays on: uvicorn puts no handler on the root logger, so nothing prints twice, and test
        # log capture keeps working.
    for name in _QUIET:
        logging.getLogger(name).setLevel(logging.WARNING)


def _plain() -> logging.Handler:
    h = logging.StreamHandler()
    h.setFormatter(logging.Formatter("%(asctime)s %(levelname)-7s %(name)s  %(message)s", "%H:%M:%S"))
    return h


def _esc(text: Any) -> str:
    """Text safe for rich markup (square brackets would be read as styles)."""
    return str(text).replace("[", r"\[")


def _short_sql(sql: str, limit: int = 300) -> str:
    """One line, comments dropped (verified queries open with long header comments), ASCII only."""
    text = re.sub(r"/\*.*?\*/", " ", sql or "", flags=re.S)
    text = re.sub(r"--[^\n]*", " ", text)
    one = re.sub(r"\s+", " ", text).strip()
    return one if len(one) <= limit else one[:limit] + " ..."


def _safe(fn):
    def wrapper(*a, **k):
        try:
            fn(*a, **k)
        except Exception:  # noqa: BLE001 - logging must never break a run
            pass
    return wrapper


# ── Who is calling ─────────────────────────────────────────────────────────────────────────────────────────────────

@contextmanager
def label(name: str) -> Iterator[None]:
    """Name the AI calls made inside (shown on each AI line)."""
    token = _LABEL.set(name)
    try:
        yield
    finally:
        _LABEL.reset(token)


def current_label() -> str:
    return _LABEL.get()


# ── Events ─────────────────────────────────────────────────────────────────────────────────────────────────────────

@_safe
def llm(model: str, seconds: float, meta: dict | None, *, fast: bool = False, error: BaseException | None = None) -> None:
    who = current_label() or "ai"
    if error is not None:
        log.warning(f"[bold magenta]AI[/] {_esc(who)} [dim]{_esc(model)}[/] [red]failed[/] after {seconds:.1f}s: "
                    f"{_esc(type(error).__name__)}")
        return
    meta = meta or {}
    tokens = f"in {int(meta.get('input_tokens', 0)):,} / out {int(meta.get('output_tokens', 0)):,} tokens"
    log.info(f"[bold magenta]AI[/] {_esc(who)} [dim]{_esc(model)}{' (fast)' if fast else ''}[/] {seconds:.1f}s, {tokens}")


@_safe
def sql(who: str, rows: int | None, seconds: float, text: str = "", *, truncated: bool = False,
        error: BaseException | None = None) -> None:
    show = os.environ.get("AGENT_LOG_SQL", "1") != "0"
    tail = f"\n    [dim]{_esc(_short_sql(text))}[/]" if show and text else ""
    if error is not None:
        log.warning(f"[bold blue]SQL[/] {_esc(who)} [red]failed[/] after {seconds:.1f}s: {_esc(type(error).__name__)}{tail}")
        return
    log.info(f"[bold blue]SQL[/] {_esc(who)} {rows if rows is not None else '?'} rows"
             f"{' (truncated)' if truncated else ''} in {seconds:.2f}s{tail}")


@_safe
def node(flow: str, name: str, detail: str = "") -> None:
    """A graph node or agent step started / finished (Ask Data nodes, agent steps, tools, job stages)."""
    log.info(f"[bold cyan]{_esc(flow)}[/] -> [bold]{_esc(name)}[/]{(' ' + _esc(detail)) if detail else ''}")


@_safe
def event(flow: str, kind: str, data: Any) -> None:
    """An event an agent run streams (step / node / decision / status), one short line each."""
    if not isinstance(data, dict):
        log.info(f"[bold cyan]{_esc(flow)}[/] {_esc(kind)}")
        return
    keep = {k: v for k, v in data.items() if k in ("step", "node", "agent", "phase", "stage", "decision", "route",
                                                    "next", "status", "ok", "label", "done", "total", "tool")}
    parts = " ".join(f"{k}={_esc(v)}" for k, v in keep.items() if v not in (None, ""))
    log.info(f"[bold cyan]{_esc(flow)}[/] {_esc(kind)} {parts}")


@_safe
def request_done(method: str, path: str, status: int, seconds: float) -> None:
    colour = "green" if status < 400 else "yellow" if status < 500 else "red"
    log.info(f"[bold]{_esc(method)}[/] {_esc(path)} [{colour}]{status}[/] {seconds:.1f}s")


class Timer:
    """with Timer() as t: ... ; t.seconds"""

    def __enter__(self) -> "Timer":
        self.started = time.perf_counter()
        self.seconds = 0.0
        return self

    def __exit__(self, *exc: Any) -> None:
        self.seconds = time.perf_counter() - self.started
