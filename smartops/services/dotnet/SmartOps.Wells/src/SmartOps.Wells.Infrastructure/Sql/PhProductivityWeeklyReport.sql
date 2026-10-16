-- PH Productivity Weekly Report
-- Computes productivity from 7 source tables: task_daily, ActivityCodesNorms,
-- Employee, ProjectIDs, OLD_NEW_CREW_MAPPING, CrewType, ActivityMasterCSV.
-- Parameters: @from (start date), @to (end date exclusive)
-- Formula: productivity_pct = (data_qty / data_hours) / Norms * 100

SET NOCOUNT ON;

;WITH base AS (
    SELECT
        CAST(td.ActionOn AS date) AS [Date],
        td.supervisor_email,
        td.task_assignee,
        td.task_code,
        td.crew_type,
        td.project_id,
        td.data_qty,
        td.data_hours,
        CASE
            WHEN td.task_assignee IS NULL THEN NULL
            WHEN CHARINDEX('.', td.task_assignee) > 0
                THEN LEFT(td.task_assignee, CHARINDEX('.', td.task_assignee) - 1)
            ELSE td.task_assignee
        END AS [PA Name],
        LEFT(LTRIM(RTRIM(td.task_code)), 8) AS Activity_ID,
        TRY_CONVERT(decimal(18,6), td.data_qty) /
            NULLIF(TRY_CONVERT(decimal(18,6), td.data_hours), 0) AS qty_per_hour
    FROM dbo.task_daily td WITH (NOLOCK)
    WHERE td.ActionOn >= CAST(@from AS date)
      AND td.ActionOn < CAST(@to AS date)
),

joined AS (
    SELECT
        b.[Date],
        DATEFROMPARTS(YEAR(b.[Date]), MONTH(b.[Date]), 1) AS MonthStart,
        b.[PA Name],
        e.UId  AS [PH Emp ID],
        e.Name AS [PH Name],
        CASE
            WHEN e.UId IS NOT NULL
                 AND LEN(CONVERT(varchar(50), e.UId)) = 6
                 AND LEFT(CONVERT(varchar(50), e.UId), 1) = '9'
                THEN 'ATNM'
            ELSE 'Sub contractor'
        END AS [ATNM/Sub Contractor],
        pid.column2 AS Category,
        ISNULL(map_oldnew.CREW_GROUP_CODE, b.crew_type) AS CrewType_Group,
        COALESCE(ct_from_map.[Description], ct_direct.[Description]) AS CrewName_Resolved,
        COALESCE(am_group.DISCIPLINE, am_old.DISCIPLINE) AS CrewDiscipline_Resolved,
        (
            b.qty_per_hour /
            NULLIF(TRY_CONVERT(decimal(18,6), n.Norms), 0)
        ) * 100 AS productivity_pct
    FROM base b
    LEFT JOIN dbo.ActivityCodesNorms n WITH (NOLOCK)
        ON LTRIM(RTRIM(b.Activity_ID)) = LTRIM(RTRIM(n.Activity_ID))
    LEFT JOIN dbo.Employee e WITH (NOLOCK)
        ON LTRIM(RTRIM(b.supervisor_email)) = LTRIM(RTRIM(e.Email))
    LEFT JOIN dbo.ProjectIDs pid WITH (NOLOCK)
        ON pid.ID = b.project_id
    LEFT JOIN dbo.OLD_NEW_CREW_MAPPING map_oldnew WITH (NOLOCK)
        ON map_oldnew.Old_Crew_Code = b.crew_type
    LEFT JOIN dbo.OLD_NEW_CREW_MAPPING map_group_to_old WITH (NOLOCK)
        ON map_group_to_old.CREW_GROUP_CODE = ISNULL(map_oldnew.CREW_GROUP_CODE, b.crew_type)
    LEFT JOIN dbo.CrewType ct_from_map WITH (NOLOCK)
        ON ct_from_map.Code = map_group_to_old.Old_Crew_Code
        OR ct_from_map.Code = REPLACE(map_group_to_old.Old_Crew_Code, '-', '')
    LEFT JOIN dbo.CrewType ct_direct WITH (NOLOCK)
        ON ct_direct.Code = b.crew_type
        OR ct_direct.Code = REPLACE(b.crew_type, '-', '')
    LEFT JOIN dbo.ActivityMasterCSV am_group WITH (NOLOCK)
        ON LTRIM(RTRIM(am_group.CREW_GROUP_CODE)) = LTRIM(RTRIM(ISNULL(map_oldnew.CREW_GROUP_CODE, b.crew_type)))
    LEFT JOIN dbo.ActivityMasterCSV am_old WITH (NOLOCK)
        ON LTRIM(RTRIM(am_old.CREW_GROUP_CODE)) = LTRIM(RTRIM(map_group_to_old.Old_Crew_Code))
),

