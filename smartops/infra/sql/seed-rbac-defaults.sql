-- ═════════════════════════════════════════════════════════════════════════════
-- SmartOps — RBAC Seed: Roles, Features, and Role-Permission Defaults
-- ─────────────────────────────────────────────────────────────────────────────
-- Run AFTER add-permission-tables.sql.
-- Seeds default roles, features, and the role-permission matrix.
-- Idempotent: skips if data already exists.
-- ═════════════════════════════════════════════════════════════════════════════

SET NOCOUNT ON;
GO

USE [smartops_control_plane];
GO

-- ── 1. Seed Roles ────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM control.Role WHERE role_code = 'admin')
BEGIN
    INSERT INTO control.Role (role_code, role_name, scope) VALUES
    ('admin',          'Admin',          'platform'),
    ('cluster_admin',  'Cluster Admin',  'tenant'),
    ('site_admin',     'Site Admin',     'tenant'),
    ('planner',        'Planner',        'tenant'),
    ('site_engineer',  'Site Engineer',  'tenant'),
    ('qa_qc',          'QA QC',          'tenant'),
    ('hse',            'HSE',            'tenant');
    PRINT '✓ control.Role seeded (7 roles)';
END
GO

-- ── 2. Seed Features (module-level toggles) ──────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM control.Feature WHERE feature_code = 'dashboard')
BEGIN
    INSERT INTO control.Feature (feature_code, feature_name) VALUES
    ('dashboard',       'Dashboard'),
    ('charts',          'Charts & Tiles'),
    ('reports',         'Reports'),
    ('smart-alerts',    'Smart Alerts'),
    ('data-quality',    'Data Quality'),
    ('agentic-ai',      'Agentic AI'),
    ('user-management', 'User & Role Management'),
    ('settings',        'Settings');
    PRINT '✓ control.Feature seeded (8 features)';
END
GO

