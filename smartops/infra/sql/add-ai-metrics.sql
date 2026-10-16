-- ═════════════════════════════════════════════════════════════════════════════
-- SmartOps Tenant — AI metrics library (add-ai-metrics.sql)
-- ─────────────────────────────────────────────────────────────────────────────
-- [core].[AiMetrics]: named, trusted measures per dataset (name → aggregation of a column) that the
-- ask-your-data prompt uses as definitions. Requires add-ai-knowledge.sql. Idempotent.
--
-- Usage:
--   sqlcmd -S <server> -d smartops_tenant_TNT-1000 -i add-ai-metrics.sql
--   or open in DBeaver / SSMS and run as one script (no GO separators; USE picks the tenant DB).
-- ═════════════════════════════════════════════════════════════════════════════

SET NOCOUNT ON;

USE [smartops_tenant_TNT-1000];

IF OBJECT_ID('core.AiMetrics', 'U') IS NULL
BEGIN
    CREATE TABLE core.AiMetrics (
        id            BIGINT IDENTITY(1,1) NOT NULL,
        tenant_id     BIGINT         NOT NULL,
        source_type   NVARCHAR(10)   NOT NULL,   -- view | import
        source_id     BIGINT         NOT NULL,
        name          NVARCHAR(100)  NOT NULL,
        agg           NVARCHAR(20)   NOT NULL,   -- count | countDistinct | sum | avg | min | max
        column_name   NVARCHAR(200)  NULL,       -- NULL only for count
        description   NVARCHAR(500)  NULL,
        modified_by   NVARCHAR(100)  NULL,
        modified_at   DATETIME2      NOT NULL CONSTRAINT DF_AiMetrics_modified DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_AiMetrics PRIMARY KEY CLUSTERED (id),
        CONSTRAINT UQ_AiMetrics_name UNIQUE (tenant_id, source_type, source_id, name)
    );
END
