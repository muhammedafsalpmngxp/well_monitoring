/* ============================================================================
   Adds core.ReportVersions — immutable publish snapshots for reports.

   Why this exists: publishing a report OVERWRITES the live row in place
   (ReportService merges the draft into the published report), so before this
   table the previous definition was destroyed on every publish and there was
   nothing to roll back to.

   Each publish appends one row here. Restoring replays a snapshot onto the live
   report and appends another row (reason = 'restore'), so the history is only
   ever added to, never rewritten.

   Run once against every EXISTING tenant database. New tenant databases get this
   from init-tenant-schema.sql, which carries the same definition.

   Idempotent: safe to re-run.

   NOTE: reports published BEFORE this table existed have no snapshots, so their
   version history starts empty and fills from their next publish onward. This is
   expected — the earlier definitions were never retained and cannot be recovered.
   ============================================================================ */

IF SCHEMA_ID(N'core') IS NULL
    EXEC(N'CREATE SCHEMA core');
GO

IF OBJECT_ID(N'core.ReportVersions', N'U') IS NULL
CREATE TABLE core.ReportVersions (
    id                        bigint        IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_ReportVersions PRIMARY KEY,
    report_id                 bigint        NOT NULL,
    -- 0, 1, 2... assigned per report in publish order.
    version_no                int           NOT NULL,

    -- Snapshot of the report definition at publish time.
    report_name               nvarchar(200) NOT NULL,
    description               nvarchar(1000) NULL,
    category_id               int           NOT NULL,
    source_name               nvarchar(200) NOT NULL,
    source_type               varchar(20)   NOT NULL,
    report_json               nvarchar(max) NULL,

    -- publish | restore
    reason                    varchar(20)   NOT NULL DEFAULT 'publish',
    -- Set only when reason = 'restore': the version this snapshot was restored from.
    restored_from_version_no  int           NULL,

    published_by              bigint        NOT NULL,
    published_at              datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    tenant_id                 bigint        NOT NULL
);
GO

-- Version numbers are unique and gap-free within a report.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_core_ReportVersions_report_version')
CREATE UNIQUE INDEX UX_core_ReportVersions_report_version
    ON core.ReportVersions (report_id, version_no);
GO

-- Supports the per-report history lookup.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_core_ReportVersions_tenant_report')
CREATE INDEX IX_core_ReportVersions_tenant_report
    ON core.ReportVersions (tenant_id, report_id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_core_ReportVersions_reason')
ALTER TABLE core.ReportVersions
    ADD CONSTRAINT CK_core_ReportVersions_reason
    CHECK (reason IN ('publish', 'restore'));
GO

/* No FK to core.Reports and no cascade delete on purpose: snapshots are an audit
   record and must outlive a soft-deleted report. */
