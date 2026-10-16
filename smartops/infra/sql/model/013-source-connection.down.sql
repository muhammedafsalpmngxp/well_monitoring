-- =============================================================================
-- T-Wise Tenant: reverses 013-source-connection.sql
-- -----------------------------------------------------------------------------
-- Drops model.DatasetSource.ConnectionId and its foreign key. Stops without
-- changes while a source reads another database: dropping the column would
-- make that source read a table of the same name in the model's own database.
-- Remove those tables from their data models first. Published versions keep
-- the property in their JSON, which the API ignores once the column is gone.
-- Idempotent: each object is dropped only while it exists.
--
-- Usage:
--   sqlcmd -S <server> -d smartops_tenant_TNT-1000 -i 013-source-connection.down.sql
-- =============================================================================

SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
SET ANSI_NULLS ON;
GO

-- The column is read through sp_executesql: a batch that names a missing column does not compile.
DECLARE @stored bit = 0;
IF COL_LENGTH('model.DatasetSource', 'ConnectionId') IS NOT NULL
    EXEC sp_executesql N'IF EXISTS (SELECT 1 FROM model.DatasetSource WHERE ConnectionId IS NOT NULL) SET @stored = 1;',
        N'@stored bit OUTPUT', @stored = @stored OUTPUT;
IF @stored = 1
BEGIN
    RAISERROR('Some tables of data models read another database. Remove them from their data models first. Nothing was changed.', 16, 1);
    RETURN;
END

IF OBJECT_ID('model.FK_model_DatasetSource_Connection', 'F') IS NOT NULL
    ALTER TABLE model.DatasetSource DROP CONSTRAINT FK_model_DatasetSource_Connection;

IF COL_LENGTH('model.DatasetSource', 'ConnectionId') IS NOT NULL ALTER TABLE model.DatasetSource DROP COLUMN ConnectionId;
GO
