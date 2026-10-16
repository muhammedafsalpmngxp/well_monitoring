-- =============================================================================
-- T-Wise Control Plane: Standard and WIP lists for Model Studio and the canvas
-- (add-bi-standard-permissions.sql)
-- -----------------------------------------------------------------------------
-- Model Studio and BI Canvas each get a Standard list (published items)
-- and a WIP list (items being built), like Charts and Reports. Each list has its
-- own module code, so role management can grant them separately:
--
--   model.standard-datasets      Standard Data Models (new, view only is enough)
--   model.studio                 WIP Data Models (existing code, renamed)
--   dashboard.standard-canvases  Standard Canvases (new, view only is enough)
--   dashboard.canvas             WIP Canvases (existing code, renamed)
--
-- The existing codes keep their meaning for authoring (create, modify), so no
-- grant is lost. Admin roles get the new codes in full. Every other role that
-- can view a WIP list gets view on the matching Standard list, so nobody loses
-- sight of published items after the split.
--
-- Targets the CONTROL PLANE database, not a tenant database. There is no USE
-- statement: -d decides which database changes, so check it before running.
--   sqlcmd -S <server> -U <user> -P <password> -d <control plane database> -i add-bi-standard-permissions.sql
-- On QA the control plane database is smartops_control_plane_qa.
--
-- Idempotent: safe to run more than once. Users see the change after their next login.
--
-- Undo:
--   DELETE p FROM control.RoleModulePermission p
--     JOIN control.FeatureModule m ON m.module_id = p.module_id
--    WHERE m.module_code IN ('model.standard-datasets', 'dashboard.standard-canvases');
--   DELETE FROM control.FeatureModule WHERE module_code IN ('model.standard-datasets', 'dashboard.standard-canvases');
--   UPDATE control.FeatureModule SET display_name = 'Datasets' WHERE module_code = 'model.studio';
--   UPDATE control.FeatureModule SET display_name = 'Canvases' WHERE module_code = 'dashboard.canvas';
-- =============================================================================

SET NOCOUNT ON;
GO

IF NOT EXISTS (SELECT 1 FROM control.FeatureModule WHERE module_code = 'model.standard-datasets')
    INSERT INTO control.FeatureModule (module_code, parent_code, display_name, feature_code, sort_order, is_active, is_deleted, created_at, modified_at)
    SELECT 'model.standard-datasets', parent_code, 'Standard Data Models', feature_code, 0, 1, 0, SYSUTCDATETIME(), SYSUTCDATETIME()
    FROM control.FeatureModule WHERE module_code = 'model.studio';

IF NOT EXISTS (SELECT 1 FROM control.FeatureModule WHERE module_code = 'dashboard.standard-canvases')
    INSERT INTO control.FeatureModule (module_code, parent_code, display_name, feature_code, sort_order, is_active, is_deleted, created_at, modified_at)
    SELECT 'dashboard.standard-canvases', parent_code, 'Standard Canvases', feature_code, sort_order, 1, 0, SYSUTCDATETIME(), SYSUTCDATETIME()
    FROM control.FeatureModule WHERE module_code = 'dashboard.canvas';

UPDATE control.FeatureModule SET display_name = 'WIP Data Models', modified_at = SYSUTCDATETIME()
 WHERE module_code = 'model.studio' AND display_name <> 'WIP Data Models';
UPDATE control.FeatureModule SET display_name = 'Standard Data Models', modified_at = SYSUTCDATETIME()
 WHERE module_code = 'model.standard-datasets' AND display_name <> 'Standard Data Models';
UPDATE control.FeatureModule SET display_name = 'WIP Canvases', modified_at = SYSUTCDATETIME()
 WHERE module_code = 'dashboard.canvas' AND display_name <> 'WIP Canvases';
GO

-- Admin roles: the new codes in full.
INSERT INTO control.RoleModulePermission (role_id, module_id, can_view, can_create, can_modify, can_admin, is_active, is_deleted, created_at, modified_at)
SELECT r.role_id, m.module_id, 1, 1, 1, 1, 1, 0, SYSUTCDATETIME(), SYSUTCDATETIME()
FROM control.Role r
JOIN control.FeatureModule m ON m.module_code IN ('model.standard-datasets', 'dashboard.standard-canvases')
WHERE r.role_code IN ('admin', 'tenant_admin', 'TenantAdmin', 'platform_admin', 'PlatformAdmin')
  AND r.is_deleted = 0
  AND NOT EXISTS (SELECT 1 FROM control.RoleModulePermission p WHERE p.role_id = r.role_id AND p.module_id = m.module_id);

PRINT 'Standard lists granted in full to ' + CAST(@@ROWCOUNT AS varchar(10)) + ' admin role grant(s).';

-- Other roles: view on the Standard list wherever they can view the WIP list.
INSERT INTO control.RoleModulePermission (role_id, module_id, can_view, can_create, can_modify, can_admin, is_active, is_deleted, created_at, modified_at)
SELECT w.role_id, s.module_id, 1, 0, 0, 0, 1, 0, SYSUTCDATETIME(), SYSUTCDATETIME()
FROM control.RoleModulePermission w
JOIN control.FeatureModule wm ON wm.module_id = w.module_id
JOIN control.FeatureModule s ON s.module_code = CASE wm.module_code
        WHEN 'model.studio' THEN 'model.standard-datasets'
        WHEN 'dashboard.canvas' THEN 'dashboard.standard-canvases' END
WHERE wm.module_code IN ('model.studio', 'dashboard.canvas')
  AND w.can_view = 1 AND w.is_deleted = 0
  AND NOT EXISTS (SELECT 1 FROM control.RoleModulePermission p WHERE p.role_id = w.role_id AND p.module_id = s.module_id);

PRINT 'Standard lists granted as view to ' + CAST(@@ROWCOUNT AS varchar(10)) + ' other role grant(s).';
GO
