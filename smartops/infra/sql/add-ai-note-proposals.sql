-- ═════════════════════════════════════════════════════════════════════════════
-- SmartOps Tenant — AI note proposals (add-ai-note-proposals.sql)
-- ─────────────────────────────────────────────────────────────────────────────
-- [core].[AiNoteProposals]: business rules the model extracted after an answered question, pending
-- admin approval into core.AiDatasetNotes. Requires add-ai-knowledge.sql. Idempotent.
--
-- Usage:
--   sqlcmd -S <server> -d smartops_tenant_TNT-1000 -i add-ai-note-proposals.sql
--   or open in DBeaver / SSMS and run as one script (no GO separators; USE picks the tenant DB).
-- ═════════════════════════════════════════════════════════════════════════════

SET NOCOUNT ON;

USE [smartops_tenant_TNT-1000];

IF OBJECT_ID('core.AiNoteProposals', 'U') IS NULL
BEGIN
    CREATE TABLE core.AiNoteProposals (
        id            BIGINT IDENTITY(1,1) NOT NULL,
        tenant_id     BIGINT         NOT NULL,
        source_type   NVARCHAR(10)   NOT NULL,   -- view | import
        source_id     BIGINT         NOT NULL,
        column_name   NVARCHAR(200)  NULL,       -- NULL = whole dataset
        note          NVARCHAR(1000) NOT NULL,
        confidence    NVARCHAR(10)   NOT NULL,   -- low | medium | high
        question      NVARCHAR(2000) NOT NULL,
        status        NVARCHAR(10)   NOT NULL CONSTRAINT DF_AiNoteProposals_status DEFAULT 'pending',
        created_at    DATETIME2      NOT NULL CONSTRAINT DF_AiNoteProposals_created DEFAULT SYSUTCDATETIME(),
        reviewed_by   NVARCHAR(100)  NULL,
        reviewed_at   DATETIME2      NULL,
        CONSTRAINT PK_AiNoteProposals PRIMARY KEY CLUSTERED (id)
    );
    CREATE INDEX IX_AiNoteProposals_dataset ON core.AiNoteProposals (tenant_id, source_type, source_id, status);
END
