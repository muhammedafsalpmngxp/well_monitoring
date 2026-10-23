USE [AlTasnimBI];
SET NOCOUNT ON;

-- Preview by default. Set to 1 only during an approved maintenance window.
DECLARE @execute bit = 0;
DECLARE @tableId int = OBJECT_ID(N'dbo.activity_task_plan', N'U');
DECLARE @indexName sysname = N'IX_activity_task_plan_CrewCalendarRowLookup';
DECLARE @supportingIndex sysname;
DECLARE @indexSql nvarchar(max) = N'
CREATE NONCLUSTERED INDEX [IX_activity_task_plan_CrewCalendarRowLookup]
ON [dbo].[activity_task_plan] ([row_id], [activity_task_plan_id])
INCLUDE ([updated_at], [schedule_id], [created_at], [task_type])
WITH (MAXDOP = 2, SORT_IN_TEMPDB = OFF, ONLINE = OFF);';

IF @tableId IS NULL
    THROW 50000, 'AlTasnimBI.dbo.activity_task_plan was not found.', 1;

IF EXISTS (
    SELECT 1
    FROM (VALUES
        (N'row_id'), (N'activity_task_plan_id'), (N'updated_at'),
        (N'schedule_id'), (N'created_at'), (N'task_type')
    ) AS required(ColumnName)
    WHERE NOT EXISTS (
        SELECT 1 FROM sys.columns
        WHERE object_id = @tableId AND name = required.ColumnName
    )
)
    THROW 50001, 'A required row-lookup index column is missing.', 1;

SELECT TOP (1) @supportingIndex = existing.name
FROM sys.indexes AS existing
WHERE existing.object_id = @tableId
  AND existing.type = 2
  AND existing.is_disabled = 0
  AND existing.is_hypothetical = 0
  AND existing.has_filter = 0
  AND NOT EXISTS (
      SELECT 1
      FROM (VALUES (N'row_id', 1), (N'activity_task_plan_id', 2)) AS required(ColumnName, KeyOrdinal)
      WHERE NOT EXISTS (
          SELECT 1
          FROM sys.index_columns AS indexed
          INNER JOIN sys.columns AS columnInfo
              ON columnInfo.object_id = indexed.object_id AND columnInfo.column_id = indexed.column_id
          WHERE indexed.object_id = @tableId
            AND indexed.index_id = existing.index_id
            AND indexed.key_ordinal = required.KeyOrdinal
            AND columnInfo.name = required.ColumnName
      )
  )
  AND NOT EXISTS (
      SELECT 1
      FROM (VALUES
          (N'updated_at'), (N'schedule_id'), (N'created_at'), (N'task_type')
      ) AS required(ColumnName)
      WHERE NOT EXISTS (
          SELECT 1
          FROM sys.index_columns AS indexed
          INNER JOIN sys.columns AS columnInfo
              ON columnInfo.object_id = indexed.object_id AND columnInfo.column_id = indexed.column_id
          WHERE indexed.object_id = @tableId
            AND indexed.index_id = existing.index_id
            AND columnInfo.name = required.ColumnName
      )
  )
ORDER BY CASE WHEN existing.name = @indexName THEN 0 ELSE 1 END, existing.name;

IF @supportingIndex IS NOT NULL
BEGIN
    SELECT N'Already supported; no changes made.' AS Status, @supportingIndex AS IndexName;
    RETURN;
END;

IF EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = @tableId AND name = @indexName)
    THROW 50002, 'The row-lookup index name exists with a different or unusable definition. Review it before proceeding.', 1;

SELECT @execute AS ExecuteChanges,
       @indexName AS IndexName,
       N'Offline build: check free storage and transaction-log capacity; writes/imports can be blocked.' AS DeploymentNote,
       @indexSql AS ProposedIndexSql;

IF @execute = 1
BEGIN
    SET LOCK_TIMEOUT 10000;
    EXEC sys.sp_executesql @indexSql;
    SELECT N'Created row-lookup index.' AS Status, @indexName AS IndexName;
END;
