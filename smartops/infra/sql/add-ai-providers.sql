-- ═════════════════════════════════════════════════════════════════════════════
-- SmartOps Tenant — AI providers (add-ai-providers.sql)
-- ─────────────────────────────────────────────────────────────────────────────
-- Splits the model choice out of core.AiSettings into core.AiProviders so a tenant can register
-- several LLM endpoints and pick one as active. Migrates the existing single row, then drops the
-- old columns. Requires add-ai-settings.sql. Idempotent.
--
-- Usage:
--   sqlcmd -S <server> -d smartops_tenant_TNT-1000 -i add-ai-providers.sql
--   or open in DBeaver / SSMS and run as one script (no GO separators; USE picks the tenant DB).
-- ═════════════════════════════════════════════════════════════════════════════

SET NOCOUNT ON;

USE [smartops_tenant_TNT-1000];

IF OBJECT_ID('core.AiProviders', 'U') IS NULL
BEGIN
    CREATE TABLE core.AiProviders (
        id                 BIGINT IDENTITY(1,1) NOT NULL,
        tenant_id          BIGINT         NOT NULL,
        name               NVARCHAR(100)  NOT NULL,
        provider           NVARCHAR(20)   NOT NULL,             -- openai | anthropic | azure | ollama | custom
        base_url           NVARCHAR(500)  NOT NULL,
        model              NVARCHAR(100)  NOT NULL,
        api_key_encrypted  NVARCHAR(1000) NULL,
        is_active          BIT            NOT NULL CONSTRAINT DF_AiProviders_active DEFAULT 0,
        created_by         NVARCHAR(100)  NULL,
        created_at         DATETIME2      NOT NULL CONSTRAINT DF_AiProviders_created DEFAULT SYSUTCDATETIME(),
        modified_by        NVARCHAR(100)  NULL,
        modified_at        DATETIME2      NOT NULL CONSTRAINT DF_AiProviders_modified DEFAULT SYSUTCDATETIME(),
        deleted_by         NVARCHAR(100)  NULL,
        -- no is_deleted: providers are deleted for real (remove-ai-providers-soft-delete.sql)
        CONSTRAINT PK_AiProviders PRIMARY KEY CLUSTERED (id)
    );
    CREATE INDEX IX_AiProviders_tenant ON core.AiProviders (tenant_id, is_active);
END

-- Move the single provider that lived on AiSettings (if the old columns still exist).
IF COL_LENGTH('core.AiSettings', 'provider') IS NOT NULL
BEGIN
    EXEC('
        INSERT INTO core.AiProviders (tenant_id, name, provider, base_url, model, api_key_encrypted, is_active, created_by, created_at, modified_by)
        SELECT s.tenant_id, s.provider + '' - '' + s.model, s.provider, s.base_url, s.model, s.api_key_encrypted, 1, s.created_by, s.created_at, s.modified_by
        FROM core.AiSettings s
        WHERE s.is_deleted = 0 AND s.model <> ''''
          AND NOT EXISTS (SELECT 1 FROM core.AiProviders p WHERE p.tenant_id = s.tenant_id);
    ');
    ALTER TABLE core.AiSettings DROP COLUMN provider, base_url, model, api_key_encrypted;
END

-- Fast model (optional): the cheap tier for routing / planning steps (Ask Data, as twise OPENAI_FAST_MODEL).
-- NULL = the main model.
IF COL_LENGTH('core.AiProviders', 'fast_model') IS NULL
    ALTER TABLE core.AiProviders ADD fast_model NVARCHAR(100) NULL;

-- Daily quota (moved from core.AiSettings.daily_quota): max AI calls per tenant per UTC day while this provider
-- is the active one; 0 = unlimited. The tenant's old quota is copied onto its existing providers once.
-- core.AiSettings.daily_quota is no longer read and can be dropped later.
IF COL_LENGTH('core.AiProviders', 'daily_quota') IS NULL
BEGIN
    ALTER TABLE core.AiProviders ADD daily_quota INT NOT NULL CONSTRAINT DF_AiProviders_quota DEFAULT 500;
    IF COL_LENGTH('core.AiSettings', 'daily_quota') IS NOT NULL
        EXEC('
            UPDATE p SET daily_quota = s.daily_quota
            FROM core.AiProviders p
            JOIN core.AiSettings s ON s.tenant_id = p.tenant_id AND s.is_deleted = 0;
        ');
END
