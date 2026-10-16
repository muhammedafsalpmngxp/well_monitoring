/* ----------------------------------------------------------------------------
   Data governance: core.DataDictionary — business documentation for dataset
   columns (imports and database views). One row per column; a row with a NULL
   column_name documents the dataset itself. Idempotent; run once per tenant DB.
   ---------------------------------------------------------------------------- */

IF OBJECT_ID(N'core.DataDictionary', N'U') IS NULL
CREATE TABLE core.DataDictionary (
    id              bigint         IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_DataDictionary PRIMARY KEY,
    dataset_kind    varchar(20)    NOT NULL,            -- import | view
    dataset_id      bigint         NOT NULL,
    column_name     nvarchar(200)  NULL,                -- NULL = dataset-level entry
    business_name   nvarchar(200)  NULL,
    description     nvarchar(2000) NULL,
    owner           nvarchar(200)  NULL,
    sensitivity     varchar(20)    NOT NULL DEFAULT 'internal',  -- public | internal | confidential | pii
    tags            nvarchar(500)  NULL,
    tenant_id       bigint         NOT NULL,
    created_by      bigint         NOT NULL,
    created_at      datetime2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_by     bigint         NULL,
    modified_at     datetime2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
    is_deleted      bit            NOT NULL DEFAULT 0,
    CONSTRAINT CK_core_DataDictionary_kind CHECK (dataset_kind IN ('import', 'view')),
    CONSTRAINT CK_core_DataDictionary_sensitivity CHECK (sensitivity IN ('public', 'internal', 'confidential', 'pii'))
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_core_DataDictionary_column')
CREATE UNIQUE INDEX UX_core_DataDictionary_column
    ON core.DataDictionary (tenant_id, dataset_kind, dataset_id, column_name) WHERE is_deleted = 0;
GO
