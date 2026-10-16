-- Crew Calendar: activities grouped by CrewGroup → CrewId for the Gantt schedule board.
-- Parameters: @fromDate, @toDate, (optional) @wellType, @project, @cluster, @site
-- Cluster and plant filtering use the recorded project-to-plant relationship.

SET NOCOUNT ON;
DROP TABLE IF EXISTS #CrewCalendarLatestRows;
DROP TABLE IF EXISTS #CrewCalendarActivities;
DROP TABLE IF EXISTS #CrewCalendarWellDates;
DROP TABLE IF EXISTS #CrewCalendarWmrTimestamps;
DROP TABLE IF EXISTS #CrewCalendarWmrActivity;
DECLARE @sharedLatestRows nvarchar(max) = NULL;
/* __SHARED_LATEST_ROWS__ */

CREATE TABLE #CrewCalendarLatestRows (row_id bigint NOT NULL PRIMARY KEY);
IF @sharedLatestRows IS NOT NULL
BEGIN
    INSERT #CrewCalendarLatestRows (row_id)
    SELECT row_id FROM OPENJSON(@sharedLatestRows) WITH (row_id bigint '$');
END
ELSE
BEGIN
;WITH LatestRows AS (
    SELECT atp.row_id,
           ROW_NUMBER() OVER (
               PARTITION BY atp.project_id, atp.code, atp.Well_ID
               ORDER BY atp.updated_at DESC, atp.schedule_id DESC, atp.row_id DESC
           ) AS RowRank
    FROM dbo.ActivityTaskPlan atp WITH (NOLOCK)
    WHERE atp.Well_ID IS NOT NULL
      /* __WELL_TYPE_FILTER__ */
      /* __PROJECT_FILTER__ */
      /* __SCOPE_FILTER__ */
)
INSERT #CrewCalendarLatestRows (row_id)
SELECT row_id
FROM LatestRows
WHERE RowRank = 1
OPTION (MAXDOP 1);
END;

;WITH ActivityGroups AS (
    SELECT LTRIM(RTRIM(Activity_ID)) AS ActivityId,
           MIN(LTRIM(RTRIM(New_Crew_code))) AS CrewGroup
    FROM dbo.ActivityCodesNorms
    WHERE NULLIF(LTRIM(RTRIM(Activity_ID)), '') IS NOT NULL
      AND NULLIF(LTRIM(RTRIM(New_Crew_code)), '') IS NOT NULL
      AND New_Crew_code <> '#N/A'
    GROUP BY LTRIM(RTRIM(Activity_ID))
    HAVING COUNT(DISTINCT LTRIM(RTRIM(New_Crew_code))) = 1
),
MasterGroups AS (
    SELECT LTRIM(RTRIM(ACTIVITY_CODE)) AS ActivityCode,
           MIN(LTRIM(RTRIM(CREW_GROUP_CODE))) AS CrewGroup
    FROM dbo.ActivityMasterCSV
    WHERE NULLIF(LTRIM(RTRIM(CREW_GROUP_CODE)), '') IS NOT NULL
    GROUP BY LTRIM(RTRIM(ACTIVITY_CODE))
    HAVING COUNT(DISTINCT LTRIM(RTRIM(CREW_GROUP_CODE))) = 1
),
Ranked AS (
    SELECT
        atp.project_id                                           AS ProjectId,
        COALESCE(NULLIF(LTRIM(RTRIM(atp.crew_type)), ''), ag.CrewGroup, mg.CrewGroup) AS CrewGroup,
        LTRIM(RTRIM(atp.crew_type))                              AS CrewCode,
        LTRIM(RTRIM(atp.crew_uid))                               AS CrewId,
        CASE
            WHEN atp.Parent_WBS LIKE 'W[0-9]%' THEN NULL
            WHEN LTRIM(RTRIM(atp.Parent_WBS)) = '' THEN NULL
            ELSE LTRIM(RTRIM(atp.Parent_WBS))
        END                                                      AS Category,
        LTRIM(RTRIM(atp.code))                                   AS ActivityCode,
        LTRIM(RTRIM(COALESCE(NULLIF(CAST(atp.[text] AS NVARCHAR(500)), ''), atp.code, 'Unnamed'))) AS ActivityText,
        atp.type                                                 AS ActivityType,
           CASE WHEN YEAR(atp.target_start) > 1900 THEN atp.target_start END AS PlannedStart,
           CASE WHEN YEAR(atp.target_end) > 1900 THEN atp.target_end END AS PlannedEnd,
        CASE WHEN YEAR(atp.actual_start) > 1900 THEN atp.actual_start END AS ActualStart,
        CASE WHEN YEAR(atp.actual_end)   > 1900 THEN atp.actual_end   END AS ActualEnd,
        TRY_CAST(atp.progress AS DECIMAL(10,4))                  AS ProgressRaw,
        TRY_CAST(atp.qty AS DECIMAL(18,4))                       AS Qty,
        TRY_CAST(atp.manhours AS DECIMAL(18,4))                   AS Manhours,
        TRY_CAST(atp.qtyactual AS DECIMAL(18,4))                  AS QtyActual,
        LTRIM(RTRIM(atp.Well_ID))                                AS WellID,
        CASE WHEN atp.type = 'M' THEN 1 ELSE 0 END              AS IsMilestone
    FROM dbo.ActivityTaskPlan atp WITH (NOLOCK)
        INNER JOIN #CrewCalendarLatestRows latest ON latest.row_id = atp.row_id
        LEFT JOIN ActivityGroups ag ON ag.ActivityId = LEFT(LTRIM(RTRIM(atp.code)), CHARINDEX('-', LTRIM(RTRIM(atp.code)) + '-') - 1)
        LEFT JOIN MasterGroups mg ON mg.ActivityCode = LTRIM(RTRIM(atp.code))
    WHERE atp.Well_ID IS NOT NULL
)
SELECT r.* INTO #CrewCalendarActivities
FROM Ranked r
CROSS APPLY (VALUES (
    CONVERT(date, COALESCE(r.ActualStart,
        CASE WHEN r.ActualEnd IS NOT NULL THEN
            CASE WHEN r.PlannedEnd >= r.PlannedStart AND r.PlannedStart <= r.ActualEnd
                 THEN r.PlannedStart ELSE r.ActualEnd END
        END)),
    CONVERT(date, COALESCE(r.ActualEnd, GETDATE()))
)) actual(StartedOn, EndedOn)
WHERE r.CrewGroup IS NOT NULL
    AND (
        (r.PlannedEnd >= r.PlannedStart
            AND r.PlannedStart <= @toDate
            AND r.PlannedEnd >= @fromDate)
        OR (actual.StartedOn <= @toDate
            AND actual.EndedOn >= @fromDate
            AND actual.EndedOn >= actual.StartedOn)
    );

