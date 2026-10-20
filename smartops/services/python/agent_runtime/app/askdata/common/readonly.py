# Ported from twise-agentic shared/twise_common/db/readonly.py (team repo); see app/askdata/README.md.
"""SELECT-only gate shared by every agent that executes SQL.

``assert_read_only`` runs two checks:

* a keyword scan with comments and string literals blanked out - cheap, and the original gate;
* a PARSE (sqlglot, T-SQL). The scan alone can be fooled: T-SQL needs no semicolon between
  statements (`SELECT 1 AS a KILL 55`), and a `--` inside a string literal hid a second statement
  from it (`SELECT '--' AS x; DELETE ...`). The parse requires exactly ONE SELECT and refuses any
  write (SELECT ... INTO included), OPENQUERY / OPENROWSET / OPENDATASOURCE / OPENXML, and three-
  or four-part names (another database, a linked server). SQL it cannot parse is refused.

Every agent also has its own validator; this is the last line of defence directly in front of
the driver, and every agent's execution path calls it - including SQL read back from disk (frozen
queries, compiled probes, cached artifacts), which no validator sees again. Rules about WHICH
tables a query may read are agent-specific and build on ``parse_single_select`` and
``structural_problems`` (see db_assistant's graph/access.py).
"""
from __future__ import annotations

import re

import sqlglot
from sqlglot import exp

FORBIDDEN_STATEMENTS = (
    "INSERT", "UPDATE", "DELETE", "MERGE", "ALTER", "DROP", "TRUNCATE", "CREATE",
    "EXEC", "EXECUTE", "GRANT", "REVOKE", "BACKUP", "RESTORE",
)

# Reach a linked server, another server or a file on disk. Refused wherever they appear.
REMOTE_FUNCTIONS = frozenset({"OPENQUERY", "OPENROWSET", "OPENDATASOURCE", "OPENXML"})

_WRITE_NODES = tuple(
    getattr(exp, name)
    for name in ("Insert", "Update", "Delete", "Merge", "Create", "Drop", "Alter",
                 "TruncateTable", "Command", "Into")
    if hasattr(exp, name)
)

_COMMENT_BLOCK = re.compile(r"/\*.*?\*/", re.DOTALL)
_COMMENT_LINE = re.compile(r"--[^\n]*")
_STRING_LITERAL = re.compile(r"'(?:[^']|'')*'", re.DOTALL)
# [Last Update] / "Create Date": quoted identifiers are names, never keywords (the parse below still checks structure).
_QUOTED_NAME = re.compile(r'\[(?:[^\]]|\]\])*\]|"(?:[^"]|"")*"')


class ReadOnlyViolation(RuntimeError):
    """A statement that is not a pure SELECT was about to be executed."""


def strip_noise(sql: str) -> str:
    """Remove comments, string literals and quoted names so keyword scanning is meaningful."""
    without_comments = _COMMENT_LINE.sub(" ", _COMMENT_BLOCK.sub(" ", sql))
    return _QUOTED_NAME.sub(" [x] ", _STRING_LITERAL.sub(" '' ", without_comments))


def function_name(func: exp.Expression) -> str:
    """Upper-case name of a parsed function call, e.g. OPENQUERY or STRING_SPLIT."""
    if isinstance(func, exp.Anonymous):
        return str(func.this).upper()
    return func.sql(dialect="tsql").split("(", 1)[0].strip().upper()


def parse_single_select(sql: str) -> exp.Expression:
    """The statement as a sqlglot tree. Raises ReadOnlyViolation unless it is exactly ONE SELECT."""
    try:
        statements = [s for s in sqlglot.parse(sql, read="tsql") if s is not None]
    except Exception as exc:  # noqa: BLE001 - any parser failure is a refusal, never a pass
        first_line = str(exc).splitlines()[0] if str(exc) else type(exc).__name__
        raise ReadOnlyViolation(
            f"The query could not be parsed ({first_line}). Write ONE plain T-SQL SELECT."
        ) from None
    statement = statements[0] if len(statements) == 1 else None
    # `(SELECT 1)` parses as a parenthesised subquery around the SELECT.
    while isinstance(statement, (exp.Subquery, exp.Paren)):
        statement = statement.this
    if not isinstance(statement, (exp.Select, exp.SetOperation)):
        raise ReadOnlyViolation("Write exactly ONE SELECT statement - no second statement, no batch.")
    return statement


def structural_problems(tree: exp.Expression) -> list[str]:
    """Writes, remote access and cross-database references inside a parsed SELECT."""
    problems: list[str] = []

    def add(message: str) -> None:
        if message not in problems:
            problems.append(message)

    for node in tree.find_all(*_WRITE_NODES):
        add(f"'{node.key.upper()}' is not allowed - only a read-only SELECT may run.")
    for func in tree.find_all(exp.Func):
        name = function_name(func)
        if name in REMOTE_FUNCTIONS:
            add(f"{name} is not allowed - a query may only read this database.")
    for table in tree.find_all(exp.Table):
        if table.catalog or isinstance(table.this, exp.Dot):
            add(f"{table.sql(dialect='tsql')}: other databases and linked servers are not allowed.")
    return problems


def assert_read_only(sql: str) -> None:
    cleaned = strip_noise(sql).strip()
    if not cleaned:
        raise ReadOnlyViolation("Empty statement")
    first_word = re.split(r"\s+", cleaned, maxsplit=1)[0].upper().lstrip("(")
    if first_word not in {"SELECT", "WITH"}:
        raise ReadOnlyViolation(f"Only SELECT/WITH statements are allowed, got {first_word!r}")
    for keyword in FORBIDDEN_STATEMENTS:
        if re.search(rf"(?<![A-Za-z0-9_]){keyword}(?![A-Za-z0-9_])", cleaned, re.IGNORECASE):
            raise ReadOnlyViolation(f"Forbidden keyword {keyword} found in statement")
    if ";" in cleaned.rstrip().rstrip(";"):
        raise ReadOnlyViolation("Multiple statements are not allowed")

    problems = structural_problems(parse_single_select(sql))
    if problems:
        raise ReadOnlyViolation(" ".join(problems))
