-- =============================================================================
-- T-Wise Tenant: unique relationship (002-unique-relationship.sql)
-- -----------------------------------------------------------------------------
-- Adds a unique index on model.Relationship so two identical requests that add
-- the same join at the same time cannot both be saved. The second one fails
-- with a duplicate key error, which the API returns as 409.
-- Additive only. Idempotent: safe to run more than once.
--
-- Stops without changing anything if model.Relationship already holds duplicate
-- rows. Remove the duplicates by hand, then run it again.
--
-- Usage:
--   sqlcmd -S <server> -d smartops_tenant_TNT-1000 -i 002-unique-relationship.sql
-- Reverse with 002-unique-relationship.down.sql.
-- =============================================================================

SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_model_Relationship_Join' AND object_id = OBJECT_ID('model.Relationship'))
BEGIN
    IF EXISTS (
        SELECT 1
        FROM model.Relationship
        GROUP BY DatasetId, FromSourceId, FromColumn, ToSourceId, ToColumn
        HAVING COUNT(*) > 1)
    BEGIN
        RAISERROR('model.Relationship has duplicate rows for the same DatasetId, FromSourceId, FromColumn, ToSourceId and ToColumn. Remove the duplicates, then run this script again. Nothing was changed.', 16, 1);
        RETURN;
    END

    CREATE UNIQUE INDEX UQ_model_Relationship_Join
        ON model.Relationship (DatasetId, FromSourceId, FromColumn, ToSourceId, ToColumn);
END
GO
