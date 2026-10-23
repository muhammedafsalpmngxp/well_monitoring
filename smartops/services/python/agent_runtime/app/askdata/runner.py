"""Run one Ask Data question for one agent (twise db_assistant Runtime._invoke + build_response).

Yields the runtime's step events: ``status`` / ``node`` while the graph runs, then ``done`` with twise's
ChatResponse fields {answer, route, needs_analysis, verified, mode, seconds, chart, export_token, steps, data}
plus usage, or ``error``. As in twise, routes that run no verification (chitchat, clarify) report verified.
"""
from __future__ import annotations

import contextvars
import dataclasses
import logging
import os
import threading
import time
from functools import lru_cache
from typing import Any, Iterator, Mapping

from app.askdata.graph_deep import build_graph
from app import trace
from app.askdata.graph_fast import build_fast_graph
from app.askdata.nodes._common import answer_steps
from app.askdata.prompts import KEYS as PROMPT_KEYS, build_prompts, knowledge
from app.prompt_text import missing
from app.askdata.tools import export as export_svc
from app.askdata.settings import AskDataRun, AskDataSettings, ColumnNote, DbTarget, Example, Link, Metric, Term, run_context
from app.askdata.tools import column_profile, links as table_links, suggest, value_match
from app.askdata.tools.knowledge import annotate as annotate_notes, known_words
from app.askdata.tools.schema_introspect import _cache_path, _value_cache_path, build_schema_text, build_value_hints

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
    key = (run.db.server, run.db.port, run.db.name, s.allowed_schemas, s.included_tables, s.excluded_tables, s.excluded_columns)
    if key in _SCHEMAS:
        return _SCHEMAS[key]
    # After a restart the schema cached on disk answers at once; checking it against the live database (a fingerprint
    # query of a few seconds) runs in the background, and a changed database is rebuilt for the next question.
    cached = _cached_schema()
    if cached:
        _SCHEMAS[key] = cached
        threading.Thread(target=contextvars.copy_context().run, args=(_load_schema, key), name="askdata-schema",
                         daemon=True).start()
        return cached
    return _load_schema(key)


def _load_schema(key: tuple) -> str:
    try:
        schema = build_schema_text()
        hints = build_value_hints()
    except Exception as exc:  # noqa: BLE001 - only the background check gets here with a schema already in use
        if key in _SCHEMAS:
            log.warning("schema: background check failed (%s) - the cached schema stays in use", exc)
            return _SCHEMAS[key]
        raise
    full = schema + (("\n\n" + hints) if hints else "")
    # An empty schema (nothing readable, or the database briefly unreachable) is not kept: the next question reads it
    # again instead of answering from nothing until the service restarts.
    if schema.strip():
        _SCHEMAS[key] = full
    return full


def _cached_schema() -> str:
    """The schema block and value hints as last built for this database and settings ("" when not on disk)."""
    try:
        with open(_cache_path(), encoding="utf-8") as fh:
            schema = fh.read().strip()
        hints = ""
        if os.path.exists(_value_cache_path()):
            with open(_value_cache_path(), encoding="utf-8") as fh:
                hints = fh.read().strip()
    except (OSError, RuntimeError):     # RuntimeError: no Ask Data run, so no cache to look in
        return ""
    return schema + (("\n\n" + hints) if hints else "") if schema else ""


@lru_cache(maxsize=1)
def _graphs() -> dict[str, Any]:
    return {"deep": build_graph(), "normal": build_fast_graph()}


def bound_history(turns: list[dict[str, str]], limit: int) -> list[dict[str, str]]:
    """Keep only the last HISTORY_TURNS exchanges (twise routes.bound_history)."""
    recent = turns[-limit:] if limit > 0 else []
    return [{"user": str(t.get("user", "")), "assistant": str(t.get("assistant", ""))} for t in recent]


