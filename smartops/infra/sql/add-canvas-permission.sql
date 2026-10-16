-- =============================================================================
-- T-Wise Control Plane: Reporting canvas permission (add-canvas-permission.sql)
-- -----------------------------------------------------------------------------
-- Adds the page module dashboard.canvas under the existing dashboard group in
-- control.FeatureModule, and grants it in full (view, create, modify, admin) to
-- the admin roles. The frontend menu, the /canvas route, POST /api/query and the
-- dataset reads check this code.
--
-- The module uses feature_code 'dashboard', so a tenant that has Dashboards
-- enabled gets the canvas without a control.TenantFeature change.
--
-- Targets the CONTROL PLANE database, not a tenant database. There is no USE
-- statement: -d decides which database changes, so check it before running.
--   sqlcmd -S <server> -U <user> -P <password> -d <control plane database> -i add-canvas-permission.sql
-- On QA the control plane database is smartops_control_plane_qa.
--
-- Idempotent: safe to run more than once. Users see the change after their next login.
--
-- Undo:
--   DELETE p FROM control.RoleModulePermission p
--     JOIN control.FeatureModule m ON m.module_id = p.module_id
--    WHERE m.module_code = 'dashboard.canvas';
--   DELETE FROM control.FeatureModule WHERE module_code = 'dashboard.canvas';
-- =============================================================================

SET NOCOUNT ON;
GO

IF NOT EXISTS (SELECT 1 FROM control.FeatureModule WHERE module_code = 'dashboard.canvas')
    INSERT INTO control.FeatureModule (module_code, parent_code, display_name, feature_code, sort_order, is_active, is_deleted, created_at, modified_at)
    VALUES ('dashboard.canvas', 'dashboard', 'Canvases', 'dashboard', 3, 1, 0, SYSUTCDATETIME(), SYSUTCDATETIME());
GO

-- Every admin role, system or tenant-scoped, that does not hold the grant yet.
INSERT INTO control.RoleModulePermission (role_id, module_id, can_view, can_create, can_modify, can_admin, is_active, is_deleted, created_at, modified_at)
SELECT r.role_id, m.module_id, 1, 1, 1, 1, 1, 0, SYSUTCDATETIME(), SYSUTCDATETIME()
FROM control.Role r
JOIN control.FeatureModule m ON m.module_code = 'dashboard.canvas'
WHERE r.role_code IN ('admin', 'tenant_admin', 'TenantAdmin', 'platform_admin', 'PlatformAdmin')
  AND r.is_deleted = 0
  AND NOT EXISTS (SELECT 1 FROM control.RoleModulePermission p WHERE p.role_id = r.role_id AND p.module_id = m.module_id);

PRINT 'dashboard.canvas granted to ' + CAST(@@ROWCOUNT AS varchar(10)) + ' admin role(s) that did not have it.';
GO
