"""Saved SQL: the built-in tool that runs the SELECT a step's author wrote, with no model call.

For agents whose answer is a known query (a daily report, a list of late wells), Ask Data's pipeline (orchestrator,
SQL author, validator, verifier, synthesize) spends several model calls re-deriving SQL the author already has. A
Saved SQL step runs that SQL as written:

  * {{name}} placeholders become ? parameters bound to the run's inputs, never pasted into the SQL. A placeholder
    written inside quotes ('{{name}}') is the same parameter. An empty input binds NULL, so optional filters can be
    written as  (? IS NULL OR col = ?).
  * The SQL must be exactly one SELECT (assert_read_only) and may read only what Ask Data may read: the same
    schemas, excluded tables and columns, no SELECT * (access_problems). Checked when the graph is built and again
    right before it runs, on the Ask Data database login. That login may be able to write (SA in local setups),
    so the query also runs inside a transaction that is always rolled back.
  * Actions: "table" returns the rows as a markdown table; "summary" also has the tenant's AI provider write the
    agent's answer from them (the answer node, with the agent's answer prompts).
"""
from __future__ import annotations

import datetime
import decimal
import re
import time
from typing import Any, Iterator, Mapping

SQL_QUERY = "sql_query"
ACTIONS = ("table", "summary")
MAX_SQL = 20000
ANSWER_ROWS = 50   # rows written into the answer text; the step's data carries up to max_rows

SQL_QUERY_TOOL = {
    "agent": SQL_QUERY, "title": "Saved SQL (built-in)", "ready": True, "capabilities": list(ACTIONS),
    "description": "Runs the read-only SELECT written on the step, with {{inputs}} as parameters. No model call: "
                   "table = the rows as the answer; summary = the AI provider writes the answer from the rows.",
}

# '{{name}}' (quoted) first, so the quotes go with the placeholder; then {{name}}.
_PLACEHOLDER = re.compile(r"'\{\{\s*(\w+)\s*\}\}'|\{\{\s*(\w+)\s*\}\}")


def placeholders(sql: str) -> list[str]:
    """The input names the SQL uses, in order (a name used twice is listed twice)."""
    return [m.group(1) or m.group(2) for m in _PLACEHOLDER.finditer(sql or "")]


def bind(sql: str, inputs: Mapping[str, str]) -> tuple[str, list[str | None]]:
    """The SQL with every placeholder as ?, and the values in the same order (blank -> None)."""
    params: list[str | None] = []

    def put(m: re.Match) -> str:
        value = (inputs.get(m.group(1) or m.group(2)) or "").strip()
        params.append(value or None)
        return "?"

    return _PLACEHOLDER.sub(put, sql), params


def hidden_placeholders(sql: str) -> int:
    """Placeholders written inside a longer quoted text ('%{{name}}%') or a comment. Each would still become a ?
    that SQL Server does not see as a parameter, so the query would fail on every run with a parameter-count error.
    A placeholder that is the whole quoted text ('{{name}}') is a parameter and is not counted."""
    from app.askdata.common.readonly import strip_noise

    marked = _PLACEHOLDER.sub(" __placeholder__ ", sql)
    return marked.count("__placeholder__") - strip_noise(marked).count("__placeholder__")


def problems(sql: str | None, action: str, input_names: set[str]) -> list[str]:
    """What stops a Saved SQL step from running, checked without the database: [] when it can run."""
    from app.askdata.common.readonly import ReadOnlyViolation, assert_read_only

    text = (sql or "").strip()
    if not text:
        return ["write its SQL"]
    if len(text) > MAX_SQL:
        return [f"its SQL is longer than {MAX_SQL} characters"]
    found: list[str] = []
    if action not in ACTIONS:
        found.append(f"unknown action '{action}' (use {' or '.join(ACTIONS)})")
    if hidden_placeholders(text):
        found.append("an {{input}} inside a longer quoted text or a comment cannot be a parameter: write it outside "
                     "the quotes, e.g. LIKE '%' + {{name}} + '%', and remove it from comments")
    unknown = sorted({n for n in placeholders(text) if n not in input_names})
    if unknown:
        found.append("its SQL uses " + ", ".join("{{" + n + "}}" for n in unknown) + ", which is not an input of the agent")
    try:
        assert_read_only(bind(text, {})[0])
    except ReadOnlyViolation as exc:
        found.append(str(exc))
    return found


