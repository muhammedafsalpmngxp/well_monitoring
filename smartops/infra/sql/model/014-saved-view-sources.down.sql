-- =============================================================================
-- T-Wise Tenant: reverses 014-saved-view-sources.sql
-- -----------------------------------------------------------------------------
-- Drops model.DatasetSource.ParamsJson and narrows CK_model_DatasetSource_Kind
-- back to 'table' and 'view'. Stops without changes while a source of kind
-- 'script' is stored, including those of soft-deleted datasets: the narrower
-- constraint would refuse it. Remove those tables from their data models first.
-- Published versions keep the property in their JSON, which the API ignores
-- once the column is gone.
-- Idempotent: each object is changed only while it exists.
--
-- Usage:
--   sqlcmd -S <server> -d smartops_tenant_TNT-1000 -i 014-saved-view-sources.down.sql
-- =============================================================================

SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
SET ANSI_NULLS ON;
GO

IF OBJECT_ID('model.DatasetSource', 'U') IS NOT NULL AND EXISTS (SELECT 1 FROM model.DatasetSource WHERE SourceKind = 'script')
BEGIN
    RAISERROR('Some tables of data models are saved views used as written. Remove them from their data models first. Nothing was changed.', 16, 1);
    RETURN;
END

IF OBJECT_ID('model.CK_model_DatasetSource_ParamsJson', 'C') IS NOT NULL
    ALTER TABLE model.DatasetSource DROP CONSTRAINT CK_model_DatasetSource_ParamsJson;

IF COL_LENGTH('model.DatasetSource', 'ParamsJson') IS NOT NULL ALTER TABLE model.DatasetSource DROP COLUMN ParamsJson;

IF OBJECT_ID('model.DatasetSource', 'U') IS NOT NULL
BEGIN
    IF OBJECT_ID('model.CK_model_DatasetSource_Kind', 'C') IS NOT NULL
        ALTER TABLE model.DatasetSource DROP CONSTRAINT CK_model_DatasetSource_Kind;
    ALTER TABLE model.DatasetSource ADD CONSTRAINT CK_model_DatasetSource_Kind
        CHECK (SourceKind COLLATE Latin1_General_BIN2 IN ('table', 'view') AND SourceKind NOT LIKE '% ');
END
GO