def ask(question: str, history: list[dict[str, str]], *, mode: str, options: Any, db: Any, llm: Any,
        prompts: Mapping[str, str] | None = None, tenant: Any = None) -> Iterator[dict[str, Any]]:
    """``options`` is models.AskDataOptions (or None), ``db`` models.Db, ``llm`` models.Llm, ``prompts`` the tenant's
    prompt texts {key: text} (every key in prompts.KEYS is required), ``tenant`` models.AskDataTenantSettings (what Ask
    Data may read and its limits; None = not set up)."""
    if db is None:
        yield {"event": "error", "data": {"message": "Ask Data has no database configured."}}
        return
    absent = missing(prompts, PROMPT_KEYS)
    if absent:
        yield {"event": "error", "data": {"message": "Ask Data cannot run: these AI prompts are not configured for this "
                                                     f"tenant: {', '.join(absent)}. An admin can restore them under "
                                                     "AI Settings > AI Prompts."}}
        return
    mode = "normal" if mode == "normal" else "deep"
    try:
        settings = settings_for(options, tenant)
    except ValueError as exc:
        yield {"event": "error", "data": {"message": str(exc)}}
        return
    texts = dict(prompts or {})
    run = AskDataRun(settings=settings, llm=llm, db=target(db), texts=texts)
    history = bound_history(history, settings.history_turns)
    started = time.monotonic()
    with run_context(run):
        run.prompts = build_prompts(
            settings.max_rows,
            knowledge(texts, "business_rules", options.business_rules if options else None),
            knowledge(texts, "few_shots", options.examples if options else None),
            texts,
            settings.org_name,
        )
        yield {"event": "status", "data": {"stage": "Reading the database structure"}}
        # What each column holds (built in the background; none until the first build finishes), and the stored
        # values the question's words match, so filters use real values instead of guessed spellings.
        profiles = column_profile.current()
        # The tenant's column names and notes (AI Settings > Ask Data & Features > Terms & column names) go after the
        # profiles; a term's words and a business name are definitions, not values to look up.
        schema = annotate_notes(column_profile.annotate(_schema(run), profiles), settings.notes, settings.links)
        if profiles:
            run.value_matches = value_match.start(question, schema, profiles, known_words(question, settings))
        route: list[tuple[str, float, list, dict]] = []    # for the log: node, seconds, AI calls, what it returned
        # Each label below is sent when its node finishes; this one covers the first node while it runs.
        yield {"event": "status", "data": {"stage": STAGE_LABELS["orchestrator"]}}
        final: dict[str, Any] = {}
        mark, used = time.monotonic(), len(run.usage)
        for kind, chunk in _graphs()[mode].stream(
                {"question": question, "history": history, "schema": schema, "mode": mode},
                config={"recursion_limit": RECURSION_LIMIT}, stream_mode=["updates", "values"]):
            if kind == "updates" and isinstance(chunk, dict):
                now = time.monotonic()
                for node, update in chunk.items():
                    route.append((node, now - mark, run.usage[used:], update if isinstance(update, dict) else {}))
                    used = len(run.usage)
                    yield {"event": "node", "data": {"phase": "start", "node": node}}
                    if node in STAGE_LABELS:
                        yield {"event": "status", "data": {"stage": STAGE_LABELS[node]}}
                mark = now
            elif kind == "values" and isinstance(chunk, dict):
                final = chunk
        # Inside the run: the export token is signed with this run's settings.
        response = _response(final, mode, time.monotonic() - started, run.usage)
        response.update(_suggestions(question, response, profiles, settings.notes, schema))
        if run.value_matches is not None:
            block, seconds = value_match.awaited(run.value_matches)
            route.insert(0, ("value match", seconds, [], {"value_matches": block}))
        # Each step with its time and AI tokens, for the answer's "Show steps" (no prompt texts).
        response["timeline"] = [{"node": name, "seconds": round(seconds, 2), "input": sum(c.get("input", 0) for c in calls),
                                 "output": sum(c.get("output", 0) for c in calls)} for name, seconds, calls, _u in route]
    trace.route(f"Ask Data ({mode})", question, route, response)
    yield {"event": "done", "data": response}


