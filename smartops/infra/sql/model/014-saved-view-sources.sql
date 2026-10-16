-- =============================================================================
-- T-Wise Tenant: saved views used as written
-- (014-saved-view-sources.sql)
-- -----------------------------------------------------------------------------
-- Widens CK_model_DatasetSource_Kind (001) with 'script': a View Builder view
-- whose SQL is a batch of DECLAREs and one final SELECT, stored in ViewSql as
-- saved and run as written. Adds model.DatasetSource.ParamsJson, a JSON object
-- that binds a variable the batch declares to a field of the data model, for
-- example {"@plant":"Plant.plant_description"}. NULL binds none.
-- Changes no data. Run 001 first: without its tables this script changes nothing.
-- Idempotent: the constraint is recreated only while it lacks 'script', and
-- the column is added only while missing.
--
-- Usage:
--   sqlcmd -S <server> -d smartops_tenant_TNT-1000 -i 014-saved-view-sources.sql
-- Reverse with 014-saved-view-sources.down.sql.
-- =============================================================================

SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
SET ANSI_NULLS ON;
GO

IF OBJECT_ID('model.DatasetSource', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.check_constraints
                   WHERE name = 'CK_model_DatasetSource_Kind' AND parent_object_id = OBJECT_ID('model.DatasetSource')
                     AND definition LIKE '%''script''%')
BEGIN
    IF OBJECT_ID('model.CK_model_DatasetSource_Kind', 'C') IS NOT NULL
        ALTER TABLE model.DatasetSource DROP CONSTRAINT CK_model_DatasetSource_Kind;
    ALTER TABLE model.DatasetSource ADD CONSTRAINT CK_model_DatasetSource_Kind
        CHECK (SourceKind COLLATE Latin1_General_BIN2 IN ('table', 'view', 'script') AND SourceKind NOT LIKE '% ');
END
GO

IF OBJECT_ID('model.DatasetSource', 'U') IS NOT NULL AND COL_LENGTH('model.DatasetSource', 'ParamsJson') IS NULL
    ALTER TABLE model.DatasetSource ADD ParamsJson NVARCHAR(MAX) NULL
        CONSTRAINT CK_model_DatasetSource_ParamsJson CHECK (ParamsJson IS NULL OR ISJSON(ParamsJson) = 1);
GO
