-- =============================================================================
-- T-Wise Tenant: import schema (004-import-schema.sql)
-- -----------------------------------------------------------------------------
-- Creates schema [import], which holds one table per sheet uploaded through
-- Model Studio's Get Data navigator, and model.ImportTable, which records where
-- each of those tables came from. The Tenant API creates, fills and replaces the
-- tables in [import]; this script creates no data table itself.
-- Additive only. Idempotent: safe to run more than once.
--
-- Permissions: the Tenant API runs CREATE TABLE, DROP TABLE and bulk inserts in
-- [import]. On QA it connects as sa, which needs nothing more. A least-privilege
-- login needs, for example (not run by this script):
--   GRANT CREATE TABLE TO [<api user>];
--   GRANT ALTER, SELECT, INSERT, DELETE ON SCHEMA::import TO [<api user>];
--
-- Usage:
--   sqlcmd -S <server> -d smartops_tenant_TNT-1000 -i 004-import-schema.sql
-- Reverse with 004-import-schema.down.sql.
-- =============================================================================

SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
SET ANSI_NULLS ON;
GO

IF SCHEMA_ID('import') IS NULL
    EXEC('CREATE SCHEMA import;');
GO

IF OBJECT_ID('model.ImportTable', 'U') IS NULL
BEGIN
    CREATE TABLE model.ImportTable (
        Id            BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_model_ImportTable PRIMARY KEY,
        TenantId      BIGINT         NOT NULL,
        ConnectionId  BIGINT         NOT NULL CONSTRAINT FK_model_ImportTable_Connection REFERENCES core.DatabaseConnections (Id),
        -- The table's name in [import]: a letter, then letters, digits and underscores.
        -- Binary collation so the ranges mean ASCII letters under any database collation.
        TableName     NVARCHAR(100)  NOT NULL CONSTRAINT CK_model_ImportTable_TableName
                                     CHECK (TableName COLLATE Latin1_General_BIN2 LIKE '[A-Za-z]%'
                                        AND TableName COLLATE Latin1_General_BIN2 NOT LIKE '%[^A-Za-z0-9_]%'),
        FileName      NVARCHAR(260)  NOT NULL,
        SheetName     NVARCHAR(128)  NULL,
        -- Rows of the sheet, counted from 1 as in the spreadsheet.
        HeaderRow     INT            NOT NULL CONSTRAINT CK_model_ImportTable_HeaderRow CHECK (HeaderRow >= 1),
        LastRow       INT            NOT NULL,
        LoadedRows    INT            NOT NULL CONSTRAINT CK_model_ImportTable_LoadedRows CHECK (LoadedRows >= 0),
        CreatedBy     BIGINT         NOT NULL,
        CreatedAt     DATETIME2      NOT NULL CONSTRAINT DF_model_ImportTable_CreatedAt DEFAULT (SYSUTCDATETIME()),
        ModifiedBy    BIGINT         NULL,
        ModifiedAt    DATETIME2      NOT NULL CONSTRAINT DF_model_ImportTable_ModifiedAt DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT CK_model_ImportTable_Rows CHECK (LastRow > HeaderRow),
        -- One registry row per physical table: the name is unique in the database, not per tenant.
        CONSTRAINT UQ_model_ImportTable_TableName UNIQUE (TableName)
    );
END
GO
