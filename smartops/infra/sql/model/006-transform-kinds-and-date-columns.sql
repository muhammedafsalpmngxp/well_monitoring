-- =============================================================================
-- T-Wise Tenant: more transform kinds and date calculated columns
-- (006-transform-kinds-and-date-columns.sql)
-- -----------------------------------------------------------------------------
-- Widens two CHECK constraints of 003 and changes nothing else:
--   CK_model_Transform_Kind            also allows 'replace' and 'remove_rows'
--   CK_model_CalculatedColumn_DataType also allows 'date'
-- A replace keeps what it finds in ConfigJson.value and its settings next to it;
-- a removal of rows keeps its test there. No table or column is added.
-- Run 003 first: without its tables this script changes nothing.
-- Idempotent: a constraint is recreated only while it lacks the new values.
--
-- Usage:
--   sqlcmd -S <server> -d smartops_tenant_TNT-1000 -i 006-transform-kinds-and-date-columns.sql
-- Reverse with 006-transform-kinds-and-date-columns.down.sql.
-- =============================================================================

SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
SET ANSI_NULLS ON;
GO

IF OBJECT_ID('model.Transform', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.check_constraints
                   WHERE name = 'CK_model_Transform_Kind' AND parent_object_id = OBJECT_ID('model.Transform')
                     AND definition LIKE '%remove[_]rows%')
BEGIN
    IF OBJECT_ID('model.CK_model_Transform_Kind', 'C') IS NOT NULL
        ALTER TABLE model.Transform DROP CONSTRAINT CK_model_Transform_Kind;
    ALTER TABLE model.Transform ADD CONSTRAINT CK_model_Transform_Kind
        CHECK (Kind COLLATE Latin1_General_BIN2 IN ('rename', 'type', 'null_fill', 'split', 'merge', 'trim', 'extract', 'replace', 'remove_rows')
               AND Kind NOT LIKE '% ');
END
GO

IF OBJECT_ID('model.CalculatedColumn', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.check_constraints
                   WHERE name = 'CK_model_CalculatedColumn_DataType' AND parent_object_id = OBJECT_ID('model.CalculatedColumn')
                     AND definition LIKE '%''date''%')
BEGIN
    IF OBJECT_ID('model.CK_model_CalculatedColumn_DataType', 'C') IS NOT NULL
        ALTER TABLE model.CalculatedColumn DROP CONSTRAINT CK_model_CalculatedColumn_DataType;
    ALTER TABLE model.CalculatedColumn ADD CONSTRAINT CK_model_CalculatedColumn_DataType
        CHECK (DataType COLLATE Latin1_General_BIN2 IN ('number', 'text', 'date') AND DataType NOT LIKE '% ');
END
GO
