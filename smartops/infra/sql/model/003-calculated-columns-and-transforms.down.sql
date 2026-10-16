-- =============================================================================
-- T-Wise Tenant: reverse 003-calculated-columns-and-transforms.sql
-- Drops model.Transform and model.CalculatedColumn. Every calculated column and
-- transform stored in them is lost. Run it before 001's down script: these
-- tables reference model.Dataset and model.DatasetSource.
-- =============================================================================

SET NOCOUNT ON;
GO

DROP TABLE IF EXISTS model.Transform;
DROP TABLE IF EXISTS model.CalculatedColumn;
GO
