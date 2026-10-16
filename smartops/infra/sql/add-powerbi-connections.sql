/* ============================================================================
   core.PowerBiConnections -- the tenant's Power BI embedding identity: an
   Azure AD app registration (service principal) and the workspace it may
   embed reports from. One row per tenant.

   client_secret_encrypted is AES-encrypted with ConnectionPasswordHelper and
   never returned to clients.

   Idempotent: safe to re-run.
   ============================================================================ */
IF SCHEMA_ID(N'core') IS NULL EXEC(N'CREATE SCHEMA core');
GO
IF OBJECT_ID(N'core.PowerBiConnections', N'U') IS NULL
CREATE TABLE core.PowerBiConnections (
    id                       bigint         IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_PowerBiConnections PRIMARY KEY,
    tenant_id                bigint         NOT NULL,
    azure_tenant_id          nvarchar(36)   NOT NULL,
    client_id                nvarchar(36)   NOT NULL,
    client_secret_encrypted  nvarchar(4000) NOT NULL,
    workspace_id             nvarchar(36)   NOT NULL,
    modified_by              bigint         NOT NULL,
    created_at               datetime2(7)   NOT NULL CONSTRAINT DF_core_PowerBiConnections_created_at DEFAULT SYSUTCDATETIME(),
    modified_at              datetime2(7)   NOT NULL CONSTRAINT DF_core_PowerBiConnections_modified_at DEFAULT SYSUTCDATETIME()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_core_PowerBiConnections_tenant')
    CREATE UNIQUE INDEX UX_core_PowerBiConnections_tenant ON core.PowerBiConnections (tenant_id);
GO
