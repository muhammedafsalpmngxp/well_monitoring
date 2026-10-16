-- ═════════════════════════════════════════════════════════════════════════════
-- SmartOps Tenant — AI grounding (add-ai-knowledge.sql)
-- ─────────────────────────────────────────────────────────────────────────────
-- [core].[AiDatasetNotes]: admin-written business notes per dataset / column, injected into the
-- ask-your-data prompt. [core].[AiExamples]: questions whose answer got a thumbs-up, reused as
-- examples for later questions on the same dataset. Requires add-ai-conversations.sql. Idempotent.
--
-- Usage:
--   sqlcmd -S <server> -d smartops_tenant_TNT-1000 -i add-ai-knowledge.sql
--   or open in DBeaver / SSMS and run as one script (no GO separators; USE picks the tenant DB).
-- ═════════════════════════════════════════════════════════════════════════════

SET NOCOUNT ON;

USE [smartops_tenant_TNT-1000];

IF OBJECT_ID('core.AiDatasetNotes', 'U') IS NULL
BEGIN
    CREATE TABLE core.AiDatasetNotes (
        id            BIGINT IDENTITY(1,1) NOT NULL,
        tenant_id     BIGINT         NOT NULL,
        source_type   NVARCHAR(10)   NOT NULL,   -- view | import
        source_id     BIGINT         NOT NULL,
        column_name   NVARCHAR(200)  NULL,       -- NULL = note about the whole dataset
        note          NVARCHAR(1000) NOT NULL,
        modified_by   NVARCHAR(100)  NULL,
        modified_at   DATETIME2      NOT NULL CONSTRAINT DF_AiDatasetNotes_modified DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_AiDatasetNotes PRIMARY KEY CLUSTERED (id)
    );
    CREATE INDEX IX_AiDatasetNotes_dataset ON core.AiDatasetNotes (tenant_id, source_type, source_id);
END

IF COL_LENGTH('core.AiDatasetNotes', 'display_name') IS NULL
ALTER TABLE core.AiDatasetNotes ADD display_name nvarchar(200) NULL;  -- what people call the column; used in headers, prompts and answers

IF OBJECT_ID('core.AiExamples', 'U') IS NULL
BEGIN
    CREATE TABLE core.AiExamples (
        id               BIGINT IDENTITY(1,1) NOT NULL,
        tenant_id        BIGINT         NOT NULL,
        source_type      NVARCHAR(10)   NOT NULL,
        source_id        BIGINT         NOT NULL,
        message_id       BIGINT         NOT NULL,   -- core.AiChatMessages.id of the liked answer
        question         NVARCHAR(2000) NOT NULL,
        query_spec_json  NVARCHAR(MAX)  NOT NULL,
        created_by       NVARCHAR(100)  NOT NULL,
        created_at       DATETIME2      NOT NULL CONSTRAINT DF_AiExamples_created DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_AiExamples PRIMARY KEY CLUSTERED (id),
        CONSTRAINT UQ_AiExamples_message UNIQUE (message_id)
    );
    CREATE INDEX IX_AiExamples_dataset ON core.AiExamples (tenant_id, source_type, source_id);
END
