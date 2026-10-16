/* ============================================================================
   Adds core.DataSourceConnections — pull-based external data sources
   (Google Sheets, Google Drive, REST API).

   Run once against every EXISTING tenant database. New tenant databases get
   this table from init-tenant-schema.sql, which carries the same definition.

   Idempotent: safe to re-run.

   Related: connector data is fetched on demand and materialised into
   core.ImportedDatasets / core.ImportedDataRows, so no new row storage is
   introduced here — only the connection definitions.
   ============================================================================ */

IF SCHEMA_ID(N'core') IS NULL
    EXEC(N'CREATE SCHEMA core');
GO

IF OBJECT_ID(N'core.DataSourceConnections', N'U') IS NULL
CREATE TABLE core.DataSourceConnections (
    id                      bigint        IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_DataSourceConnections PRIMARY KEY,
    connection_name         nvarchar(200) NOT NULL,
    -- google_sheets | google_drive | rest_api
    kind                    varchar(50)   NOT NULL,
    -- none | api_key | bearer | basic | oauth2
    auth_type               varchar(30)   NOT NULL DEFAULT 'none',
    -- AES-256-GCM ciphertext of a JSON credential bag. Never returned by the API.
    credentials_encrypted   nvarchar(max) NULL,
    -- Non-secret, kind-specific settings (url, spreadsheetId, headers, paging...).
    config_json             nvarchar(max) NOT NULL DEFAULT N'{}',
    -- untested | ok | failed — result of the most recent test or ingest.
    last_status             varchar(20)   NULL DEFAULT 'untested',
    last_error_message      nvarchar(500) NULL,
    last_tested_at          datetime2(3)  NULL,
    is_active               bit           NOT NULL DEFAULT 1,
    tenant_id               bigint        NOT NULL,
    created_by              bigint        NOT NULL,
    created_at              datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_by             bigint        NULL,
    modified_at             datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    is_deleted              bit           NOT NULL DEFAULT 0
);
GO

-- Unique data source name per tenant (only non-deleted)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_core_DataSourceConnections_tenant_name')
CREATE UNIQUE INDEX UX_core_DataSourceConnections_tenant_name
    ON core.DataSourceConnections (tenant_id, connection_name)
    WHERE is_deleted = 0;
GO

-- Supports the "list my sources, filtered by kind" grid query
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_core_DataSourceConnections_tenant_kind')
CREATE INDEX IX_core_DataSourceConnections_tenant_kind
    ON core.DataSourceConnections (tenant_id, kind)
    WHERE is_deleted = 0;
GO

-- Reject unknown connector kinds at the database level as well as in the API,
-- so a bad direct insert cannot produce a row no connector can serve.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_core_DataSourceConnections_kind')
ALTER TABLE core.DataSourceConnections
    ADD CONSTRAINT CK_core_DataSourceConnections_kind
    CHECK (kind IN ('google_sheets', 'google_drive', 'rest_api'));
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_core_DataSourceConnections_auth_type')
ALTER TABLE core.DataSourceConnections
    ADD CONSTRAINT CK_core_DataSourceConnections_auth_type
    CHECK (auth_type IN ('none', 'api_key', 'bearer', 'basic', 'oauth2'));
GO

/* ----------------------------------------------------------------------------
   core.DatabaseConnections.provider previously only ever held 'mssql'.
   PostgreSQL and MySQL are now supported, so widen the column if a CHECK
   constraint pinned it to a single value.
   ---------------------------------------------------------------------------- */

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_core_DatabaseConnections_provider')
    ALTER TABLE core.DatabaseConnections DROP CONSTRAINT CK_core_DatabaseConnections_provider;
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_core_DatabaseConnections_provider')
ALTER TABLE core.DatabaseConnections
    ADD CONSTRAINT CK_core_DatabaseConnections_provider
    CHECK (provider IN ('mssql', 'postgres', 'mysql', 'mariadb', 'redshift', 'clickhouse', 'trino'));
GO
