-- =============================================================================
-- T-Wise Tenant: reverses 011-table-names.sql
-- -----------------------------------------------------------------------------
-- Drops model.DatasetSource.Caption and Description. Tables show their alias
-- again. Published versions keep the properties in their JSON, which the API
-- ignores once the columns are gone.
-- Idempotent: each column is dropped only while it exists.
--
-- Usage:
--   sqlcmd -S <server> -d smartops_tenant_TNT-1000 -i 011-table-names.down.sql
-- =============================================================================

SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
SET ANSI_NULLS ON;
GO

IF COL_LENGTH('model.DatasetSource', 'Caption') IS NOT NULL ALTER TABLE model.DatasetSource DROP COLUMN Caption;
GO

IF COL_LENGTH('model.DatasetSource', 'Description') IS NOT NULL ALTER TABLE model.DatasetSource DROP COLUMN Description;
GO
