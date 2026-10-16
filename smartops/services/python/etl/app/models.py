"""Pydantic request/response models for the ETL service."""

from pydantic import BaseModel, Field


class RunRequest(BaseModel):
    """Trigger ETL for a specific tenant-source."""
    tenant_source_id: int = Field(..., description="ID of the tenant-source to ingest")
    full_refresh: bool = Field(False, description="If true, re-extract all data (ignore watermark)")


class RunAllRequest(BaseModel):
    """Trigger ETL for all active tenant-sources."""
    full_refresh: bool = Field(False, description="If true, re-extract all data for every source")


class RunResponse(BaseModel):
    """Response after triggering an ETL run."""
    ingestion_run_id: int | None = None
    tenant_source_id: int
    status: str
    message: str


class RunStatusResponse(BaseModel):
    """Status of an ingestion run."""
    ingestion_run_id: int
    tenant_source_id: int
    started_at: str | None = None
    finished_at: str | None = None
    status: str | None = None
    rows_extracted: int | None = None
    rows_loaded: int | None = None
    error_count: int | None = None


class PreflightIssue(BaseModel):
    """A single validation issue found during pre-flight check."""
    level: str          # "error" | "warning"
    check: str          # which validation failed
    detail: str         # human-readable explanation


class PreflightResponse(BaseModel):
    """Result of a pre-flight configuration validation."""
    tenant_source_id: int
    passed: bool        # True if no errors (warnings are allowed)
    errors: int
    warnings: int
    issues: list[PreflightIssue]
