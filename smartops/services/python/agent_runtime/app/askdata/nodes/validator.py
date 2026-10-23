# Ported from twise-agentic db_assistant/src/agent/sub_agents/deep/nodes/validator.py (team repo); see app/askdata/README.md.
"""Validator (deterministic) — the hard safety gate in front of the executor.

Two checks: `is_select_only` (a keyword scan: no writes) and `graph/access.py` (a parse: one
SELECT that reads only the tables and columns the SCHEMA block shows). The keyword scan alone is
not a guarantee - it can be fooled by T-SQL batches without semicolons - which is why the parse
also refuses anything but a single SELECT. The login's own permissions remain the backstop.
"""
from __future__ import annotations

import re

from app.askdata.nodes._common import with_rejection
from app.askdata.tools.access import access_problems
from app.askdata.state import AgentState
from app.askdata.log import get_agent_logger

log = get_agent_logger("db_assistant")

# Whole-word keywords that must never appear in a query we run.
_FORBIDDEN = re.compile(
    r"\b(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|CREATE|TRUNCATE|EXEC|EXECUTE|"
    r"GRANT|REVOKE|BACKUP|RESTORE|SHUTDOWN|RECONFIGURE|INTO)\b",
    re.IGNORECASE,
)
_PROC = re.compile(r"\b(sp_|xp_)\w+", re.IGNORECASE)

# Read-side dangers. These are legal inside a SELECT — so the rules above let them through — but
# they reach OUTSIDE the approved schemas: the server's filesystem, a linked server, or the login
# catalogue (sys.sql_logins exposes password hashes). They cannot modify data; they leak it.
# Verified against this database: none of these words occurs in any table or column name, so
# blocking them cannot reject a legitimate query.
_UNSAFE = re.compile(
    r"\b(OPENROWSET|OPENQUERY|OPENDATASOURCE|OPENXML|BULK|WAITFOR)\b"
    r"|\bfn_(get_audit_file|trace_gettable)\b"
    r"|\bsys\.(sql_logins|server_principals|credentials|master_key_passwords)\b",
    re.IGNORECASE,
)


def _scrub(sql: str) -> str:
    """Blank out string literals, bracketed identifiers and comments in ONE pass.

    Only this inspection copy is scrubbed — the SQL that runs is always the original.

    Two reasons this is a single character scan rather than two regex passes:

    * a keyword inside DATA is not a command. `WHERE remarks LIKE '%update required%'` was being
      rejected as an UPDATE, so a legitimate question failed and burned both retries;
    * doing strings and comments separately is exploitable. Strip comments first and a `--`
      inside a string breaks the literal; blank strings first and a lone quote inside a comment
      can swallow a real statement, e.g.

          SELECT a -- '
          DROP TABLE t -- '

      would mask the DROP while SQL Server still executes it as a second statement.
    """
    out: list[str] = []
    i, n = 0, len(sql)
    while i < n:
        ch = sql[i]

        if sql.startswith("--", i):
            nl = sql.find("\n", i)
            i = n if nl == -1 else nl
            out.append(" ")
            continue

        if sql.startswith("/*", i):
            end = sql.find("*/", i + 2)
            i = n if end == -1 else end + 2
            out.append(" ")
            continue

        if ch == "'":  # string literal; '' escapes a quote inside it
            i += 1
            while i < n:
                if sql[i] == "'":
                    if i + 1 < n and sql[i + 1] == "'":
                        i += 2
                        continue
                    i += 1
                    break
                i += 1
            out.append("''")
            continue

        # Bracketed identifier, e.g. [Delete Count]. Only when properly closed, so an unmatched
        # '[' can never swallow the rest of the statement.
        if ch == "[":
            end = sql.find("]", i + 1)
            if end != -1:
                out.append("[x]")
                i = end + 1
                continue

        out.append(ch)
        i += 1
    return "".join(out)


def is_select_only(sql: str) -> tuple[bool, str]:
    if not sql or not sql.strip():
        return False, "Empty query."
    clean = _scrub(sql).strip().rstrip(";").strip()

    if ";" in clean:
        return False, "Multiple statements are not allowed — write a single SELECT."

    lowered = clean.lower()
    if not (lowered.startswith("select") or lowered.startswith("with")):
        return False, "Query must start with SELECT (or WITH ... SELECT)."

    if _FORBIDDEN.search(clean):
        bad = _FORBIDDEN.search(clean).group(0)
        return False, f"Forbidden keyword '{bad}' — only read-only SELECT is permitted."
    if _PROC.search(clean):
        return False, "Stored-procedure calls (sp_/xp_) are not allowed."
    if _UNSAFE.search(clean):
        bad = _UNSAFE.search(clean).group(0)
        return False, (
            f"'{bad}' is not allowed — a query may only read the approved schemas, never remote "
            "servers, files on disk, or login/credential data."
        )

    return True, ""


def validator_node(state: AgentState) -> dict:
    sql = state.get("sql", "")
    ok, reason = is_select_only(sql)
    if not ok:
        log.warning("validation rejected: %s", reason)
        return {"validation_error": reason, "retry_count": state.get("retry_count", 0) + 1,
                "rejections": with_rejection(state, "validator", reason)}

    # WHAT it reads: only tables and columns the SCHEMA block shows (see graph/access.py). Also
    # catches a table-name slip (dbo.task_daily for well.task_daily) before a DB round trip.
    problems = access_problems(sql, state.get("schema", ""))
    if problems:
        reason = "Not allowed: " + " ".join(problems)
        log.warning("validation rejected: %s", reason)
        return {"validation_error": reason, "retry_count": state.get("retry_count", 0) + 1,
                "rejections": with_rejection(state, "validator", reason)}

    log.info("validation ok: single read-only SELECT over approved tables")
    return {"validation_error": ""}
