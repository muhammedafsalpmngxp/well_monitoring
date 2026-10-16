-- =============================================================================
-- T-Wise Tenant: tables from another database of the same server
-- (013-source-connection.sql)
-- -----------------------------------------------------------------------------
-- Adds model.DatasetSource.ConnectionId, the connection whose database holds a
-- table when it is not the data model's own. NULL reads the model's database,
-- so every existing source keeps reading what it reads now. The API allows
-- only an active SQL Server connection on the model's server and port, and
-- reads such a table as [database].[schema].[table] through the model's
-- connection. Views stay on the model's own database.
-- Changes no data. Run 001 first: without its tables this script changes nothing.
-- Idempotent: the column and its foreign key are added only while missing.
--
-- Usage:
--   sqlcmd -S <server> -d smartops_tenant_TNT-1000 -i 013-source-connection.sql
-- Reverse with 013-source-connection.down.sql.
-- =============================================================================

SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
SET ANSI_NULLS ON;
GO

IF OBJECT_ID('model.DatasetSource', 'U') IS NOT NULL AND COL_LENGTH('model.DatasetSource', 'ConnectionId') IS NULL
    ALTER TABLE model.DatasetSource ADD ConnectionId BIGINT NULL;
GO

IF COL_LENGTH('model.DatasetSource', 'ConnectionId') IS NOT NULL AND OBJECT_ID('model.FK_model_DatasetSource_Connection', 'F') IS NULL
    ALTER TABLE model.DatasetSource ADD CONSTRAINT FK_model_DatasetSource_Connection
        FOREIGN KEY (ConnectionId) REFERENCES core.DatabaseConnections (Id);
GO
