SET NOCOUNT ON;
DROP TABLE IF EXISTS #CrewCalendarCandidateKeys;
DROP TABLE IF EXISTS #CrewCalendarEligibleKeys;

SELECT DISTINCT activity.project_id,
                activity.task_code,
                activity.well_id
INTO #CrewCalendarCandidateKeys
FROM AlTasnimBI.dbo.activity_task_plan AS activity
CROSS APPLY (VALUES (
    CASE WHEN YEAR(activity.target_start_date) > 1900 THEN activity.target_start_date END,
    CASE WHEN YEAR(activity.target_end_date) > 1900 THEN activity.target_end_date END,
    CASE WHEN YEAR(activity.actual_start_date) > 1900 THEN activity.actual_start_date END,
    CASE WHEN YEAR(activity.actual_end_date) > 1900 THEN activity.actual_end_date END
)) AS dates(PlannedStart, PlannedEnd, ActualStart, ActualEnd)
CROSS APPLY (VALUES (
    CONVERT(date, COALESCE(dates.ActualStart,
        CASE WHEN dates.ActualEnd IS NOT NULL THEN
            CASE WHEN dates.PlannedEnd >= dates.PlannedStart
                      AND dates.PlannedStart <= dates.ActualEnd
                 THEN dates.PlannedStart ELSE dates.ActualEnd END
        END)),
    CONVERT(date, COALESCE(dates.ActualEnd, GETDATE()))
)) AS actual(StartedOn, EndedOn)
WHERE activity.well_id IS NOT NULL
  AND (@wellType IS NULL OR activity.task_type = @wellType)
  AND (@project IS NULL OR activity.project_id = @project)
  AND (
      (@cluster IS NULL AND @plant IS NULL)
      OR EXISTS (
          SELECT 1
          FROM AlTasnimBI.project.project_mstr AS project
          INNER JOIN AlTasnimBI.core.plant_description AS plant
              ON plant.plant_code = TRY_CONVERT(int, project.site_code)
          INNER JOIN AlTasnimBI.ref.cluster AS cluster
              ON cluster.cluster_code = plant.cluster_code
          WHERE project.project_id = activity.project_id
            AND (@cluster IS NULL OR LTRIM(RTRIM(cluster.cluster_name)) = @cluster)
            AND (@plant IS NULL OR LTRIM(RTRIM(plant.plant_description)) = @plant)
      )
  )
  AND (
      (dates.PlannedEnd >= dates.PlannedStart
       AND CONVERT(date, dates.PlannedStart) <= @toDate
       AND dates.PlannedEnd >= @fromDate)
      OR (actual.StartedOn <= @toDate AND actual.EndedOn >= @fromDate
          AND actual.EndedOn >= actual.StartedOn)
  )
OPTION (HASH GROUP, RECOMPILE);

SELECT latest.row_id, latest.activity_task_plan_id
INTO #CrewCalendarEligibleKeys
FROM #CrewCalendarCandidateKeys AS candidate
CROSS APPLY (
    SELECT TOP (1) detail.row_id, detail.activity_task_plan_id,
           detail.target_start_date, detail.target_end_date, detail.actual_start_date, detail.actual_end_date
    FROM AlTasnimBI.dbo.activity_task_plan AS detail
    WHERE detail.well_id = candidate.well_id
      AND detail.task_code IS NOT DISTINCT FROM candidate.task_code
      AND detail.project_id IS NOT DISTINCT FROM candidate.project_id
      AND (@wellType IS NULL OR detail.task_type = @wellType)
    ORDER BY detail.updated_at DESC, detail.schedule_id DESC, detail.row_id DESC,
             detail.created_at DESC, detail.activity_task_plan_id DESC
) AS latest
CROSS APPLY (VALUES (
    CASE WHEN YEAR(latest.target_start_date) > 1900 THEN latest.target_start_date END,
    CASE WHEN YEAR(latest.target_end_date) > 1900 THEN latest.target_end_date END,
    CASE WHEN YEAR(latest.actual_start_date) > 1900 THEN latest.actual_start_date END,
    CASE WHEN YEAR(latest.actual_end_date) > 1900 THEN latest.actual_end_date END
)) AS dates(PlannedStart, PlannedEnd, ActualStart, ActualEnd)
CROSS APPLY (VALUES (
    CONVERT(date, COALESCE(dates.ActualStart,
        CASE WHEN dates.ActualEnd IS NOT NULL THEN
            CASE WHEN dates.PlannedEnd >= dates.PlannedStart AND dates.PlannedStart <= dates.ActualEnd
                 THEN dates.PlannedStart ELSE dates.ActualEnd END
        END)),
    CONVERT(date, COALESCE(dates.ActualEnd, GETDATE()))
)) AS actual(StartedOn, EndedOn)
WHERE (dates.PlannedEnd >= dates.PlannedStart
       AND CONVERT(date, dates.PlannedStart) <= @toDate AND dates.PlannedEnd >= @fromDate)
   OR (actual.StartedOn <= @toDate AND actual.EndedOn >= @fromDate AND actual.EndedOn >= actual.StartedOn)