-- ── 3. Seed Role-Module Permission Matrix ─────────────────────────────────────
--    V=can_view  C=can_create  M=can_modify  A=can_admin
--    Mapping from the RBAC documentation Section 9.
IF NOT EXISTS (SELECT 1 FROM control.RoleModulePermission)
BEGIN
    DECLARE @rp TABLE (
        role_code       varchar(40),
        module_code     varchar(80),
        can_view        bit,
        can_create      bit,
        can_modify      bit,
        can_admin       bit
    );

    -- ── Admin: full access to everything ──
    INSERT INTO @rp VALUES
    ('admin', 'dashboard.standard-boards',  1,1,1,1),
    ('admin', 'dashboard.wip-boards',       1,1,1,1),
    ('admin', 'charts.standard-charts',     1,1,1,1),
    ('admin', 'charts.published-charts',    1,1,1,1),
    ('admin', 'charts.wip-charts',          1,1,1,1),
    ('admin', 'charts.standard-tiles',      1,1,1,1),
    ('admin', 'charts.published-tiles',     1,1,1,1),
    ('admin', 'charts.wip-tiles',           1,1,1,1),
    ('admin', 'reports.standard-reports',   1,1,1,1),
    ('admin', 'reports.my-reports',         1,1,1,1),
    ('admin', 'smart-alerts.alerts',        1,1,1,1),
    ('admin', 'smart-alerts.rule-config',   1,1,1,1),
    ('admin', 'data-quality.error-log',     1,1,1,1),
    ('admin', 'data-quality.self-healing',  1,1,1,1),
    ('admin', 'data-quality.data-dictionary',1,1,1,1),
    ('admin', 'data-quality.lineage',       1,1,1,1),
    ('admin', 'agentic-ai.agents',          1,1,1,1),
    ('admin', 'agentic-ai.activity-log',    1,1,1,1),
    ('admin', 'agentic-ai.features',        1,1,1,1),
    ('admin', 'agentic-ai.slippage',        1,1,1,1),
    ('admin', 'agentic-ai.daily-report',    1,1,1,1),
    ('admin', 'agentic-ai.data-anomaly',    1,1,1,1),
    ('admin', 'user-management.users',      1,1,1,1),
    ('admin', 'user-management.roles',      1,1,1,1),
    ('admin', 'settings.database-view',     1,1,1,1);

    -- ── Cluster Admin ──
    INSERT INTO @rp VALUES
    ('cluster_admin', 'dashboard.standard-boards',  1,1,1,1),
    ('cluster_admin', 'dashboard.wip-boards',       1,1,1,1),
    ('cluster_admin', 'charts.standard-charts',     1,1,1,1),
    ('cluster_admin', 'charts.published-charts',    1,1,1,1),
    ('cluster_admin', 'charts.wip-charts',          1,1,1,1),
    ('cluster_admin', 'charts.standard-tiles',      1,1,1,1),
    ('cluster_admin', 'charts.published-tiles',     1,1,1,1),
    ('cluster_admin', 'charts.wip-tiles',           1,1,1,1),
    ('cluster_admin', 'reports.standard-reports',   1,1,1,0),
    ('cluster_admin', 'reports.my-reports',         1,1,1,0),
    ('cluster_admin', 'smart-alerts.alerts',        1,1,1,0),
    ('cluster_admin', 'smart-alerts.rule-config',   1,1,1,1),
    ('cluster_admin', 'data-quality.error-log',     1,1,1,0),
    ('cluster_admin', 'data-quality.self-healing',  1,0,1,0),
    ('cluster_admin', 'user-management.users',      1,1,1,0),
    ('cluster_admin', 'settings.database-view',     1,0,0,0);

    -- ── Site Admin ──
    INSERT INTO @rp VALUES
    ('site_admin', 'dashboard.standard-boards',  1,1,1,0),
    ('site_admin', 'dashboard.wip-boards',       1,1,1,0),
    ('site_admin', 'charts.standard-charts',     1,0,0,0),
    ('site_admin', 'charts.wip-charts',          1,1,1,0),
    ('site_admin', 'reports.standard-reports',   1,0,0,0),
    ('site_admin', 'reports.my-reports',         1,1,1,0),
    ('site_admin', 'smart-alerts.alerts',        1,0,0,0),
    ('site_admin', 'data-quality.error-log',     1,0,0,0),
    ('site_admin', 'user-management.users',      1,0,0,0);

    -- ── Planner ──
    INSERT INTO @rp VALUES
    ('planner', 'dashboard.standard-boards', 1,0,0,0),
    ('planner', 'dashboard.wip-boards',      1,1,1,0),
    ('planner', 'charts.standard-charts',    1,0,0,0),
    ('planner', 'charts.wip-charts',         1,1,1,0),
    ('planner', 'reports.standard-reports',  1,0,0,0),
    ('planner', 'reports.my-reports',        1,1,1,0),
    ('planner', 'smart-alerts.alerts',       1,0,0,0);

    -- ── Site Engineer ──
    INSERT INTO @rp VALUES
    ('site_engineer', 'dashboard.standard-boards', 1,0,0,0),
    ('site_engineer', 'dashboard.wip-boards',      1,1,1,0),
    ('site_engineer', 'charts.standard-charts',    1,0,0,0),
    ('site_engineer', 'charts.wip-charts',         1,1,1,0),
    ('site_engineer', 'reports.standard-reports',  1,0,0,0),
    ('site_engineer', 'reports.my-reports',        1,1,1,0),
    ('site_engineer', 'smart-alerts.alerts',       1,0,0,0);

    -- ── QA QC ──
    INSERT INTO @rp VALUES
    ('qa_qc', 'dashboard.standard-boards', 1,0,0,0),
    ('qa_qc', 'dashboard.wip-boards',      1,0,0,0),
    ('qa_qc', 'charts.standard-charts',    1,0,0,0),
    ('qa_qc', 'reports.standard-reports',  1,0,0,0),
    ('qa_qc', 'reports.my-reports',        1,1,1,0),
    ('qa_qc', 'smart-alerts.alerts',       1,0,0,0),
    ('qa_qc', 'data-quality.error-log',    1,1,1,0);

    -- ── HSE ──
    INSERT INTO @rp VALUES
    ('hse', 'dashboard.standard-boards', 1,0,0,0),
    ('hse', 'charts.standard-charts',    1,0,0,0),
    ('hse', 'reports.standard-reports',  1,0,0,0),
    ('hse', 'smart-alerts.alerts',       1,0,0,0);

    -- Resolve codes → IDs and insert
    INSERT INTO control.RoleModulePermission (role_id, module_id, can_view, can_create, can_modify, can_admin, is_active, is_deleted, created_at, modified_at)
    SELECT r.role_id, m.module_id, t.can_view, t.can_create, t.can_modify, t.can_admin, 1, 0, SYSUTCDATETIME(), SYSUTCDATETIME()
    FROM @rp t
    JOIN control.Role r          ON r.role_code = t.role_code
    JOIN control.FeatureModule m ON m.module_code = t.module_code;

    PRINT '✓ control.RoleModulePermission seeded (' + CAST(@@ROWCOUNT AS varchar) + ' rows)';
END
GO

PRINT '✓ RBAC seed data complete.';
GO
