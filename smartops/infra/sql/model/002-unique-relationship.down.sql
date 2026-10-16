-- =============================================================================
-- T-Wise Tenant: reverse 002-unique-relationship.sql
-- Drops the unique index on model.Relationship. No data is lost.
-- =============================================================================

SET NOCOUNT ON;
GO

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_model_Relationship_Join' AND object_id = OBJECT_ID('model.Relationship'))
    DROP INDEX UQ_model_Relationship_Join ON model.Relationship;
GO
