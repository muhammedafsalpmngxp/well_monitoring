-- =============================================================================
-- T-Wise Tenant: table names and descriptions in a dataset
-- (011-table-names.sql)
-- -----------------------------------------------------------------------------
-- Adds model.DatasetSource.Caption, the table's name as people read it (NULL
-- shows the alias), and model.DatasetSource.Description. Formulas keep using
-- the alias, so nothing that reads the model changes.
-- Changes no data. Run 001 first: without its tables this script changes nothing.
-- Idempotent: each column is added only while it is missing.
--
-- Usage:
--   sqlcmd -S <server> -d smartops_tenant_TNT-1000 -i 011-table-names.sql
-- Reverse with 011-table-names.down.sql.
-- =============================================================================

SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
SET ANSI_NULLS ON;
GO

IF OBJECT_ID('model.DatasetSource', 'U') IS NOT NULL AND COL_LENGTH('model.DatasetSource', 'Caption') IS NULL
    ALTER TABLE model.DatasetSource ADD Caption NVARCHAR(80) NULL;
GO

IF OBJECT_ID('model.DatasetSource', 'U') IS NOT NULL AND COL_LENGTH('model.DatasetSource', 'Description') IS NULL
    ALTER TABLE model.DatasetSource ADD Description NVARCHAR(500) NULL;
GO
