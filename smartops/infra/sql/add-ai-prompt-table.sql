-- ═════════════════════════════════════════════════════════════════════════════
-- SmartOps Tenant — AI prompts in their own table (add-ai-prompt-table.sql)
-- ─────────────────────────────────────────────────────────────────────────────
-- Every AI prompt lives in the tenant database (AI Settings → AI Prompts, admins only):
--   core.AiPrompt          one row per prompt: the ACTIVE text and its live version number. row_ver changes on
--                          every update: the Tenant API refreshes its prompt cache by it.
--   core.AiPromptHistory   every version of every prompt (add-ai-prompt-history.sql); is_current marks the live
--                          one, and core.AiPrompt always holds that version's text.
--
-- Moves the prompts out of core.AiSettings.prompts_json: each prompt's live version is copied from the history.
-- prompts_json is left as it is and no longer used (a text found only there is carried over by the Tenant API).
-- Any prompt still missing is added by the Tenant API from its seed
-- (TWise.Tenant.Infrastructure/Resources/ai-prompts.seed.json) the first time the tenant needs it.
--
-- Requires add-ai-prompt-history.sql. Idempotent: safe to run more than once.
--
-- Usage:
--   sqlcmd -S <server> -d <tenant database> -i add-ai-prompt-table.sql
--   or open in DBeaver / SSMS and run as one script (no GO separators; USE picks the tenant DB).
-- ═════════════════════════════════════════════════════════════════════════════

SET NOCOUNT ON;

USE [smartops_tenant_TNT-1000];

IF OBJECT_ID('core.AiPrompt', 'U') IS NULL
    CREATE TABLE core.AiPrompt (
        id           bigint         IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_AiPrompt PRIMARY KEY,
        tenant_id    bigint         NOT NULL,
        prompt_key   nvarchar(100)  NOT NULL,
        body         nvarchar(max)  NOT NULL,
        version_no   int            NOT NULL,          -- the live version in core.AiPromptHistory
        modified_by  nvarchar(200)  NOT NULL,
        modified_at  datetime2      NOT NULL CONSTRAINT DF_core_AiPrompt_modified DEFAULT SYSUTCDATETIME(),
        row_ver      rowversion     NOT NULL,
        CONSTRAINT UQ_core_AiPrompt_key UNIQUE (tenant_id, prompt_key)
    );

-- Copy each prompt's live version from the history (prompts that already have a row are left alone).
INSERT INTO core.AiPrompt (tenant_id, prompt_key, body, version_no, modified_by, modified_at)
SELECT h.tenant_id, h.prompt_key, h.body, h.version_no, h.changed_by, h.changed_at
FROM core.AiPromptHistory h
WHERE h.is_current = 1
  AND NOT EXISTS (SELECT 1 FROM core.AiPrompt p WHERE p.tenant_id = h.tenant_id AND p.prompt_key = h.prompt_key);

DECLARE @prompts int = (SELECT COUNT(*) FROM core.AiPrompt);
PRINT CONCAT('core.AiPrompt: ', @prompts, ' prompt(s).');
