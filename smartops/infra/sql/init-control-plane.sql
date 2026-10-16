-- ═════════════════════════════════════════════════════════════════════════════
-- SmartOps — Control Plane database  (init-control-plane.sql)
-- ─────────────────────────────────────────────────────────────────────────────
-- Creates the shared CONTROL PLANE database, separate from the existing
-- operational DB (AppMasterDB). Holds tenant metadata, the canonical model
-- catalogue, per-tenant source & field-mapping (adapter) config, access control,
-- feature flags, and ops logs. NO tenant operational data lives here.
--
-- Authoritative schema source: smartops/docs/smartops_control_plane (1).dbml
--
-- ─────────────────────────────────────────────────────────────────────────────
-- NO connection details are hard-coded here. The database NAME is supplied as the
-- sqlcmd scripting variable $(ControlPlaneDb); the server / user / password come
-- from the config file  smartops/infra/sql/controlplane.env.
--
-- RUN VIA THE RUNNER (reads controlplane.env, never touches existing configs):
--     pwsh ./run-control-plane.ps1            # from smartops/infra/sql
--
-- Or invoke directly, passing the DB name explicitly:
--     sqlcmd -S <server> -U <user> -P <pwd> -C -b \
--            -v ControlPlaneDb="smartops_control_plain" -i init-control-plane.sql
--
-- SAFETY
--   • Targets ONLY the database named by $(ControlPlaneDb). Never references AppMasterDB.
--   • Idempotent: re-runnable. IF NOT EXISTS guards everywhere; never DROPs anything.
-- ═════════════════════════════════════════════════════════════════════════════

SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

-- ── 1. Database ──────────────────────────────────────────────────────────────
IF DB_ID(N'$(ControlPlaneDb)') IS NULL
BEGIN
    PRINT 'Creating database [$(ControlPlaneDb)] ...';
    CREATE DATABASE [$(ControlPlaneDb)];
END
ELSE
    PRINT 'Database [$(ControlPlaneDb)] already exists — leaving as-is.';
GO

USE [$(ControlPlaneDb)];
GO

-- ── 2. Schema ────────────────────────────────────────────────────────────────
IF SCHEMA_ID(N'control') IS NULL
    EXEC(N'CREATE SCHEMA control AUTHORIZATION dbo;');
GO

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. TABLES  (created parent-first so inline FKs resolve)
--    Audit columns (is_active, created_at, modified_at) carry sane defaults.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── Group A: independent parents ─────────────────────────────────────────────

