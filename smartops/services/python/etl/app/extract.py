"""Data extractor: pull rows from MSSQL or REST source systems with streaming support."""

import logging
import os
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Generator

from fastapi import HTTPException

from .client import ControlPlaneClient

logger = logging.getLogger("smartops.etl.extract")

# Strict pattern: only allows word characters, dots, and spaces (for multi-part names)
_SAFE_TABLE_NAME = re.compile(r'^[A-Za-z_][A-Za-z0-9_ .]{0,128}$')
_SAFE_COLUMN_NAME = re.compile(r'^\w{1,128}$')

# Parallel extraction control
PARALLEL_EXTRACT: bool = os.environ.get("ETL_PARALLEL_EXTRACT", "1").lower() in ("1", "true", "yes")
EXTRACT_WORKERS: int = int(os.environ.get("ETL_EXTRACT_WORKERS", "4"))


def _validate_table_name(name: str) -> str:
    """Validate and return a safe table identifier. Raises ValueError if unsafe."""
    if not _SAFE_TABLE_NAME.match(name):
        raise ValueError(f"Unsafe table name rejected: {name!r}")
    # Allow schema-qualified names (dbo.Table) while callers wrap result in [...]
    return name.replace(".", "].[")


def _validate_column_name(name: str) -> str:
    """Validate and return a safe column identifier. Raises ValueError if unsafe."""
    if not _SAFE_COLUMN_NAME.match(name):
        raise ValueError(f"Unsafe column name rejected: {name!r}")
    return name

try:
    import httpx
except ImportError:
    httpx = None  # type: ignore

try:
    import pyodbc
except ImportError:
    pyodbc = None  # type: ignore

WATERMARK_COLUMN: str = os.environ.get("ETL_WATERMARK_COLUMN", "modified_at")
FETCH_BATCH_SIZE: int = int(os.environ.get("ETL_FETCH_BATCH_SIZE", "2000"))
_MSSQL_CONN_PREFIXES = ("mssql://", "Server=", "Data Source=")
_REST_CONN_PREFIXES = ("https://", "http://")  # NOSONAR

# Tables known to lack the watermark column (discovered at runtime, cached per connection)
_watermark_capable_tables: dict[str, set[str]] = {}


def _get_row_limit() -> int:
    """Read ROW_LIMIT at call time (after load_dotenv has run)."""
    return int(os.environ.get("ETL_ROW_LIMIT", "1"))


def _get_ref_row_limit() -> int:
    """Read REF_ROW_LIMIT at call time (after load_dotenv has run). 0=unlimited."""
    return int(os.environ.get("ETL_REF_ROW_LIMIT", "0"))


def _get_odbc_driver() -> str:
    """Read ODBC driver name at call time (after load_dotenv has run)."""
    return os.environ.get("ETL_ODBC_DRIVER", "ODBC Driver 18 for SQL Server")


def _get_odbc_encrypt() -> str:
    """Driver 18 defaults Encrypt=yes; default to no to preserve Driver 17 behaviour."""
    return os.environ.get("ETL_ODBC_ENCRYPT", "no")

