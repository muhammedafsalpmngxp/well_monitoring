-- =============================================================================
-- T-Wise Tenant: reverse 005-pin-view-source-sql.sql
-- Drops model.DatasetSource.ViewSql. Every view source loses its stored SQL, so
-- queries on it are refused until the column is added again and a modeller
-- updates the source from its view. Run it only on an instance where losing
-- that is acceptable.
-- =============================================================================

SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO

IF COL_LENGTH('model.DatasetSource', 'ViewSql') IS NOT NULL
    ALTER TABLE model.DatasetSource DROP COLUMN ViewSql;
GO
