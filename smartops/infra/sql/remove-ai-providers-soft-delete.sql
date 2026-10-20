-- =============================================================================
-- core.AiProviders: from soft delete to real delete (remove-ai-providers-soft-delete.sql)
-- -----------------------------------------------------------------------------
-- Deleting a provider in Settings > AI Providers now removes its row (and its encrypted key). This script:
--   1. deletes the rows that were only marked deleted (is_deleted = 1) and are not the active provider,
--   2. drops the is_deleted column (and its default constraint, whatever its name).
-- Idempotent: safe to run again (it does nothing once the column is gone).
--
-- ORDER: every Tenant API that uses this database must run the new code first (it no longer reads is_deleted).
-- An older Tenant API still selects is_deleted and fails on AI Providers until it is updated.
--
-- Run on each tenant database, e.g.:
--   sqlcmd -S <server> -U <user> -P <password> -d smartops_tenant_TNT-1000 -i remove-ai-providers-soft-delete.sql
-- =============================================================================
SET NOCOUNT ON;

IF COL_LENGTH('core.AiProviders', 'is_deleted') IS NOT NULL
BEGIN
    BEGIN TRANSACTION;

    EXEC sp_executesql N'DELETE FROM core.AiProviders WHERE is_deleted = 1 AND is_active = 0;';
    PRINT CAST(@@ROWCOUNT AS varchar(10)) + ' soft-deleted provider row(s) removed.';

    DECLARE @df sysname = (
        SELECT dc.name FROM sys.default_constraints dc
        JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
        WHERE dc.parent_object_id = OBJECT_ID('core.AiProviders') AND c.name = 'is_deleted');
    IF @df IS NOT NULL
        EXEC (N'ALTER TABLE core.AiProviders DROP CONSTRAINT ' + QUOTENAME(@df) + N';');

    ALTER TABLE core.AiProviders DROP COLUMN is_deleted;
    PRINT 'core.AiProviders.is_deleted dropped.';

    COMMIT TRANSACTION;
END
ELSE
    PRINT 'core.AiProviders has no is_deleted column: nothing to do.';
