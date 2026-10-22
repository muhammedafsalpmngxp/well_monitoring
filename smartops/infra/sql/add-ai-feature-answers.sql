-- ═════════════════════════════════════════════════════════════════════════════
-- SmartOps Tenant — Agentic Features: saved AI answers (add-ai-feature-answers.sql)
-- ─────────────────────────────────────────────────────────────────────────────
--   core.AiFeatureAnswer   verified AI answers of an Agentic Feature (today Daily Report's briefs and questions),
--                          so a restart of the agent runtime loses none and the day brief prepared in the background
--                          is ready when someone opens the page.
--
-- answer_key is the agent runtime's content hash of everything an answer rests on (the data, the prompts, the
-- model, the settings): an answer is reused only for exactly that input, so one written on older data is never
-- shown for newer data. The Tenant API keeps the newest rows per report date (Daily Report setting "Saved AI answers
-- per date") and deletes the rest.
--
-- Without this table everything still works: answers (also the briefs prepared in the background) are then kept only
-- in the agent runtime's memory and are lost when it restarts (the Tenant API logs that once).
--
-- Requires add-agentic-features.sql. Idempotent: safe to run more than once.
--
-- Usage:
--   sqlcmd -S <server> -d <tenant database> -i add-ai-feature-answers.sql
--   or open in DBeaver / SSMS and run as one script (no GO separators; USE picks the tenant DB).
-- ═════════════════════════════════════════════════════════════════════════════

SET NOCOUNT ON;

USE [smartops_tenant_TNT-1000];

IF OBJECT_ID('core.AiFeatureAnswer', 'U') IS NULL
    CREATE TABLE core.AiFeatureAnswer (
        tenant_id    bigint         NOT NULL,
        feature      nvarchar(40)   NOT NULL,
        answer_key   char(64)       NOT NULL,         -- the runtime's content hash (SHA-256, lower-case hex)
        report_date  date           NOT NULL,
        kind         nvarchar(20)   NOT NULL,         -- brief | ask
        scope        nvarchar(20)   NULL,             -- brief: day | well | task
        draft        nvarchar(max)  NOT NULL,         -- the verified text
        verification nvarchar(max)  NULL,             -- the verifier's verdict (JSON)
        model        nvarchar(100)  NULL,
        created_by   nvarchar(200)  NULL,             -- the user who asked, or "system" for a prepared brief
        created_at   datetime2      NOT NULL CONSTRAINT DF_core_AiFeatureAnswer_created DEFAULT SYSUTCDATETIME(),
        used_at      datetime2      NOT NULL CONSTRAINT DF_core_AiFeatureAnswer_used DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_core_AiFeatureAnswer PRIMARY KEY (tenant_id, feature, answer_key)
    );

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_core_AiFeatureAnswer_date' AND object_id = OBJECT_ID('core.AiFeatureAnswer'))
    CREATE INDEX IX_core_AiFeatureAnswer_date ON core.AiFeatureAnswer (tenant_id, feature, report_date, used_at DESC);

PRINT 'core.AiFeatureAnswer is ready.';
