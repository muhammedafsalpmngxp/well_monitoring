-- ═════════════════════════════════════════════════════════════════════════════
-- SmartOps Tenant — view run log (add-view-run-log.sql)
-- ─────────────────────────────────────────────────────────────────────────────
-- [core].[ViewRunLog]: one row per chart, tile, dashboard or Ask AI load and per
-- saved view run, with its duration, rows or error. Data Quality → Self-Healing AI
-- reads it to find failing and slow views. The app removes rows older than
-- SelfHealing:RetentionDays. Idempotent.
--
-- Usage:
--   sqlcmd -S <server> -d <tenant database> -i add-view-run-log.sql
--   or open it in DBeaver / SSMS connected to the tenant database and run it as one script.
-- ═════════════════════════════════════════════════════════════════════════════

SET NOCOUNT ON;

IF OBJECT_ID('core.ViewRunLog', 'U') IS NULL
BEGIN
    CREATE TABLE core.ViewRunLog (
        id            BIGINT IDENTITY(1,1) NOT NULL,
        view_id       BIGINT         NULL,       -- core.DatabaseViews.id when the source is a saved view
        source_name   NVARCHAR(256)  NOT NULL,
        source_type   NVARCHAR(30)   NOT NULL,   -- View | Table | ...
        caller        NVARCHAR(20)   NOT NULL,   -- chart | preview
        duration_ms   INT            NOT NULL,
        row_count     INT            NULL,
        error         NVARCHAR(2000) NULL,       -- NULL when the load succeeded
        user_id       BIGINT         NULL,
        created_at    DATETIME2      NOT NULL CONSTRAINT DF_ViewRunLog_created DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_ViewRunLog PRIMARY KEY CLUSTERED (id)
    );
    CREATE INDEX IX_ViewRunLog_created ON core.ViewRunLog (created_at) INCLUDE (view_id, source_name, source_type, duration_ms, error);
END
