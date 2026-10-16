-- =============================================================================
-- T-Wise Tenant: reverses 007-publish-and-measure-home.sql
-- -----------------------------------------------------------------------------
-- Drops model.Dataset.PublishedModel, PublishedAt, PublishedBy and
-- model.Measure.HomeSourceId. Every published version is lost: canvases read
-- each dataset from its tables again, and measures list with the dataset.
-- Idempotent: each column is dropped only while it exists.
--
-- Usage:
--   sqlcmd -S <server> -d smartops_tenant_TNT-1000 -i 007-publish-and-measure-home.down.sql
-- =============================================================================

SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
SET ANSI_NULLS ON;
GO

IF OBJECT_ID('model.CK_model_Dataset_PublishedModel', 'C') IS NOT NULL
    ALTER TABLE model.Dataset DROP CONSTRAINT CK_model_Dataset_PublishedModel;
GO

IF COL_LENGTH('model.Dataset', 'PublishedModel') IS NOT NULL ALTER TABLE model.Dataset DROP COLUMN PublishedModel;
GO
IF COL_LENGTH('model.Dataset', 'PublishedAt') IS NOT NULL ALTER TABLE model.Dataset DROP COLUMN PublishedAt;
GO
IF COL_LENGTH('model.Dataset', 'PublishedBy') IS NOT NULL ALTER TABLE model.Dataset DROP COLUMN PublishedBy;
GO
IF COL_LENGTH('model.Measure', 'HomeSourceId') IS NOT NULL ALTER TABLE model.Measure DROP COLUMN HomeSourceId;
GO
