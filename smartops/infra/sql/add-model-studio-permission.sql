-- =============================================================================
-- T-Wise Control Plane: Model Studio permission (add-model-studio-permission.sql)
-- -----------------------------------------------------------------------------
-- Adds the Model Studio modules to control.FeatureModule:
--   model          group, shown as "Model Studio" in the roles and permissions tree
--   model.studio   the Datasets page; the frontend menu and the tenant API check this code
-- and grants model.studio in full (view, create, modify, admin) to the admin roles.
--
-- Both modules use feature_code 'settings', so a tenant that has Settings enabled
-- gets Model Studio without a control.TenantFeature change.
--
-- Targets the CONTROL PLANE database, not a tenant database. There is no USE
-- statement: -d decides which database changes, so check it before running.
--   sqlcmd -S <server> -U <user> -P <password> -d <control plane database> -i add-model-studio-permission.sql
-- On QA the control plane database is smartops_control_plane_qa.
--
-- Idempotent: safe to run more than once. Users see the change after their next login.
--
-- A module or grant that was soft-deleted (is_deleted = 1) is revived rather than
-- inserted again: module_code and (role_id, module_id) are unique whether or not a
-- row is deleted, so a second row cannot be added.
--
-- Undo:
--   DELETE p FROM control.RoleModulePermission p
--     JOIN control.FeatureModule m ON m.module_id = p.module_id
--    WHERE m.module_code IN ('model.studio', 'model');
--   DELETE FROM control.FeatureModule WHERE module_code IN ('model.studio', 'model');
-- =============================================================================

SET NOCOUNT ON;
GO

-- Revive a soft-deleted row; insert only when there is none at all.
UPDATE control.FeatureModule
   SET is_deleted = 0, deleted_at = NULL, is_active = 1, modified_at = SYSUTCDATETIME()
 WHERE module_code IN ('model', 'model.studio')
   AND is_deleted = 1;

IF NOT EXISTS (SELECT 1 FROM control.FeatureModule WHERE module_code = 'model')
    INSERT INTO control.FeatureModule (module_code, parent_code, display_name, feature_code, sort_order, is_active, is_deleted, created_at, modified_at)
    VALUES ('model', NULL, 'Model Studio', 'settings', 9, 1, 0, SYSUTCDATETIME(), SYSUTCDATETIME());

IF NOT EXISTS (SELECT 1 FROM control.FeatureModule WHERE module_code = 'model.studio')
    INSERT INTO control.FeatureModule (module_code, parent_code, display_name, feature_code, sort_order, is_active, is_deleted, created_at, modified_at)
    VALUES ('model.studio', 'model', 'Datasets', 'settings', 1, 1, 0, SYSUTCDATETIME(), SYSUTCDATETIME());
GO

-- Admin roles, system or tenant-scoped, that are not deleted.
-- A soft-deleted grant is revived in full. A grant switched off without being deleted is left alone.
UPDATE p
   SET can_view = 1, can_create = 1, can_modify = 1, can_admin = 1,
       is_active = 1, is_deleted = 0, deleted_at = NULL, modified_at = SYSUTCDATETIME()
FROM control.RoleModulePermission p
JOIN control.Role r ON r.role_id = p.role_id
JOIN control.FeatureModule m ON m.module_id = p.module_id AND m.module_code = 'model.studio'
WHERE r.role_code IN ('admin', 'tenant_admin', 'TenantAdmin', 'platform_admin', 'PlatformAdmin')
  AND r.is_deleted = 0
  AND p.is_deleted = 1;

PRINT 'model.studio revived for ' + CAST(@@ROWCOUNT AS varchar(10)) + ' admin role(s) whose grant was deleted.';

-- The NOT EXISTS ignores is_deleted on purpose: (role_id, module_id) is unique, and a deleted grant was revived above.
INSERT INTO control.RoleModulePermission (role_id, module_id, can_view, can_create, can_modify, can_admin, is_active, is_deleted, created_at, modified_at)
SELECT r.role_id, m.module_id, 1, 1, 1, 1, 1, 0, SYSUTCDATETIME(), SYSUTCDATETIME()
FROM control.Role r
JOIN control.FeatureModule m ON m.module_code = 'model.studio'
WHERE r.role_code IN ('admin', 'tenant_admin', 'TenantAdmin', 'platform_admin', 'PlatformAdmin')
  AND r.is_deleted = 0
  AND NOT EXISTS (SELECT 1 FROM control.RoleModulePermission p WHERE p.role_id = r.role_id AND p.module_id = m.module_id);

PRINT 'model.studio granted to ' + CAST(@@ROWCOUNT AS varchar(10)) + ' admin role(s) that did not have it.';
GO
