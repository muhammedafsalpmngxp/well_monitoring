# Ported from twise-agentic db_assistant/src/agent/sub_agents/deep/nodes/executor.py (team repo); see app/askdata/README.md.
"""Executor (deterministic) — runs the validated SELECT read-only, capped + timed + logged."""
from __future__ import annotations

import time

from app.askdata.settings import agent_settings
from app.askdata.common.connection import get_connection
from app.askdata.common.readonly import assert_read_only
from app.askdata.state import AgentState
from app.askdata.log import get_agent_logger

log = get_agent_logger("db_assistant")


def executor_node(state: AgentState) -> dict:
    sql = state.get("sql", "")
    conn = None
    start = time.perf_counter()
    try:
        # Second line of defence (twise ran only the validator): refuse anything but one SELECT.
        assert_read_only(sql)
        conn = get_connection(timeout=agent_settings.query_timeout, readonly=True)
        cur = conn.cursor()
        cur.execute(sql)
        columns = [d[0] for d in cur.description] if cur.description else []
        # Fetch one extra row to detect truncation.
        fetched = [list(r) for r in cur.fetchmany(agent_settings.max_rows + 1)]
        truncated = len(fetched) > agent_settings.max_rows
        rows = fetched[: agent_settings.max_rows]
        elapsed = time.perf_counter() - start
        log.info("exec ok: %d rows%s in %.2fs", len(rows), " (truncated)" if truncated else "", elapsed)

        step = {
            "sub_question": state.get("sub_question") or state.get("question", ""),
            "sql": sql,
            "columns": columns,
            "rows": rows,
            "truncated": truncated,
        }
        # Only `steps` is returned: the same columns/rows/truncated used to also be copied to
        # top-level state, where nothing ever read them — a duplicate of every result set
        # (up to MAX_ROWS) carried through the whole graph for no reason.
        return {
            "steps": state.get("steps", []) + [step],
            "query_count": state.get("query_count", 0) + 1,
            "exec_error": "",
        }
    except Exception as exc:  # noqa: BLE001 - feed the DB error back for self-correction
        elapsed = time.perf_counter() - start
        log.warning("exec error in %.2fs: %s", elapsed, exc)
        return {"exec_error": str(exc), "retry_count": state.get("retry_count", 0) + 1}
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:  # noqa: BLE001
                pass
