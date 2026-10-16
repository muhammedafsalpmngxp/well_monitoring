-- =============================================================================
-- T-Wise Tenant: reverses 009-hidden-columns.sql
-- -----------------------------------------------------------------------------
-- Drops model.DatasetSource.HiddenColumns and its check. Every hidden column
-- shows again in report builders. Published versions keep the property in
-- their JSON, which the API ignores once the column is gone.
-- Idempotent: each object is dropped only while it exists.
--
-- Usage:
--   sqlcmd -S <server> -d smartops_tenant_TNT-1000 -i 009-hidden-columns.down.sql
-- =============================================================================

SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
SET ANSI_NULLS ON;
GO

IF OBJECT_ID('model.CK_model_DatasetSource_HiddenColumns', 'C') IS NOT NULL
    ALTER TABLE model.DatasetSource DROP CONSTRAINT CK_model_DatasetSource_HiddenColumns;
GO

IF COL_LENGTH('model.DatasetSource', 'HiddenColumns') IS NOT NULL ALTER TABLE model.DatasetSource DROP COLUMN HiddenColumns;
GO
