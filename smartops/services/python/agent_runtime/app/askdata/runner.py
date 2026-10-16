"""Run one Ask Data question for one agent (twise db_assistant Runtime._invoke + build_response).

Yields the runtime's step events: ``status`` / ``node`` while the graph runs, then ``done`` with twise's
ChatResponse fields {answer, route, needs_analysis, verified, mode, seconds, chart, export_token, steps, data}
plus usage, or ``error``. As in twise, routes that run no verification (chitchat, clarify) report verified.
"""
from __future__ import annotations

import logging
import time
from functools import lru_cache
from typing import Any, Iterator

from app.askdata.graph_deep import build_graph
from app.askdata.graph_fast import build_fast_graph
from app.askdata.nodes._common import answer_steps
from app.askdata.prompts import build_prompts, default_knowledge, load_db_prompts
from app.askdata.tools import export as export_svc
from app.askdata.settings import AskDataRun, AskDataSettings, DbTarget, run_context
from app.askdata.tools.schema_introspect import build_schema_text, build_value_hints

log = logging.getLogger("askdata.runner")

RECURSION_LIMIT = 60
# Graph step -> what the user is told (twise STAGE_LABELS). Never names a table, column or query.
STAGE_LABELS = {
    "orchestrator": "Understanding your question",
    "planner": "Planning the steps",
    "sql_author": "Preparing the query",
    "validator": "Checking the query is safe",
    "executor": "Fetching your data",
    "analysis": "Analysing the results",
    "verifier": "Verifying the numbers",
    "synthesize": "Writing the answer",
    "chart": "Building the chart",
}


# Schema block per database + visibility settings, loaded once per process like twise's Runtime.startup
# (a restart re-checks the fingerprint and rebuilds when the database changed).
_SCHEMAS: dict[tuple, str] = {}


def _schema(run: AskDataRun) -> str:
    s = run.settings
    key = (run.db.server, run.db.port, run.db.name, s.allowed_schemas, s.excluded_tables, s.excluded_columns)
    if key not in _SCHEMAS:
        schema = build_schema_text()
        hints = build_value_hints()
        _SCHEMAS[key] = schema + (("\n\n" + hints) if hints else "")
    return _SCHEMAS[key]


@lru_cache(maxsize=1)
def _graphs() -> dict[str, Any]:
    return {"deep": build_graph(), "normal": build_fast_graph()}


def bound_history(turns: list[dict[str, str]], limit: int) -> list[dict[str, str]]:
    """Keep only the last HISTORY_TURNS exchanges (twise routes.bound_history)."""
    recent = turns[-limit:] if limit > 0 else []
    return [{"user": str(t.get("user", "")), "assistant": str(t.get("assistant", ""))} for t in recent]


def ask(question: str, history: list[dict[str, str]], *, mode: str, options: Any, db: Any, llm: Any) -> Iterator[dict[str, Any]]:
    """``options`` is models.AskDataOptions (or None), ``db`` models.Db, ``llm`` models.Llm."""
    if db is None:
        yield {"event": "error", "data": {"message": "Ask Data has no database configured."}}
        return
    mode = "normal" if mode == "normal" else "deep"
    settings = settings_for(options)
    run = AskDataRun(settings=settings, llm=llm, db=target(db))
    history = bound_history(history, settings.history_turns)
    started = time.monotonic()
    with run_context(run):
        load_db_prompts()
        run.prompts = build_prompts(
            settings.max_rows,
            (options.business_rules if options and options.business_rules else default_knowledge("business_rules.md")),
            (options.examples if options and options.examples else default_knowledge("few_shots.md")),
        )
        yield {"event": "status", "data": {"stage": "Reading the database structure"}}
        schema = _schema(run)
        # Each label below is sent when its node finishes; this one covers the first node while it runs.
        yield {"event": "status", "data": {"stage": STAGE_LABELS["orchestrator"]}}
        final: dict[str, Any] = {}
        for kind, chunk in _graphs()[mode].stream(
                {"question": question, "history": history, "schema": schema, "mode": mode},
                config={"recursion_limit": RECURSION_LIMIT}, stream_mode=["updates", "values"]):
            if kind == "updates" and isinstance(chunk, dict):
                for node in chunk:
                    yield {"event": "node", "data": {"phase": "start", "node": node}}
                    if node in STAGE_LABELS:
                        yield {"event": "status", "data": {"stage": STAGE_LABELS[node]}}
            elif kind == "values" and isinstance(chunk, dict):
                final = chunk
        # Inside the run: the export token is signed with this run's settings.
        response = _response(final, mode, time.monotonic() - started, run.usage)
    yield {"event": "done", "data": response}