IF OBJECT_ID(N'control.Region', N'U') IS NULL
CREATE TABLE control.Region (
    region_id    int            IDENTITY(1,1) NOT NULL CONSTRAINT PK_control_Region PRIMARY KEY,
    region_code  varchar(20)    NOT NULL CONSTRAINT UQ_control_Region_code UNIQUE,
    region_name  varchar(100)   NULL,
    is_active    bit            NOT NULL DEFAULT 1,
    created_at   datetime2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at  datetime2(3)   NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF OBJECT_ID(N'control.SchemaVersion', N'U') IS NULL
CREATE TABLE control.SchemaVersion (
    schema_version_id int          IDENTITY(1,1) NOT NULL CONSTRAINT PK_control_SchemaVersion PRIMARY KEY,
    version_no        varchar(20)  NOT NULL CONSTRAINT UQ_control_SchemaVersion_no UNIQUE,
    description       varchar(200) NULL,
    released_at       datetime2(3) NULL,
    is_current        bit          NOT NULL DEFAULT 0,
    is_active         bit          NOT NULL DEFAULT 1,
    created_at        datetime2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at       datetime2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF OBJECT_ID(N'control.SourceSystem', N'U') IS NULL
CREATE TABLE control.SourceSystem (
    source_system_id int          IDENTITY(1,1) NOT NULL CONSTRAINT PK_control_SourceSystem PRIMARY KEY,
    source_code      varchar(20)  NOT NULL CONSTRAINT UQ_control_SourceSystem_code UNIQUE,
    source_name      varchar(100) NULL,
    source_kind      varchar(50)  NULL,
    is_active        bit          NOT NULL DEFAULT 1,
    created_at       datetime2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at      datetime2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF OBJECT_ID(N'control.AppUser', N'U') IS NULL
CREATE TABLE control.AppUser (
    user_id      bigint        IDENTITY(1,1) NOT NULL CONSTRAINT PK_control_AppUser PRIMARY KEY,
    email        varchar(160)  NOT NULL CONSTRAINT UQ_control_AppUser_email UNIQUE,
    display_name varchar(100)  NULL,
    is_sso       bit           NOT NULL DEFAULT 0,
    status       varchar(20)   NULL,
    is_active    bit           NOT NULL DEFAULT 1,
    last_login_at datetime2(3) NULL,
    created_at   datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at  datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

-- Backfill last_login_at for databases created before this column existed
IF COL_LENGTH(N'control.AppUser', N'last_login_at') IS NULL
    ALTER TABLE control.AppUser ADD last_login_at datetime2(3) NULL;
GO


IF OBJECT_ID(N'control.Role', N'U') IS NULL
CREATE TABLE control.Role (
    role_id     int           IDENTITY(1,1) NOT NULL CONSTRAINT PK_control_Role PRIMARY KEY,
    role_code   varchar(40)   NOT NULL,
    role_name   varchar(100)  NULL,
    scope       varchar(20)   NULL,
    tenant_id   bigint        NULL CONSTRAINT FK_Role_Tenant FOREIGN KEY REFERENCES control.Tenant(tenant_id),
    is_active   bit           NOT NULL DEFAULT 1,
    created_at  datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    is_deleted  bit           NOT NULL DEFAULT 0,
    deleted_at  datetime2(3)  NULL,
    INDEX IX_Role_code_tenant  UNIQUE (role_code, tenant_id) WHERE tenant_id IS NOT NULL,
    INDEX IX_Role_code_system  UNIQUE (role_code) WHERE tenant_id IS NULL AND is_deleted = 0
);
GO

IF OBJECT_ID(N'control.Feature', N'U') IS NULL
CREATE TABLE control.Feature (
    feature_id   int          IDENTITY(1,1) NOT NULL CONSTRAINT PK_control_Feature PRIMARY KEY,
    feature_code varchar(40)  NOT NULL CONSTRAINT UQ_control_Feature_code UNIQUE,
    feature_name varchar(100) NULL,
    is_active    bit          NOT NULL DEFAULT 1,
    created_at   datetime2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at  datetime2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

-- ── Group B: depend on Group A ───────────────────────────────────────────────

IF OBJECT_ID(N'control.Tenant', N'U') IS NULL
CREATE TABLE control.Tenant (
    tenant_id         bigint       IDENTITY(1,1) NOT NULL CONSTRAINT PK_control_Tenant PRIMARY KEY,
    tenant_code       varchar(20)  NOT NULL CONSTRAINT UQ_control_Tenant_code UNIQUE,
    tenant_name       varchar(100) NULL,
    region_id         int          NULL,
    isolation_mode    varchar(20)  NULL,   -- database_per_tenant | schema_per_tenant | pooled
    data_plane_ref    varchar(200) NULL,   -- pointer to the tenant DB/schema
    schema_version_id int          NULL,
    status            varchar(20)  NULL,
    is_active         bit          NOT NULL DEFAULT 1,
    created_at        datetime2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at       datetime2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_Tenant_Region        FOREIGN KEY (region_id)         REFERENCES control.Region(region_id),
    CONSTRAINT FK_Tenant_SchemaVersion FOREIGN KEY (schema_version_id) REFERENCES control.SchemaVersion(schema_version_id)
);
GO

IF OBJECT_ID(N'control.CanonicalEntity', N'U') IS NULL
CREATE TABLE control.CanonicalEntity (
    canonical_entity_id int          IDENTITY(1,1) NOT NULL CONSTRAINT PK_control_CanonicalEntity PRIMARY KEY,
    entity_name         varchar(100) NOT NULL CONSTRAINT UQ_control_CanonicalEntity_name UNIQUE,
    schema_version_id   int          NULL,
    layer               varchar(10)  NULL,   -- ref | core
    description         varchar(200) NULL,
    is_active           bit          NOT NULL DEFAULT 1,
    created_at          datetime2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at         datetime2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_CanonicalEntity_SchemaVersion FOREIGN KEY (schema_version_id) REFERENCES control.SchemaVersion(schema_version_id)
);
GO

IF OBJECT_ID(N'control.TenantSource', N'U') IS NULL
CREATE TABLE control.TenantSource (
    tenant_source_id    bigint       IDENTITY(1,1) NOT NULL CONSTRAINT PK_control_TenantSource PRIMARY KEY,
    tenant_id           bigint       NOT NULL,
    source_system_id    int          NOT NULL,
    connection_ref      varchar(200) NULL,   -- secrets-vault key, never a password
    ingestion_mode      varchar(20)  NULL,   -- one_time | continuous
    is_system_of_record bit          NOT NULL DEFAULT 0,
    status              varchar(20)  NULL,
    is_active           bit          NOT NULL DEFAULT 1,
    created_at          datetime2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at         datetime2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_TenantSource_Tenant       FOREIGN KEY (tenant_id)        REFERENCES control.Tenant(tenant_id),
    CONSTRAINT FK_TenantSource_SourceSystem FOREIGN KEY (source_system_id) REFERENCES control.SourceSystem(source_system_id),
    CONSTRAINT UQ_control_TenantSource UNIQUE (tenant_id, source_system_id)
);
GO

IF OBJECT_ID(N'control.UserTenantRole', N'U') IS NULL
CREATE TABLE control.UserTenantRole (
    user_tenant_role_id bigint       IDENTITY(1,1) NOT NULL CONSTRAINT PK_control_UserTenantRole PRIMARY KEY,
    user_id             bigint       NOT NULL,
    tenant_id           bigint       NOT NULL,
    role_id             int          NOT NULL,
    is_active           bit          NOT NULL DEFAULT 1,
    created_at          datetime2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at         datetime2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_UserTenantRole_AppUser FOREIGN KEY (user_id)   REFERENCES control.AppUser(user_id),
    CONSTRAINT FK_UserTenantRole_Tenant  FOREIGN KEY (tenant_id) REFERENCES control.Tenant(tenant_id),
    CONSTRAINT FK_UserTenantRole_Role    FOREIGN KEY (role_id)   REFERENCES control.Role(role_id),
    CONSTRAINT UQ_control_UserTenantRole UNIQUE (user_id, tenant_id, role_id)
);
GO

IF OBJECT_ID(N'control.TenantFeature', N'U') IS NULL
CREATE TABLE control.TenantFeature (
    tenant_feature_id bigint       IDENTITY(1,1) NOT NULL CONSTRAINT PK_control_TenantFeature PRIMARY KEY,
    tenant_id         bigint       NOT NULL,
    feature_id        int          NOT NULL,
    is_enabled        bit          NOT NULL DEFAULT 0,
    valid_from        datetime2(3) NULL,
    valid_to          datetime2(3) NULL,
    is_active         bit          NOT NULL DEFAULT 1,
    created_at        datetime2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at       datetime2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_TenantFeature_Tenant  FOREIGN KEY (tenant_id)  REFERENCES control.Tenant(tenant_id),
    CONSTRAINT FK_TenantFeature_Feature FOREIGN KEY (feature_id) REFERENCES control.Feature(feature_id),
    CONSTRAINT UQ_control_TenantFeature UNIQUE (tenant_id, feature_id)
);
GO

-- ── Group C: depend on Group B ───────────────────────────────────────────────

IF OBJECT_ID(N'control.CanonicalField', N'U') IS NULL
CREATE TABLE control.CanonicalField (
    canonical_field_id  int          IDENTITY(1,1) NOT NULL CONSTRAINT PK_control_CanonicalField PRIMARY KEY,
    canonical_entity_id int          NOT NULL,
    field_name          varchar(100) NOT NULL,
    data_type           varchar(50)  NULL,
    is_required         bit          NOT NULL DEFAULT 0,
    description         varchar(200) NULL,
    is_active           bit          NOT NULL DEFAULT 1,
    created_at          datetime2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at         datetime2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_CanonicalField_CanonicalEntity FOREIGN KEY (canonical_entity_id) REFERENCES control.CanonicalEntity(canonical_entity_id),
    CONSTRAINT UQ_control_CanonicalField UNIQUE (canonical_entity_id, field_name)
);
GO

IF OBJECT_ID(N'control.FieldMapping', N'U') IS NULL
CREATE TABLE control.FieldMapping (
    field_mapping_id   bigint         IDENTITY(1,1) NOT NULL CONSTRAINT PK_control_FieldMapping PRIMARY KEY,
    tenant_source_id   bigint         NOT NULL,
    canonical_field_id int            NOT NULL,
    source_object      varchar(128)   NULL,
    source_field       varchar(128)   NULL,
    transform_rule     nvarchar(max)  NULL,
    is_active          bit            NOT NULL DEFAULT 1,
    created_at         datetime2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at        datetime2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_FieldMapping_TenantSource   FOREIGN KEY (tenant_source_id)   REFERENCES control.TenantSource(tenant_source_id),
    CONSTRAINT FK_FieldMapping_CanonicalField FOREIGN KEY (canonical_field_id) REFERENCES control.CanonicalField(canonical_field_id),
    CONSTRAINT UQ_control_FieldMapping UNIQUE (tenant_source_id, canonical_field_id)
);
GO

IF OBJECT_ID(N'control.CapabilityProfile', N'U') IS NULL
CREATE TABLE control.CapabilityProfile (
    capability_id      bigint       IDENTITY(1,1) NOT NULL CONSTRAINT PK_control_CapabilityProfile PRIMARY KEY,
    tenant_source_id   bigint       NOT NULL,
    canonical_field_id int          NOT NULL,
    is_available       bit          NOT NULL DEFAULT 0,
    note               varchar(200) NULL,
    is_active          bit          NOT NULL DEFAULT 1,
    created_at         datetime2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at        datetime2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_CapabilityProfile_TenantSource   FOREIGN KEY (tenant_source_id)   REFERENCES control.TenantSource(tenant_source_id),
    CONSTRAINT FK_CapabilityProfile_CanonicalField FOREIGN KEY (canonical_field_id) REFERENCES control.CanonicalField(canonical_field_id),
    CONSTRAINT UQ_control_CapabilityProfile UNIQUE (tenant_source_id, canonical_field_id)
);
GO

IF OBJECT_ID(N'control.IngestionRun', N'U') IS NULL
CREATE TABLE control.IngestionRun (
    ingestion_run_id bigint       IDENTITY(1,1) NOT NULL CONSTRAINT PK_control_IngestionRun PRIMARY KEY,
    tenant_source_id bigint       NOT NULL,
    started_at       datetime2(3) NULL,
    finished_at      datetime2(3) NULL,
    status           varchar(20)  NULL,
    rows_extracted   int          NULL,
    rows_loaded      int          NULL,
    error_count      int          NULL,
    created_at       datetime2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_IngestionRun_TenantSource FOREIGN KEY (tenant_source_id) REFERENCES control.TenantSource(tenant_source_id)
);
GO

IF OBJECT_ID(N'control.AuditEvent', N'U') IS NULL
CREATE TABLE control.AuditEvent (
    audit_event_id bigint        IDENTITY(1,1) NOT NULL CONSTRAINT PK_control_AuditEvent PRIMARY KEY,
    tenant_id      bigint        NULL,   -- nullable: platform-level events
    user_id        bigint        NULL,   -- nullable: system events
    action         varchar(80)   NULL,
    entity         varchar(80)   NULL,
    detail         nvarchar(max) NULL,
    occurred_at    datetime2(3)  NULL,
    created_at     datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_AuditEvent_Tenant  FOREIGN KEY (tenant_id) REFERENCES control.Tenant(tenant_id),
    CONSTRAINT FK_AuditEvent_AppUser FOREIGN KEY (user_id)   REFERENCES control.AppUser(user_id)
);
GO

PRINT 'Schema + 16 control-plane tables ensured.';
GO

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. PHASE-1 PLATFORM SEED  (loaded before any tenant exists)
--    IDs are pinned via IDENTITY_INSERT to match the design docs & sample data,
--    so future tenant rows that reference them line up exactly.
--    Each row is guarded by IF NOT EXISTS — safe to re-run.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── Region ───────────────────────────────────────────────────────────────────
SET IDENTITY_INSERT control.Region ON;
IF NOT EXISTS (SELECT 1 FROM control.Region WHERE region_id = 1)
    INSERT control.Region (region_id, region_code, region_name) VALUES (1, 'me-central-1', 'UAE Central');
IF NOT EXISTS (SELECT 1 FROM control.Region WHERE region_id = 2)
    INSERT control.Region (region_id, region_code, region_name) VALUES (2, 'eu-west-1', 'Ireland');
SET IDENTITY_INSERT control.Region OFF;
GO

-- ── SchemaVersion (canonical template versions; 1.2.0 is current) ─────────────
SET IDENTITY_INSERT control.SchemaVersion ON;
IF NOT EXISTS (SELECT 1 FROM control.SchemaVersion WHERE schema_version_id = 1)
    INSERT control.SchemaVersion (schema_version_id, version_no, description, is_current) VALUES (1, '1.0.0', 'Initial canonical model', 0);
IF NOT EXISTS (SELECT 1 FROM control.SchemaVersion WHERE schema_version_id = 2)
    INSERT control.SchemaVersion (schema_version_id, version_no, description, is_current) VALUES (2, '1.1.0', 'Consolidated core.Well', 0);
IF NOT EXISTS (SELECT 1 FROM control.SchemaVersion WHERE schema_version_id = 3)
    INSERT control.SchemaVersion (schema_version_id, version_no, description, is_current) VALUES (3, '1.2.0', 'Added flowline_status_id; ref.RigState', 1);
SET IDENTITY_INSERT control.SchemaVersion OFF;
GO

-- ── SourceSystem (catalogue of source TYPES) ─────────────────────────────────
SET IDENTITY_INSERT control.SourceSystem ON;
IF NOT EXISTS (SELECT 1 FROM control.SourceSystem WHERE source_system_id = 1)
    INSERT control.SourceSystem (source_system_id, source_code, source_name, source_kind) VALUES (1, 'SAP', 'SAP Drilling', 'drilling');
IF NOT EXISTS (SELECT 1 FROM control.SourceSystem WHERE source_system_id = 2)
    INSERT control.SourceSystem (source_system_id, source_code, source_name, source_kind) VALUES (2, 'ACC', 'Autodesk Construction Cloud', 'documents');
IF NOT EXISTS (SELECT 1 FROM control.SourceSystem WHERE source_system_id = 3)
    INSERT control.SourceSystem (source_system_id, source_code, source_name, source_kind) VALUES (3, 'P6', 'Primavera P6', 'scheduling');
IF NOT EXISTS (SELECT 1 FROM control.SourceSystem WHERE source_system_id = 4)
    INSERT control.SourceSystem (source_system_id, source_code, source_name, source_kind) VALUES (4, 'VISE', 'Vise field reporting', 'field_ops');
IF NOT EXISTS (SELECT 1 FROM control.SourceSystem WHERE source_system_id = 5)
    INSERT control.SourceSystem (source_system_id, source_code, source_name, source_kind) VALUES (5, 'SHAREPOINT', 'SharePoint', 'documents');
SET IDENTITY_INSERT control.SourceSystem OFF;
GO

-- ── Role (scope: platform | tenant) ──────────────────────────────────────────
-- Only system roles are seeded here. Tenant-specific roles are created at runtime.
SET IDENTITY_INSERT control.Role ON;
IF NOT EXISTS (SELECT 1 FROM control.Role WHERE role_id = 1)
    INSERT control.Role (role_id, role_code, role_name, scope) VALUES (1, 'PlatformAdmin', 'Platform administrator', 'platform');
IF NOT EXISTS (SELECT 1 FROM control.Role WHERE role_id = 2)
    INSERT control.Role (role_id, role_code, role_name, scope) VALUES (2, 'TenantAdmin', 'Tenant administrator', 'tenant');
SET IDENTITY_INSERT control.Role OFF;
GO

-- ── Feature (toggleable capabilities; IDs match sample data) ──────────────────
SET IDENTITY_INSERT control.Feature ON;
IF NOT EXISTS (SELECT 1 FROM control.Feature WHERE feature_id = 1)
    INSERT control.Feature (feature_id, feature_code, feature_name) VALUES (1, 'ETA_FORECAST', 'Schedule slippage & ETA forecast');
IF NOT EXISTS (SELECT 1 FROM control.Feature WHERE feature_id = 2)
    INSERT control.Feature (feature_id, feature_code, feature_name) VALUES (2, 'SIMILAR_WELL', 'Similar-well benchmarking');
IF NOT EXISTS (SELECT 1 FROM control.Feature WHERE feature_id = 3)
    INSERT control.Feature (feature_id, feature_code, feature_name) VALUES (3, 'REPORT_BUILDER', 'Report builder');
IF NOT EXISTS (SELECT 1 FROM control.Feature WHERE feature_id = 6)
    INSERT control.Feature (feature_id, feature_code, feature_name) VALUES (6, 'PENALTY_FORECAST', 'Penalty exposure & bonus forecast');
SET IDENTITY_INSERT control.Feature OFF;
GO

-- ── CanonicalEntity (catalogue of canonical things; IDs match sample data) ────
SET IDENTITY_INSERT control.CanonicalEntity ON;
IF NOT EXISTS (SELECT 1 FROM control.CanonicalEntity WHERE canonical_entity_id = 10)
    INSERT control.CanonicalEntity (canonical_entity_id, entity_name, schema_version_id, layer) VALUES (10, 'core.Well', 1, 'core');
IF NOT EXISTS (SELECT 1 FROM control.CanonicalEntity WHERE canonical_entity_id = 11)
    INSERT control.CanonicalEntity (canonical_entity_id, entity_name, schema_version_id, layer) VALUES (11, 'core.ScheduleTask', 1, 'core');
IF NOT EXISTS (SELECT 1 FROM control.CanonicalEntity WHERE canonical_entity_id = 12)
    INSERT control.CanonicalEntity (canonical_entity_id, entity_name, schema_version_id, layer) VALUES (12, 'core.Project', 1, 'core');
IF NOT EXISTS (SELECT 1 FROM control.CanonicalEntity WHERE canonical_entity_id = 13)
    INSERT control.CanonicalEntity (canonical_entity_id, entity_name, schema_version_id, layer) VALUES (13, 'ref.Crew', 1, 'ref');
SET IDENTITY_INSERT control.CanonicalEntity OFF;
GO

-- ── CanonicalField (mapping targets; IDs match sample data) ───────────────────
SET IDENTITY_INSERT control.CanonicalField ON;
IF NOT EXISTS (SELECT 1 FROM control.CanonicalField WHERE canonical_field_id = 100)
    INSERT control.CanonicalField (canonical_field_id, canonical_entity_id, field_name, data_type, is_required) VALUES (100, 10, 'well_code', 'nvarchar(20)', 1);
IF NOT EXISTS (SELECT 1 FROM control.CanonicalField WHERE canonical_field_id = 101)
    INSERT control.CanonicalField (canonical_field_id, canonical_entity_id, field_name, data_type, is_required) VALUES (101, 10, 'well_name', 'nvarchar(100)', 0);
IF NOT EXISTS (SELECT 1 FROM control.CanonicalField WHERE canonical_field_id = 110)
    INSERT control.CanonicalField (canonical_field_id, canonical_entity_id, field_name, data_type, is_required) VALUES (110, 11, 'task_code', 'nvarchar(40)', 1);
IF NOT EXISTS (SELECT 1 FROM control.CanonicalField WHERE canonical_field_id = 111)
    INSERT control.CanonicalField (canonical_field_id, canonical_entity_id, field_name, data_type, is_required) VALUES (111, 11, 'actual_end', 'datetime2', 0);
SET IDENTITY_INSERT control.CanonicalField OFF;
GO

-- ═════════════════════════════════════════════════════════════════════════════
-- 5. VERIFY
-- ═════════════════════════════════════════════════════════════════════════════
SELECT t.name AS table_name, p.rows AS row_count
FROM   sys.tables t
JOIN   sys.schemas s ON s.schema_id = t.schema_id
JOIN   sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0,1)
WHERE  s.name = 'control'
ORDER BY t.name;
GO

PRINT 'Control-plane database [$(ControlPlaneDb)] is ready.';
GO
