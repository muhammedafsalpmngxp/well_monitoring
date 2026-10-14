-- ═════════════════════════════════════════════════════════════════════════════
-- SmartOps Tenant — AI prompts in the database, with version history (add-ai-prompt-history.sql)
-- ─────────────────────────────────────────────────────────────────────────────
-- Every AI prompt lives in the tenant database (AI Settings → AI Prompts, admins only):
--   core.AiPrompt                  the ACTIVE text of every prompt, one row each (add-ai-prompt-table.sql)
--   core.AiSettings.row_ver        added by earlier versions of this script; no longer used
--   core.AiPromptHistory           every version of every prompt: who saved it, when, why. Version 1 of each key
--                                  is the original text ('seed'); "Restore original" restores it.
--
-- The texts themselves are not inserted here: the Tenant API copies any missing key from its seed
-- (TWise.Tenant.Infrastructure/Resources/ai-prompts.seed.json) into core.AiPrompt and history the first time the
-- tenant needs it. A tenant that had customised a prompt keeps its text (recorded as version 2, 'update').
--
-- Requires add-ai-settings.sql and add-ai-prompts.sql. Idempotent: safe to run more than once.
--
-- Usage:
--   sqlcmd -S <server> -d <tenant database> -i add-ai-prompt-history.sql
--   or open in DBeaver / SSMS and run as one script (no GO separators; USE picks the tenant DB).
-- ═════════════════════════════════════════════════════════════════════════════

SET NOCOUNT ON;

USE [smartops_tenant_TNT-1000];

IF COL_LENGTH('core.AiSettings', 'row_ver') IS NULL
    ALTER TABLE core.AiSettings ADD row_ver rowversion NOT NULL;

IF OBJECT_ID('core.AiPromptHistory', 'U') IS NULL
    CREATE TABLE core.AiPromptHistory (
        id          bigint         IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_AiPromptHistory PRIMARY KEY,
        tenant_id   bigint         NOT NULL,
        prompt_key  nvarchar(100)  NOT NULL,
        version_no  int            NOT NULL,
        body        nvarchar(max)  NOT NULL,
        action      nvarchar(20)   NOT NULL,          -- seed | update | restore
        note        nvarchar(400)  NULL,
        changed_by  nvarchar(200)  NOT NULL,
        changed_at  datetime2      NOT NULL CONSTRAINT DF_core_AiPromptHistory_changed DEFAULT SYSUTCDATETIME(),
        is_current  bit            NOT NULL,
        CONSTRAINT UQ_core_AiPromptHistory_version UNIQUE (tenant_id, prompt_key, version_no),
        CONSTRAINT CK_core_AiPromptHistory_action CHECK (action IN ('seed', 'update', 'restore'))
    );

-- At most one live version per prompt, guaranteed by the database.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_core_AiPromptHistory_current'
               AND object_id = OBJECT_ID('core.AiPromptHistory'))
    CREATE UNIQUE INDEX UX_core_AiPromptHistory_current ON core.AiPromptHistory (tenant_id, prompt_key)
        WHERE is_current = 1;