OPTION (RECOMPILE);

;WITH ActivityGroups AS (
    SELECT LTRIM(RTRIM(activity_id)) AS ActivityId,
           MIN(LTRIM(RTRIM(new_crew_code))) AS CrewGroup
    FROM AlTasnimBI.dbo.activity_codes_norms
    WHERE NULLIF(LTRIM(RTRIM(activity_id)), '') IS NOT NULL
      AND NULLIF(LTRIM(RTRIM(new_crew_code)), '') IS NOT NULL
      AND new_crew_code <> '#N/A'
    GROUP BY LTRIM(RTRIM(activity_id))
    HAVING COUNT(DISTINCT LTRIM(RTRIM(new_crew_code))) = 1
), MasterGroups AS (
    SELECT LTRIM(RTRIM(activity_code)) AS ActivityCode,
           MIN(LTRIM(RTRIM(crew_code))) AS CrewGroup
    FROM AlTasnimBI.dbo.activity_master_csv
    WHERE NULLIF(LTRIM(RTRIM(crew_code)), '') IS NOT NULL
    GROUP BY LTRIM(RTRIM(activity_code))
    HAVING COUNT(DISTINCT LTRIM(RTRIM(crew_code))) = 1
), CalendarActivities AS (
    SELECT activity.project_id AS ProjectId,
           COALESCE(NULLIF(LTRIM(RTRIM(activity.crew_type)), ''),
                    activityGroup.CrewGroup, masterGroup.CrewGroup) AS CrewGroup,
           LTRIM(RTRIM(activity.crew_type)) AS CrewCode,
           LTRIM(RTRIM(activity.crew_uid)) AS CrewId,
           CASE
               WHEN activity.parent_wbs_code LIKE 'W[0-9]%' THEN NULL
               WHEN LTRIM(RTRIM(activity.parent_wbs_code)) = '' THEN NULL
               ELSE LTRIM(RTRIM(activity.parent_wbs_code))
           END AS Category,
           LTRIM(RTRIM(activity.task_code)) AS ActivityCode,
           LTRIM(RTRIM(COALESCE(NULLIF(CAST(activity.task_description AS nvarchar(500)), ''),
                               activity.task_code, 'Unnamed'))) AS ActivityText,
           activity.task_type AS ActivityType,
           CASE WHEN YEAR(activity.target_start_date) > 1900 THEN activity.target_start_date END AS PlannedStart,
           CASE WHEN YEAR(activity.target_end_date) > 1900 THEN activity.target_end_date END AS PlannedEnd,
           CASE WHEN YEAR(activity.actual_start_date) > 1900 THEN activity.actual_start_date END AS ActualStart,
           CASE WHEN YEAR(activity.actual_end_date) > 1900 THEN activity.actual_end_date END AS ActualEnd,
           activity.progress_percent AS ProgressRaw,
           activity.planned_quantity AS Qty,
           activity.planned_manhours AS Manhours,
           activity.actual_quantity AS QtyActual,
           LTRIM(RTRIM(activity.well_id)) AS WellID,
           CASE WHEN activity.task_type = 'M' THEN 1 ELSE 0 END AS IsMilestone
    FROM #CrewCalendarEligibleKeys AS latest
    CROSS APPLY (
        SELECT TOP (1) detail.*
        FROM AlTasnimBI.dbo.activity_task_plan AS detail
                WHERE detail.row_id IS NOT DISTINCT FROM latest.row_id
                    AND detail.activity_task_plan_id = latest.activity_task_plan_id
          AND (@wellType IS NULL OR detail.task_type = @wellType)
        ORDER BY detail.updated_at DESC,
                 detail.schedule_id DESC,
                 detail.row_id DESC,
                 detail.created_at DESC,
                 detail.activity_task_plan_id DESC
    ) AS activity
    LEFT JOIN ActivityGroups AS activityGroup
        ON activityGroup.ActivityId = LEFT(LTRIM(RTRIM(activity.task_code)),
            CHARINDEX('-', LTRIM(RTRIM(activity.task_code)) + '-') - 1)
    LEFT JOIN MasterGroups AS masterGroup
        ON masterGroup.ActivityCode = LTRIM(RTRIM(activity.task_code))
), WellDates AS (
    SELECT LTRIM(RTRIM(well_id)) AS WellID,
           MAX(rig_on_date) AS RigOnDate
    FROM AlTasnimBI.well.well_master
    WHERE NULLIF(LTRIM(RTRIM(well_id)), '') IS NOT NULL
    GROUP BY LTRIM(RTRIM(well_id))
), ProjectPlants AS (
    SELECT project_id, MIN(TRY_CONVERT(int, site_code)) AS PlantCode
    FROM AlTasnimBI.project.project_mstr
    WHERE project_id IS NOT NULL
    GROUP BY project_id
    HAVING COUNT(DISTINCT TRY_CONVERT(int, site_code)) = 1
)
SELECT activity.CrewGroup,
       activity.CrewCode,
       activity.CrewId,
       activity.Category,
       activity.ActivityCode,
       activity.ActivityText,
       activity.ActivityType,
       CONVERT(varchar(10), activity.PlannedStart, 23) AS PlannedStart,
       CONVERT(varchar(10), activity.PlannedEnd, 23) AS PlannedEnd,
       CONVERT(varchar(10), activity.ActualStart, 23) AS ActualStart,
       CONVERT(varchar(10), activity.ActualEnd, 23) AS ActualEnd,
       CAST(ISNULL(activity.ProgressRaw, 0) * 100 AS decimal(10,2)) AS Progress,
       activity.WellID,
       activity.IsMilestone,
       CASE
           WHEN activity.ActivityType = 'M' THEN 'milestone'
           WHEN activity.ActualEnd IS NOT NULL THEN 'completed'
           WHEN activity.ActualStart IS NOT NULL THEN 'inprogress'
           ELSE 'planned'
       END AS Status,
       CONVERT(varchar(10), well.RigOnDate, 23) AS RigOnDate,
       activity.Qty,
       activity.Manhours,
       activity.QtyActual,
       CASE WHEN activity.Manhours > 0
            THEN CAST(activity.Qty / (activity.Manhours / 8.0) AS decimal(10,2))
       END AS NormsPerDay,
       CASE WHEN activity.Manhours > 0 AND activity.ActualStart IS NOT NULL
                 AND DATEDIFF(DAY, activity.ActualStart, GETDATE()) > 0
                 AND activity.QtyActual IS NOT NULL AND activity.QtyActual > 0
            THEN CAST(
                (activity.QtyActual / CAST(DATEDIFF(DAY, activity.ActualStart, GETDATE()) AS decimal(18,4)))
                / NULLIF(activity.Qty / (activity.Manhours / 8.0), 0) * 100
                AS decimal(10,1))
       END AS ProductivityPct,
    CONVERT(nvarchar(50), activity.ProjectId) AS ProjectId,
    project.PlantCode
