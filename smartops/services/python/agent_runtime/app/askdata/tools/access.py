# Ported from twise-agentic db_assistant/src/tools/access.py (team repo); see app/askdata/README.md.
"""Access check (deterministic) - WHAT a query may read, not only whether it writes.

The SELECT-only gate in nodes/validator.py stops writes. Hiding a table or a column used to happen
only in the prompt: EXCLUDED_TABLES / EXCLUDED_COLUMNS and the secret-name filter kept them out of
the SCHEMA block, but a query that named them anyway (`[sys].[sql_logins]`, `FROM well.t, x.y`,
`[OtherDb].dbo.t`, an excluded column, `SELECT *`) still ran - and a signed export re-ran it for
up to EXPORT_MAX_ROWS rows. This module enforces the boundary on the SQL itself.

Every query is parsed with sqlglot (T-SQL) and rejected unless ALL of these hold. The first rule
and the OPENQUERY / other-database rules are the shared gate's (twise_common/db/readonly.py); the rest
are this agent's own:

  * it parses as exactly ONE SELECT - a second statement, a batch without semicolons, or
    SELECT ... INTO fails here even when the keyword scan in validator.py was fooled
  * every table is schema.table, is listed in the SCHEMA block, and is not EXCLUDED_TABLES -
    so no other database, no linked server, no sys / INFORMATION_SCHEMA view
  * no column hidden by EXCLUDED_COLUMNS or the secret-name filter is referenced
  * no `SELECT *` / `alias.*` straight from a table: it would return the hidden columns
  * no OPENQUERY / OPENROWSET / user-defined function; the only table functions allowed are
    STRING_SPLIT, OPENJSON and GENERATE_SERIES, which read no table

It fails CLOSED: SQL the parser cannot read, or a schema that is not loaded, is a rejection. The
SQL Author receives the reason and rewrites, exactly as for any other validation error.
"""
from __future__ import annotations

from typing import Iterator

from sqlglot import exp

from app.askdata.tools.schema_introspect import _is_excluded, _is_excluded_column, _is_secret
from app.askdata.settings import agent_settings
from app.askdata.common.readonly import (
    ReadOnlyViolation,
    function_name,
    parse_single_select,
    structural_problems,
)

# Table-valued built-ins that take values, not tables. Anything else used as a row source is refused.
SAFE_TABLE_FUNCTIONS = frozenset({"STRING_SPLIT", "OPENJSON", "GENERATE_SERIES"})

# Problems reported back to the SQL Author per query. Enough to fix it, short enough for a prompt.
_MAX_PROBLEMS = 5


def visible_tables(schema_text: str) -> set[str]:
    """Lowercased "schema.table" names declared by the rendered SCHEMA block (introspect._render)."""
    return {
        line[len("TABLE "):].strip().lower()
        for line in (schema_text or "").splitlines()
        if line.startswith("TABLE ")
    }


def _direct_tables(select: exp.Select) -> dict[str, tuple[str, str]]:
    """alias (lowercased) -> (schema, table) for the base tables this SELECT reads in FROM / JOIN."""
    source = select.args.get("from_") or select.args.get("from")
    items = ([source.this] if source is not None else []) + [
        join.this for join in select.args.get("joins") or []
    ]
    return {
        item.alias_or_name.lower(): (item.db, item.name)
        for item in items
        if isinstance(item, exp.Table) and isinstance(item.this, exp.Identifier) and item.db
    }


def _enclosing_selects(node: exp.Expression) -> Iterator[exp.Select]:
    parent = node.parent
    while parent is not None:
        if isinstance(parent, exp.Select):
            yield parent
        parent = parent.parent


def _is_order_by_alias(column: exp.Column, select: exp.Select) -> bool:
    """An unqualified ORDER BY name that refers to this SELECT's own output alias, not a table column."""
    if not isinstance(column.find_ancestor(exp.Order, exp.Select), exp.Order):
        return False
    if column.find_ancestor(exp.Select) is not select:
        return False
    aliases = {p.alias.lower() for p in select.expressions if isinstance(p, exp.Alias)}
    return column.name.lower() in aliases


def _column_tables(column: exp.Column) -> list[tuple[str, str]]:
    """The base tables a column reference can resolve to.

    Qualified (`w.col`): the table that alias names in the nearest enclosing SELECT, or nothing when
    the alias is a CTE / derived table - that body is checked on its own. Unqualified: every base
    table of every enclosing SELECT, because a correlated subquery can read an outer table's column.
    """
    selects = list(_enclosing_selects(column))
    qualifier = column.table.lower()
    if qualifier:
        for select in selects:
            target = _direct_tables(select).get(qualifier)
            if target:
                return [target]
        return []
    if selects and _is_order_by_alias(column, selects[0]):
        return []
    return [t for select in selects for t in _direct_tables(select).values()]


def access_problems(sql: str, schema_text: str) -> list[str]:
    """Reasons this query may not run, or [] when it reads only what the SCHEMA block shows."""
    visible = visible_tables(schema_text)
    if not visible:
        return ["The schema is not loaded, so the query cannot be checked - try again shortly."]
    try:
        tree = parse_single_select(sql)
    except ReadOnlyViolation as exc:
        return [str(exc)]

    problems: list[str] = []

    def add(message: str) -> None:
        if message not in problems:
            problems.append(message)

    # Writes, OPENQUERY / OPENROWSET and other databases: the shared gate's rules (db/readonly.py).
    for message in structural_problems(tree):
        add(message)

    ctes = {cte.alias.lower() for cte in tree.find_all(exp.CTE)}
    for table in tree.find_all(exp.Table):
        if table.catalog or isinstance(table.this, exp.Dot):
            continue  # another database / linked server: already reported above
        elif isinstance(table.this, exp.Func):
            name = function_name(table.this)
            if name not in SAFE_TABLE_FUNCTIONS:
                add(f"{name}(...) is not allowed as a row source.")
        elif not table.db:
            if table.name.lower() not in ctes:
                add(f"{table.name}: write every table as schema.table, exactly as in the SCHEMA block.")
        elif (
            f"{table.db}.{table.name}".lower() not in visible
            or table.db.lower() not in agent_settings.allowed_schemas
            or _is_excluded(table.db, table.name)
        ):
            add(f"{table.db}.{table.name}: not an available table - use only the schema.table "
                "names listed in the SCHEMA block.")

    for lateral in tree.find_all(exp.Lateral):
        if isinstance(lateral.this, exp.Func):
            name = function_name(lateral.this)
            if name not in SAFE_TABLE_FUNCTIONS:
                add(f"{name}(...) is not allowed in APPLY.")

    for dot in tree.find_all(exp.Dot):
        if isinstance(dot.expression, exp.Func):
            add(f"{dot.sql(dialect='tsql')}: user-defined functions are not allowed.")

    for select in tree.find_all(exp.Select):
        direct = _direct_tables(select)
        if not direct:
            continue
        for projection in select.expressions:
            if isinstance(projection, exp.Star):
                add("SELECT * from a table is not allowed - list the columns you need.")
            elif (
                isinstance(projection, exp.Column)
                and isinstance(projection.this, exp.Star)
                and projection.table.lower() in direct
            ):
                add(f"{projection.table}.* is not allowed - list the columns you need.")

    for column in tree.find_all(exp.Column):
        if isinstance(column.this, exp.Star):
            continue
        name = column.name
        for schema, table in _column_tables(column):
            if _is_secret(name) or _is_excluded_column(schema, table, name):
                add(f"{name}: this column is not available.")
                break

    return problems[:_MAX_PROBLEMS]
