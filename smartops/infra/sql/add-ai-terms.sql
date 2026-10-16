-- ═════════════════════════════════════════════════════════════════════════════
-- SmartOps Tenant — AI business terms (add-ai-terms.sql)
-- ─────────────────────────────────────────────────────────────────────────────
-- [core].[AiTerms]: the business's own words per dataset and what they mean, e.g.
-- "producing wells" (also "producers") = Status 'P'. The ask-your-data prompt lists them so a
-- question in business language is translated the same way every time. Idempotent.
--
-- Usage:
--   sqlcmd -S <server> -d <tenant database> -i add-ai-terms.sql
--   or open in DBeaver / SSMS and run as one script (no GO separators; USE picks the tenant DB).
-- ═════════════════════════════════════════════════════════════════════════════

SET NOCOUNT ON;

USE [smartops_tenant_TNT-1000];

IF OBJECT_ID('core.AiTerms', 'U') IS NULL
CREATE TABLE core.AiTerms (
    id            bigint         IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_AiTerms PRIMARY KEY,
    tenant_id     bigint         NOT NULL,
    source_type   nvarchar(10)   NOT NULL,   -- view | import
    source_id     bigint         NOT NULL,
    term          nvarchar(100)  NOT NULL,
    synonyms      nvarchar(500)  NULL,       -- comma separated
    column_name   nvarchar(200)  NULL,       -- with value: the term is the filter column = value
    value         nvarchar(400)  NULL,
    meaning       nvarchar(500)  NULL,       -- anything that is not a single filter
    modified_by   nvarchar(100)  NULL,
    modified_at   datetime2      NOT NULL CONSTRAINT DF_core_AiTerms_modified DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_core_AiTerms_term UNIQUE (tenant_id, source_type, source_id, term)
);