CREATE INDEX IX_CrewCalendarActivities_Well ON #CrewCalendarActivities(WellID);

SELECT TOP (0) LTRIM(RTRIM(pdo_well_id)) AS WellID,
       TRY_CONVERT(date, actual_rig_on_date) AS RigOnDateDt
INTO #CrewCalendarWellDates
FROM dbo.WellMonitoringReportOptimized;

IF EXISTS (SELECT 1 FROM #CrewCalendarActivities)
BEGIN
    DECLARE @wmr_definition nvarchar(max) = OBJECT_DEFINITION(OBJECT_ID(N'dbo.WellMonitoringReportOptimized'));
    DECLARE @wmr_start int = CHARINDEX(N'WITH target_week AS (', @wmr_definition);
    DECLARE @wmr_union int = CHARINDEX(N'final_union AS (', @wmr_definition);
    DECLARE @wmr_select int = CHARINDEX(N'SELECT', @wmr_definition, CHARINDEX(N')', @wmr_definition, @wmr_union) + 1);
    DECLARE @wmr_end int = CHARINDEX(N'FROM final_union;', @wmr_definition, @wmr_select);
    DECLARE @wmr_source nvarchar(100) = N'FROM dbo.ActivityTaskPlan atp';

    IF @wmr_start > 0 AND @wmr_union > @wmr_start AND @wmr_select > @wmr_union AND @wmr_end > @wmr_select
       AND (LEN(@wmr_definition) - LEN(REPLACE(@wmr_definition, @wmr_source, N''))) / LEN(@wmr_source) = 2
       AND EXISTS (
           SELECT 1 FROM sys.columns
           WHERE object_id = OBJECT_ID(N'dbo.ActivityTaskPlan')
             AND name = N'Time_Stamp' AND system_type_id = 231 AND max_length = 510
                         AND collation_name = CONVERT(sysname, DATABASEPROPERTYEX(DB_NAME(), 'Collation'))
       )
    BEGIN
        CREATE TABLE #CrewCalendarWmrTimestamps (
            Time_Stamp nvarchar(255) COLLATE DATABASE_DEFAULT PRIMARY KEY,
            SnapshotDate date NULL
        );
        DECLARE @wmr_timestamp nvarchar(255) = (SELECT MIN(Time_Stamp) FROM dbo.ActivityTaskPlan WITH (NOLOCK));
        WHILE @wmr_timestamp IS NOT NULL
        BEGIN
            INSERT #CrewCalendarWmrTimestamps VALUES (
                @wmr_timestamp,
                TRY_CONVERT(date, LEFT(LTRIM(RTRIM(CONVERT(nvarchar(100), @wmr_timestamp))), 10), 23)
            );
            SELECT @wmr_timestamp = MIN(Time_Stamp)
            FROM dbo.ActivityTaskPlan WITH (NOLOCK) WHERE Time_Stamp > @wmr_timestamp;
        END;

        DECLARE @wmr_latest_date date = (SELECT MAX(SnapshotDate) FROM #CrewCalendarWmrTimestamps);
        SELECT atp.row_id, atp.code, atp.actual_start, atp.actual_end, atp.Time_Stamp
        INTO #CrewCalendarWmrActivity
        FROM dbo.ActivityTaskPlan atp WITH (NOLOCK)
        INNER JOIN #CrewCalendarWmrTimestamps snapshot
            ON snapshot.Time_Stamp = atp.Time_Stamp
        WHERE snapshot.SnapshotDate = @wmr_latest_date;

        DECLARE @wmr_sql nvarchar(max) = REPLACE(
            SUBSTRING(@wmr_definition, @wmr_start, @wmr_select - @wmr_start),
            @wmr_source, N'FROM #CrewCalendarWmrActivity atp'
        ) + N', CrewCalendarWellReport AS ('
          + SUBSTRING(@wmr_definition, @wmr_select, @wmr_end + LEN(N'FROM final_union') - @wmr_select)
          + N')
        INSERT #CrewCalendarWellDates (WellID, RigOnDateDt)
        SELECT LTRIM(RTRIM(pdo_well_id)), MAX(TRY_CONVERT(date, actual_rig_on_date))
        FROM CrewCalendarWellReport WITH (NOLOCK)
        WHERE pdo_well_id IS NOT NULL AND LTRIM(RTRIM(pdo_well_id)) != ''''
          AND EXISTS (
              SELECT 1 FROM #CrewCalendarActivities activities
              WHERE activities.WellID = LTRIM(RTRIM(pdo_well_id))
          )
        GROUP BY LTRIM(RTRIM(pdo_well_id));';
        EXEC sys.sp_executesql @wmr_sql;

        DROP TABLE #CrewCalendarWmrActivity;
        DROP TABLE #CrewCalendarWmrTimestamps;
    END
    ELSE
    BEGIN
        INSERT #CrewCalendarWellDates (WellID, RigOnDateDt)
        SELECT LTRIM(RTRIM(pdo_well_id)), MAX(TRY_CONVERT(date, actual_rig_on_date))
        FROM dbo.WellMonitoringReportOptimized WITH (NOLOCK)
        WHERE pdo_well_id IS NOT NULL AND LTRIM(RTRIM(pdo_well_id)) != ''
          AND EXISTS (
              SELECT 1 FROM #CrewCalendarActivities activities
              WHERE activities.WellID = LTRIM(RTRIM(pdo_well_id))
          )
        GROUP BY LTRIM(RTRIM(pdo_well_id));
    END;
END;

SELECT
    r.CrewGroup,
    r.CrewCode,
    r.CrewId,
    r.Category,
    r.ActivityCode,
    r.ActivityText,
    r.ActivityType,
    CONVERT(varchar(10), r.PlannedStart, 23) AS PlannedStart,
    CONVERT(varchar(10), r.PlannedEnd,   23) AS PlannedEnd,
    CASE WHEN r.ActualStart IS NOT NULL THEN CONVERT(varchar(10), r.ActualStart, 23) END AS ActualStart,
    CASE WHEN r.ActualEnd   IS NOT NULL THEN CONVERT(varchar(10), r.ActualEnd,   23) END AS ActualEnd,
    CAST(ISNULL(r.ProgressRaw, 0) * 100 AS DECIMAL(10,2)) AS Progress,
    r.WellID,
    r.IsMilestone,
    CASE
        WHEN r.ActivityType = 'M' THEN 'milestone'
           WHEN r.ActualEnd IS NOT NULL THEN 'completed'
           WHEN r.ActualStart IS NOT NULL THEN 'inprogress'
           ELSE 'planned'
    END AS Status,
    CONVERT(varchar(10), w.RigOnDateDt, 23) AS RigOnDate,
    r.Qty,
    r.Manhours,
    r.QtyActual,
    CASE WHEN r.Manhours > 0
         THEN CAST(r.Qty / (r.Manhours / 8.0) AS DECIMAL(10,2))
         ELSE NULL END AS NormsPerDay,
    CASE WHEN r.Manhours > 0 AND r.ActualStart IS NOT NULL
              AND DATEDIFF(DAY, r.ActualStart, GETDATE()) > 0
              AND r.QtyActual IS NOT NULL AND r.QtyActual > 0
         THEN CAST(
             (r.QtyActual / CAST(DATEDIFF(DAY, r.ActualStart, GETDATE()) AS DECIMAL(18,4)))
             / NULLIF((r.Qty / (r.Manhours / 8.0)), 0) * 100
             AS DECIMAL(10,1))
         ELSE NULL END AS ProductivityPct,
    CONVERT(nvarchar(50), r.ProjectId) AS ProjectId
FROM #CrewCalendarActivities r
LEFT JOIN #CrewCalendarWellDates w ON r.WellID = w.WellID
ORDER BY r.CrewGroup ASC, r.CrewCode ASC, r.PlannedStart ASC;

DROP TABLE #CrewCalendarLatestRows;
DROP TABLE #CrewCalendarActivities;
DROP TABLE #CrewCalendarWellDates;