def _suggestions(question: str, response: dict[str, Any], profiles: dict, notes: tuple[ColumnNote, ...],
                 schema: str = "") -> dict[str, list[str]]:
    """Next questions for the panel: {"follow_ups": [...]} for an answer that found something, else (nothing found,
    small talk) {"suggestions": [...]}, questions that work here; {} while the question is being clarified."""
    if response.get("route") == "clarify" or not profiles:
        return {}
    rows = (response.get("data") or {}).get("rows") or []
    found = bool(rows) and not (len(rows) == 1 and all(v in (0, None, "") for v in rows[0]))
    # A query that reads no table only carries a message ("... is not available"): nothing was found.
    if response.get("route") == "sql" and found and suggest.reads_tables(response.get("sql") or ""):
        return {"follow_ups": suggest.follow_ups(response.get("sql") or "", profiles, notes)}
    return {"suggestions": [q for q in suggest.starters(profiles, notes, schema) if q.lower() != question.strip().lower()]}


def links(db: Any, tenant: Any) -> list[dict]:
    """Suggested table links from the cached column profiles ([] until the first build finishes, which this starts)."""
    run = AskDataRun(settings=settings_for(None, tenant), db=target(db))
    with run_context(run):
        profiles = column_profile.current()
        return table_links.suggest(profiles, _schema(run)) if profiles else []


def starters(db: Any, tenant: Any) -> list[str]:
    """Starter questions for an empty panel, from the cached column profiles ([] until the first build finishes,
    which this starts)."""
    run = AskDataRun(settings=settings_for(None, tenant), db=target(db))
    with run_context(run):
        profiles = column_profile.current()
        return suggest.starters(profiles, run.settings.notes, _schema(run)) if profiles else []


def rows(sql: str, db: Any, tenant: Any) -> dict[str, Any]:
    """An Ask Data answer's rows again, for its insight report. The SQL comes from the answer's saved steps (Tenant API),
    never from the browser, and is checked against the current schema like an export (one read-only SELECT over what
    Ask Data may read); it runs read-only within the tenant's rows per query and query time limit."""
    base = settings_for(None, tenant)
    run = AskDataRun(settings=dataclasses.replace(base, export_max_rows=base.max_rows, export_query_timeout=base.query_timeout),
                     db=target(db))
    with run_context(run):
        columns, data, capped = export_svc.fetch_all(sql, _schema(run))
    return {"data": {"columns": columns, "rows": data, "truncated": capped}}


def without_export_hints(answer: str) -> str:
    """The answer without sentences pointing at an Export option (synthesize adds them), for callers that offer none."""
    import re
    from app.askdata.tools.export_formats import _EXPORT_HINT

    lines = []
    for line in answer.splitlines():
        kept = " ".join(s for s in re.split(r"(?<=[.!?])\s+", line) if not _EXPORT_HINT.search(s))
        if kept.strip() or not line.strip():
            lines.append(kept if line.strip() else line)
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip() or answer


NOT_SET_UP = ("Ask Data is not set up for this tenant yet: an admin chooses the schemas it may read under "
              "AI Settings > Ask Data & Features.")
# Never readable, whatever a tenant lists (the access check refuses them too).
_SYSTEM_SCHEMAS = frozenset({"sys", "information_schema"})


def _names(values: Any) -> tuple[str, ...]:
    """Lowercased, trimmed, blanks and repeats dropped, order kept (the visibility checks compare lowercase)."""
    out: list[str] = []
    for v in values or ():
        n = str(v).strip().lower()
        if n and n not in out:
            out.append(n)
    return tuple(out)


