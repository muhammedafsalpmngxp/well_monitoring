# Ported from twise-agentic shared/twise_common/db/connection.py (team repo); see app/askdata/README.md.
"""Read-only-intent MS SQL connection via pyodbc, shared by every agent.

Merged from the four source projects. Differences they had are now parameters:

  * ``timeout``           per-call override (anomaly SUMMARY vs DETAIL scans)
  * ``read_uncommitted``  anomaly probes scan whole tables and must not block writers
  * ``readonly``          daily-report style ``ApplicationIntent=ReadOnly`` + pyodbc readonly flag
  * ``codepage``          decode non-Unicode columns with the configured ANSI code page

pyodbc is imported inside the functions that connect, so pure helpers elsewhere stay importable
in an environment without the driver.

datetimeoffset: pyodbc has no decoder for ODBC type -155, so every connection registers the
converter Microsoft's own samples document.
"""
from __future__ import annotations

import datetime
import struct
import time
from contextlib import contextmanager
from typing import Any, Iterator, Sequence

from app.askdata.settings import settings
from app.askdata.common.readonly import assert_read_only
from app.askdata.log import get_logger

log = get_logger(__name__)

_SQL_SS_TIMESTAMPOFFSET = -155
_DRIVER_CANDIDATES = [
    "ODBC Driver 18 for SQL Server",
    "ODBC Driver 17 for SQL Server",
    "SQL Server",
]


class DatabaseUnavailable(RuntimeError):
    """The database could not be reached or the query failed."""


def _decode_datetimeoffset(raw: bytes) -> datetime.datetime:
    year, month, day, hour, minute, second, frac_100ns, tz_hour, tz_minute = struct.unpack(
        "<6hI2h", raw
    )
    return datetime.datetime(
        year, month, day, hour, minute, second, frac_100ns // 1000,
        tzinfo=datetime.timezone(datetime.timedelta(hours=tz_hour, minutes=tz_minute)),
    )


def pick_driver() -> str:
    import pyodbc

    if settings.db_driver:
        return settings.db_driver
    installed = {d.strip() for d in pyodbc.drivers()}
    for cand in _DRIVER_CANDIDATES:
        if cand in installed:
            return cand
    if installed:
        return sorted(installed)[-1]
    raise RuntimeError("No ODBC driver found. Install 'ODBC Driver 18 for SQL Server' (or 17).")


def _target(config: bool) -> dict[str, Any]:
    """The business database (default) or the config database (CONFIG_DB_*, see config.py)."""
    if config:
        return {"server": settings.config_db_server, "port": settings.config_db_port,
                "name": settings.config_db_name, "user": settings.config_db_user,
                "password": settings.config_db_password, "prefix": "CONFIG_DB",
                "timeout": settings.config_db_connect_timeout}
    return {"server": settings.db_server, "port": settings.db_port, "name": settings.db_name,
            "user": settings.db_user, "password": settings.db_password, "prefix": "DB",
            "timeout": settings.db_connect_timeout}


def missing_settings(*, config: bool = False) -> list[str]:
    t = _target(config)
    return [f"{t['prefix']}_{key.upper()}" for key in ("server", "name", "user", "password") if not t[key]]


def connection_string(*, readonly_intent: bool = False, app_name: str = "", config: bool = False) -> str:
    """ODBC connection string. Never logged, never returned by the API.

    ``config=True`` connects to the config database (CONFIG_DB_*) instead of the business one.
    """
    missing = missing_settings(config=config)
    if missing:
        raise ValueError("Missing database settings in .env: " + ", ".join(missing))
    t = _target(config)
    parts = [
        f"DRIVER={{{pick_driver()}}}",
        f"SERVER={t['server']},{t['port']}",
        f"DATABASE={t['name']}",
        f"UID={t['user']}",
        f"PWD={t['password']}",
        f"Encrypt={settings.db_encrypt}",
        f"TrustServerCertificate={settings.db_trust_cert}",
        f"Connection Timeout={t['timeout']}",
    ]
    if readonly_intent:
        parts.append("ApplicationIntent=ReadOnly")
    if app_name:
        parts.append(f"APP={app_name}")
    return ";".join(parts) + ";"


