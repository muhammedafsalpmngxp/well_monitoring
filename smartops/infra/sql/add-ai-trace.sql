-- ═════════════════════════════════════════════════════════════════════════════
-- SmartOps Tenant — AI prompt trace (add-ai-trace.sql)
-- ─────────────────────────────────────────────────────────────────────────────
-- Adds [core].[AiTraces]: for each Ask AI answer, what was sent to the AI, what came back and
-- how long each step took. The API keeps 30 days and deletes older rows itself.
-- Requires the AI conversation tables. Idempotent.
--
-- Usage:
--   sqlcmd -S <server> -d <tenant database> -i add-ai-trace.sql
--   or open in DBeaver / SSMS and run as one script (no GO separators; USE picks the tenant DB).
-- ═════════════════════════════════════════════════════════════════════════════

SET NOCOUNT ON;

USE [smartops_tenant_TNT-1000];

IF OBJECT_ID('core.AiTraces', 'U') IS NULL
CREATE TABLE core.AiTraces (
    id          bigint         IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_AiTraces PRIMARY KEY,
    message_id  bigint         NOT NULL,   -- core.AiChatMessages.id of the assistant answer
    trace_json  nvarchar(max)  NOT NULL,   -- steps: load, context, ask, query, rejected, answer
    created_at  datetime2      NOT NULL CONSTRAINT DF_core_AiTraces_created DEFAULT SYSUTCDATETIME()
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_core_AiTraces_message')
CREATE INDEX IX_core_AiTraces_message ON core.AiTraces (message_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_core_AiTraces_created')
CREATE INDEX IX_core_AiTraces_created ON core.AiTraces (created_at);
