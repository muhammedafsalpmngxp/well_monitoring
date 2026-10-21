"""Readable terminal logs of what the agent runtime does: each request, each graph node and agent step, each AI call
(model, time, tokens) and each SQL query (rows, time), for Ask Data, agents and the Agentic Features.
After each Ask Data question, one route summary: Step 1:, Step 2:, ... with what each step produced (route).

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


def _cut(text: Any, limit: int) -> str:
    one = re.sub(r"\s+", " ", str(text or "")).strip()
    return one if len(one) <= limit else one[:limit] + " ..."


def _produced(node: str, update: dict) -> list[tuple[str, str]]:
    """What a node decided or made, from the state it returned, as (style, plain text) lines: the route, the SQL,
    the rows, a verdict, the answer."""
    u = update
    if node == "value match":
        text = (u.get("value_matches") or "").split("\n")
        found = [("", line[2:]) for line in text if line.startswith("- ")]
        missing = [("dim", line) for line in text if line.startswith("No stored value")]
        return found + missing or [("dim", "no matches")]
    if u.get("validation_error"):
        return [("red", "rejected: " + _cut(u["validation_error"], 400))]
    if u.get("exec_error"):
        return [("red", "failed: " + _cut(u["exec_error"], 400))]
    if node == "validator":
        return [("green", "ok")]
    if node == "verifier" and "verify_ok" in u:
        return [("green", "ok")] if u["verify_ok"] else [("yellow", "rejected: " + _cut(u.get("verify_feedback"), 400))]
    if u.get("sql"):
        return [("dim", _short_sql(u["sql"], 1200))]
    if node == "executor" and u.get("steps"):
        step = u["steps"][-1]
        n = len(step.get("rows") or [])
        cols = ", ".join(str(c) for c in (step.get("columns") or []))
        return [("", f"{n} row{'s' if n != 1 else ''}{' (truncated)' if step.get('truncated') else ''}: {_cut(cols, 200)}")]
    if "route" in u:
        flags = [k for k in ("needs_analysis", "multi_step", "wants_chart", "is_followup") if u.get(k)]
        return [("bold", f"route={u['route']}" + (f" ({', '.join(flags)})" if flags else ""))]
    if u.get("clarify_question"):
        return [("", "asks: " + _cut(u["clarify_question"], 400))]
    if u.get("answer"):
        return [("", f'"{_cut(u["answer"], 400)}"')]
    if u.get("next_action"):
        return [("", f"next: {u['next_action']}" + (f" - {_cut(u['sub_question'], 300)}" if u.get("sub_question") else ""))]
    if "chart" in u:
        return [("", f"chart: {(u['chart'] or {}).get('type') or 'none'}")]
    if u.get("analysis"):
        return [("", _cut(u["analysis"], 400))]
    return []


def _wrap(text: str, width: int) -> list[str]:
    import textwrap
    return textwrap.wrap(text, width, break_long_words=True, break_on_hyphens=False) or [""]


@_safe
def route(flow: str, question: str, steps: list[tuple[str, float, list, dict]], result: dict) -> None:
    """One summary per question, after it is answered: Step 1:, Step 2:, ... in the order the nodes ran, each with its
    time, AI tokens (in / out) and what it produced; a retry shows as the same node again.

        Ask Data (deep) "how many wells are in marmul"  route sql · verified · 20.3s · 4 AI calls · 49,057 / 464 tokens
        ├─ Step 1:  value match     0.0s
        │            "marmul": ref.cluster.cluster_name = 'Marmul' (1 row); ...
        ├─ Step 2:  orchestrator    5.8s  AI 2,552 / 125    route=sql
        ├─ Step 3:  sql_author      5.5s  AI 34,381 / 273
        │            SELECT COUNT(DISTINCT wm.well_id) AS well_count FROM well.well_master AS wm ...
        ...
        └─ Step 7:  synthesize      2.2s  AI 4,861 / 13     "There are 448 wells in Marmul."
    """
    usage = result.get("usage") or []
    t_in, t_out = sum(u.get("input", 0) for u in usage), sum(u.get("output", 0) for u in usage)
    verified = "[green]verified[/]" if result.get("verified") else "[yellow]not verified[/]"
    lines = [f"[bold cyan]{_esc(flow)}[/] [bold]\"{_esc(_cut(question, 120))}\"[/]  route {_esc(result.get('route'))} · "
             f"{verified} · {result.get('seconds', 0):.1f}s · {len(usage)} AI call{'s' if len(usage) != 1 else ''} · "
             f"{t_in:,} / {t_out:,} tokens"]
    # rich puts the time and level (20 columns) and the tree (13) before each line.
    width = max(50, int(os.environ["AGENT_LOG_WIDTH"]) - 36) if os.environ.get("AGENT_LOG_WIDTH", "").isdigit() else 80
    for i, (name, seconds, calls, update) in enumerate(steps):
        branch, cont = ("└─", "  ") if i == len(steps) - 1 else ("├─", "│ ")
        ai = ("AI " + " + ".join(f"{c.get('input', 0):,} / {c.get('output', 0):,}" for c in calls)) if calls else ""
        out = _produced(name, update)
        # A short result stays on the step's line; the SQL and value matches go below it, wrapped under the step.
        inline = out.pop(0) if len(out) == 1 and len(out[0][1]) <= 50 else None
        head = f"{branch} {f'Step {i + 1}:':<9}[bold]{_esc(name):<14}[/] {seconds:5.1f}s  [magenta]{ai:<20}[/]"
        if inline:
            style, text = inline
            head += f" [{style}]{_esc(text)}[/]" if style else f" {_esc(text)}"
        lines.append(head.rstrip())
        for style, text in out:
            for part in _wrap(text, width):
                lines.append(f"{cont}           " + (f"[{style}]{_esc(part)}[/]" if style else _esc(part)))
    log.info("\n".join(lines))


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
