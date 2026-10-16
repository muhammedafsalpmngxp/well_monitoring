"""
SmartOps ETL Service — Modular entry point.

Endpoints:
  POST /validate/{id}      Pre-flight config validation
  POST /run                Trigger an ETL run for a tenant-source
  POST /run/all            Trigger ETL for all active tenant-sources
  GET  /runs               List recent ingestion runs
  GET  /runs/{id}          Get a single run's status
  GET  /mappings-preview/{id}  HTML (or JSON) preview of field mappings
  GET  /health             Service health (provided by shared factory)
"""
import os
import sys
import logging
import logging.handlers
from datetime import datetime, timezone
from pathlib import Path

# Load .env before any os.environ reads
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

def _resolve_shared_python() -> str | None:
    """Locate smartops shared/python across container and source-checkout layouts."""
    candidates: list[Path] = []
    if override := os.environ.get("SMARTOPS_SHARED_PYTHON"):
        candidates.append(Path(override))
    candidates.append(Path("/shared/python"))
    candidates.extend(p / "shared" / "python" for p in Path(__file__).resolve().parents)
    for candidate in candidates:
        if (candidate / "smartops_shared").is_dir():
            return str(candidate)
    return None


if (_shared_python := _resolve_shared_python()) and _shared_python not in sys.path:
    sys.path.insert(0, _shared_python)

# ── Configuration ──────────────────────────────────────────────────────────────
LOG_DIR   = Path(os.environ.get("ETL_LOG_DIR", Path(__file__).resolve().parents[1] / "logs"))
LOG_DIR.mkdir(parents=True, exist_ok=True)
LOG_LEVEL = os.environ.get("ETL_LOG_LEVEL", "INFO").upper()

CONTROL_PLANE_URL = os.environ.get("CONTROL_PLANE_URL", "http://localhost:7007")
INTERNAL_API_KEY  = os.environ.get("ETL_INTERNAL_API_KEY", "")
ETL_ENVIRONMENT   = os.environ.get("ETL_ENVIRONMENT", "development").lower()

# ── Logging ────────────────────────────────────────────────────────────────────
class _ETLFormatter(logging.Formatter):
    """Structured formatter: timestamps, level, module shortname, message."""
    _MODULE_SHORT = {
        "smartops.etl":             "core",
        "smartops.etl.engine":      "engine",
        "smartops.etl.extract":     "extract",
        "smartops.etl.transform":   "transform",
        "smartops.etl.load":        "load",
        "smartops.etl.dead_letter": "dead-letter",
        "smartops.etl.schema":      "schema",
    }

    def format(self, record: logging.LogRecord) -> str:
        module = self._MODULE_SHORT.get(record.name, record.name.rsplit(".", 1)[-1])
        ts     = self.formatTime(record, self.datefmt)
        lvl    = record.levelname
        msg    = record.getMessage()
        base   = f"{ts} [{lvl:<7s}] [{module:<10s}] {msg}"
        if record.exc_info and not record.exc_text:
            record.exc_text = self.formatException(record.exc_info)
        if record.exc_text:
            base += "\n" + record.exc_text
        return base

_formatter = _ETLFormatter(datefmt="%Y-%m-%d %H:%M:%S")
_console = logging.StreamHandler(sys.stdout)
_console.setFormatter(_formatter)

_log_filename = LOG_DIR / f"etl_{datetime.now(timezone.utc).strftime('%Y-%m-%d')}.log"
_file_handler = logging.handlers.RotatingFileHandler(
    _log_filename, maxBytes=5 * 1024 * 1024, backupCount=10, encoding="utf-8",
)
_file_handler.setFormatter(_formatter)

logger = logging.getLogger("smartops.etl")
logger.setLevel(LOG_LEVEL)
logger.addHandler(_console)
logger.addHandler(_file_handler)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("uvicorn.access").setLevel(logging.WARNING)

# ── Imports (after logging configured) ─────────────────────────────────────────
from fastapi import Depends, Header, HTTPException, Query
from fastapi.responses import HTMLResponse

from smartops_shared.app import create_app

from .client import ControlPlaneClient
from .engine import ETLEngine
from .models import (
    PreflightIssue,
    PreflightResponse,
    RunAllRequest,
    RunRequest,
    RunResponse,
    RunStatusResponse,
)

# ── Enable ODBC connection pooling ─────────────────────────────────────────────
try:
    import pyodbc
    pyodbc.pooling = True
except ImportError:
    pass

# ── App factory ────────────────────────────────────────────────────────────────
app = create_app(
    title="SmartOps · ETL Pipeline Service",
    service_name="etl",
)

# ── Lifecycle: manage HTTP client ──────────────────────────────────────────────
cp_client: ControlPlaneClient | None = None
engine: ETLEngine | None = None


