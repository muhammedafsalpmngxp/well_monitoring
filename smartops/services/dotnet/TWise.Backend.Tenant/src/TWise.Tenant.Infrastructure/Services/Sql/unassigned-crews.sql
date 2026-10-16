-- Unassigned crews WITHIN a date window: master crews (dbo.crews) that have NO
-- activity in ActivityTaskPlan overlapping [@fromDate, @toDate], grouped by crew group.
-- All groups that have idle crews are shown (no active-window restriction).
-- Group is derived from CrewType (via the crews.CrewType FK) with a dash-Code parse fallback.
-- Params: @fromDate, @toDate. Optional filter: @crewGroup (via __GROUP_FILTER__).

SET NOCOUNT ON;

-- Crews assigned within the window (crew_uid present in ActivityTaskPlan for the range).
IF OBJECT_ID('tempdb..#uid') IS NOT NULL DROP TABLE #uid;
SELECT DISTINCT LTRIM(RTRIM(crew_uid)) AS crew_uid
INTO #uid
FROM dbo.ActivityTaskPlan WITH (NOLOCK)
WHERE crew_uid IS NOT NULL AND LTRIM(RTRIM(crew_uid)) != ''
  AND target_start IS NOT NULL AND target_end IS NOT NULL
  AND target_start <= @toDate AND target_end >= @fromDate
    AND target_start >= '20200101';

CREATE UNIQUE CLUSTERED INDEX IX_uid ON #uid (crew_uid);

;WITH FreeCrews AS (
    SELECT
        LTRIM(RTRIM(c.Code)) AS CrewUid,
        NULLIF(LTRIM(RTRIM(c.Composition)), '') AS CompTrim,
        LTRIM(RTRIM(c.CrewType)) AS CrewTypeId,
        LTRIM(RTRIM(c.Code)) AS CodeTrim
    FROM dbo.crews c WITH (NOLOCK)
    WHERE c.Code IS NOT NULL AND LTRIM(RTRIM(c.Code)) != ''
            AND NOT EXISTS (
                    SELECT 1
                    FROM #uid busy
                    WHERE busy.crew_uid = LTRIM(RTRIM(c.Code))
            )
),
Parsed AS (
    SELECT
        f.CrewUid,
        f.CompTrim,
        f.CrewTypeId,
        -- dash format: '3522-FBH-0502-910296' -> 'FBH-0502' (already the crew-type/group code)
        CASE WHEN f.CodeTrim LIKE '%-%-%-%' THEN
            LEFT(
                STUFF(f.CodeTrim, 1, CHARINDEX('-', f.CodeTrim), ''),
                LEN(STUFF(f.CodeTrim, 1, CHARINDEX('-', f.CodeTrim), ''))
                    - CHARINDEX('-', REVERSE(STUFF(f.CodeTrim, 1, CHARINDEX('-', f.CodeTrim), '')))
            )
        END AS DashGroup
    FROM FreeCrews f
),
Derived AS (
    SELECT
        p.CrewUid,
        COALESCE(p.CompTrim, ctf.Code) AS TypeToken,
        -- Group from the CrewType master via the crews.CrewType FK; dash-parsed Code as fallback.
        COALESCE(ctf.Code, p.DashGroup, 'UNKNOWN') AS GroupCode
    FROM Parsed p
    LEFT JOIN dbo.CrewType ctf ON LTRIM(RTRIM(ctf.ID)) = p.CrewTypeId
)
SELECT
    d.GroupCode      AS CrewGroup,
    ct.Description    AS CrewGroupName,
    d.CrewUid         AS CrewUid,
    d.TypeToken       AS CrewTypeCode
FROM Derived d
LEFT JOIN dbo.CrewType ct ON LTRIM(RTRIM(ct.Code)) = d.GroupCode
WHERE d.GroupCode <> 'UNKNOWN'
    /* __GROUP_FILTER__ */
ORDER BY d.GroupCode ASC, d.CrewUid ASC;

DROP TABLE #uid;