def settings_for(options: Any) -> AskDataSettings:
    """The agent's Knowledge Source limits over twise's defaults."""
    return AskDataSettings(**({"max_rows": options.max_rows} if options and options.max_rows else {}),
                           **({"allowed_schemas": tuple(s.strip().lower() for s in options.allowed_schemas if s.strip())}
                              if options and options.allowed_schemas else {}))


def target(db: Any) -> DbTarget:
    return DbTarget(server=db.server, name=db.name, user=db.user, password=db.password,
                    port=db.port, encrypt=db.encrypt, trust_cert=db.trust_cert)


def _response(result: dict[str, Any], mode: str, elapsed: float, usage: list[dict[str, Any]]) -> dict[str, Any]:
    """twise routes.build_response (include_sql=true)."""
    shown = answer_steps(result)
    last = shown[-1] if shown else None
    return {
        "answer": result.get("answer") or "(no answer produced)",
        "route": result.get("route", "sql"),
        "needs_analysis": bool(result.get("needs_analysis", False)),
        # Non-sql routes never run verification, so they are reported as verified.
        "verified": bool(result.get("verify_ok", True)),
        "mode": mode,
        "seconds": round(elapsed, 2),
        "export_token": export_svc.make_token(last.get("sql", "")) if last else None,
        # Every attempt, rejected ones included, so the SQL view shows what was tried (twise build_response).
        "steps": [{"sub_question": s.get("sub_question", ""), "sql": s.get("sql", ""),
                   "row_count": len(s.get("rows") or []), "truncated": bool(s.get("truncated"))}
                  for s in (result.get("steps") or []) + (result.get("rejected_steps") or [])],
        "data": {"columns": list(last.get("columns") or []), "rows": [list(r) for r in last.get("rows") or []],
                 "truncated": bool(last.get("truncated"))} if last else None,
        "chart": result.get("chart") or None,
        "usage": usage,
    }


def export(token: str, fmt_name: str, *, question: str, answer: str, verified: bool, options: Any,
           db: Any) -> tuple[str, str, bytes]:
    """twise routes.export: re-run the SQL an answer was built from (signed token), every row, no model call.
    Raises export_svc.ExportError for a 400, ImportError when the format's library is missing."""
    import re
    from app.askdata.tools import export_formats as fmt

    run = AskDataRun(settings=settings_for(options), db=target(db))
    with run_context(run):   # the token's signing secret and limits are run settings
        sql = export_svc.read_token(token)
        schema = build_schema_text()
        columns, rows, capped = export_svc.fetch_all(sql, schema)
        content_type, ext = fmt.FORMATS[fmt_name]
        notes = [fmt.cap_note(capped, len(rows), run.settings.export_max_rows), fmt.unverified_note(verified)]
        title = (question or "Data export").strip()[:120]
        body = fmt.to_xlsx(columns, rows, notes, title) if fmt_name == "xlsx" else fmt.to_docx(columns, rows, notes, title, answer)
    stem = re.sub(r"[^a-z0-9]+", "-", (question or "export").lower()).strip("-")[:50] or "export"
    return content_type, f"al-tasnim-{stem}.{ext}", body
