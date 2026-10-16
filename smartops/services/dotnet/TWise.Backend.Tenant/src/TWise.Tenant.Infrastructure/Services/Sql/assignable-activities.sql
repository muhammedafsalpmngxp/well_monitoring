SET NOCOUNT ON;

IF @crewGroup IS NOT NULL
BEGIN
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
    Activities AS (
        SELECT LTRIM(RTRIM(atp.code)) AS ActivityCode,
               NULLIF(LTRIM(RTRIM(CAST(atp.[text] AS nvarchar(500)))), '') AS ActivityName,
               COALESCE(NULLIF(LTRIM(RTRIM(atp.crew_type)), ''), ag.CrewGroup, mg.CrewGroup) AS CrewGroup
        FROM dbo.ActivityTaskPlan atp
        LEFT JOIN ActivityGroups ag
            ON ag.ActivityId = LEFT(LTRIM(RTRIM(atp.code)), CHARINDEX('-', LTRIM(RTRIM(atp.code)) + '-') - 1)
        LEFT JOIN MasterGroups mg ON mg.ActivityCode = LTRIM(RTRIM(atp.code))
        WHERE NULLIF(LTRIM(RTRIM(atp.code)), '') IS NOT NULL
    )
        SELECT
        ActivityCode,
        COALESCE(MIN(ActivityName), ActivityCode) AS ActivityName,
        CrewGroup AS CrewGroupCode,
        CrewGroup AS CrewTypeCode,
                CAST(NULL AS nvarchar(100)) AS Discipline,
                CAST(NULL AS nvarchar(100)) AS Uom,
                CAST(NULL AS decimal(18, 4)) AS Norm
    FROM Activities
    WHERE CrewGroup = @crewGroup
    GROUP BY CrewGroup, ActivityCode
        ORDER BY ActivityCode;
        RETURN;
END;

SELECT DISTINCT
    LTRIM(RTRIM(a.ACTIVITY_CODE))        AS ActivityCode,
    LTRIM(RTRIM(a.ACTIVITY_DESCRIPTION)) AS ActivityName,
    gm.CREW_GROUP_CODE                   AS CrewGroupCode,
    LTRIM(RTRIM(a.CREW_GROUP_CODE))      AS CrewTypeCode,
    LTRIM(RTRIM(a.DISCIPLINE))           AS Discipline,
    m.UOM                                AS Uom,
    m.Norms                              AS Norm
FROM dbo.ActivityMasterCSV a
LEFT JOIN dbo.OLD_NEW_CREW_MAPPING gm
    ON LTRIM(RTRIM(a.CREW_GROUP_CODE)) = LTRIM(RTRIM(gm.Old_Crew_Code))
OUTER APPLY (
    SELECT TOP 1 mm.UOM, mm.Norms
    FROM dbo.ActivityMasterMapping mm
    WHERE LTRIM(RTRIM(mm.Activity_Code)) = LTRIM(RTRIM(a.ACTIVITY_CODE))
) m
WHERE a.ACTIVITY_CODE IS NOT NULL AND LTRIM(RTRIM(a.ACTIVITY_CODE)) <> ''
    /* __FILTER__ */
ORDER BY CrewGroupCode, ActivityCode;
