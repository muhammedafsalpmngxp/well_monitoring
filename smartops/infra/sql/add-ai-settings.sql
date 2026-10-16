-- ═════════════════════════════════════════════════════════════════════════════
-- SmartOps Tenant — AI settings and usage log (add-ai-settings.sql)
-- ─────────────────────────────────────────────────────────────────────────────
-- Creates [core].[AiSettings] (one row per tenant: daily quota, on/off) and [core].[AiUsageLog]
-- (one row per LLM call, for quota and cost). Providers live in add-ai-providers.sql.
-- Idempotent: safe to run multiple times.
--
-- Usage:
--   sqlcmd -S <server> -d smartops_tenant_TNT-1000 -i add-ai-settings.sql
--   or open in DBeaver / SSMS and run as one script (no GO separators; USE picks the tenant DB).
-- ═════════════════════════════════════════════════════════════════════════════

SET NOCOUNT ON;

-- Adjust the database name per tenant if required.
USE [smartops_tenant_TNT-1000];

IF SCHEMA_ID('core') IS NULL
    EXEC('CREATE SCHEMA core;');

IF OBJECT_ID('core.AiSettings', 'U') IS NULL
BEGIN
    CREATE TABLE core.AiSettings (
        id                 BIGINT IDENTITY(1,1) NOT NULL,
        tenant_id          BIGINT         NOT NULL,
        daily_quota        INT            NOT NULL CONSTRAINT DF_AiSettings_quota DEFAULT 500,  -- 0 = unlimited
        is_enabled         BIT            NOT NULL CONSTRAINT DF_AiSettings_enabled DEFAULT 0,
        created_by         NVARCHAR(100)  NULL,
        created_at         DATETIME2      NOT NULL CONSTRAINT DF_AiSettings_created DEFAULT SYSUTCDATETIME(),
        modified_by        NVARCHAR(100)  NULL,
        modified_at        DATETIME2      NOT NULL CONSTRAINT DF_AiSettings_modified DEFAULT SYSUTCDATETIME(),
        is_deleted         BIT            NOT NULL CONSTRAINT DF_AiSettings_deleted DEFAULT 0,
        CONSTRAINT PK_AiSettings PRIMARY KEY CLUSTERED (id),
        CONSTRAINT UQ_AiSettings_tenant UNIQUE (tenant_id)
    );
END

IF OBJECT_ID('core.AiUsageLog', 'U') IS NULL
BEGIN
    CREATE TABLE core.AiUsageLog (
        id                 BIGINT IDENTITY(1,1) NOT NULL,
        tenant_id          BIGINT         NOT NULL,
        user_id            NVARCHAR(100)  NULL,
        purpose            NVARCHAR(40)   NOT NULL,             -- test | ask | chart | summary ...
        model              NVARCHAR(100)  NOT NULL,
        prompt_tokens      INT            NOT NULL CONSTRAINT DF_AiUsageLog_pt DEFAULT 0,
        completion_tokens  INT            NOT NULL CONSTRAINT DF_AiUsageLog_ct DEFAULT 0,
        latency_ms         INT            NOT NULL CONSTRAINT DF_AiUsageLog_lat DEFAULT 0,
        succeeded          BIT            NOT NULL CONSTRAINT DF_AiUsageLog_ok DEFAULT 0,
        error              NVARCHAR(1000) NULL,
        created_at         DATETIME2      NOT NULL CONSTRAINT DF_AiUsageLog_created DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_AiUsageLog PRIMARY KEY CLUSTERED (id)
    );
    -- Quota check is "calls since midnight UTC for this tenant".
    CREATE INDEX IX_AiUsageLog_tenant_created ON core.AiUsageLog (tenant_id, created_at);
END
