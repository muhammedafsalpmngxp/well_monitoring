-- =============================================================================
-- T-Wise Tenant: calculated columns and transforms (003-calculated-columns-and-transforms.sql)
-- -----------------------------------------------------------------------------
-- Adds model.CalculatedColumn (a calculation on one row of a dataset source, used
-- like a column of it) and model.Transform (a change applied to one column of a
-- source whenever the column is read). Both compile into the SELECT of a query;
-- nothing here, and nothing that uses these tables, changes a source table.
-- Additive only. Idempotent: safe to run more than once.
--
-- Usage:
--   sqlcmd -S <server> -d smartops_tenant_TNT-1000 -i 003-calculated-columns-and-transforms.sql
-- Reverse with 003-calculated-columns-and-transforms.down.sql.
-- =============================================================================

SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
SET ANSI_NULLS ON;
GO

-- As in 001: string CHECKs compare with a binary collation, and NOT LIKE '% ' blocks trailing spaces.

IF OBJECT_ID('model.CalculatedColumn', 'U') IS NULL
BEGIN
    CREATE TABLE model.CalculatedColumn (
        Id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_model_CalculatedColumn PRIMARY KEY,
        DatasetId       BIGINT         NOT NULL CONSTRAINT FK_model_CalculatedColumn_Dataset REFERENCES model.Dataset (Id),
        SourceId        BIGINT         NOT NULL,
        Name            NVARCHAR(128)  NOT NULL CONSTRAINT CK_model_CalculatedColumn_Name CHECK (LEN(Name) > 0),
        ExpressionAst   NVARCHAR(MAX)  NOT NULL CONSTRAINT CK_model_CalculatedColumn_Ast CHECK (ISJSON(ExpressionAst) = 1),
        ExpressionText  NVARCHAR(MAX)  NULL,
        -- The type of the formula's result, decided by its outer operation.
        DataType        NVARCHAR(10)   NOT NULL CONSTRAINT CK_model_CalculatedColumn_DataType CHECK (DataType COLLATE Latin1_General_BIN2 IN ('number', 'text') AND DataType NOT LIKE '% '),
        -- A calculated column belongs to one source of its own dataset.
        CONSTRAINT FK_model_CalculatedColumn_Source FOREIGN KEY (DatasetId, SourceId) REFERENCES model.DatasetSource (DatasetId, Id),
        CONSTRAINT UQ_model_CalculatedColumn_Name UNIQUE (DatasetId, SourceId, Name)
    );
END
GO

IF OBJECT_ID('model.Transform', 'U') IS NULL
BEGIN
    CREATE TABLE model.Transform (
        Id          BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_model_Transform PRIMARY KEY,
        DatasetId   BIGINT         NOT NULL CONSTRAINT FK_model_Transform_Dataset REFERENCES model.Dataset (Id),
        SourceId    BIGINT         NOT NULL,
        -- A column of the source's table. COLUMN is a reserved word, hence ColumnName.
        ColumnName  NVARCHAR(128)  NOT NULL,
        -- Every kind the design spec names. The API accepts trim and null_fill; the query compiler refuses the others.
        Kind        NVARCHAR(20)   NOT NULL CONSTRAINT CK_model_Transform_Kind CHECK (Kind COLLATE Latin1_General_BIN2 IN ('rename', 'type', 'null_fill', 'split', 'merge', 'trim', 'extract') AND Kind NOT LIKE '% '),
        ConfigJson  NVARCHAR(MAX)  NOT NULL CONSTRAINT DF_model_Transform_ConfigJson DEFAULT ('{}')
                                   CONSTRAINT CK_model_Transform_ConfigJson CHECK (ISJSON(ConfigJson) = 1),
        -- The transforms of one source apply in this order.
        SortOrder   INT            NOT NULL,
        CONSTRAINT FK_model_Transform_Source FOREIGN KEY (DatasetId, SourceId) REFERENCES model.DatasetSource (DatasetId, Id)
    );
END
GO
