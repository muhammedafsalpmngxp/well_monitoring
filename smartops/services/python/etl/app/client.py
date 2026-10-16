"""HTTP client for the Control Plane API with connection reuse and retry."""

import logging
import time
from typing import Any

from fastapi import HTTPException

logger = logging.getLogger("smartops.etl.client")

try:
    import httpx
except ImportError:
    httpx = None  # type: ignore

# Retry configuration
_MAX_RETRIES = 3
_RETRY_BACKOFF = 0.5  # seconds, doubles each retry


def _is_retryable_error(exc: Exception) -> bool:
    """Check if an exception is a transient error worth retrying."""
    if httpx and isinstance(exc, (httpx.ConnectError, httpx.ReadTimeout, httpx.WriteTimeout)):
        return True
    if hasattr(exc, 'response') and hasattr(exc.response, 'status_code'):
        return exc.response.status_code >= 500
    return False


def _with_retry(fn, *args, retryable: bool = True, **kwargs) -> Any:
    """Execute fn with exponential backoff on transient HTTP errors.
    
    Set retryable=False for non-idempotent operations (POST creates)
    to avoid duplicate side effects on timeout.
    """
    if not retryable:
        return fn(*args, **kwargs)
    last_exc: Exception | None = None
    for attempt in range(_MAX_RETRIES):
        try:
            return fn(*args, **kwargs)
        except Exception as exc:
            if not _is_retryable_error(exc) or attempt == _MAX_RETRIES - 1:
                raise
            last_exc = exc
            wait = _RETRY_BACKOFF * (2 ** attempt)
            logger.warning("Retry %d/%d after %.1fs: %s", attempt + 1, _MAX_RETRIES, wait, exc)
            time.sleep(wait)
    raise last_exc  # type: ignore


class ControlPlaneClient:
    """HTTP client to communicate with the Control Plane API."""

    def __init__(self, base_url: str, api_key: str | None = None):
        self.base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._http: Any = None

    def _client(self) -> "httpx.Client":
        if httpx is None:
            logger.error("httpx not installed — cannot reach Control Plane at %s", self.base_url)
            raise HTTPException(503, "httpx not installed — cannot reach Control Plane")
        if self._http is None or self._http.is_closed:
            headers = {}
            if self._api_key:
                headers["X-Api-Key"] = self._api_key
            self._http = httpx.Client(
                base_url=self.base_url,
                timeout=30.0,
                headers=headers,
            )
        return self._http

    def close(self) -> None:
        """Close the underlying HTTP client."""
        if self._http and not self._http.is_closed:
            self._http.close()
            self._http = None

    def get_tenant_sources(self) -> list[dict]:
        """Fetch all active tenant-source configurations."""
        def _do():
            r = self._client().get("/tenant-sources")
            r.raise_for_status()
            return [ts for ts in r.json() if ts.get("isActive")]
        return _with_retry(_do)

    def get_tenant_source(self, tenant_source_id: int) -> dict | None:
        """Fetch a single tenant-source by ID."""
        def _do():
            r = self._client().get(f"/tenant-sources/{tenant_source_id}")
            if r.status_code == 404:
                return None
            r.raise_for_status()
            return r.json()
        return _with_retry(_do)

    def get_field_mappings(self, tenant_source_id: int) -> list[dict]:
        """Fetch field mappings for a tenant-source (server-side filter if supported)."""
        def _do():
            r = self._client().get(
                "/field-mappings",
                params={"tenantSourceId": tenant_source_id, "isActive": "true"},
            )
            r.raise_for_status()
            # Client-side filter as fallback if API ignores query params
            return [fm for fm in r.json()
                    if fm.get("tenantSourceId") == tenant_source_id and fm.get("isActive")]
        return _with_retry(_do)

    def get_canonical_fields(self) -> list[dict]:
        """Fetch all canonical field definitions."""
        def _do():
            r = self._client().get("/canonical-fields")
            r.raise_for_status()
            return r.json()
        return _with_retry(_do)

    def get_canonical_entities(self) -> list[dict]:
        """Fetch all canonical entity definitions."""
        def _do():
            r = self._client().get("/canonical-entities")
            r.raise_for_status()
            return r.json()
        return _with_retry(_do)

    def get_tenant(self, tenant_id: int) -> dict | None:
        """Fetch a single tenant by ID (provides dataPlaneRef)."""
        def _do():
            r = self._client().get(f"/tenants/{tenant_id}")
            if r.status_code == 404:
                return None
            r.raise_for_status()
            return r.json()
        return _with_retry(_do)

    def get_capability_profile(self, tenant_source_id: int) -> list[dict]:
        """Fetch capability profiles for a tenant-source."""
        def _do():
            r = self._client().get("/capability-profiles")
            r.raise_for_status()
            return [cp for cp in r.json()
                    if cp.get("tenantSourceId") == tenant_source_id and cp.get("isAvailable")]
        return _with_retry(_do)

    def create_ingestion_run(self, tenant_source_id: int, started_at: str) -> dict:
        """Create a new ingestion run record in the Control Plane."""
        def _do():
            r = self._client().post("/ingestion-runs", json={
                "tenantSourceId": tenant_source_id,
                "startedAt": started_at,
                "status": "Running",
            })
            r.raise_for_status()
            return r.json()
        return _with_retry(_do, retryable=False)

    def update_ingestion_run(self, run_id: int, **kwargs) -> None:
        """Update an ingestion run (status, row counts, finished time)."""
        def _do():
            r = self._client().put(f"/ingestion-runs/{run_id}", json=kwargs)
            r.raise_for_status()
        _with_retry(_do)

    def get_ingestion_runs(self) -> list[dict]:
        """List all ingestion runs."""
        def _do():
            r = self._client().get("/ingestion-runs")
            r.raise_for_status()
            return r.json()
        return _with_retry(_do)

    def get_ingestion_run(self, run_id: int) -> dict | None:
        """Get a specific ingestion run."""
        def _do():
            r = self._client().get(f"/ingestion-runs/{run_id}")
            if r.status_code == 404:
                return None
            r.raise_for_status()
            return r.json()
        return _with_retry(_do)
