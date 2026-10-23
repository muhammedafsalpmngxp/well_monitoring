USE [AlTasnimBI];

DECLARE @execute bit = 0;
DECLARE @tableId int = OBJECT_ID(N'dbo.activity_task_plan', N'U');
DECLARE @indexName sysname = N'IX_activity_task_plan_CrewCalendarLatest';
DECLARE @indexSql nvarchar(max) = N'
CREATE NONCLUSTERED INDEX [IX_activity_task_plan_CrewCalendarLatest]
ON [dbo].[activity_task_plan]
(
    [well_id],
    [task_code],
    [project_id],
    [updated_at] DESC,
    [schedule_id] DESC,
    [row_id] DESC,
    [created_at] DESC,
    [activity_task_plan_id] DESC
)
INCLUDE
(
    [task_type],
    [target_start_date],
    [target_end_date],
    [actual_start_date],
    [actual_end_date]
)
WITH (MAXDOP = 2, SORT_IN_TEMPDB = OFF, ONLINE = OFF);';

IF @tableId IS NULL
    THROW 50000, 'AlTasnimBI.dbo.activity_task_plan was not found.', 1;

IF EXISTS (
    SELECT 1
    FROM (VALUES
        (N'well_id'), (N'task_code'), (N'project_id'), (N'updated_at'),
        (N'schedule_id'), (N'row_id'), (N'created_at'), (N'activity_task_plan_id'),
        (N'task_type'), (N'target_start_date'), (N'target_end_date'),
        (N'actual_start_date'), (N'actual_end_date')
    ) AS required(ColumnName)
    WHERE NOT EXISTS (
        SELECT 1 FROM sys.columns
        WHERE object_id = @tableId AND name = required.ColumnName
    )
)
    THROW 50001, 'A required index column is missing.', 1;

IF EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = @tableId AND name = @indexName
)
    THROW 50002, 'The proposed index name already exists. Review its definition before proceeding.', 1;

IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = @tableId
      AND name IN (N'well_id', N'task_code')
      AND (max_length = -1 OR system_type_id NOT IN (167, 175, 231, 239))
)
    THROW 50003, 'Well and task keys must be bounded character columns.', 1;

IF (
    SELECT SUM(CONVERT(int, max_length))
    FROM sys.columns
    WHERE object_id = @tableId
      AND name IN (N'well_id', N'task_code', N'project_id', N'updated_at',
                   N'schedule_id', N'row_id', N'created_at', N'activity_task_plan_id')
) > 1700
    THROW 50004, 'The declared index keys exceed the nonclustered key-width limit.', 1;

SELECT @execute AS ExecuteChanges,
       N'Offline build: schedule a maintenance window and check free storage and transaction-log capacity.' AS DeploymentNote,
       @indexSql AS ProposedIndexSql;

IF @execute = 1
    EXEC sys.sp_executesql @indexSql;