-- ═════════════════════════════════════════════════════════════════════════════
-- SmartOps Tenant — AI instructions per dataset (add-ai-dataset-prompts.sql)
-- ─────────────────────────────────────────────────────────────────────────────
-- Adds [core].[AiDatasetPrompts]: an admin's override of one AI instruction (ask-rules, answer,
-- report, alert-message) for one dataset; the tenant-wide text in core.AiSettings applies where no
-- row exists. Idempotent.
--
-- Usage:
--   sqlcmd -S <server> -d <tenant database> -i add-ai-dataset-prompts.sql
--   or open in DBeaver / SSMS and run as one script (no GO separators; USE picks the tenant DB).
-- ═════════════════════════════════════════════════════════════════════════════

SET NOCOUNT ON;

USE [smartops_tenant_TNT-1000];

IF OBJECT_ID('core.AiDatasetPrompts', 'U') IS NULL
CREATE TABLE core.AiDatasetPrompts (
    id            bigint         IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_AiDatasetPrompts PRIMARY KEY,
    tenant_id     bigint         NOT NULL,
    source_type   nvarchar(10)   NOT NULL,   -- view | import
    source_id     bigint         NOT NULL,
    prompt_key    nvarchar(40)   NOT NULL,   -- ask-rules | answer | report | alert-message
    prompt_text   nvarchar(4000) NOT NULL,
    modified_by   nvarchar(100)  NULL,
    modified_at   datetime2      NOT NULL CONSTRAINT DF_core_AiDatasetPrompts_modified DEFAULT SYSUTCDATETIME()
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_core_AiDatasetPrompts_key')
CREATE UNIQUE INDEX UX_core_AiDatasetPrompts_key ON core.AiDatasetPrompts (tenant_id, source_type, source_id, prompt_key);