@app.on_event("startup")
def _startup() -> None:
    global cp_client, engine
    if ETL_ENVIRONMENT != "development" and not INTERNAL_API_KEY:
        logger.critical("ETL_INTERNAL_API_KEY is required in non-development environments")
        raise RuntimeError("ETL_INTERNAL_API_KEY must be set for environment=%s" % ETL_ENVIRONMENT)
    if not INTERNAL_API_KEY:
        logger.warning("ETL_INTERNAL_API_KEY not set — API authentication DISABLED (dev mode)")
    cp_client = ControlPlaneClient(CONTROL_PLANE_URL, api_key=INTERNAL_API_KEY or None)
    engine = ETLEngine(cp_client)
    logger.info("ETL service started — control_plane=%s env=%s", CONTROL_PLANE_URL, ETL_ENVIRONMENT)


@app.on_event("shutdown")
def _shutdown() -> None:
    if cp_client:
        cp_client.close()
    logger.info("ETL service shutting down")


# ── Auth dependency ────────────────────────────────────────────────────────────
def verify_api_key(x_api_key: str = Header(default="")) -> None:
    """Validate internal API key if configured. Skipped in dev (no key set)."""
    if INTERNAL_API_KEY and x_api_key != INTERNAL_API_KEY:
        raise HTTPException(401, "Invalid or missing X-Api-Key")


# ── Endpoints ──────────────────────────────────────────────────────────────────

@app.post("/validate/{tenant_source_id}", tags=["ETL"], dependencies=[Depends(verify_api_key)])
def validate_config(tenant_source_id: int) -> PreflightResponse:
    """Validate mapping configuration WITHOUT running ETL."""
    logger.info("Preflight validation requested for tenant_source=%d", tenant_source_id)
    issues = engine.preflight_check(tenant_source_id)
    errors   = sum(1 for i in issues if i["level"] == "error")
    warnings = sum(1 for i in issues if i["level"] == "warning")
    if errors:
        logger.warning("Preflight FAILED for tenant_source=%d — %d error(s), %d warning(s)", tenant_source_id, errors, warnings)
    else:
        logger.info("Preflight PASSED for tenant_source=%d — %d warning(s)", tenant_source_id, warnings)
    return PreflightResponse(
        tenant_source_id=tenant_source_id,
        passed=errors == 0,
        errors=errors,
        warnings=warnings,
        issues=[PreflightIssue(**i) for i in issues],
    )


@app.post("/run", tags=["ETL"], dependencies=[Depends(verify_api_key)])
def trigger_run(request: RunRequest) -> RunResponse:
    """Trigger ETL for a single tenant-source."""
    return engine.execute_run(request.tenant_source_id, request.full_refresh)


@app.post("/run/all", tags=["ETL"], dependencies=[Depends(verify_api_key)])
def trigger_run_all(request: RunAllRequest) -> list[RunResponse]:
    """Trigger ETL for all active tenant-sources (sequential)."""
    sources = [ts for ts in cp_client.get_tenant_sources() if ts.get("tenantSourceId")]
    logger.info("Run-all requested: %d active tenant-source(s), full_refresh=%s", len(sources), request.full_refresh)
    results = [engine.execute_run(ts["tenantSourceId"], request.full_refresh) for ts in sources]
    succeeded = sum(1 for r in results if r.status == "Completed")
    logger.info("Run-all finished: %d/%d succeeded", succeeded, len(results))
    return results


@app.get("/runs", tags=["Status"], dependencies=[Depends(verify_api_key)])
def list_runs(
    limit: int = Query(50, ge=1, le=500, description="Max runs to return"),
    offset: int = Query(0, ge=0, description="Number of runs to skip"),
) -> list[RunStatusResponse]:
    """List recent ingestion runs (paginated, newest first)."""
    all_runs = cp_client.get_ingestion_runs()
    all_runs.sort(key=lambda r: r.get("startedAt", ""), reverse=True)
    page = all_runs[offset:offset + limit]
    return [
        RunStatusResponse(
            ingestion_run_id=r.get("ingestionRunId", 0),
            tenant_source_id=r.get("tenantSourceId", 0),
            started_at=r.get("startedAt"),
            finished_at=r.get("finishedAt"),
            status=r.get("status"),
            rows_extracted=r.get("rowsExtracted"),
            rows_loaded=r.get("rowsLoaded"),
            error_count=r.get("errorCount"),
        )
        for r in page
    ]


@app.get("/runs/{run_id}", tags=["Status"], dependencies=[Depends(verify_api_key)])
def get_run(run_id: int) -> RunStatusResponse:
    """Get status of a specific ingestion run."""
    r = cp_client.get_ingestion_run(run_id)
    if r is None:
        logger.warning("Run id=%d not found (404)", run_id)
        raise HTTPException(404, f"Run {run_id} not found")
    return RunStatusResponse(
        ingestion_run_id=r.get("ingestionRunId", 0),
        tenant_source_id=r.get("tenantSourceId", 0),
        started_at=r.get("startedAt"),
        finished_at=r.get("finishedAt"),
        status=r.get("status"),
        rows_extracted=r.get("rowsExtracted"),
        rows_loaded=r.get("rowsLoaded"),
        error_count=r.get("errorCount"),
    )


