-- =============================================================================
-- T-Wise Tenant: stored SQL of view sources (005-pin-view-source-sql.sql)
-- -----------------------------------------------------------------------------
-- Adds model.DatasetSource.ViewSql. When a modeller adds a View Builder view to
-- a dataset, the Tenant API stores the view's checked SQL here, and queries run
-- that SQL rather than the view as it is now. A later edit of the view reaches
-- the dataset only when a modeller updates the source from its view.
-- Existing view sources keep NULL and are refused by queries until a modeller
-- updates them. Table sources keep NULL.
-- Additive only. Idempotent: safe to run more than once.
--
-- Usage:
--   sqlcmd -S <server> -d smartops_tenant_TNT-1000 -i 005-pin-view-source-sql.sql
-- Reverse with 005-pin-view-source-sql.down.sql.
-- =============================================================================

SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
SET ANSI_NULLS ON;
GO

IF COL_LENGTH('model.DatasetSource', 'ViewSql') IS NULL
    ALTER TABLE model.DatasetSource ADD ViewSql NVARCHAR(MAX) NULL;
GO
