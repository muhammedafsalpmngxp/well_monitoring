-- =============================================================================
-- T-Wise Tenant: reverse 001-create-model-schema.sql
-- Drops the model schema and everything in it. Datasets are lost.
-- =============================================================================

SET NOCOUNT ON;
GO

DROP TABLE IF EXISTS model.Measure;
DROP TABLE IF EXISTS model.Relationship;
DROP TABLE IF EXISTS model.DatasetSource;
DROP TABLE IF EXISTS model.Dataset;
GO

IF SCHEMA_ID('model') IS NOT NULL
    EXEC('DROP SCHEMA model;');
GO
