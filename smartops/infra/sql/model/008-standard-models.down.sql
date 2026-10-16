-- =============================================================================
-- T-Wise Tenant: reverses 008-standard-models.sql
-- -----------------------------------------------------------------------------
-- Soft-deletes the three standard datasets and the three showcase canvases by
-- name, as deleting them in the application does. Their rows stay in the
-- tables, and 008 creates fresh copies when run again. Copies a user renamed
-- are not touched. The dashboard category Al Tasnim Dashboard is kept, since
-- other canvases may use it.
-- Idempotent: rows already deleted are skipped.
--
-- Usage:
--   sqlcmd -S <server> -d smartops_tenant_TNT-1000 -i 008-standard-models.down.sql
-- =============================================================================

SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
SET ANSI_NULLS ON;

UPDATE core.Dashboard SET IsDeleted = 1, ModifiedAt = SYSUTCDATETIME()
WHERE IsDeleted = 0
  AND DashboardName IN (N'Well Delivery Command Center', N'Construction Progress Pulse', N'Field Workforce Pulse');

UPDATE model.Dataset SET IsDeleted = 1, ModifiedAt = SYSUTCDATETIME()
WHERE IsDeleted = 0
  AND Name IN (N'Well Delivery 360', N'Well Progress Tracker', N'Field Workforce Activity');
