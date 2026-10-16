SET NOCOUNT ON;
DROP TABLE IF EXISTS #CrewRosterLatestRows;
DECLARE @sharedLatestRows nvarchar(max) = NULL;
/* __SHARED_LATEST_ROWS__ */

;WITH CrewTypes AS (
    SELECT LTRIM(RTRIM(ID)) AS TypeId,
           MAX(NULLIF(LTRIM(RTRIM(Code)), '')) AS Code,
           MAX(NULLIF(LTRIM(RTRIM(Description)), '')) AS Description
    FROM dbo.CrewType
    GROUP BY LTRIM(RTRIM(ID))
), Members AS (
    SELECT LTRIM(RTRIM(crews.Code)) AS CrewUid,
           COALESCE(NULLIF(LTRIM(RTRIM(crews.Composition)), ''), types.Code) AS CrewTypeCode,
           types.Code AS GroupCode,
           types.Description AS GroupName
    FROM dbo.crews crews
    LEFT JOIN CrewTypes types ON types.TypeId = LTRIM(RTRIM(crews.CrewType))
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

CREATE TABLE #CrewRosterLatestRows (row_id bigint NOT NULL PRIMARY KEY);

IF @sharedLatestRows IS NOT NULL
BEGIN
    INSERT #CrewRosterLatestRows (row_id)
    SELECT row_id FROM OPENJSON(@sharedLatestRows) WITH (row_id bigint '$');
END
ELSE
BEGIN
;WITH LatestRows AS (
    SELECT row_id,
           ROW_NUMBER() OVER (
               PARTITION BY project_id, code, Well_ID
               ORDER BY updated_at DESC, schedule_id DESC, row_id DESC
           ) AS RowRank
    FROM dbo.ActivityTaskPlan
)
INSERT #CrewRosterLatestRows (row_id)
SELECT row_id
FROM LatestRows
WHERE RowRank = 1
OPTION (MAXDOP 1);
END;

;WITH Ranked AS (
    SELECT LTRIM(RTRIM(crew_uid)) AS CrewUid,
           CASE WHEN YEAR(target_start) > 1900 THEN target_start END AS PlannedStart,
           CASE WHEN YEAR(target_end) > 1900 THEN target_end END AS PlannedEnd,
           CASE WHEN YEAR(actual_start) > 1900 THEN actual_start END AS ActualStart,
           CASE WHEN YEAR(actual_end) > 1900 THEN actual_end END AS ActualEnd
    FROM dbo.ActivityTaskPlan atp
    INNER JOIN #CrewRosterLatestRows latest ON latest.row_id = atp.row_id
), Bookings AS (
    SELECT CrewUid,
             CASE WHEN ActualStart < PlannedStart THEN ActualStart
                 ELSE COALESCE(PlannedStart, ActualStart, @fromDate) END AS PlannedStart,
           CASE WHEN ActualStart IS NOT NULL AND ActualEnd IS NULL
                THEN CASE WHEN PlannedEnd > @toDate THEN PlannedEnd ELSE @toDate END
             WHEN ActualEnd > PlannedEnd THEN ActualEnd
                ELSE COALESCE(PlannedEnd, ActualEnd, @toDate) END AS PlannedEnd
    FROM Ranked
    WHERE NULLIF(CrewUid, '') IS NOT NULL
), SafeBookings AS (
    SELECT CrewUid,
           CASE WHEN PlannedEnd < PlannedStart THEN @fromDate ELSE PlannedStart END AS PlannedStart,
           CASE WHEN PlannedEnd < PlannedStart THEN @toDate ELSE PlannedEnd END AS PlannedEnd
    FROM Bookings
)
SELECT DISTINCT CrewUid,
       CONVERT(varchar(10), PlannedStart, 23) AS PlannedStart,
       CONVERT(varchar(10), PlannedEnd, 23) AS PlannedEnd
FROM SafeBookings
WHERE PlannedStart <= @toDate AND PlannedEnd >= @fromDate
  AND PlannedEnd >= PlannedStart;

DROP TABLE #CrewRosterLatestRows;

SELECT DISTINCT LTRIM(RTRIM(crew.Code)) AS CrewUid,
             LTRIM(RTRIM(task.Project_id)) AS ProjectId,
             NULLIF(LTRIM(RTRIM(project.Code)), '') AS ProjectCode,
             NULLIF(LTRIM(RTRIM(project.Cluster)), '') AS Cluster
FROM dbo.crews AS crew
LEFT JOIN dbo.TaskCrew AS task
        ON LTRIM(RTRIM(task.Crew)) = LTRIM(RTRIM(crew.ID))
LEFT JOIN dbo.ProjectIDs AS project
        ON TRY_CONVERT(uniqueidentifier, task.Project_id) = TRY_CONVERT(uniqueidentifier, project.ID)
WHERE NULLIF(LTRIM(RTRIM(crew.Code)), '') IS NOT NULL
    AND NULLIF(LTRIM(RTRIM(task.Project_id)), '') IS NOT NULL
ORDER BY CrewUid, ProjectId, ProjectCode, Cluster;