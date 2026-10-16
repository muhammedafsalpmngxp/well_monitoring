-- =============================================================================
-- T-Wise Tenant: published datasets and a home table for measures
-- (007-publish-and-measure-home.sql)
-- -----------------------------------------------------------------------------
-- Adds columns and changes no data:
--   model.Dataset.PublishedModel  the dataset's tables, relationships, measures,
--                                 calculated columns and transforms as JSON, as
--                                 they were at the last Publish. Canvases read
--                                 this; Model Studio edits the tables as a draft.
--                                 NULL until the first Publish, and a dataset
--                                 never published is read from its tables.
--   model.Dataset.PublishedAt     when it was last published (UTC).
--   model.Dataset.PublishedBy     who published it.
--   model.Measure.HomeSourceId    the table a measure is listed under in the
--                                 Data pane; NULL lists it with the dataset's
--                                 measures. No foreign key: removing a table
--                                 sets it back to NULL in the API.
-- Run 001 first: without its tables this script changes nothing.
-- Idempotent: each column is added only while it is missing.
--
-- Usage:
--   sqlcmd -S <server> -d smartops_tenant_TNT-1000 -i 007-publish-and-measure-home.sql
-- Reverse with 007-publish-and-measure-home.down.sql.
-- =============================================================================

SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
SET ANSI_NULLS ON;
GO

IF OBJECT_ID('model.Dataset', 'U') IS NOT NULL AND COL_LENGTH('model.Dataset', 'PublishedModel') IS NULL
    ALTER TABLE model.Dataset ADD PublishedModel NVARCHAR(MAX) NULL
        CONSTRAINT CK_model_Dataset_PublishedModel CHECK (PublishedModel IS NULL OR ISJSON(PublishedModel) = 1);
GO

IF OBJECT_ID('model.Dataset', 'U') IS NOT NULL AND COL_LENGTH('model.Dataset', 'PublishedAt') IS NULL
    ALTER TABLE model.Dataset ADD PublishedAt DATETIME2 NULL;
GO

IF OBJECT_ID('model.Dataset', 'U') IS NOT NULL AND COL_LENGTH('model.Dataset', 'PublishedBy') IS NULL
    ALTER TABLE model.Dataset ADD PublishedBy BIGINT NULL;
GO

IF OBJECT_ID('model.Measure', 'U') IS NOT NULL AND COL_LENGTH('model.Measure', 'HomeSourceId') IS NULL
    ALTER TABLE model.Measure ADD HomeSourceId BIGINT NULL;
GO
