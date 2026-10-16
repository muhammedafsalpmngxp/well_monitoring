SET NOCOUNT ON;

;WITH LatestRows AS (
    SELECT row_id,
           ROW_NUMBER() OVER (
               PARTITION BY project_id, code, Well_ID
               ORDER BY updated_at DESC, schedule_id DESC, row_id DESC
           ) AS RowRank
    FROM dbo.ActivityTaskPlan
)
SELECT row_id
FROM LatestRows
WHERE RowRank = 1
OPTION (MAXDOP 1);