wknum AS (
    SELECT
        j.*,
        CASE
            WHEN DAY(j.[Date]) BETWEEN 1  AND 7  THEN 1
            WHEN DAY(j.[Date]) BETWEEN 8  AND 14 THEN 2
            WHEN DAY(j.[Date]) BETWEEN 15 AND 21 THEN 3
            WHEN DAY(j.[Date]) BETWEEN 22 AND 28 THEN 4
            ELSE 5
        END AS WeekNo
    FROM joined j
),

ph_month_master AS (
    SELECT MonthStart, [PH Emp ID],
        MAX([PH Name]) AS [PH Name],
        MAX([ATNM/Sub Contractor]) AS [ATNM/Sub Contractor]
    FROM wknum
    GROUP BY MonthStart, [PH Emp ID]
),

weekly_avg AS (
    SELECT MonthStart, [PH Emp ID], WeekNo,
        AVG(productivity_pct) AS WeekAvgProd
    FROM wknum
    GROUP BY MonthStart, [PH Emp ID], WeekNo
),

weekly_pi AS (
    SELECT wa.MonthStart, wa.[PH Emp ID], wa.WeekNo, wa.WeekAvgProd,
        CASE
            WHEN wa.WeekAvgProd IS NULL THEN 'NA'
            WHEN wa.WeekAvgProd < 65 THEN 'P0'
            WHEN wa.WeekAvgProd < 70 THEN 'P1'
            WHEN wa.WeekAvgProd < 75 THEN 'P2'
            WHEN wa.WeekAvgProd < 80 THEN 'P3'
            WHEN wa.WeekAvgProd < 85 THEN 'P4'
            WHEN wa.WeekAvgProd < 90 THEN 'P5'
            WHEN wa.WeekAvgProd < 95 THEN 'P6'
            WHEN wa.WeekAvgProd < 100 THEN 'P7'
            ELSE 'P8'
        END AS PI_CMR,
        CASE
            WHEN wa.WeekAvgProd IS NULL THEN 'NA'
            WHEN wa.WeekAvgProd <= 75 THEN 'P0'
            WHEN wa.WeekAvgProd <= 80 THEN 'P1'
            WHEN wa.WeekAvgProd <= 85 THEN 'P2'
            WHEN wa.WeekAvgProd <= 90 THEN 'P3'
            WHEN wa.WeekAvgProd <= 95 THEN 'P4'
            WHEN wa.WeekAvgProd < 100 THEN 'P5'
            WHEN wa.WeekAvgProd = 100 THEN 'P6'
            WHEN wa.WeekAvgProd <= 105 THEN 'P7'
            ELSE 'P8'
        END AS PI_TWISE
    FROM weekly_avg wa
),

monthly_avg AS (
    SELECT MonthStart, [PH Emp ID], AVG(productivity_pct) AS MonthAvgProd
    FROM wknum
    GROUP BY MonthStart, [PH Emp ID]
),

category_agg AS (
    SELECT d.MonthStart, d.[PH Emp ID],
        STRING_AGG(d.Category, CHAR(10)) WITHIN GROUP (ORDER BY d.Category) AS CategoryList
    FROM (SELECT DISTINCT MonthStart, [PH Emp ID], ISNULL(Category, 'NA') AS Category FROM wknum) d
    GROUP BY d.MonthStart, d.[PH Emp ID]
),

