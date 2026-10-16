/* ============================================================================
   Adds refresh scheduling and monitoring:

     core.RefreshSchedules  — recurring refreshes (cron + time zone)
     core.RefreshJobs       — one row per execution; this IS the refresh history
     core.ImportedDatasets  — last-refresh markers so freshness is visible

   Refreshing re-runs an existing ingest through the same connector used for the
   manual import, replacing (full) or appending to (incremental) the dataset's
   rows, so charts and tiles keep working without being rewired.

   Run once against every EXISTING tenant database. New tenant databases get this
   from init-tenant-schema.sql, which carries the same definition.

   Idempotent: safe to re-run.
   ============================================================================ */

IF SCHEMA_ID(N'core') IS NULL
    EXEC(N'CREATE SCHEMA core');
GO

/* ── Schedules ───────────────────────────────────────────────────────────── */

IF OBJECT_ID(N'core.RefreshSchedules', N'U') IS NULL
CREATE TABLE core.RefreshSchedules (
    id                         bigint        IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_RefreshSchedules PRIMARY KEY,
    schedule_name              nvarchar(200) NOT NULL,
    data_source_connection_id  bigint        NOT NULL,
    imported_dataset_id        bigint        NOT NULL,
    -- Connector object to fetch (sheet tab, Drive file id); NULL uses the source default.
    object_ref                 nvarchar(500) NULL,
    -- Standard 5-field cron expression, evaluated in time_zone_id.
    cron_expression            varchar(100)  NOT NULL,
    time_zone_id               varchar(100)  NOT NULL DEFAULT 'UTC',
    -- Display label only ("Daily", "Every 5 minutes"); the cron is authoritative.
    frequency_label            nvarchar(50)  NULL,
    -- full | incremental
    refresh_mode               varchar(20)   NOT NULL DEFAULT 'full',
    -- Incremental only: column holding a monotonically increasing value.
    incremental_column         nvarchar(200) NULL,
    last_watermark             nvarchar(400) NULL,
    is_enabled                 bit           NOT NULL DEFAULT 1,
    last_run_at                datetime2(3)  NULL,
    -- Next fire time in UTC. The worker claims schedules whose value is in the past.
    next_run_at                datetime2(3)  NULL,
    last_status                varchar(20)   NULL,
    tenant_id                  bigint        NOT NULL,
    created_by                 bigint        NOT NULL,
    created_at                 datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_by                bigint        NULL,
    modified_at                datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    is_deleted                 bit           NOT NULL DEFAULT 0
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_core_RefreshSchedules_tenant_name')
CREATE UNIQUE INDEX UX_core_RefreshSchedules_tenant_name
    ON core.RefreshSchedules (tenant_id, schedule_name)
    WHERE is_deleted = 0;
GO

-- The worker's hot query is "enabled schedules that are due".
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_core_RefreshSchedules_due')
CREATE INDEX IX_core_RefreshSchedules_due
    ON core.RefreshSchedules (is_enabled, next_run_at)
    WHERE is_deleted = 0;
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_core_RefreshSchedules_mode')
ALTER TABLE core.RefreshSchedules
    ADD CONSTRAINT CK_core_RefreshSchedules_mode
    CHECK (refresh_mode IN ('full', 'incremental'));
GO

/* ── Jobs (refresh history) ──────────────────────────────────────────────── */

IF OBJECT_ID(N'core.RefreshJobs', N'U') IS NULL
CREATE TABLE core.RefreshJobs (
    id                         bigint        IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_RefreshJobs PRIMARY KEY,
    -- Short human-facing code shown in the Data Sync grid, e.g. 'JB-1088'.
    job_code                   varchar(30)   NOT NULL,
    -- NULL for a manual, unscheduled refresh.
    schedule_id                bigint        NULL,
    data_source_connection_id  bigint        NOT NULL,
    imported_dataset_id        bigint        NOT NULL,
    job_process                nvarchar(200) NOT NULL,
    -- queued | processing | succeeded | failed
    status                     varchar(20)   NOT NULL DEFAULT 'queued',
    -- schedule | manual | retry
    triggered_by               varchar(20)   NOT NULL DEFAULT 'manual',
    refresh_mode               varchar(20)   NOT NULL DEFAULT 'full',
    queued_at                  datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    started_at                 datetime2(3)  NULL,
    completed_at               datetime2(3)  NULL,
    duration_ms                int           NULL,
    row_count                  int           NULL,
    error_message              nvarchar(2000) NULL,
    triggered_by_user_id       bigint        NULL,
    tenant_id                  bigint        NOT NULL,
    is_deleted                 bit           NOT NULL DEFAULT 0
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_core_RefreshJobs_job_code')
CREATE UNIQUE INDEX UX_core_RefreshJobs_job_code
    ON core.RefreshJobs (job_code);
GO

-- History is always read newest-first for a tenant.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_core_RefreshJobs_tenant_queued')
CREATE INDEX IX_core_RefreshJobs_tenant_queued
    ON core.RefreshJobs (tenant_id, queued_at)
    WHERE is_deleted = 0;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_core_RefreshJobs_schedule')
CREATE INDEX IX_core_RefreshJobs_schedule
    ON core.RefreshJobs (schedule_id)
    WHERE is_deleted = 0;
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_core_RefreshJobs_status')
ALTER TABLE core.RefreshJobs
    ADD CONSTRAINT CK_core_RefreshJobs_status
    CHECK (status IN ('queued', 'processing', 'succeeded', 'failed'));
GO

/* ── Last-refresh markers on the dataset ─────────────────────────────────── */

IF COL_LENGTH('core.ImportedDatasets', 'last_refreshed_at') IS NULL
    ALTER TABLE core.ImportedDatasets ADD last_refreshed_at datetime2(3) NULL;
GO

IF COL_LENGTH('core.ImportedDatasets', 'last_refresh_status') IS NULL
    ALTER TABLE core.ImportedDatasets ADD last_refresh_status varchar(20) NULL;
GO

IF COL_LENGTH('core.ImportedDatasets', 'last_refresh_job_code') IS NULL
    ALTER TABLE core.ImportedDatasets ADD last_refresh_job_code varchar(30) NULL;
GO

/* ── Dataset origin, so a dataset knows what to refresh from ─────────────── */

IF COL_LENGTH('core.ImportedDatasets', 'data_source_connection_id') IS NULL
    ALTER TABLE core.ImportedDatasets ADD data_source_connection_id bigint NULL;
GO

IF COL_LENGTH('core.ImportedDatasets', 'source_object_ref') IS NULL
    ALTER TABLE core.ImportedDatasets ADD source_object_ref nvarchar(500) NULL;
GO

/* Best-effort back-fill for datasets ingested before the origin columns existed.
   Connector ingests wrote file_name as 'connectionName/objectRef' and file_type as the
   connector kind, so the source can be recovered by matching on those. File uploads
   (file_type csv/xlsx/xls/json) are left NULL — they have no source to refresh from. */
UPDATE d
   SET d.data_source_connection_id = c.id,
       d.source_object_ref = NULLIF(
           STUFF(d.file_name, 1, LEN(c.connection_name) + 1, ''), 'default')
  FROM core.ImportedDatasets d
  JOIN core.DataSourceConnections c
    ON c.tenant_id = d.tenant_id
   AND c.is_deleted = 0
   AND d.file_name LIKE c.connection_name + '/%'
 WHERE d.data_source_connection_id IS NULL
   AND d.file_type IN ('google_sheets', 'google_drive', 'rest_api');
GO
