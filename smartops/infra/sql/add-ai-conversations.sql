-- ═════════════════════════════════════════════════════════════════════════════
-- SmartOps Tenant — AI "ask your data" conversations (add-ai-conversations.sql)
-- ─────────────────────────────────────────────────────────────────────────────
-- Creates [core].[AiConversations] (one thread per user per dataset) and [core].[AiChatMessages]
-- (user questions and assistant answers with the query spec that produced them).
-- Requires add-ai-settings.sql. Idempotent.
--
-- Usage:
--   sqlcmd -S <server> -d smartops_tenant_TNT-1000 -i add-ai-conversations.sql
--   or open in DBeaver / SSMS and run as one script (no GO separators; USE picks the tenant DB).
-- ═════════════════════════════════════════════════════════════════════════════

SET NOCOUNT ON;

USE [smartops_tenant_TNT-1000];

IF OBJECT_ID('core.AiConversations', 'U') IS NULL
BEGIN
    CREATE TABLE core.AiConversations (
        id            BIGINT IDENTITY(1,1) NOT NULL,
        tenant_id     BIGINT         NOT NULL,
        user_id       NVARCHAR(100)  NOT NULL,
        source_type   NVARCHAR(10)   NOT NULL,   -- view | import
        source_id     BIGINT         NOT NULL,
        source_name   NVARCHAR(200)  NOT NULL,
        title         NVARCHAR(120)  NOT NULL,   -- first question
        created_at    DATETIME2      NOT NULL CONSTRAINT DF_AiConversations_created DEFAULT SYSUTCDATETIME(),
        modified_at   DATETIME2      NOT NULL CONSTRAINT DF_AiConversations_modified DEFAULT SYSUTCDATETIME(),
        is_deleted    BIT            NOT NULL CONSTRAINT DF_AiConversations_deleted DEFAULT 0,
        CONSTRAINT PK_AiConversations PRIMARY KEY CLUSTERED (id)
    );
    CREATE INDEX IX_AiConversations_tenant_user ON core.AiConversations (tenant_id, user_id, modified_at DESC);
END

IF OBJECT_ID('core.AiChatMessages', 'U') IS NULL
BEGIN
    CREATE TABLE core.AiChatMessages (
        id               BIGINT IDENTITY(1,1) NOT NULL,
        conversation_id  BIGINT         NOT NULL,
        role             NVARCHAR(10)   NOT NULL,   -- user | assistant
        content          NVARCHAR(MAX)  NOT NULL,
        query_spec_json  NVARCHAR(MAX)  NULL,       -- assistant turns only
        created_at       DATETIME2      NOT NULL CONSTRAINT DF_AiChatMessages_created DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_AiChatMessages PRIMARY KEY CLUSTERED (id),
        CONSTRAINT FK_AiChatMessages_conversation FOREIGN KEY (conversation_id) REFERENCES core.AiConversations (id)
    );
    CREATE INDEX IX_AiChatMessages_conversation ON core.AiChatMessages (conversation_id, id);
END
-- Assistant turns: what the panel showed with the answer (result rows up to AiHistory:SavedRows, chart, findings,
-- Ask Data query, next questions) as JSON, so a reopened chat shows its table and chart. NULL = older answer.
IF COL_LENGTH('core.AiChatMessages', 'answer_json') IS NULL
    ALTER TABLE core.AiChatMessages ADD answer_json NVARCHAR(MAX) NULL;