crewtype_agg AS (
    SELECT d.MonthStart, d.[PH Emp ID],
        STRING_AGG(d.CrewType_Group, CHAR(10)) WITHIN GROUP (ORDER BY d.CrewType_Group) AS CrewTypes
    FROM (SELECT DISTINCT MonthStart, [PH Emp ID], ISNULL(CrewType_Group, 'NA') AS CrewType_Group FROM wknum) d
    GROUP BY d.MonthStart, d.[PH Emp ID]
),

crewdisc_agg AS (
    SELECT d.MonthStart, d.[PH Emp ID],
        STRING_AGG(d.CrewDiscipline_Resolved, CHAR(10)) WITHIN GROUP (ORDER BY d.CrewDiscipline_Resolved) AS CrewDisciplines
    FROM (SELECT DISTINCT MonthStart, [PH Emp ID], ISNULL(CrewDiscipline_Resolved, 'NA') AS CrewDiscipline_Resolved FROM wknum) d
    GROUP BY d.MonthStart, d.[PH Emp ID]
),

crewname_agg AS (
    SELECT d.MonthStart, d.[PH Emp ID],
        STRING_AGG(d.CrewName_Resolved, CHAR(10)) WITHIN GROUP (ORDER BY d.CrewName_Resolved) AS CrewNames
    FROM (SELECT DISTINCT MonthStart, [PH Emp ID], ISNULL(CrewName_Resolved, 'NA') AS CrewName_Resolved FROM wknum) d
    GROUP BY d.MonthStart, d.[PH Emp ID]
),

paname_agg AS (
    SELECT d.MonthStart, d.[PH Emp ID],
        STRING_AGG(d.[PA Name], CHAR(10)) WITHIN GROUP (ORDER BY d.[PA Name]) AS PANames
    FROM (SELECT DISTINCT MonthStart, [PH Emp ID], ISNULL([PA Name], 'NA') AS [PA Name] FROM wknum) d
    GROUP BY d.MonthStart, d.[PH Emp ID]
),

month_pi AS (
    SELECT m.MonthStart, m.[PH Emp ID], m.MonthAvgProd,
        CASE
            WHEN m.MonthAvgProd IS NULL THEN 'NA'
            WHEN m.MonthAvgProd < 65 THEN 'P0'
            WHEN m.MonthAvgProd < 70 THEN 'P1'
            WHEN m.MonthAvgProd < 75 THEN 'P2'
            WHEN m.MonthAvgProd < 80 THEN 'P3'
            WHEN m.MonthAvgProd < 85 THEN 'P4'
            WHEN m.MonthAvgProd < 90 THEN 'P5'
            WHEN m.MonthAvgProd < 95 THEN 'P6'
            WHEN m.MonthAvgProd < 100 THEN 'P7'
            ELSE 'P8'
        END AS Month_PI_CMR,
        CASE
            WHEN m.MonthAvgProd IS NULL THEN 'NA'
            WHEN m.MonthAvgProd <= 75 THEN 'P0'
            WHEN m.MonthAvgProd <= 80 THEN 'P1'
            WHEN m.MonthAvgProd <= 85 THEN 'P2'
            WHEN m.MonthAvgProd <= 90 THEN 'P3'
            WHEN m.MonthAvgProd <= 95 THEN 'P4'
            WHEN m.MonthAvgProd < 100 THEN 'P5'
            WHEN m.MonthAvgProd = 100 THEN 'P6'
            WHEN m.MonthAvgProd <= 105 THEN 'P7'
            ELSE 'P8'
        END AS Month_PI_TWISE
    FROM monthly_avg m
)

