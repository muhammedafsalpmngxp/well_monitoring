"""Which tables a feature's SQL reads, and whether the tenant allows them (Settings > AI Settings > the feature).

Verified SQL is checked before every run, so a query edited in the database, or a table an admin later withdraws,
is refused with a message that names the table instead of reading data the tenant did not allow.
"""
from __future__ import annotations

import re

from app.features.common.models import FeatureAccess


class AccessDenied(ValueError):
    """The SQL reads a table the feature may not read (message is safe to show)."""


_SCRUB = re.compile(r"'(?:[^']|'')*'|--[^\n]*|/\*.*?\*/", re.S)
_NAME = r"(?:\[[^\]]+\]|[A-Za-z_][\w$#@]*)"
# FROM / JOIN followed by a (possibly bracketed) one-, two- or three-part name
_TABLE = re.compile(rf"\b(?:from|join)\s+({_NAME}(?:\s*\.\s*{_NAME}){{0,2}})", re.I)
# CTE names: WITH name [(cols)] AS (   and   , name [(cols)] AS (
_CTE = re.compile(rf"(?:\bwith|,)\s*({_NAME})\s*(?:\([^)]*\))?\s*as\s*\(", re.I)


def _norm(name: str) -> str:
    return ".".join(part.strip().strip("[]").strip().lower() for part in name.split("."))


def referenced_tables(sql: str) -> set[str]:
    """``schema.table`` (lower case) of every table the SQL reads: sqlglot when it parses the statement, else the
    FROM / JOIN names. An unqualified name that is not a CTE counts as ``dbo.<name>``, the schema SQL Server resolves
    it to for a dbo-default login, so it is checked rather than skipped."""
    try:
        import sqlglot
        from sqlglot import exp

        tree = sqlglot.parse_one(sql, read="tsql")
        ctes = {c.alias_or_name.lower() for c in tree.find_all(exp.CTE)}
        found = set()
        for t in tree.find_all(exp.Table):
            if not t.name or (not t.db and t.name.lower() in ctes):
                continue
            if isinstance(t.this, exp.Func):   # table functions (OPENJSON, STRING_SPLIT) read no table
                continue
            schema = t.db or "dbo"
            found.add(f"{t.catalog}.{schema}.{t.name}".lower() if t.catalog else f"{schema}.{t.name}".lower())
        return found
    except Exception:  # noqa: BLE001 - T-SQL sqlglot cannot read: fall back to the keyword scan
        scrubbed = _SCRUB.sub(" ", sql)
        ctes = {_norm(m.group(1)) for m in _CTE.finditer(scrubbed)}
        found = set()
        for m in _TABLE.finditer(scrubbed):
            name = _norm(m.group(1))
            if "." not in name:
                if name in ctes:
                    continue
                name = f"dbo.{name}"
            found.add(name)
        return found


def allowed(table: str, access: FeatureAccess) -> bool:
    t = table.lower()
    if t.count(".") != 1:
        return False                       # three-part names (another database) are never allowed
    schema, name = t.split(".")
    excluded = {x.strip().lower() for x in access.excluded_tables if x.strip()}
    if t in excluded or name in excluded:
        return False
    included = {x.strip().lower() for x in access.included_tables if x.strip()}
    if included:
        return t in included
    return schema in {s.strip().lower() for s in access.allowed_schemas if s.strip()}


def check(sql: str, access: FeatureAccess, feature_title: str) -> None:
    """Raise AccessDenied when the SQL reads a table the feature may not read."""
    if not (access.included_tables or access.allowed_schemas):
        raise AccessDenied(f"{feature_title} is not set up yet: an admin chooses the tables it may read under "
                           f"Settings > AI Settings > {feature_title}.")
    refused = sorted(t for t in referenced_tables(sql) if not allowed(t, access))
    if refused:
        raise AccessDenied(f"{feature_title} may not read {', '.join(refused)}. An admin can allow "
                           f"{'it' if len(refused) == 1 else 'them'} under Settings > AI Settings > {feature_title}.")
