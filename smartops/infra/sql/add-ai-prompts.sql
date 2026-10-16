-- ═════════════════════════════════════════════════════════════════════════════
-- SmartOps Tenant — editable AI instructions (add-ai-prompts.sql)
-- ─────────────────────────────────────────────────────────────────────────────
-- Adds prompts_json to [core].[AiSettings]: the admin's custom AI instructions as JSON
-- {key: text} (Settings → AI Features → AI instructions). NULL means every default.
-- Requires add-ai-settings.sql. Idempotent.
--
-- Usage:
--   sqlcmd -S <server> -d <tenant database> -i add-ai-prompts.sql
--   or open in DBeaver / SSMS and run as one script (no GO separators; USE picks the tenant DB).
-- ═════════════════════════════════════════════════════════════════════════════

SET NOCOUNT ON;

USE [smartops_tenant_TNT-1000];

IF COL_LENGTH('core.AiSettings', 'prompts_json') IS NULL
    ALTER TABLE core.AiSettings ADD prompts_json nvarchar(max) NULL;