SELECT
    ROW_NUMBER() OVER (ORDER BY mp.MonthStart, mp.[PH Emp ID]) AS [S.No],
    DATENAME(month, mp.MonthStart) AS [Month],
    YEAR(mp.MonthStart) AS [Year],
    mp.MonthStart,
    ISNULL(pa.PANames, 'NA') AS [PA Name],
    ISNULL(CONVERT(nvarchar(50), mp.[PH Emp ID]), 'NA') AS [PH Emp ID],
    ISNULL(pm.[PH Name], 'NA') AS [PH Name],
    ISNULL(pm.[ATNM/Sub Contractor], 'NA') AS [ATNM/Sub Contractor],
    ISNULL(cat.CategoryList, 'NA') AS [Category],
    ISNULL(ct.CrewTypes, 'NA') AS [Crew Type],
    ISNULL(cd.CrewDisciplines, 'NA') AS [Crew Discipline],
    ISNULL(cn.CrewNames, 'NA') AS [Crew Name],
    CAST(mp.MonthAvgProd AS decimal(18,2)) AS [Average Productivity (%)],
    MAX(CASE WHEN w.WeekNo = 1 THEN w.PI_CMR   END) AS [W1_PI (CMR)],
    MAX(CASE WHEN w.WeekNo = 1 THEN w.PI_TWISE END) AS [W1_PI (T-Wise)],
    MAX(CASE WHEN w.WeekNo = 2 THEN w.PI_CMR   END) AS [W2_PI (CMR)],
    MAX(CASE WHEN w.WeekNo = 2 THEN w.PI_TWISE END) AS [W2_PI (T-Wise)],
    MAX(CASE WHEN w.WeekNo = 3 THEN w.PI_CMR   END) AS [W3_PI (CMR)],
    MAX(CASE WHEN w.WeekNo = 3 THEN w.PI_TWISE END) AS [W3_PI (T-Wise)],
    MAX(CASE WHEN w.WeekNo = 4 THEN w.PI_CMR   END) AS [W4_PI (CMR)],
    MAX(CASE WHEN w.WeekNo = 4 THEN w.PI_TWISE END) AS [W4_PI (T-Wise)],
    MAX(CASE WHEN w.WeekNo = 5 THEN w.PI_CMR   END) AS [W5_PI (CMR)],
    MAX(CASE WHEN w.WeekNo = 5 THEN w.PI_TWISE END) AS [W5_PI (T-Wise)],
    mp.Month_PI_CMR   AS [Month PI (CMR)],
    mp.Month_PI_TWISE AS [Month PI (T-Wise)]
FROM month_pi mp
LEFT JOIN ph_month_master pm
    ON pm.MonthStart = mp.MonthStart
   AND ISNULL(pm.[PH Emp ID], -1) = ISNULL(mp.[PH Emp ID], -1)
LEFT JOIN weekly_pi w
    ON w.MonthStart = mp.MonthStart
   AND ISNULL(w.[PH Emp ID], -1) = ISNULL(mp.[PH Emp ID], -1)
LEFT JOIN category_agg cat
    ON cat.MonthStart = mp.MonthStart
   AND ISNULL(cat.[PH Emp ID], -1) = ISNULL(mp.[PH Emp ID], -1)
LEFT JOIN crewtype_agg ct
    ON ct.MonthStart = mp.MonthStart
   AND ISNULL(ct.[PH Emp ID], -1) = ISNULL(mp.[PH Emp ID], -1)
LEFT JOIN crewdisc_agg cd
    ON cd.MonthStart = mp.MonthStart
   AND ISNULL(cd.[PH Emp ID], -1) = ISNULL(mp.[PH Emp ID], -1)
LEFT JOIN crewname_agg cn
    ON cn.MonthStart = mp.MonthStart
   AND ISNULL(cn.[PH Emp ID], -1) = ISNULL(mp.[PH Emp ID], -1)
LEFT JOIN paname_agg pa
    ON pa.MonthStart = mp.MonthStart
   AND ISNULL(pa.[PH Emp ID], -1) = ISNULL(mp.[PH Emp ID], -1)
GROUP BY
    mp.MonthStart, mp.[PH Emp ID], pm.[PH Name], pm.[ATNM/Sub Contractor],
    mp.MonthAvgProd, mp.Month_PI_CMR, mp.Month_PI_TWISE,
    cat.CategoryList, ct.CrewTypes, cd.CrewDisciplines, cn.CrewNames, pa.PANames
{0}
ORDER BY mp.MonthStart DESC, mp.[PH Emp ID];
