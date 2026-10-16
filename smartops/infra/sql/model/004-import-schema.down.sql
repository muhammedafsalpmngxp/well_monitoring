-- =============================================================================
-- T-Wise Tenant: reverse 004-import-schema.sql
-- Drops model.ImportTable and the empty [import] schema.
-- Stops without changing anything while [import] still holds tables: they hold
-- uploaded data. Drop them by hand first, after checking that no dataset uses
-- them (see README, "Uploaded files (004)").
-- =============================================================================

SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO

IF EXISTS (SELECT 1 FROM sys.tables WHERE schema_id = SCHEMA_ID('import'))
BEGIN
    RAISERROR('Schema import still holds tables with uploaded data. Drop them by hand first. Nothing was changed.', 16, 1);
    RETURN;
END

DROP TABLE IF EXISTS model.ImportTable;

IF SCHEMA_ID('import') IS NOT NULL
    EXEC('DROP SCHEMA import;');
GO
