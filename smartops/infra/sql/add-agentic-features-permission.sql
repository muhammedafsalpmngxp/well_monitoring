-- =============================================================================
-- T-Wise Control Plane: Agentic Features permissions (add-agentic-features-permission.sql)
-- -----------------------------------------------------------------------------
-- Adds the Agentic Features page and its three features under the existing Agentic AI group in
-- control.FeatureModule, and grants them in full (view, create, modify, admin) to the admin roles:
--   agentic-ai.features      Agentic AI → Agentic Features (the landing page)
--   agentic-ai.slippage      Slippage
--   agentic-ai.daily-report  Daily Report
--   agentic-ai.data-anomaly  Data Anomaly (view = see results; create / modify = compile, run, decide proposals)
-- The frontend menu and routes and the Tenant API endpoints check these codes.
--
-- The modules use feature_code 'agentic-ai', so a tenant that has Agentic AI enabled gets them without a
-- control.TenantFeature change.
--
-- Targets the CONTROL PLANE database, not a tenant database. There is no USE statement: -d decides which
-- database changes, so check it before running.
--   sqlcmd -S <server> -U <user> -P <password> -d <control plane database> -i add-agentic-features-permission.sql
-- On QA the control plane database is smartops_control_plane_qa.
--
-- Idempotent: safe to run more than once. Users see the change after their next login.
--
-- Undo:
--   DELETE p FROM control.RoleModulePermission p
--     JOIN control.FeatureModule m ON m.module_id = p.module_id
--    WHERE m.module_code IN ('agentic-ai.features', 'agentic-ai.slippage', 'agentic-ai.daily-report', 'agentic-ai.data-anomaly');
--   DELETE FROM control.FeatureModule
--    WHERE module_code IN ('agentic-ai.features', 'agentic-ai.slippage', 'agentic-ai.daily-report', 'agentic-ai.data-anomaly');
-- =============================================================================

SET NOCOUNT ON;
GO

DECLARE @modules TABLE (code nvarchar(100), name nvarchar(200), sort_order int);
INSERT INTO @modules VALUES
    ('agentic-ai.features',     'Agentic Features', 3),
    ('agentic-ai.slippage',     'Slippage',         4),
    ('agentic-ai.daily-report', 'Daily Report',     5),
    ('agentic-ai.data-anomaly', 'Data Anomaly',     6);

INSERT INTO control.FeatureModule (module_code, parent_code, display_name, feature_code, sort_order, is_active, is_deleted, created_at, modified_at)
SELECT m.code, 'agentic-ai', m.name, 'agentic-ai', m.sort_order, 1, 0, SYSUTCDATETIME(), SYSUTCDATETIME()
FROM @modules m
WHERE NOT EXISTS (SELECT 1 FROM control.FeatureModule f WHERE f.module_code = m.code);

PRINT CAST(@@ROWCOUNT AS varchar(10)) + ' Agentic Features module(s) added.';
GO

-- Every admin role, system or tenant-scoped, that does not hold the grant yet.
INSERT INTO control.RoleModulePermission (role_id, module_id, can_view, can_create, can_modify, can_admin, is_active, is_deleted, created_at, modified_at)
SELECT r.role_id, m.module_id, 1, 1, 1, 1, 1, 0, SYSUTCDATETIME(), SYSUTCDATETIME()
FROM control.Role r
JOIN control.FeatureModule m ON m.module_code IN ('agentic-ai.features', 'agentic-ai.slippage', 'agentic-ai.daily-report', 'agentic-ai.data-anomaly')
WHERE r.role_code IN ('admin', 'tenant_admin', 'TenantAdmin', 'platform_admin', 'PlatformAdmin')
  AND r.is_deleted = 0
  AND NOT EXISTS (SELECT 1 FROM control.RoleModulePermission p WHERE p.role_id = r.role_id AND p.module_id = m.module_id);

PRINT 'Agentic Features granted: ' + CAST(@@ROWCOUNT AS varchar(10)) + ' new admin grant(s).';
GO
