-- ═════════════════════════════════════════════════════════════════════════════
-- SmartOps — RBAC Seed: FeatureModule tree (seed-feature-modules.sql)
-- ─────────────────────────────────────────────────────────────────────────────
-- Seeds the control.FeatureModule table with the navigation module tree.
-- Tables are created via EF Core migrations — this script only seeds data.
-- Idempotent: skips if data already exists.
-- ═════════════════════════════════════════════════════════════════════════════

SET NOCOUNT ON;
GO

USE [smartops_control_plane];
GO

IF NOT EXISTS (SELECT 1 FROM control.FeatureModule)
BEGIN
    -- Module roots (top-level navigation groups)
    INSERT INTO control.FeatureModule (module_code, parent_code, display_name, feature_code, sort_order, is_active, is_deleted, created_at, modified_at) VALUES
    ('dashboard',       NULL, 'Dashboard',             'dashboard',       1, 1, 0, SYSUTCDATETIME(), SYSUTCDATETIME()),
    ('charts',          NULL, 'Charts & Tiles',        'charts',          2, 1, 0, SYSUTCDATETIME(), SYSUTCDATETIME()),
    ('reports',         NULL, 'Reports',               'reports',         3, 1, 0, SYSUTCDATETIME(), SYSUTCDATETIME()),
    ('smart-alerts',    NULL, 'Smart Alerts',          'smart-alerts',    4, 1, 0, SYSUTCDATETIME(), SYSUTCDATETIME()),
    ('data-quality',    NULL, 'Data Quality',          'data-quality',    5, 1, 0, SYSUTCDATETIME(), SYSUTCDATETIME()),
    ('agentic-ai',      NULL, 'Agentic AI',            'agentic-ai',      6, 1, 0, SYSUTCDATETIME(), SYSUTCDATETIME()),
    ('user-management', NULL, 'User & Role Management','user-management', 7, 1, 0, SYSUTCDATETIME(), SYSUTCDATETIME()),
    ('settings',        NULL, 'Settings',              'settings',        8, 1, 0, SYSUTCDATETIME(), SYSUTCDATETIME());

    -- Dashboard
    INSERT INTO control.FeatureModule (module_code, parent_code, display_name, feature_code, sort_order, is_active, is_deleted, created_at, modified_at) VALUES
    ('dashboard.standard-boards',    'dashboard', 'Standard Boards',    'dashboard', 1, 1, 0, SYSUTCDATETIME(), SYSUTCDATETIME()),
    ('dashboard.wip-boards',         'dashboard', 'WIP Boards',         'dashboard', 2, 1, 0, SYSUTCDATETIME(), SYSUTCDATETIME());

    -- Charts & Tiles
    INSERT INTO control.FeatureModule (module_code, parent_code, display_name, feature_code, sort_order, is_active, is_deleted, created_at, modified_at) VALUES
    ('charts.standard-charts',   'charts', 'Standard Charts',   'charts', 1, 1, 0, SYSUTCDATETIME(), SYSUTCDATETIME()),
    ('charts.published-charts',  'charts', 'Published Charts',  'charts', 2, 1, 0, SYSUTCDATETIME(), SYSUTCDATETIME()),
    ('charts.wip-charts',        'charts', 'WIP Charts',        'charts', 3, 1, 0, SYSUTCDATETIME(), SYSUTCDATETIME()),
    ('charts.standard-tiles',    'charts', 'Standard Tiles',    'charts', 4, 1, 0, SYSUTCDATETIME(), SYSUTCDATETIME()),
    ('charts.published-tiles',   'charts', 'Published Tiles',   'charts', 5, 1, 0, SYSUTCDATETIME(), SYSUTCDATETIME()),
    ('charts.wip-tiles',         'charts', 'WIP Tiles',         'charts', 6, 1, 0, SYSUTCDATETIME(), SYSUTCDATETIME());

    -- Reports
    INSERT INTO control.FeatureModule (module_code, parent_code, display_name, feature_code, sort_order, is_active, is_deleted, created_at, modified_at) VALUES
    ('reports.standard-reports', 'reports', 'Standard Reports', 'reports', 1, 1, 0, SYSUTCDATETIME(), SYSUTCDATETIME()),
    ('reports.my-reports',       'reports', 'My Reports',       'reports', 2, 1, 0, SYSUTCDATETIME(), SYSUTCDATETIME());

    -- Smart Alerts
    INSERT INTO control.FeatureModule (module_code, parent_code, display_name, feature_code, sort_order, is_active, is_deleted, created_at, modified_at) VALUES
    ('smart-alerts.alerts',      'smart-alerts', 'Alerts',                   'smart-alerts', 1, 1, 0, SYSUTCDATETIME(), SYSUTCDATETIME()),
    ('smart-alerts.rule-config', 'smart-alerts', 'Alert Rule Configuration', 'smart-alerts', 2, 1, 0, SYSUTCDATETIME(), SYSUTCDATETIME());

    -- Data Quality
    INSERT INTO control.FeatureModule (module_code, parent_code, display_name, feature_code, sort_order, is_active, is_deleted, created_at, modified_at) VALUES
    ('data-quality.error-log',       'data-quality', 'Error Log & Rules', 'data-quality', 1, 1, 0, SYSUTCDATETIME(), SYSUTCDATETIME()),
    ('data-quality.self-healing',    'data-quality', 'Self-Healing AI',   'data-quality', 2, 1, 0, SYSUTCDATETIME(), SYSUTCDATETIME()),
    ('data-quality.data-dictionary', 'data-quality', 'Data Dictionary',   'data-quality', 3, 1, 0, SYSUTCDATETIME(), SYSUTCDATETIME()),
    ('data-quality.lineage',         'data-quality', 'Data Lineage',      'data-quality', 4, 1, 0, SYSUTCDATETIME(), SYSUTCDATETIME());

    -- Agentic AI
    INSERT INTO control.FeatureModule (module_code, parent_code, display_name, feature_code, sort_order, is_active, is_deleted, created_at, modified_at) VALUES
    ('agentic-ai.agents',       'agentic-ai', 'AI Agents',    'agentic-ai', 1, 1, 0, SYSUTCDATETIME(), SYSUTCDATETIME()),
    ('agentic-ai.activity-log', 'agentic-ai', 'Activity Log', 'agentic-ai', 2, 1, 0, SYSUTCDATETIME(), SYSUTCDATETIME());

    -- User & Role Management
    INSERT INTO control.FeatureModule (module_code, parent_code, display_name, feature_code, sort_order, is_active, is_deleted, created_at, modified_at) VALUES
    ('user-management.users', 'user-management', 'Users',               'user-management', 1, 1, 0, SYSUTCDATETIME(), SYSUTCDATETIME()),
    ('user-management.roles', 'user-management', 'Roles & Permissions', 'user-management', 2, 1, 0, SYSUTCDATETIME(), SYSUTCDATETIME());

    -- Settings
    INSERT INTO control.FeatureModule (module_code, parent_code, display_name, feature_code, sort_order, is_active, is_deleted, created_at, modified_at) VALUES
    ('settings.database-view', 'settings', 'Database View', 'settings', 1, 1, 0, SYSUTCDATETIME(), SYSUTCDATETIME());

    PRINT '✓ control.FeatureModule seeded (28 rows)';
END
GO