def run(sql: str, action: str, inputs: Mapping[str, str], *, db: Any, options: Any,
        tenant: Any = None) -> Iterator[dict[str, Any]]:
    """Runs one Saved SQL step. Yields status, then done ({answer, route, verified, steps, data, usage}) or error.
    ``tenant`` is the tenant's Ask Data settings (models.AskDataTenantSettings): the same schemas, hidden tables and
    columns and limits Ask Data reads under, narrowed by the agent's Knowledge Source (``options``)."""
    from app.askdata import runner
    from app.askdata.common.connection import get_connection
    from app.askdata.common.readonly import assert_read_only
    from app.askdata.settings import AskDataRun, run_context
    from app.askdata.tools.access import access_problems

    if db is None:
        yield {"event": "error", "data": {"message": "Saved SQL has no database configured."}}
        return
    try:
        settings = runner.settings_for(options, tenant)
    except ValueError as exc:
        yield {"event": "error", "data": {"message": str(exc)}}
        return
    bound, params = bind(sql.strip(), inputs)
    started = time.monotonic()
    with run_context(AskDataRun(settings=settings, db=runner.target(db))) as ctx:
        yield {"event": "status", "data": {"stage": "Checking the query is safe"}}
        # The schema block Ask Data reads, cached per database: it says which tables and columns are visible.
        refused = access_problems(bound, runner._schema(ctx))
        if refused:
            yield {"event": "error", "data": {"message": "The saved SQL cannot run: " + " ".join(refused)}}
            return
        assert_read_only(bound)   # last line of defence, as in Ask Data's executor
        yield {"event": "status", "data": {"stage": "Fetching your data"}}
        conn = get_connection(timeout=settings.query_timeout, readonly=True)
        try:
            # The Ask Data login may be able to write (SA locally). The checks above allow only one SELECT; as a
            # last guard the query also runs in a transaction that is always rolled back, so nothing it did stays.
            conn.autocommit = False
            cur = conn.cursor()
            cur.execute(bound, *params)
            columns = [d[0] for d in cur.description] if cur.description else []
            fetched = [list(r) for r in cur.fetchmany(settings.max_rows + 1)]
        finally:
            try:
                conn.rollback()
            finally:
                conn.close()
    truncated = len(fetched) > settings.max_rows
    rows = fetched[:settings.max_rows]
    yield {"event": "done", "data": {
        "answer": table(columns, rows, truncated),
        # route / verified: the Test panel's chip. The author wrote and checked this SQL; nothing was generated.
        "route": "sql", "verified": True, "summarize": action == "summary",
        "steps": [{"sub_question": "", "sql": sql.strip(), "row_count": len(rows), "truncated": truncated}],
        "data": {"columns": columns, "rows": [[_cell(v) for v in r] for r in rows], "truncated": truncated},
        "seconds": round(time.monotonic() - started, 2),
        "usage": [],
    }}


def table(columns: list[str], rows: list[list[Any]], truncated: bool) -> str:
    """The rows as a markdown table, at most ANSWER_ROWS of them, with a line saying how many there are."""
    if not columns:
        return "The query returned no columns."
    if not rows:
        return "The query returned no rows."
    esc = lambda v: "" if v is None else str(_cell(v)).replace("|", "\\|").replace("\n", " ")   # noqa: E731
    lines = ["| " + " | ".join(esc(c) for c in columns) + " |", "|" + "---|" * len(columns)]
    lines += ["| " + " | ".join(esc(v) for v in r) + " |" for r in rows[:ANSWER_ROWS]]
    count = f"{len(rows)}{'+' if truncated else ''} rows"
    shown = f" (showing the first {ANSWER_ROWS})" if len(rows) > ANSWER_ROWS else ""
    return "\n".join(lines) + f"\n\n{count}{shown}."


def _cell(v: Any) -> Any:
    """A value the answer and the JSON stream can carry: dates as ISO text, decimals as numbers."""
    if isinstance(v, (datetime.datetime, datetime.date, datetime.time)):
        return v.isoformat(sep=" ") if isinstance(v, datetime.datetime) else v.isoformat()
    if isinstance(v, decimal.Decimal):
        return int(v) if v == v.to_integral_value() else float(v)
    if isinstance(v, (bytes, bytearray)):
        return "0x" + bytes(v).hex()
    return v
