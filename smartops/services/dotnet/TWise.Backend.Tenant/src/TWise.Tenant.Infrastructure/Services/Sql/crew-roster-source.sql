SET NOCOUNT ON;
DROP TABLE IF EXISTS #CrewRosterLatestKeys;
DROP TABLE IF EXISTS #CrewRosterLatestActivities;

-- Same sources and latest-version ranking as crew-roster.sql, without the date window. Bookings are
-- clipped to the requested range in CrewCalendarService, so one load serves every date range.
;WITH CrewTypes AS (
        SELECT crew_type_id AS TypeId,
            MAX(NULLIF(LTRIM(RTRIM(crew_type_code)), '')) AS Code,
            MAX(NULLIF(LTRIM(RTRIM(crew_type_name)), '')) AS Description
        FROM AlTasnimBI.ref.crew_type
        GROUP BY crew_type_id
), Members AS (
    SELECT LTRIM(RTRIM(crews.Code)) AS CrewUid,
           COALESCE(NULLIF(LTRIM(RTRIM(crews.Composition)), ''), types.Code) AS CrewTypeCode,
           types.Code AS GroupCode,
           types.Description AS GroupName
    FROM AlTasnimBI.ref.crew crews
    INNER JOIN CrewTypes types ON types.TypeId = crews.crew_type_id
    WHERE NULLIF(LTRIM(RTRIM(crews.Code)), '') IS NOT NULL
), Derived AS (
    SELECT CrewUid, CrewTypeCode, GroupName,
           COALESCE(GroupCode, CASE WHEN CrewUid LIKE '%-%-%-%' THEN
               LEFT(STUFF(CrewUid, 1, CHARINDEX('-', CrewUid), ''),
                    LEN(STUFF(CrewUid, 1, CHARINDEX('-', CrewUid), ''))
                    - CHARINDEX('-', REVERSE(STUFF(CrewUid, 1, CHARINDEX('-', CrewUid), ''))))
           END) AS GroupCode
    FROM Members
)
SELECT DISTINCT GroupCode, GroupName, CrewUid, CrewTypeCode
FROM Derived
WHERE NULLIF(GroupCode, '') IS NOT NULL AND GroupCode <> 'UNKNOWN'
ORDER BY GroupCode, CrewUid;

SELECT DISTINCT project_id, task_code, well_id
INTO #CrewRosterLatestKeys
FROM AlTasnimBI.dbo.activity_task_plan
-- A key with no assigned version cannot supply bookings or crew-project mappings.
WHERE NULLIF(LTRIM(RTRIM(crew_uid)), '') IS NOT NULL
OPTION (HASH GROUP, RECOMPILE);

SELECT LTRIM(RTRIM(activity.crew_uid)) AS CrewUid,
             activity.project_id AS ProjectId,
             CASE WHEN YEAR(activity.target_start_date) > 1900 THEN activity.target_start_date END AS PlannedStart,
             CASE WHEN YEAR(activity.target_end_date) > 1900 THEN activity.target_end_date END AS PlannedEnd,
             CASE WHEN YEAR(activity.actual_start_date) > 1900 THEN activity.actual_start_date END AS ActualStart,
             CASE WHEN YEAR(activity.actual_end_date) > 1900 THEN activity.actual_end_date END AS ActualEnd
INTO #CrewRosterLatestActivities
FROM #CrewRosterLatestKeys AS latest
CROSS APPLY (
        SELECT TOP (1) detail.crew_uid, detail.project_id,
                     detail.target_start_date, detail.target_end_date, detail.actual_start_date, detail.actual_end_date
        FROM AlTasnimBI.dbo.activity_task_plan AS detail
        WHERE detail.well_id IS NOT DISTINCT FROM latest.well_id
            AND detail.task_code IS NOT DISTINCT FROM latest.task_code
            AND detail.project_id IS NOT DISTINCT FROM latest.project_id
        ORDER BY detail.updated_at DESC, detail.schedule_id DESC, detail.row_id DESC,
                         detail.created_at DESC, detail.activity_task_plan_id DESC
) AS activity
OPTION (RECOMPILE);

DROP TABLE #CrewRosterLatestKeys;

SELECT DISTINCT CrewUid, PlannedStart, PlannedEnd, ActualStart, ActualEnd
FROM #CrewRosterLatestActivities
WHERE NULLIF(CrewUid, '') IS NOT NULL;

SELECT DISTINCT LTRIM(RTRIM(crew.Code)) AS CrewUid,
         CONVERT(nvarchar(50), activity.ProjectId) AS ProjectId,
         NULLIF(LTRIM(RTRIM(project.project_code)), '') AS ProjectCode,
         NULLIF(LTRIM(RTRIM(project.cluster)), '') AS Cluster
FROM AlTasnimBI.ref.crew AS crew
INNER JOIN #CrewRosterLatestActivities AS activity
    ON activity.CrewUid = LTRIM(RTRIM(crew.code))
LEFT JOIN AlTasnimBI.project.project_mstr AS project
    ON project.project_id = activity.ProjectId
WHERE NULLIF(LTRIM(RTRIM(crew.Code)), '') IS NOT NULL
    AND activity.ProjectId IS NOT NULL
ORDER BY CrewUid, ProjectId, ProjectCode, Cluster;

DROP TABLE #CrewRosterLatestActivities;
