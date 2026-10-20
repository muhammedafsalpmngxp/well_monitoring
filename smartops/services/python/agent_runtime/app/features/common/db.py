"""Read-only SQL Server access for the Agentic Features, on the database the Tenant API sends with each request.

Every statement passes the SELECT-only gate (askdata.common.readonly) and the feature's table allowlist (access.py)
before it runs; connections use ApplicationIntent=ReadOnly and pyodbc's readonly flag. Nothing is pooled or kept.
"""
from __future__ import annotations

import datetime
import decimal
import math
import time
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any, Iterator, Sequence

from app.askdata.common.connection import _DRIVER_CANDIDATES, _SQL_SS_TIMESTAMPOFFSET, _decode_datetimeoffset
from app.askdata.common.readonly import assert_read_only
from app import trace
from app.features.common import access
from app.features.common.context import current
from app.models import Db


class DatabaseUnavailable(RuntimeError):
    """The database could not be reached, or a query failed (message is safe to show)."""


@dataclass
class QueryResult:
    columns: list[str]
    rows: list[dict[str, Any]]
    truncated: bool = False


def pick_driver() -> str:
    """The best SQL Server ODBC driver installed. (Ask Data's pick_driver reads an Ask Data run's settings, which a
    feature request does not have.)"""
    import pyodbc

    installed = {d.strip() for d in pyodbc.drivers()}
    for candidate in _DRIVER_CANDIDATES:
        if candidate in installed:
            return candidate
    sql_server = sorted(d for d in installed if "SQL Server" in d)
    if sql_server:
        return sql_server[-1]
    raise DatabaseUnavailable("No SQL Server ODBC driver is installed on the agent service.")


def connection_string(db: Db, app_name: str) -> str:
    return ";".join([
        f"DRIVER={{{pick_driver()}}}", f"SERVER={db.server},{db.port}", f"DATABASE={db.name}", f"UID={db.user}",
        f"PWD={db.password}", f"Encrypt={db.encrypt}", f"TrustServerCertificate={db.trust_cert}", "Connection Timeout=15",
        "ApplicationIntent=ReadOnly", f"APP={app_name}",
    ]) + ";"


def connect(db: Db | None = None, *, timeout: int = 60, read_uncommitted: bool = False, codepage: str | None = None):
    """A fresh autocommit, read-only connection (``db`` defaults to the current request's)."""
    import pyodbc

    run = current()
    target = db or run.request.db
    try:
        conn = pyodbc.connect(connection_string(target, f"AgentRuntime-{run.feature}"), autocommit=True, timeout=15,
                              readonly=True)
    except pyodbc.Error:
        raise DatabaseUnavailable("The database could not be reached. Check the Ask Data database connection "
                                  "of the Tenant API and network access.") from None
    conn.timeout = timeout
    conn.add_output_converter(_SQL_SS_TIMESTAMPOFFSET, _decode_datetimeoffset)
    if codepage:
        conn.setdecoding(pyodbc.SQL_CHAR, encoding=codepage)
        conn.setdecoding(pyodbc.SQL_WCHAR, encoding="utf-16le")
    if read_uncommitted:
        try:
            conn.cursor().execute("SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED")
        except pyodbc.Error:
            pass                                   # a courtesy setting never blocks a run
    return conn


@contextmanager
def connection(**kwargs) -> Iterator[Any]:
    conn = connect(**kwargs)
    try:
        yield conn
    finally:
        try:
            conn.close()
        except Exception:  # noqa: BLE001
            pass


def guard(sql: str, feature_title: str) -> None:
    """The SELECT-only gate and the feature's table allowlist (raises ReadOnlyViolation / access.AccessDenied)."""
    assert_read_only(sql)
    access.check(sql, current().request.access, feature_title)


def query(sql: str, params: Sequence[Any] = (), *, feature_title: str, label: str = "query",
          max_rows: int | None = None, timeout: int = 60, conn: Any | None = None, **conn_kwargs) -> QueryResult:
    """Run one guarded SELECT with bound ``?`` parameters. ``max_rows`` caps what is fetched (truncated=True)."""
    import pyodbc

    guard(sql, feature_title)

    def run(c) -> QueryResult:
        cur = c.cursor()
        try:
            cur.execute(sql, *params)
            cols = [d[0] for d in cur.description or []]
            raw = cur.fetchmany(max_rows + 1) if max_rows else cur.fetchall()
        finally:
            cur.close()
        truncated = bool(max_rows) and len(raw) > max_rows
        rows = [dict(zip(cols, r)) for r in (raw[:max_rows] if truncated else raw)]
        return QueryResult(cols, rows, truncated)

    started = time.perf_counter()
    who = f"{current().feature}.{label}"
    try:
        if conn is not None:
            result = run(conn)
        else:
            with connection(timeout=timeout, **conn_kwargs) as c:
                result = run(c)
        trace.sql(who, len(result.rows), time.perf_counter() - started, sql, truncated=result.truncated)
        return result
    except pyodbc.Error as exc:
        trace.sql(who, None, time.perf_counter() - started, sql, error=exc)
        message = str(exc.args[1] if len(exc.args) > 1 else exc)
        hint = (" The database structure has probably changed since this query was verified."
                if "invalid column" in message.lower() or "invalid object" in message.lower() else "")
        raise DatabaseUnavailable(f"The query '{label}' failed.{hint}") from None


def jsonable(value: Any, *, decimals_as: str = "float") -> Any:
    """A database value as JSON: dates as ISO text, Decimal as float (or exact text with decimals_as='str'),
    NaN/inf as null, bytes as text."""
    if isinstance(value, (datetime.datetime, datetime.date, datetime.time)):
        return value.isoformat()
    if isinstance(value, decimal.Decimal):
        if not value.is_finite():
            return None
        return format(value, "f") if decimals_as == "str" else float(value)
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, (bytes, bytearray)):
        try:
            return bytes(value).decode("utf-8")
        except UnicodeDecodeError:
            return bytes(value).hex()
    return value


def jsonable_rows(rows: list[dict[str, Any]], **kwargs) -> list[dict[str, Any]]:
    return [{k: jsonable(v, **kwargs) for k, v in r.items()} for r in rows]