def settings_for(options: Any, tenant: Any = None) -> AskDataSettings:
    """The tenant's Ask Data settings (models.AskDataTenantSettings, from AI Settings > Ask Data & Features), narrowed by an agent's
    Knowledge Source (``options``). An agent can only narrow the tenant's schemas and lower its row limit. Raises
    ValueError when the tenant has not set Ask Data up or the agent's schemas cannot be read."""
    base = tuple(s for s in _names(tenant.allowed_schemas if tenant else ()) if s not in _SYSTEM_SCHEMAS)
    if not base:
        raise ValueError(NOT_SET_UP)
    wanted = _names(options.allowed_schemas if options else ())
    allowed = tuple(s for s in wanted if s in base)
    if wanted and not allowed:
        # Falling back to every schema would widen what the agent asked for (e.g. a typo "wel").
        raise ValueError(f"None of the agent's allowed schemas ({', '.join(wanted)}) can be read here. "
                         f"Use some of: {', '.join(base)}.")
    max_rows = min(options.max_rows, tenant.max_rows) if options and options.max_rows else tenant.max_rows
    return AskDataSettings(
        max_sql_retries=tenant.max_sql_retries, max_rows=max_rows, query_timeout=tenant.query_timeout,
        max_queries=tenant.max_queries, verify_retries=tenant.verify_retries, history_turns=tenant.history_turns,
        allowed_schemas=allowed or base, included_tables=_names(tenant.included_tables),
        excluded_tables=_names(tenant.excluded_tables),
        excluded_columns=_names(tenant.excluded_columns), org_name=(tenant.org_name or "").strip(),
        export_prefix=tenant.export_prefix or "",
        terms=tuple(Term(t.term.strip(), tuple(x.strip() for x in t.synonyms if x.strip()), (t.column or "").strip(),
                         (t.value or "").strip(), (t.meaning or "").strip())
                    for t in tenant.terms or () if t.term.strip()),
        notes=tuple(ColumnNote(n.column.strip().lower(), (n.display_name or "").strip(), (n.note or "").strip())
                    for n in tenant.notes or () if n.column.strip()),
        metrics=tuple(Metric(m.name.strip(), m.agg.strip(), (m.column or "").strip(), (m.description or "").strip())
                      for m in tenant.metrics or () if m.name.strip()),
        examples=tuple(Example(e.question.strip(), e.sql.strip()) for e in tenant.examples or ()),
        links=tuple(Link(k.from_.strip(), k.to.strip()) for k in tenant.links or ()))


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
        # The query the answer and the data below come from (never a rejected attempt).
        "sql": last.get("sql", "") if last else None,
        # Every attempt, rejected ones included and marked, so the SQL view shows what was tried (twise build_response).
        "steps": [{"sub_question": s.get("sub_question", ""), "sql": s.get("sql", ""),
                   "row_count": len(s.get("rows") or []), "truncated": bool(s.get("truncated")), "rejected": rejected}
                  for rejected, group in ((False, result.get("steps") or []), (True, result.get("rejected_steps") or []))
                  for s in group],
        # Every query refused on the way and why (stage: verifier, validator or database), in order: core.AiTraces.rejections_json.
        "rejections": [{"stage": r.get("stage", ""), "sql": r.get("sql", ""), "reason": r.get("reason", ""),
                        "sub_question": r.get("sub_question", "")} for r in result.get("rejections") or []],
        "data": {"columns": list(last.get("columns") or []), "rows": [list(r) for r in last.get("rows") or []],
                 "truncated": bool(last.get("truncated"))} if last else None,
        "chart": result.get("chart") or None,
        "usage": usage,
    }


def export(token: str, fmt_name: str, *, question: str, answer: str, verified: bool, options: Any,
           db: Any, tenant: Any = None) -> tuple[str, str, bytes]:
    """twise routes.export: re-run the SQL an answer was built from (signed token), every row, no model call.
    Raises export_svc.ExportError for a 400, ImportError when the format's library is missing."""
    import re
    from app.askdata.tools import export_formats as fmt

    run = AskDataRun(settings=settings_for(options, tenant), db=target(db))
    with run_context(run):   # the token's signing secret and limits are run settings
        sql = export_svc.read_token(token)
        schema = build_schema_text()
        columns, rows, capped = export_svc.fetch_all(sql, schema)
        content_type, ext = fmt.FORMATS[fmt_name]
        notes = [fmt.cap_note(capped, len(rows), run.settings.export_max_rows), fmt.unverified_note(verified)]
        title = (question or "Data export").strip()[:120]
        body = fmt.to_xlsx(columns, rows, notes, title) if fmt_name == "xlsx" else fmt.to_docx(columns, rows, notes, title, answer)
    stem = re.sub(r"[^a-z0-9]+", "-", (question or "export").lower()).strip("-")[:50] or "export"
    prefix = re.sub(r"[^a-z0-9-]+", "-", run.settings.export_prefix.lower()).strip("-")
    return content_type, f"{prefix + '-' if prefix else ''}{stem}.{ext}", body
