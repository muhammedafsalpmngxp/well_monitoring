USE [AlTasnimBI];
SET NOCOUNT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;

-- Preview by default. Set to 1 to apply the approved precision correction.
DECLARE @execute bit = 0;
DECLARE @tableId int = OBJECT_ID(N'dbo.crew_calendar_result', N'U');
DECLARE @procedureId int = OBJECT_ID(N'dbo.Load_CrewCalendar_Result', N'P');
DECLARE @definition nvarchar(max) = OBJECT_DEFINITION(@procedureId);
DECLARE @precision tinyint, @scale tinyint, @nullable bit, @type sysname;
DECLARE @oldCast nvarchar(100) = N'AS decimal(10,1))';
-- Preserve one decimal place; both this cast and decimal(28,2) storage allow 26 integer digits.
DECLARE @newCast nvarchar(100) = N'AS decimal(27,1))';

IF @tableId IS NULL OR @procedureId IS NULL OR @definition IS NULL
    THROW 50000, 'The calendar result table or readable loader procedure was not found.', 1;

SELECT @precision = columnInfo.precision, @scale = columnInfo.scale,
       @nullable = columnInfo.is_nullable, @type = typeInfo.name
FROM sys.columns AS columnInfo
INNER JOIN sys.types AS typeInfo ON typeInfo.user_type_id = columnInfo.user_type_id
WHERE columnInfo.object_id = @tableId AND columnInfo.name = N'productivity_pct';

IF @precision IS NULL OR @type NOT IN (N'decimal', N'numeric')
   OR @precision NOT IN (10, 28) OR @scale <> 2
    THROW 50001, 'Unexpected productivity_pct definition; review the schema before applying this fix.', 1;

DECLARE @oldCastCount int = (LEN(@definition) - LEN(REPLACE(@definition, @oldCast, N''))) / LEN(@oldCast);
IF @oldCastCount > 1 OR (@oldCastCount = 0 AND CHARINDEX(@newCast, @definition) = 0)
    THROW 50002, 'Unexpected loader productivity expression; no procedure changes were made.', 1;

IF EXISTS (
    SELECT 1 FROM sys.sql_modules
    WHERE object_id = @procedureId AND (uses_ansi_nulls = 0 OR uses_quoted_identifier = 0)
)
    THROW 50003, 'Unexpected loader SET options; preserve them explicitly before applying this fix.', 1;

IF @precision = 28 AND @oldCastCount = 0
BEGIN
    SELECT N'Productivity precision is already corrected; no changes made.' AS Status;
    RETURN;
END;

IF @execute = 0
BEGIN
    SELECT N'Preview only; no changes made.' AS Status,
           N'dbo.crew_calendar_result.productivity_pct -> decimal(28,2)' AS ColumnChange,
           @oldCast AS PreviousLoaderCast, @newCast AS CorrectedLoaderCast,
           N'No source quantities are modified; no calendar rows are reloaded.' AS DataImpact;
    RETURN;
END;

IF @@TRANCOUNT <> 0
    THROW 50004, 'Run this deployment as a standalone batch, not inside the rollback-only SQL test harness.', 1;

DECLARE @alterColumn nvarchar(max) = N'ALTER TABLE dbo.crew_calendar_result ALTER COLUMN productivity_pct decimal(28,2)'
    + CASE WHEN @nullable = 1 THEN N' NULL;' ELSE N' NOT NULL;' END;
SET @definition = LTRIM(REPLACE(@definition, @oldCast, @newCast));
IF @definition NOT LIKE N'CREATE OR ALTER %'
BEGIN
    IF LEFT(@definition, 6) = N'CREATE'
        SET @definition = STUFF(@definition, 1, 6, N'ALTER');
    ELSE IF LEFT(@definition, 5) <> N'ALTER'
        THROW 50005, 'Unexpected procedure header; no changes were made.', 1;
END;

SET XACT_ABORT ON;
SET LOCK_TIMEOUT 10000;
BEGIN TRY
    BEGIN TRANSACTION;
    DECLARE @lockResult int;
    EXEC @lockResult = sys.sp_getapplock @Resource = N'TWise.CrewCalendarResult',
        @LockMode = N'Exclusive', @LockOwner = N'Transaction', @LockTimeout = 10000;
    IF @lockResult < 0
        THROW 50006, 'Calendar data is in use; retry this precision deployment when the current load finishes.', 1;

    IF @precision <> 28 EXEC sys.sp_executesql @alterColumn;
    IF @oldCastCount = 1 EXEC sys.sp_executesql @definition;

    IF NOT EXISTS (
        SELECT 1 FROM sys.columns
        WHERE object_id = @tableId AND name = N'productivity_pct' AND precision = 28 AND scale = 2
    ) OR CHARINDEX(@newCast, OBJECT_DEFINITION(@procedureId)) = 0
        THROW 50007, 'Productivity precision verification failed; the deployment will be rolled back.', 1;

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;

SELECT N'Applied productivity precision correction; source quantities and calendar rows were preserved.' AS Status;
