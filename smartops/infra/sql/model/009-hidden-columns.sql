-- =============================================================================
-- T-Wise Tenant: hidden columns per dataset table
-- (009-hidden-columns.sql)
-- -----------------------------------------------------------------------------
-- Adds model.DatasetSource.HiddenColumns, a JSON array of the column names a
-- modeller hid from report builders (technical keys, raw JSON and the like).
-- Hidden columns still work in relationships, measures and filters; the canvas
-- Data pane leaves them out and Model Studio shows them greyed. NULL hides none.
-- Changes no data. Run 001 first: without its tables this script changes nothing.
-- Idempotent: the column is added only while it is missing.
--
-- Usage:
--   sqlcmd -S <server> -d smartops_tenant_TNT-1000 -i 009-hidden-columns.sql
-- Reverse with 009-hidden-columns.down.sql.
-- =============================================================================

SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
SET ANSI_NULLS ON;
GO

IF OBJECT_ID('model.DatasetSource', 'U') IS NOT NULL AND COL_LENGTH('model.DatasetSource', 'HiddenColumns') IS NULL
    ALTER TABLE model.DatasetSource ADD HiddenColumns NVARCHAR(MAX) NULL
        CONSTRAINT CK_model_DatasetSource_HiddenColumns CHECK (HiddenColumns IS NULL OR ISJSON(HiddenColumns) = 1);
GO
