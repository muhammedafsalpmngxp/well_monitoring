/* ============================================================================
   core.MarketplaceCatalogs -- visual catalogs a tenant registers from the
   marketplace screen, replacing hard-coded URLs in appsettings.

   url is user-supplied and therefore checked by OutboundUrlGuard on every
   fetch (https only, no private or loopback hosts). auth_value_encrypted is
   AES-encrypted with ConnectionPasswordHelper and never returned to clients.

   Idempotent: safe to re-run.
   ============================================================================ */
IF SCHEMA_ID(N'core') IS NULL EXEC(N'CREATE SCHEMA core');
GO
IF OBJECT_ID(N'core.MarketplaceCatalogs', N'U') IS NULL
CREATE TABLE core.MarketplaceCatalogs (
    id                    bigint         IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_MarketplaceCatalogs PRIMARY KEY,
    catalog_key           nvarchar(50)   NOT NULL,
    name                  nvarchar(100)  NOT NULL,
    url                   nvarchar(2000) NOT NULL,
    auth_header           nvarchar(100)  NULL,
    auth_value_encrypted  nvarchar(4000) NULL,
    tenant_id             bigint         NOT NULL,
    created_by            bigint         NOT NULL,
    created_at            datetime2(7)   NOT NULL CONSTRAINT DF_core_MarketplaceCatalogs_created_at DEFAULT SYSUTCDATETIME(),
    modified_at           datetime2(7)   NOT NULL CONSTRAINT DF_core_MarketplaceCatalogs_modified_at DEFAULT SYSUTCDATETIME(),
    is_deleted            bit            NOT NULL CONSTRAINT DF_core_MarketplaceCatalogs_is_deleted DEFAULT 0
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_core_MarketplaceCatalogs_tenant_key')
    CREATE UNIQUE INDEX UX_core_MarketplaceCatalogs_tenant_key ON core.MarketplaceCatalogs (tenant_id, catalog_key) WHERE is_deleted = 0;
GO
