-- =============================================================================
-- T-Wise Tenant: model schema (001-create-model-schema.sql)
-- -----------------------------------------------------------------------------
-- Creates the [model] schema that stores datasets for the modelling layer:
-- sources, relationships and measures. Additive only; nothing in core changes.
-- Idempotent: safe to run more than once.
--
-- Usage:
--   sqlcmd -S <server> -d smartops_tenant_TNT-1000 -i 001-create-model-schema.sql
-- Reverse with 001-create-model-schema.down.sql.
-- =============================================================================

SET NOCOUNT ON;
-- Required for the filtered unique index; classic sqlcmd defaults QUOTED_IDENTIFIER to OFF.
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

-- The string CHECKs compare with a binary collation so 'Many_To_One' cannot pass under a
-- case-insensitive database collation. NOT LIKE '% ' blocks trailing spaces, which SQL Server
-- ignores in = and IN even under a binary collation.

IF SCHEMA_ID('model') IS NULL
    EXEC('CREATE SCHEMA model;');
GO

IF OBJECT_ID('model.Dataset', 'U') IS NULL
BEGIN
    CREATE TABLE model.Dataset (
        Id            BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_model_Dataset PRIMARY KEY,
        TenantId      BIGINT         NOT NULL,
        ConnectionId  BIGINT         NOT NULL CONSTRAINT FK_model_Dataset_Connection REFERENCES core.DatabaseConnections (Id),
        Name          NVARCHAR(128)  NOT NULL,
        Description   NVARCHAR(500)  NULL,
        Status        NVARCHAR(20)   NOT NULL CONSTRAINT DF_model_Dataset_Status DEFAULT ('draft')
                                     CONSTRAINT CK_model_Dataset_Status CHECK (Status COLLATE Latin1_General_BIN2 IN ('draft', 'published', 'certified') AND Status NOT LIKE '% '),
        CreatedBy     BIGINT         NOT NULL,
        CreatedAt     DATETIME2      NOT NULL CONSTRAINT DF_model_Dataset_CreatedAt DEFAULT (SYSUTCDATETIME()),
        ModifiedBy    BIGINT         NULL,
        ModifiedAt    DATETIME2      NOT NULL CONSTRAINT DF_model_Dataset_ModifiedAt DEFAULT (SYSUTCDATETIME()),
        IsDeleted     BIT            NOT NULL CONSTRAINT DF_model_Dataset_IsDeleted DEFAULT (0)
    );
END
GO

-- Separate from the table, so a re-run creates it if an earlier run stopped after the table.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_model_Dataset_Name' AND object_id = OBJECT_ID('model.Dataset'))
    CREATE UNIQUE INDEX UQ_model_Dataset_Name ON model.Dataset (TenantId, Name) WHERE IsDeleted = 0;
GO

IF OBJECT_ID('model.DatasetSource', 'U') IS NULL
BEGIN
    CREATE TABLE model.DatasetSource (
        Id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_model_DatasetSource PRIMARY KEY,
        DatasetId       BIGINT         NOT NULL CONSTRAINT FK_model_DatasetSource_Dataset REFERENCES model.Dataset (Id),
        SourceKind      NVARCHAR(10)   NOT NULL CONSTRAINT CK_model_DatasetSource_Kind CHECK (SourceKind COLLATE Latin1_General_BIN2 IN ('table', 'view') AND SourceKind NOT LIKE '% '),
        SchemaName      NVARCHAR(128)  NOT NULL,
        SourceName      NVARCHAR(128)  NOT NULL,
        -- No dot: request fields are written alias.column.
        Alias           NVARCHAR(64)   NOT NULL CONSTRAINT CK_model_DatasetSource_Alias CHECK (Alias NOT LIKE '%.%'),
        -- Row-level security. 'plant' filters RlsPlantColumn by the user's plant claims; 'none' is an explicit opt-out.
        RlsMode         NVARCHAR(10)   NOT NULL CONSTRAINT CK_model_DatasetSource_RlsMode CHECK (RlsMode COLLATE Latin1_General_BIN2 IN ('plant', 'none') AND RlsMode NOT LIKE '% '),
        RlsPlantColumn  NVARCHAR(128)  NULL,
        RowEstimate     BIGINT         NULL,
        CONSTRAINT CK_model_DatasetSource_RlsColumn CHECK (RlsMode = 'none' OR RlsPlantColumn IS NOT NULL),
        CONSTRAINT UQ_model_DatasetSource_Alias UNIQUE (DatasetId, Alias),
        -- Target of the Relationship foreign keys, so a relationship stays inside its dataset.
        CONSTRAINT UQ_model_DatasetSource_DatasetId_Id UNIQUE (DatasetId, Id)
    );
END
GO

IF OBJECT_ID('model.Relationship', 'U') IS NULL
BEGIN
    CREATE TABLE model.Relationship (
        Id            BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_model_Relationship PRIMARY KEY,
        DatasetId     BIGINT         NOT NULL CONSTRAINT FK_model_Relationship_Dataset REFERENCES model.Dataset (Id),
        -- For many_to_one, From is the many side and To is the one side.
        FromSourceId  BIGINT         NOT NULL,
        FromColumn    NVARCHAR(128)  NOT NULL,
        ToSourceId    BIGINT         NOT NULL,
        ToColumn      NVARCHAR(128)  NOT NULL,
        Cardinality   NVARCHAR(12)   NOT NULL CONSTRAINT CK_model_Relationship_Cardinality CHECK (Cardinality COLLATE Latin1_General_BIN2 IN ('many_to_one', 'one_to_one') AND Cardinality NOT LIKE '% '),
        IsActive      BIT            NOT NULL CONSTRAINT DF_model_Relationship_IsActive DEFAULT (1),
        DetectedFrom  NVARCHAR(10)   NOT NULL CONSTRAINT CK_model_Relationship_DetectedFrom CHECK (DetectedFrom COLLATE Latin1_General_BIN2 IN ('fk', 'heuristic', 'user') AND DetectedFrom NOT LIKE '% '),
        CONSTRAINT FK_model_Relationship_From FOREIGN KEY (DatasetId, FromSourceId) REFERENCES model.DatasetSource (DatasetId, Id),
        CONSTRAINT FK_model_Relationship_To FOREIGN KEY (DatasetId, ToSourceId) REFERENCES model.DatasetSource (DatasetId, Id),
        CONSTRAINT CK_model_Relationship_NotSelf CHECK (FromSourceId <> ToSourceId)
    );
END
GO

IF OBJECT_ID('model.Measure', 'U') IS NULL
BEGIN
    CREATE TABLE model.Measure (
        Id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_model_Measure PRIMARY KEY,
        DatasetId       BIGINT         NOT NULL CONSTRAINT FK_model_Measure_Dataset REFERENCES model.Dataset (Id),
        Name            NVARCHAR(128)  NOT NULL,
        ExpressionAst   NVARCHAR(MAX)  NOT NULL CONSTRAINT CK_model_Measure_Ast CHECK (ISJSON(ExpressionAst) = 1),
        ExpressionText  NVARCHAR(MAX)  NULL,
        Format          NVARCHAR(32)   NULL,
        Folder          NVARCHAR(128)  NULL,
        IsCertified     BIT            NOT NULL CONSTRAINT DF_model_Measure_IsCertified DEFAULT (0),
        CONSTRAINT UQ_model_Measure_Name UNIQUE (DatasetId, Name)
    );
END
GO