@app.get(
    "/mappings-preview/{tenant_source_id}",
    tags=["ETL"],
    dependencies=[Depends(verify_api_key)],
    response_class=HTMLResponse,
    responses={200: {"content": {"text/html": {}, "application/json": {}}}},
)
def mappings_preview(tenant_source_id: int, format: str = Query("html")) -> HTMLResponse:
    """Preview field mappings as an HTML table. Use ?format=json for JSON output.

    Open the request URL directly in your browser to see the rendered table.
    """
    logger.info("Mappings preview requested for tenant_source=%d (format=%s)", tenant_source_id, format)
    rows = engine.get_mappings_preview(tenant_source_id)
    if rows is None:
        if format == "json":
            raise HTTPException(404, f"Tenant-source {tenant_source_id} not found")
        return HTMLResponse(_error_page(f"Tenant-source {tenant_source_id} not found"), status_code=404)
    if format == "json":
        from fastapi.responses import JSONResponse
        return JSONResponse(content=rows)
    return HTMLResponse(_render_mappings_html(tenant_source_id, rows))


_PREVIEW_COLUMNS = [
    ("Source Table", "source_table"),
    ("Source Field", "source_field"),
    ("Layer", "layer"),
    ("Canonical Entity", "canonical_entity"),
    ("Canonical Field", "canonical_field"),
    ("Is Foreign Key", "is_foreign_key"),
    ("FK References", "fk_references"),
    ("Data Present", "data_present"),
    ("Data Type", "data_type"),
    ("Transform Rule", "transform_rule"),
]


def _render_mappings_html(tenant_source_id: int, rows: list[dict]) -> str:
    """Build a self-contained HTML page with an inline-styled mappings table."""
    if not rows:
        return _error_page(f"No mappings configured for tenant-source {tenant_source_id}")

    thead = "".join(f"<th>{h}</th>" for h, _ in _PREVIEW_COLUMNS)
    tbody_rows = [_render_row(i, r) for i, r in enumerate(rows)]

    return (
        "<!DOCTYPE html><html><head><meta charset='utf-8'>"
        f"<title>Mappings Preview — Tenant Source {tenant_source_id}</title></head>"
        "<body style='font-family:system-ui,sans-serif;margin:2rem'>"
        f"<h2>Mappings Preview &mdash; Tenant Source {tenant_source_id}</h2>"
        f"<p>{len(rows)} mapping(s)</p>"
        "<table style='border-collapse:collapse;width:100%' border='1' cellpadding='6'>"
        f"<thead><tr style='background:#2c3e50;color:#fff'>{thead}</tr></thead>"
        f"<tbody>{''.join(tbody_rows)}</tbody></table></body></html>"
    )


def _render_row(index: int, r: dict) -> str:
    bg = "#f9f9f9" if index % 2 == 0 else "#ffffff"
    cells = [_render_cell(k, r.get(k, "")) for _, k in _PREVIEW_COLUMNS]
    return f'<tr style="background:{bg}">{"".join(cells)}</tr>'


def _render_cell(key: str, val) -> str:
    if key == "is_foreign_key":
        if val:
            return '<td style="color:#e67e22;font-weight:600">Yes</td>'
        return "<td>No</td>"
    if key == "fk_references" and val:
        return f'<td style="color:#8e44ad;font-style:italic">{_esc(val)}</td>'
    if key == "data_present":
        color = {"Yes": "#27ae60", "No": "#e74c3c"}.get(str(val), "#7f8c8d")
        return f'<td style="color:{color};font-weight:600">{_esc(val)}</td>'
    return f"<td>{_esc(val)}</td>"


def _error_page(message: str) -> str:
    return (
        "<!DOCTYPE html><html><head><meta charset='utf-8'>"
        "<title>Mappings Preview</title></head>"
        "<body style='font-family:system-ui,sans-serif;margin:2rem'>"
        f"<h2>Mappings Preview</h2><p style='color:#e74c3c'>{_esc(message)}</p>"
        "</body></html>"
    )


def _esc(val) -> str:
    """Minimal HTML escaping."""
    return str(val).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


# ── Entrypoint ─────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    _etl_root = str(Path(__file__).resolve().parents[1])
    if _etl_root not in sys.path:
        sys.path.insert(0, _etl_root)
    uvicorn.run("app.main:app", host="127.0.0.1", port=8006, reload=True, reload_dirs=[_etl_root])
