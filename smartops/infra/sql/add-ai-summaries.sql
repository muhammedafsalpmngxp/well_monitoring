-- ═════════════════════════════════════════════════════════════════════════════
-- SmartOps Tenant — AI summaries (add-ai-summaries.sql)
-- ─────────────────────────────────────────────────────────────────────────────
-- [core].[AiSummaries]: Explain this chart / Explain the dashboard texts, kept until the data they summarise
-- changes (the key is a hash of that data). Rows unused for 30 days are removed by the app. Idempotent.
--
-- Usage:
--   sqlcmd -S <server> -d <tenant database> -i add-ai-summaries.sql
--   or open it in DBeaver / SSMS connected to the tenant database and run it as one script.
-- ═════════════════════════════════════════════════════════════════════════════

SET NOCOUNT ON;

IF OBJECT_ID('core.AiSummaries', 'U') IS NULL
BEGIN
    CREATE TABLE core.AiSummaries (
        id            BIGINT IDENTITY(1,1) NOT NULL,
        tenant_id     BIGINT         NOT NULL,
        kind          NVARCHAR(10)   NOT NULL,   -- chart | dashboard
        payload_hash  NVARCHAR(64)   NOT NULL,   -- SHA-256 hex of the title, data and prompt
        text          NVARCHAR(MAX)  NOT NULL,
        created_at    DATETIME2      NOT NULL CONSTRAINT DF_AiSummaries_created DEFAULT SYSUTCDATETIME(),
        used_at       DATETIME2      NOT NULL CONSTRAINT DF_AiSummaries_used DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_AiSummaries PRIMARY KEY CLUSTERED (id)
    );
    CREATE UNIQUE INDEX UX_AiSummaries_key ON core.AiSummaries (tenant_id, kind, payload_hash);
    CREATE INDEX IX_AiSummaries_used ON core.AiSummaries (tenant_id, used_at);
END