FROM CalendarActivities AS activity
LEFT JOIN WellDates AS well ON well.WellID = activity.WellID
LEFT JOIN ProjectPlants AS project ON project.project_id = activity.ProjectId
CROSS APPLY (VALUES (
    CONVERT(date, COALESCE(activity.ActualStart,
        CASE WHEN activity.ActualEnd IS NOT NULL THEN
            CASE WHEN activity.PlannedEnd >= activity.PlannedStart
                      AND activity.PlannedStart <= activity.ActualEnd
                 THEN activity.PlannedStart ELSE activity.ActualEnd END
        END)),
    CONVERT(date, COALESCE(activity.ActualEnd, GETDATE()))
)) AS actual(StartedOn, EndedOn)
WHERE activity.CrewGroup IS NOT NULL
  AND (
      (activity.PlannedEnd >= activity.PlannedStart
       AND CONVERT(date, activity.PlannedStart) <= @toDate
       AND activity.PlannedEnd >= @fromDate)
      OR (actual.StartedOn <= @toDate AND actual.EndedOn >= @fromDate
          AND actual.EndedOn >= actual.StartedOn)
  )
ORDER BY activity.CrewGroup, activity.CrewCode, activity.PlannedStart
OPTION (RECOMPILE);

DROP TABLE #CrewCalendarCandidateKeys;
DROP TABLE #CrewCalendarEligibleKeys;
