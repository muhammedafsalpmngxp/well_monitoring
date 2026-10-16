-- ═════════════════════════════════════════════════════════════════════════════
-- SmartOps Tenant — AI memory review (add-ai-memory.sql)
-- ─────────────────────────────────────────────────────────────────────────────
-- Adds status and review to [core].[AiExamples]. Answered questions are now saved automatically
-- and reviewed by the model; only "liked" and "approved" examples guide later questions.
-- Existing rows were thumbs-up examples, so they default to "liked". Requires add-ai-knowledge.sql.
-- Idempotent.
--
-- Usage:
--   sqlcmd -S <server> -d <tenant database> -i add-ai-memory.sql
--   or open in DBeaver / SSMS and run as one script (no GO separators; USE picks the tenant DB).
-- ═════════════════════════════════════════════════════════════════════════════

SET NOCOUNT ON;

USE [smartops_tenant_TNT-1000];

IF COL_LENGTH('core.AiExamples', 'status') IS NULL
    ALTER TABLE core.AiExamples ADD status nvarchar(20) NOT NULL CONSTRAINT DF_core_AiExamples_status DEFAULT N'liked';
IF COL_LENGTH('core.AiExamples', 'review') IS NULL
    ALTER TABLE core.AiExamples ADD review nvarchar(500) NULL;
