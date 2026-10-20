"""Database access for the anomaly engine, on top of app.features.common.db (read-only connections, the SELECT-only
gate, the feature's table allowlist). One module so the tests can replace ``connect`` with a fake database."""
from __future__ import annotations

from contextlib import contextmanager
from typing import Any, Iterator

from app.features.anomaly import TITLE
from app.features.common import db as common_db
from app.features.common.db import DatabaseUnavailable

__all__ = ["DB_ERRORS", "DatabaseUnavailable", "connect", "connection", "guard", "error_text", "link_lost"]

try:
    import pyodbc

    DB_ERRORS: tuple[type[BaseException], ...] = (pyodbc.Error,)
except ImportError:  # pragma: no cover - the driver is a requirement; only pure helpers work without it
    DB_ERRORS = ()


def connect(timeout: int, read_uncommitted: bool = False) -> Any:
    """A fresh read-only autocommit connection to the request's database (READ UNCOMMITTED when asked: issued on the
    connection, never part of the validated SQL)."""
    return common_db.connect(timeout=timeout, read_uncommitted=read_uncommitted)


@contextmanager
def connection(timeout: int, read_uncommitted: bool = False) -> Iterator[Any]:
    conn = connect(timeout=timeout, read_uncommitted=read_uncommitted)
    try:
        yield conn
    finally:
        try:
            conn.close()
        except Exception:  # noqa: BLE001
            pass


def guard(sql: str) -> None:
    """The SELECT-only gate and the feature's table allowlist (raises ReadOnlyViolation / AccessDenied)."""
    common_db.guard(sql, TITLE)


def error_text(exc: BaseException) -> str:
    """A database error as the message the driver gave (fed back to the SQL Author, stored on a failed probe)."""
    args = getattr(exc, "args", ()) or ()
    if len(args) > 1 and isinstance(args[1], str):
        return args[1].strip()
    return str(exc).strip() or type(exc).__name__


def link_lost(exc: BaseException) -> bool:
    """The connection itself failed (the server or network dropped it), not the statement: SQLSTATE 08xxx."""
    args = getattr(exc, "args", ()) or ()
    state = str(args[0]) if args else ""
    return state.startswith("08") or "Communication link failure" in str(exc) or "forcibly closed" in str(exc)
