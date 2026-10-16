-- =============================================================================
-- T-Wise Tenant: reverse 006-transform-kinds-and-date-columns.sql
-- Narrows both constraints back to the lists of 003.
-- Stops without changing anything while a transform of kind replace or
-- remove_rows, or a date calculated column, is stored, including those of
-- soft-deleted datasets: the narrower constraints would refuse them.
-- =============================================================================

SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
SET ANSI_NULLS ON;
GO

-- Each table is read only when it exists, so the script is safe to run with either of 003's tables missing.
DECLARE @stored bit = 0;
IF OBJECT_ID('model.Transform', 'U') IS NOT NULL
    IF EXISTS (SELECT 1 FROM model.Transform WHERE Kind IN ('replace', 'remove_rows')) SET @stored = 1;
IF OBJECT_ID('model.CalculatedColumn', 'U') IS NOT NULL
    IF EXISTS (SELECT 1 FROM model.CalculatedColumn WHERE DataType = 'date') SET @stored = 1;
IF @stored = 1
BEGIN
    RAISERROR('Transforms of kind replace or remove_rows, or date calculated columns, are still stored. Remove them first. Nothing was changed.', 16, 1);
    RETURN;
END

IF OBJECT_ID('model.Transform', 'U') IS NOT NULL
BEGIN
    IF OBJECT_ID('model.CK_model_Transform_Kind', 'C') IS NOT NULL
        ALTER TABLE model.Transform DROP CONSTRAINT CK_model_Transform_Kind;
    ALTER TABLE model.Transform ADD CONSTRAINT CK_model_Transform_Kind
        CHECK (Kind COLLATE Latin1_General_BIN2 IN ('rename', 'type', 'null_fill', 'split', 'merge', 'trim', 'extract') AND Kind NOT LIKE '% ');
END

IF OBJECT_ID('model.CalculatedColumn', 'U') IS NOT NULL
BEGIN
    IF OBJECT_ID('model.CK_model_CalculatedColumn_DataType', 'C') IS NOT NULL
        ALTER TABLE model.CalculatedColumn DROP CONSTRAINT CK_model_CalculatedColumn_DataType;
    ALTER TABLE model.CalculatedColumn ADD CONSTRAINT CK_model_CalculatedColumn_DataType
        CHECK (DataType COLLATE Latin1_General_BIN2 IN ('number', 'text') AND DataType NOT LIKE '% ');
END
GO
