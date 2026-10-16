/* ----------------------------------------------------------------------------
   Lineage page permission. Run against the CONTROL-PLANE database (the tenant
   table lives in add-governance.sql). Idempotent.
   ---------------------------------------------------------------------------- */

IF OBJECT_ID(N'control.FeatureModule', N'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM control.FeatureModule WHERE module_code = 'data-quality.lineage')
INSERT INTO control.FeatureModule (module_code, parent_code, display_name, feature_code, sort_order, is_active, is_deleted, created_at, modified_at)
VALUES ('data-quality.lineage', 'data-quality', 'Data Lineage', 'data-quality', 4, 1, 0, SYSUTCDATETIME(), SYSUTCDATETIME());
GO
