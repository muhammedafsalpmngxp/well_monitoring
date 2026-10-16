-- ═════════════════════════════════════════════════════════════════════════════
-- SmartOps — Add tenant_id to Role table for tenant-scoped roles
-- Run AFTER init-control-plane.sql
-- Idempotent: skips if column already exists.
-- ═════════════════════════════════════════════════════════════════════════════

SET NOCOUNT ON;
GO

USE [smartops_control_plane];
GO

-- ── 1. Add tenant_id column ──────────────────────────────────────────────────
IF COL_LENGTH('control.Role', 'tenant_id') IS NULL
BEGIN
    ALTER TABLE control.Role
        ADD tenant_id bigint NULL
            CONSTRAINT FK_Role_Tenant FOREIGN KEY REFERENCES control.Tenant(tenant_id);
    PRINT '✓ control.Role.tenant_id column added';
END
GO

-- ── 2. Replace unique index: (role_code) → (role_code, tenant_id) ────────────
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_control_Role_code' AND object_id = OBJECT_ID('control.Role'))
BEGIN
    ALTER TABLE control.Role DROP CONSTRAINT UQ_control_Role_code;
    PRINT '✓ Dropped old UQ_control_Role_code constraint';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Role_code_tenant' AND object_id = OBJECT_ID('control.Role'))
BEGIN
    CREATE UNIQUE INDEX IX_Role_code_tenant ON control.Role (role_code, tenant_id)
        WHERE is_deleted = 0;
    PRINT '✓ Created IX_Role_code_tenant filtered unique index';
END
GO

-- Unique index for system roles (tenant_id IS NULL) to prevent duplicate system role codes
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Role_code_system' AND object_id = OBJECT_ID('control.Role'))
BEGIN
    CREATE UNIQUE INDEX IX_Role_code_system ON control.Role (role_code)
        WHERE tenant_id IS NULL AND is_deleted = 0;
    PRINT '✓ Created IX_Role_code_system filtered unique index';
END
GO

-- ── 3. Ensure only PlatformAdmin and TenantAdmin remain as system roles ──────
-- Existing roles keep tenant_id = NULL (system roles).
-- No rows deleted — they remain for backward compatibility.

PRINT '✓ Tenant-scoped roles migration complete.';
GO