def get_connection(
    timeout: int | None = None,
    read_uncommitted: bool = False,
    *,
    readonly: bool = False,
    codepage: str | None = None,
    app_name: str = "",
):
    """Open a fresh autocommit connection.

    ``timeout`` defaults to QUERY_TIMEOUT. ``read_uncommitted`` is issued as its own statement
    on the connection by this module, never as part of validated SQL, so it cannot weaken the
    SELECT-only gate. Converters are registered per connection because there is no pool.
    """
    import pyodbc

    secs = settings.query_timeout if timeout is None else timeout
    try:
        conn = pyodbc.connect(
            connection_string(readonly_intent=readonly, app_name=app_name),
            autocommit=True,
            timeout=settings.db_connect_timeout,
            readonly=readonly,
        )
    except pyodbc.Error as exc:
        sqlstate = exc.args[0] if exc.args else "unknown"
        log.error("db_connect_failed", extra={"sqlstate": sqlstate})
        raise DatabaseUnavailable(
            "Unable to connect to the Ask Data database. Check its connection settings in the Tenant API and network access."
        ) from None
    conn.timeout = secs
    conn.add_output_converter(_SQL_SS_TIMESTAMPOFFSET, _decode_datetimeoffset)
    if codepage:
        conn.setdecoding(pyodbc.SQL_CHAR, encoding=codepage)
        conn.setdecoding(pyodbc.SQL_WCHAR, encoding="utf-16le")
    if read_uncommitted:
        try:
            conn.cursor().execute("SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED")
        except Exception as exc:  # noqa: BLE001 - a courtesy setting must never block a run
            log.warning("db_read_uncommitted_failed", extra={"error": str(exc)})
    return conn


@contextmanager
def connection_scope(**kwargs) -> Iterator[Any]:
    """``with connection_scope() as conn:`` - always closed, even on error."""
    conn = get_connection(**kwargs)
    try:
        yield conn
    finally:
        try:
            conn.close()
        except Exception:  # noqa: BLE001
            pass


def fetch_all(
    sql: str,
    params: Sequence[Any] = (),
    *,
    label: str = "query",
    connection: Any | None = None,
    **conn_kwargs,
) -> list[dict[str, Any]]:
    """Run a parameterised SELECT and return rows as dictionaries.

    ``assert_read_only`` runs first. User input is never concatenated into SQL - callers bind
    ``?`` placeholders through ``params``.
    """
    import pyodbc

    assert_read_only(sql)

    def _run(conn) -> list[dict[str, Any]]:
        started = time.perf_counter()
        cursor = conn.cursor()
        try:
            cursor.execute(sql, *params)
            columns = [column[0] for column in cursor.description or []]
            rows = [dict(zip(columns, row)) for row in cursor.fetchall()]
        finally:
            cursor.close()
        log.info(
            "sql_executed",
            extra={"label": label, "ms": round((time.perf_counter() - started) * 1000, 1), "rows": len(rows)},
        )
        return rows

    try:
        if connection is not None:
            return _run(connection)
        with connection_scope(**conn_kwargs) as conn:
            return _run(conn)
    except pyodbc.Error as exc:
        sqlstate = exc.args[0] if exc.args else "unknown"
        log.error("sql_failed", extra={"label": label, "sqlstate": sqlstate})
        raise DatabaseUnavailable(f"The database query '{label}' failed (SQLSTATE {sqlstate}).") from None


def ping() -> tuple[bool, str]:
    """Health check. Returns (ok, message) and never raises."""
    try:
        with connection_scope() as conn:
            cur = conn.cursor()
            cur.execute("SELECT DB_NAME(), @@VERSION")
            row = cur.fetchone()
            return True, f"Connected to {row[0]}"
    except Exception as exc:  # noqa: BLE001 - surface any driver/network error to the caller
        return False, str(exc)


def check_connectivity() -> dict[str, Any]:
    """Verify the database answers and report the server it answered from."""
    rows = fetch_all(
        "SELECT DB_NAME() AS database_name, "
        "CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(64)) AS server_version, "
        "SYSDATETIME() AS server_time",
        label="connectivity",
    )
    return rows[0] if rows else {}
