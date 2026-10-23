SET NOCOUNT ON;

SELECT LTRIM(RTRIM(result.crew_group)) AS CrewGroup,
       LTRIM(RTRIM(result.crew_code)) AS CrewCode,
       LTRIM(RTRIM(result.crew_id)) AS CrewId,
       NULLIF(LTRIM(RTRIM(result.category)), '') AS Category,
       COALESCE(LTRIM(RTRIM(result.activity_code)), '') AS ActivityCode,
       COALESCE(NULLIF(LTRIM(RTRIM(result.activity_text)), ''),
                NULLIF(LTRIM(RTRIM(result.activity_code)), ''), 'Unnamed') AS ActivityText,
       result.activity_type AS ActivityType,
       CONVERT(varchar(10), result.planned_start, 23) AS PlannedStart,
       CONVERT(varchar(10), result.planned_end, 23) AS PlannedEnd,
       CONVERT(varchar(10), result.actual_start, 23) AS ActualStart,
       CONVERT(varchar(10), result.actual_end, 23) AS ActualEnd,
       CAST(ISNULL(result.progress, 0) AS decimal(10,2)) AS Progress,
       LTRIM(RTRIM(result.well_id)) AS WellID,
       CONVERT(int, result.is_milestone) AS IsMilestone,
       CASE
           WHEN result.activity_type = 'M' THEN 'milestone'
           WHEN result.actual_end IS NOT NULL THEN 'completed'
           WHEN result.actual_start IS NOT NULL THEN 'inprogress'
           ELSE 'planned'
       END AS Status,
       CONVERT(varchar(10), result.rig_on_date, 23) AS RigOnDate,
       result.qty AS Qty,
       result.manhours AS Manhours,
       result.qty_actual AS QtyActual,
       result.norms_per_day AS NormsPerDay,
       -- Productivity depends on today's date, so it is recalculated instead of reusing the stored snapshot value.
       CASE WHEN result.manhours > 0 AND result.actual_start IS NOT NULL
                 AND DATEDIFF(DAY, result.actual_start, GETDATE()) > 0
                 AND result.qty_actual IS NOT NULL AND result.qty_actual > 0
            THEN CAST(
                (result.qty_actual / CAST(DATEDIFF(DAY, result.actual_start, GETDATE()) AS decimal(18,4)))
                / NULLIF(result.qty / (result.manhours / 8.0), 0) * 100
                AS decimal(27,1))
       END AS ProductivityPct,
       CONVERT(nvarchar(50), result.project_id) AS ProjectId,
       result.plant_code AS PlantCode
FROM AlTasnimBI.dbo.crew_calendar_result AS result
CROSS APPLY (VALUES (
    COALESCE(result.actual_start,
        CASE WHEN result.actual_end IS NOT NULL THEN
            CASE WHEN result.planned_end >= result.planned_start
                      AND result.planned_start <= result.actual_end
                 THEN result.planned_start ELSE result.actual_end END
        END),
    COALESCE(result.actual_end, CONVERT(date, GETDATE()))
)) AS actual(StartedOn, EndedOn)
WHERE NULLIF(LTRIM(RTRIM(result.crew_group)), '') IS NOT NULL
  AND result.well_id IS NOT NULL
  AND (@wellType IS NULL OR result.activity_type = @wellType)
  AND (@project IS NULL OR result.project_id = @project)
  AND (
      (@cluster IS NULL AND @plant IS NULL)
      OR EXISTS (
          SELECT 1
          FROM AlTasnimBI.project.project_mstr AS project
          INNER JOIN AlTasnimBI.core.plant_description AS plant
              ON plant.plant_code = TRY_CONVERT(int, project.site_code)
          INNER JOIN AlTasnimBI.ref.cluster AS cluster
              ON cluster.cluster_code = plant.cluster_code
          WHERE project.project_id = result.project_id
            AND (@cluster IS NULL OR LTRIM(RTRIM(cluster.cluster_name)) = @cluster)
            AND (@plant IS NULL OR LTRIM(RTRIM(plant.plant_description)) = @plant)
      )
  )
  AND (
      (result.planned_end >= result.planned_start
       AND result.planned_start <= @toDate
       AND result.planned_end >= @fromDate)
      OR (actual.StartedOn <= @toDate AND actual.EndedOn >= @fromDate
          AND actual.EndedOn >= actual.StartedOn)
  )
ORDER BY CrewGroup, CrewCode, result.planned_start
OPTION (RECOMPILE);