class DataExtractor:
    """
    Extracts source rows for a TenantSource.

    Supports MSSQL and REST. Uses fetchmany() for streaming extraction
    to avoid loading entire tables into memory.
    """

    def __init__(self, client: ControlPlaneClient) -> None:
        self._client = client
        self._wm_capable: set[str] | None = None  # tables that have the watermark column
        self._watermark_cache: str | None = None
        self._watermark_cached: bool = False

    def _discover_watermark_tables(
        self, conn: Any, _source_objects: list[str],
    ) -> set[str]:
        """Return the set of source tables that have the WATERMARK_COLUMN.
        Queried once per connection; cached for subsequent calls."""
        if self._wm_capable is not None:
            return self._wm_capable
        wm_col = WATERMARK_COLUMN
        try:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.COLUMNS "
                "WHERE COLUMN_NAME = ?",
                wm_col,
            )
            self._wm_capable = {row[0] for row in cursor.fetchall()}
            if self._wm_capable:
                logger.info("Watermark column '%s' found in: %s", wm_col, sorted(self._wm_capable))
            else:
                logger.warning("Watermark column '%s' not found in any source table — incremental mode will do full scan", wm_col)
        except Exception as exc:
            logger.warning("Could not discover watermark columns: %s — falling back to full scan", exc)
            self._wm_capable = set()
        return self._wm_capable

    def _discover_order_columns(
        self, conn: Any, source_objects: list[str],
    ) -> dict[str, str]:
        """Discover deterministic ORDER BY columns for paginated extraction.

        For each source table, finds the clustered index or identity column
        to ensure consistent row ordering across paginated connections.
        Returns {table_name: "order_clause"} for tables that have a deterministic key.
        Tables not in the result should fall back to single-connection extraction.
        """
        result: dict[str, str] = {}
        try:
            cursor = conn.cursor()
            # Get clustered index columns for all tables in one query
            cursor.execute(
                "SELECT OBJECT_SCHEMA_NAME(i.object_id) + '.' + OBJECT_NAME(i.object_id) AS table_name, "
                "COL_NAME(ic.object_id, ic.column_id) AS col_name, ic.key_ordinal "
                "FROM sys.indexes i "
                "JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id "
                "WHERE i.type_desc = 'CLUSTERED' "
                "ORDER BY table_name, ic.key_ordinal"
            )
            clustered: dict[str, list[str]] = {}
            for row in cursor.fetchall():
                clustered.setdefault(row[0], []).append(row[1])

            # Get identity columns as fallback
            cursor.execute(
                "SELECT OBJECT_SCHEMA_NAME(object_id) + '.' + OBJECT_NAME(object_id), COL_NAME(object_id, column_id) "
                "FROM sys.identity_columns"
            )
            identity_cols: dict[str, str] = {row[0]: row[1] for row in cursor.fetchall()}

            for table in source_objects:
                if table in clustered:
                    cols = clustered[table]
                    safe_cols = ", ".join(f"[{_validate_column_name(c)}]" for c in cols)
                    result[table] = safe_cols
                elif table in identity_cols:
                    safe_col = _validate_column_name(identity_cols[table])
                    result[table] = f"[{safe_col}]"
                # else: table has no deterministic order → not in result

            if result:
                logger.debug("Order columns discovered: %s", result)
        except Exception as exc:
            logger.warning("Could not discover order columns: %s — pagination will use (SELECT NULL)", exc)
        return result

    def extract(
        self,
        tenant_source: dict,
        mappings: list[dict],
        full_refresh: bool,
        ref_sources: set[str] | None = None,
    ) -> list[dict]:
        """Route to MSSQL or REST based on connectionRef prefix.

        Args:
            ref_sources: source objects that feed ref-layer tables.
                         These are extracted fully (no ROW_LIMIT).
        """
        conn_ref       = tenant_source.get("connectionRef", "")
        source_objects = list({m.get("sourceObject") for m in mappings if m.get("sourceObject")})
        self._watermark_cached = False  # Fresh watermark each run

        if not source_objects:
            logger.warning("No source objects in mappings — nothing to extract")
            return []

        # Order: ref-feeding sources first, then core sources
        if ref_sources:
            source_objects.sort(key=lambda s: (0 if s in ref_sources else 1, s))

        logger.debug("Extracting %s (full_refresh=%s, ref_sources=%s)", source_objects, full_refresh, ref_sources)

        if conn_ref.startswith(_MSSQL_CONN_PREFIXES):
            return self._mssql(conn_ref, source_objects, full_refresh, ref_sources)
        if conn_ref.startswith(_REST_CONN_PREFIXES):
            return self._rest(conn_ref, source_objects)

        conn_str = os.environ.get(f"SOURCE_{conn_ref}", conn_ref)
        if conn_str and pyodbc:
            return self._mssql(conn_str, source_objects, full_refresh, ref_sources)
        raise ValueError(f"Unsupported connectionRef: {conn_ref[:40]!r}")

    def extract_streaming(
        self,
        tenant_source: dict,
        mappings: list[dict],
        full_refresh: bool,
        ref_sources: set[str] | None = None,
    ) -> Generator[list[dict], None, None]:
        """Yield batches of rows for memory-efficient processing of large tables."""
        conn_ref       = tenant_source.get("connectionRef", "")
        source_objects = list({m.get("sourceObject") for m in mappings if m.get("sourceObject")})
        self._watermark_cached = False  # Fresh watermark each run

        if not source_objects:
            return

        if ref_sources:
            source_objects.sort(key=lambda s: (0 if s in ref_sources else 1, s))

        # Build column whitelist per source table (only extract mapped columns)
        # This reduces data transfer by 50-70% for wide tables like WMR (180→60 cols)
        source_columns: dict[str, list[str]] = {}
        for m in mappings:
            src_obj = m.get("sourceObject")
            src_field = m.get("sourceField")
            if src_obj and src_field:
                source_columns.setdefault(src_obj, []).append(src_field)
        # Deduplicate column lists
        source_columns = {k: sorted(set(v)) for k, v in source_columns.items()}

        if conn_ref.startswith(_MSSQL_CONN_PREFIXES):
            yield from self._mssql_streaming_parallel(conn_ref, source_objects, full_refresh, ref_sources, source_columns)
        elif conn_ref.startswith(_REST_CONN_PREFIXES):
            yield self._rest(conn_ref, source_objects)
        else:
            conn_str = os.environ.get(f"SOURCE_{conn_ref}", conn_ref)
            if conn_str and pyodbc:
                yield from self._mssql_streaming_parallel(conn_str, source_objects, full_refresh, ref_sources, source_columns)
            else:
                raise ValueError(f"Unsupported connectionRef: {conn_ref[:40]!r}")

    def _mssql(
        self,
        conn_str: str,
        source_objects: list[str],
        full_refresh: bool,
        ref_sources: set[str] | None = None,
    ) -> list[dict]:
        """Extract via pyodbc using fetchmany for bounded memory.

        When PARALLEL_EXTRACT is enabled and there are multiple source tables,
        extracts tables concurrently using ThreadPoolExecutor (each thread gets
        its own pyodbc connection — thread-safe).
        """
        if pyodbc is None:
            raise HTTPException(503, "pyodbc not installed")

        # Parallel extraction: each table on its own connection/thread
        if PARALLEL_EXTRACT and len(source_objects) > 1:
            return self._mssql_parallel(conn_str, source_objects, full_refresh, ref_sources)

        all_rows: list[dict] = []
        for batch in self._mssql_streaming(conn_str, source_objects, full_refresh, ref_sources):
            all_rows.extend(batch)
        return all_rows

    def _extract_single_table(
        self,
        table: str,
        norm_str: str,
        full_refresh: bool,
        watermark: str | None,
        wm_tables: set[str],
        ref_sources: set[str] | None,
    ) -> list[dict]:
        """Extract a single table on its own connection (used by parallel extractor)."""
        safe = _validate_table_name(table)
        is_ref = ref_sources and table in ref_sources
        row_limit = _get_ref_row_limit() if is_ref else _get_row_limit()
        top_clause = f"TOP {row_limit}" if row_limit > 0 else ""

        table_rows: list[dict] = []
        conn = pyodbc.connect(norm_str, timeout=120)
        conn.timeout = 300
        try:
            cursor = conn.cursor()
            use_watermark = (not full_refresh and watermark and table in wm_tables)
            if use_watermark:
                wm_col = _validate_column_name(WATERMARK_COLUMN)
                cursor.execute(
                    f"SELECT {top_clause} * FROM [{safe}] WHERE [{wm_col}] > ?",
                    watermark,
                )
            else:
                cursor.execute(f"SELECT {top_clause} * FROM [{safe}]")

            cols = [c[0] for c in cursor.description]
            while True:
                rows = cursor.fetchmany(FETCH_BATCH_SIZE)
                if not rows:
                    break
                batch = [{**dict(zip(cols, r)), "_source_object": table} for r in rows]
                table_rows.extend(batch)
        finally:
            conn.close()
        logger.debug("[%s]: extracted %d rows (parallel)", safe, len(table_rows))
        return table_rows

    def _mssql_parallel(
        self,
        conn_str: str,
        source_objects: list[str],
        full_refresh: bool,
        ref_sources: set[str] | None = None,
    ) -> list[dict]:
        """Extract multiple tables concurrently using ThreadPoolExecutor.

        Each table gets its own connection and thread. Results are merged
        preserving ref-first ordering.
        """
        norm_str = self.norm_conn(conn_str)
        watermark: str | None = None
        if not full_refresh:
            watermark = self._last_watermark()
            logger.info("Incremental watermark: %s", watermark or "none — full scan")

        workers = min(EXTRACT_WORKERS, len(source_objects))
        logger.info("Parallel extraction: %d tables with %d workers", len(source_objects), workers)

        # Pre-discover watermark-capable tables
        wm_tables = self._wm_capable or set()
        if not full_refresh and watermark and self._wm_capable is None:
            try:
                _probe = pyodbc.connect(norm_str, timeout=30)
                wm_tables = self._discover_watermark_tables(_probe, source_objects)
                _probe.close()
            except Exception:
                wm_tables = set()

        all_rows: list[dict] = []
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {
                pool.submit(
                    self._extract_single_table, t, norm_str, full_refresh, watermark, wm_tables, ref_sources,
                ): t
                for t in source_objects
            }
            for future in as_completed(futures):
                table = futures[future]
                try:
                    table_rows = future.result()
                    all_rows.extend(table_rows)
                except Exception as exc:
                    logger.exception("Parallel extraction failed for %s: %s", table, exc)
                    raise

        return all_rows

    def _mssql_streaming_parallel(
        self,
        conn_str: str,
        source_objects: list[str],
        full_refresh: bool,
        ref_sources: set[str] | None = None,
        source_columns: dict[str, list[str]] | None = None,
    ) -> Generator[list[dict], None, None]:
        """Extract multiple source tables concurrently using threads.

        Each table is extracted on its own thread/connection. Batches are
        collected via a queue and yielded as they arrive. This reduces total
        extraction time from sum(table_times) to max(table_times).
        """
        from concurrent.futures import ThreadPoolExecutor, as_completed
        import queue

        if len(source_objects) <= 1:
            yield from self._mssql_streaming(conn_str, source_objects, full_refresh, ref_sources, source_columns)
            return

        # Extract each table in its own thread, collecting all batches
        def _extract_table(table: str) -> list[list[dict]]:
            batches: list[list[dict]] = []
            for batch in self._mssql_streaming(conn_str, [table], full_refresh, ref_sources, source_columns):
                batches.append(batch)
            return batches

        all_batches: list[list[dict]] = []
        with ThreadPoolExecutor(max_workers=min(len(source_objects), 4)) as executor:
            futures = {executor.submit(_extract_table, table): table for table in source_objects}
            for future in as_completed(futures):
                table = futures[future]
                try:
                    batches = future.result()
                    all_batches.extend(batches)
                except Exception as exc:
                    logger.exception("Parallel extraction failed for %s: %s", table, str(exc)[:120])
                    raise

        # Yield collected batches
        for batch in all_batches:
            yield batch

    @staticmethod
    def _build_safe_col_list(source_columns: dict[str, list[str]] | None, table: str) -> str:
        """Build a bracketed column list from mapped columns, or '*' as fallback."""
        if not source_columns or table not in source_columns:
            return "*"
        safe_cols = []
        for c in source_columns[table]:
            if c and "'" not in c and ";" not in c and "--" not in c and "]" not in c and len(c) <= 128:
                safe_cols.append(f"[{c}]")
        return ", ".join(safe_cols) if safe_cols else "*"

    def _execute_page_query(
        self, page_cursor: Any, safe: str, col_list: str, order_clause: str,
        offset: int, page_size: int, use_watermark: bool, watermark: str | None,
    ) -> None:
        """Execute the paginated SELECT query on the given cursor."""
        if use_watermark:
            wm_col = _validate_column_name(WATERMARK_COLUMN)
            page_cursor.execute(
                f"SELECT {col_list} FROM [{safe}] "
                f"WHERE [{wm_col}] > ? "
                f"ORDER BY {order_clause} OFFSET {offset} ROWS FETCH NEXT {page_size} ROWS ONLY",
                watermark,
            )
        else:
            page_cursor.execute(
                f"SELECT {col_list} FROM [{safe}] "
                f"ORDER BY {order_clause} OFFSET {offset} ROWS FETCH NEXT {page_size} ROWS ONLY"
            )

    def _extract_paginated(
        self,
        conn_str: str,
        table: str,
        safe: str,
        col_list: str,
        order_clause: str,
        use_watermark: bool,
        watermark: str | None,
        total_rows: int,
    ) -> Generator[list[dict], None, None]:
        """Paginated extraction for large tables — each page gets a fresh connection."""
        _PAGE_SIZE = 5000
        _MAX_PAGE_RETRIES = 3
        logger.info("[%s]: paginated extract (%d rows, %d pages, order=%s)",
                    safe, total_rows, (total_rows + _PAGE_SIZE - 1) // _PAGE_SIZE, order_clause)
        offset = 0
        while offset < total_rows:
            yield from self._extract_single_page(
                conn_str, table, safe, col_list, order_clause, offset, _PAGE_SIZE,
                use_watermark, watermark, _MAX_PAGE_RETRIES,
            )
            offset += _PAGE_SIZE

    @staticmethod
    def _is_tcp_drop(exc: Exception) -> bool:
        """Check if an exception indicates a TCP connection drop."""
        s = str(exc)[:120]
        return "Communication link" in s or "08S01" in s

    def _extract_single_page(
        self,
        conn_str: str,
        table: str,
        safe: str,
        col_list: str,
        order_clause: str,
        offset: int,
        page_size: int,
        use_watermark: bool,
        watermark: str | None,
        max_retries: int,
    ) -> Generator[list[dict], None, None]:
        """Extract one page with retry on TCP drop."""
        for _attempt in range(max_retries):
            page_conn = pyodbc.connect(conn_str, timeout=120)
            page_conn.timeout = 120
            try:
                page_cursor = page_conn.cursor()
                self._execute_page_query(
                    page_cursor, safe, col_list, order_clause, offset, page_size, use_watermark, watermark,
                )
                yield from self._yield_cursor_batches(page_cursor, table)
                return
            except Exception as page_exc:
                if not self._is_tcp_drop(page_exc):
                    raise
                logger.warning("[%s] page %d TCP drop (attempt %d/%d) — retrying",
                               safe, offset // page_size + 1, _attempt + 1, max_retries)
                if _attempt == max_retries - 1:
                    raise
            finally:
                try:
                    page_conn.close()
                except Exception:
                    pass

    @staticmethod
    def _yield_cursor_batches(cursor: Any, table: str) -> Generator[list[dict], None, None]:
        """Yield row batches from an open cursor."""
        cols = [c[0] for c in cursor.description]
        while True:
            rows = cursor.fetchmany(FETCH_BATCH_SIZE)
            if not rows:
                break
            yield [{**dict(zip(cols, r)), "_source_object": table} for r in rows]

    def _extract_standard(
        self,
        conn_str: str,
        table: str,
        safe: str,
        col_list: str,
        top_clause: str,
        use_watermark: bool,
        watermark: str | None,
    ) -> Generator[list[dict], None, None]:
        """Standard extraction for small tables — single connection."""
        conn = pyodbc.connect(conn_str, timeout=120)
        conn.timeout = 300
        try:
            cursor = conn.cursor()
            if use_watermark:
                wm_col = _validate_column_name(WATERMARK_COLUMN)
                cursor.execute(
                    f"SELECT {top_clause} {col_list} FROM [{safe}] WHERE [{wm_col}] > ?",
                    watermark,
                )
            else:
                cursor.execute(f"SELECT {top_clause} {col_list} FROM [{safe}]")

            cols = [c[0] for c in cursor.description]
            while True:
                rows = cursor.fetchmany(FETCH_BATCH_SIZE)
                if not rows:
                    break
                batch = [{**dict(zip(cols, r)), "_source_object": table} for r in rows]
                logger.debug("[%s]: yielding batch of %d rows", safe, len(batch))
                yield batch
        finally:
            conn.close()

    def _mssql_streaming(
        self,
        conn_str: str,
        source_objects: list[str],
        full_refresh: bool,
        ref_sources: set[str] | None = None,
        source_columns: dict[str, list[str]] | None = None,
    ) -> Generator[list[dict], None, None]:
        """Extract via pyodbc yielding batches of FETCH_BATCH_SIZE rows.

        Ref-feeding sources are extracted fully (no ROW_LIMIT) since they are
        small lookup tables that must be complete for FK resolution.

        When source_columns is provided, only those columns are extracted
        (instead of SELECT *). This reduces data transfer by 50-70% for wide tables.
        """
        if pyodbc is None:
            raise HTTPException(503, "pyodbc not installed")

        conn_str  = self.norm_conn(conn_str)
        watermark: str | None = None

        if not full_refresh:
            watermark = self._last_watermark()
            logger.info("Incremental watermark: %s", watermark or "none — full scan")

        # Discover watermark tables and order columns using a short-lived connection
        _probe = pyodbc.connect(conn_str, timeout=120)
        wm_tables = self._discover_watermark_tables(_probe, source_objects)
        _order_columns = self._discover_order_columns(_probe, source_objects)
        _probe.close()

        # Extract each table with its own connection (prevents TCP drops on long transfers)
        for table in source_objects:
            yield from self._streaming_extract_table(
                conn_str, table, full_refresh, watermark, wm_tables, _order_columns,
                ref_sources, source_columns,
            )

    def _streaming_extract_table(
        self,
        conn_str: str,
        table: str,
        full_refresh: bool,
        watermark: str | None,
        wm_tables: set[str],
        order_columns: dict[str, str],
        ref_sources: set[str] | None,
        source_columns: dict[str, list[str]] | None,
    ) -> Generator[list[dict], None, None]:
        """Extract a single table via streaming (paginated or standard)."""
        safe = _validate_table_name(table)
        is_ref = ref_sources and table in ref_sources
        row_limit = _get_ref_row_limit() if is_ref else _get_row_limit()
        top_clause = f"TOP {row_limit}" if row_limit > 0 else ""
        use_watermark = (not full_refresh and watermark and table in wm_tables)

        col_list = self._build_safe_col_list(source_columns, table)

        conn = pyodbc.connect(conn_str, timeout=120)
        conn.timeout = 300
        try:
            cursor = conn.cursor()
            if col_list != "*":
                try:
                    cursor.execute(f"SELECT TOP 0 {col_list} FROM [{safe}]")
                except Exception:
                    col_list = "*"
                    logger.debug("[%s]: mapped column check failed, using SELECT *", safe)
            cursor.execute(f"SELECT COUNT(*) FROM [{safe}]")
            total_rows = cursor.fetchone()[0]
        finally:
            conn.close()

        _PAGE_SIZE = 5000
        order_clause = order_columns.get(table, "(SELECT NULL)")
        if total_rows > _PAGE_SIZE and row_limit == 0:
            yield from self._extract_paginated(
                conn_str, table, safe, col_list, order_clause, use_watermark, watermark, total_rows,
            )
        else:
            yield from self._extract_standard(
                conn_str, table, safe, col_list, top_clause, use_watermark, watermark,
            )

    def _rest(self, base_url: str, source_objects: list[str]) -> list[dict]:
        """Fetch JSON from REST endpoints."""
        if httpx is None:
            raise HTTPException(503, "httpx not installed")

        all_rows: list[dict] = []
        with httpx.Client(base_url=base_url, timeout=60.0) as client:
            for endpoint in source_objects:
                r = client.get(f"/{endpoint.lstrip('/')}")
                if r.status_code != 200:
                    logger.warning("/%s returned %d — skipping", endpoint, r.status_code)
                    continue
                data = r.json()
                rows = data if isinstance(data, list) else data.get("value", [])
                for row in rows:
                    row["_source_object"] = endpoint
                all_rows.extend(rows)
                logger.debug("/%s: %d records", endpoint, len(rows))

        return all_rows

    def _last_watermark(self) -> str | None:
        """Return finishedAt of the most recent Completed run, or None.

        Cached for the lifetime of this extractor instance to avoid re-scanning
        all ingestion runs on every table extraction (important for parallel mode).
        """
        if self._watermark_cached:
            return self._watermark_cache
        runs = [
            r for r in self._client.get_ingestion_runs()
            if r.get("status") == "Completed" and r.get("finishedAt")
        ]
        self._watermark_cache = max(runs, key=lambda r: r["finishedAt"])["finishedAt"] if runs else None
        self._watermark_cached = True
        return self._watermark_cache

    @staticmethod
    def norm_conn(conn_str: str) -> str:
        """Convert ADO.NET connection string to pyodbc ODBC format if needed."""
        if conn_str.startswith(("DRIVER=", "Server=")):
            return conn_str
        parts: dict[str, str] = {}
        for seg in conn_str.split(";"):
            if "=" in seg.strip():
                k, _, v = seg.strip().partition("=")
                parts[k.strip().lower()] = v.strip()
        server = parts.get("data source", parts.get("server", ""))
        if not server:
            return conn_str
        odbc = [f"DRIVER={{{_get_odbc_driver()}}}", f"SERVER={server}"]
        if db  := parts.get("initial catalog",    parts.get("database", "")):  odbc.append(f"DATABASE={db}")
        if uid := parts.get("user id",            parts.get("uid", "")):        odbc.append(f"UID={uid}")
        if pwd := parts.get("password",           parts.get("pwd", "")):        odbc.append(f"PWD={pwd}")
        if parts.get("trust server certificate",  parts.get("trustservercertificate", "")).lower() in ("true", "yes", "1"):
            odbc.append("TrustServerCertificate=Yes")
        odbc.append(f"Encrypt={_get_odbc_encrypt()}")
        # Keep TCP alive during large data transfers (prevents remote DB connection drops)
        odbc.append("Connection Timeout=120")
        return ";".join(odbc)
