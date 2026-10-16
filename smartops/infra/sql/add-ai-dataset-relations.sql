-- ═════════════════════════════════════════════════════════════════════════════
-- SmartOps Tenant — AI relationship graph (add-ai-dataset-relations.sql)
-- ─────────────────────────────────────────────────────────────────────────────
-- Adds [core].[AiDatasetRelations]: links between two datasets through a shared column, found by
-- the Settings → AI Relationships scan or drawn by an admin, then confirmed or rejected. Confirmed
-- links are told to the AI. Idempotent.
--
-- Usage:
--   sqlcmd -S <server> -i add-ai-dataset-relations.sql
--   or open in DBeaver / SSMS and run as one script (no GO separators; USE picks the tenant DB).
-- ═════════════════════════════════════════════════════════════════════════════

SET NOCOUNT ON;

USE [smartops_tenant_TNT-1000];

IF OBJECT_ID('core.AiDatasetRelations', 'U') IS NULL
CREATE TABLE core.AiDatasetRelations (
    id            bigint         IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_AiDatasetRelations PRIMARY KEY,
    tenant_id     bigint         NOT NULL,
    from_type     nvarchar(10)   NOT NULL,   -- view | import
    from_id       bigint         NOT NULL,
    from_name     nvarchar(200)  NOT NULL,
    from_column   nvarchar(200)  NOT NULL,
    to_type       nvarchar(10)   NOT NULL,
    to_id         bigint         NOT NULL,
    to_name       nvarchar(200)  NOT NULL,
    to_column     nvarchar(200)  NOT NULL,
    status        nvarchar(10)   NOT NULL CONSTRAINT DF_core_AiDatasetRelations_status DEFAULT 'suggested',  -- suggested | confirmed | rejected
    overlap       float          NULL,       -- share of sample values shared (0-1)
    modified_by   nvarchar(100)  NULL,
    modified_at   datetime2      NOT NULL CONSTRAINT DF_core_AiDatasetRelations_modified DEFAULT SYSUTCDATETIME()
);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_core_AiDatasetRelations_tenant')
CREATE INDEX IX_core_AiDatasetRelations_tenant ON core.AiDatasetRelations (tenant_id, status);
