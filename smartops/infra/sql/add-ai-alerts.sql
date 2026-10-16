-- ═════════════════════════════════════════════════════════════════════════════
-- SmartOps Tenant — AI alerts (add-ai-alerts.sql)
-- ─────────────────────────────────────────────────────────────────────────────
-- Adds [core].[AiAlerts]: Ask AI answers a user watches. The answer's query runs again every
-- every_hours (1, 24 or 168) and the owner is notified in the app when it starts crossing the limit
-- (above / below) or looking unusual. Idempotent.
--
-- Usage:
--   sqlcmd -S <server> -d <tenant database> -i add-ai-alerts.sql
--   or open in DBeaver / SSMS and run as one script (no GO separators; USE picks the tenant DB).
-- ═════════════════════════════════════════════════════════════════════════════

SET NOCOUNT ON;

USE [smartops_tenant_TNT-1000];

IF OBJECT_ID('core.AiAlerts', 'U') IS NULL
CREATE TABLE core.AiAlerts (
    id               bigint          IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_AiAlerts PRIMARY KEY,
    tenant_id        bigint          NOT NULL,
    user_id          nvarchar(100)   NOT NULL,   -- owner; notified and checked as this user
    source_type      nvarchar(10)    NOT NULL,   -- view | import
    source_id        bigint          NOT NULL,
    source_name      nvarchar(200)   NOT NULL,
    question         nvarchar(2000)  NOT NULL,
    query_spec_json  nvarchar(max)   NOT NULL,   -- the answer's query, run again on each check
    kind             nvarchar(10)    NOT NULL,   -- above | below | unusual | change
    threshold        float           NULL,       -- the limit for above / below, or the percent allowed for change
    every_hours      int             NOT NULL CONSTRAINT DF_core_AiAlerts_every DEFAULT 24,
    notify_emails    nvarchar(1000)  NULL,       -- comma-separated addresses also mailed when it starts firing
    is_triggered     bit             NOT NULL CONSTRAINT DF_core_AiAlerts_triggered DEFAULT 0,
    last_message     nvarchar(1000)  NULL,
    history_json     nvarchar(max)   NULL,       -- last 30 single values, the baseline for unusual
    last_checked_at  datetime2       NULL,
    next_check_at    datetime2       NOT NULL,
    created_at       datetime2       NOT NULL CONSTRAINT DF_core_AiAlerts_created DEFAULT SYSUTCDATETIME()
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_core_AiAlerts_due')
CREATE INDEX IX_core_AiAlerts_due ON core.AiAlerts (next_check_at);
IF COL_LENGTH('core.AiAlerts', 'notify_emails') IS NULL
ALTER TABLE core.AiAlerts ADD notify_emails nvarchar(1000) NULL;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_core_AiAlerts_owner')
CREATE INDEX IX_core_AiAlerts_owner ON core.AiAlerts (tenant_id, user_id);
