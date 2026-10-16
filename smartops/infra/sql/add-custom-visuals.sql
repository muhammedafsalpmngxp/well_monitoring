/* ============================================================================
   core.CustomVisuals — chart visuals installed from a marketplace catalog, or
   authored in-house.

   A row here is registered at runtime as a renderer for the 'customvisual'
   chart type, so a tenant gains a visual without a code change or deployment.

   options_template_json is DECLARATIVE JSON ONLY, validated on write by
   CustomVisualValidator: it renders in every viewer's browser, so a template
   able to carry JavaScript would be stored XSS across the tenant.

   Idempotent: safe to re-run.
   ============================================================================ */

IF SCHEMA_ID(N'core') IS NULL
    EXEC(N'CREATE SCHEMA core');
GO

IF OBJECT_ID(N'core.CustomVisuals', N'U') IS NULL
CREATE TABLE core.CustomVisuals (
    id                     bigint         IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_CustomVisuals PRIMARY KEY,
    visual_key             nvarchar(50)   NOT NULL,
    display_name           nvarchar(100)  NOT NULL,
    description            nvarchar(500)  NULL,
    icon                   nvarchar(50)   NULL,
    render_kind            nvarchar(30)   NOT NULL
        CONSTRAINT DF_core_CustomVisuals_render_kind DEFAULT N'highcharts-template',
    data_roles_json        nvarchar(max)  NOT NULL
        CONSTRAINT DF_core_CustomVisuals_data_roles DEFAULT N'[]',
    options_template_json  nvarchar(max)  NOT NULL
        CONSTRAINT DF_core_CustomVisuals_options DEFAULT N'{}',
    is_active              bit            NOT NULL CONSTRAINT DF_core_CustomVisuals_is_active DEFAULT 1,

    -- Null when authored in this tenant rather than installed from a catalog.
    catalog_id             nvarchar(50)   NULL,
    catalog_plugin_id      nvarchar(100)  NULL,
    installed_version      nvarchar(30)   NULL,

    tenant_id              bigint         NOT NULL,
    created_by             bigint         NOT NULL,
    created_at             datetime2(7)   NOT NULL CONSTRAINT DF_core_CustomVisuals_created_at DEFAULT SYSUTCDATETIME(),
    modified_by            bigint         NULL,
    modified_at            datetime2(7)   NOT NULL CONSTRAINT DF_core_CustomVisuals_modified_at DEFAULT SYSUTCDATETIME(),
    is_deleted             bit            NOT NULL CONSTRAINT DF_core_CustomVisuals_is_deleted DEFAULT 0
);
GO

/* A widget references its visual by key alone, so two live visuals sharing one
   would make rendering ambiguous. Filtered so a key frees up after uninstall. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_core_CustomVisuals_tenant_key')
    CREATE UNIQUE INDEX UX_core_CustomVisuals_tenant_key
        ON core.CustomVisuals (tenant_id, visual_key)
        WHERE is_deleted = 0;
GO

/* Answers "is this plugin already installed?" when rendering the catalog. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_core_CustomVisuals_catalog')
    CREATE INDEX IX_core_CustomVisuals_catalog
        ON core.CustomVisuals (tenant_id, catalog_id, catalog_plugin_id)
        WHERE is_deleted = 0;
GO
