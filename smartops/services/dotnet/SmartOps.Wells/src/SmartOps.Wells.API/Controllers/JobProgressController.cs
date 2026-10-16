using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Caching.Memory;

namespace SmartOps.Wells.API.Controllers;

/// <summary>
/// Job Progress Report API
///
/// Reads directly from the SQL view [dbo].[Job_Progress_Report_GB] which computes:
///   - Weekly plan &amp; actual %  (W1–W5, current month, cum prior, cum current)
///   - Revenue in OMR          (purpose value × each % bucket)
///   - Target finish date
///
/// Additionally joins [dbo].[ProjectIDs] on pid.column2 = Category to add:
///   - Cluster   (Nimr / Marmul)
///   - WellType  (Conventional Well / Non-Standard Well / SNLP / …)
///
/// Status per row is computed here (not in SQL):
///   CmActualPct &lt; CmPlanPct − 2  → "Behind"
///   CmActualPct &gt; CmPlanPct + 2  → "Ahead"
///   CmPlanPct IS NULL             → "New well"
///   otherwise                     → "On track"
///
/// GET /reports/job-progress?cluster=Nimr&amp;category=All
/// </summary>
[ApiController]
[Route("reports")]
public sealed class JobProgressController(IConfiguration configuration, IMemoryCache cache) : ControllerBase
{
    private static readonly TimeSpan CacheTtl = TimeSpan.FromMinutes(60);

    private string Cs => configuration.GetConnectionString("Default")
        ?? throw new InvalidOperationException("ConnectionStrings:Default not configured.");

    // ── SQL ───────────────────────────────────────────────────────────────────
    // Fully inlined: no dependency on views.
    // Replaces both [dbo].[Job_Progress_Report_GB] and
    // [dbo].[vw_ActivityTaskPlan_JobProgress_Source].
    // All source objects are base tables:
    //   ActivityTaskPlan_JobProgress_Latest, MappingMaster, WMR,
    //   SAP_DRILLING_SEQUENCE_Latest, Job_Progress_PlanSnapshot,
    //   task_daily, data_table_sched_jsons, ProjectIDs, WBS_Master_Tracker_
    private const string QuerySql = @"
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

WITH
-- ── Inlined: dbo.vw_ActivityTaskPlan_JobProgress_Source ──────────────────────
ATP_Latest AS (
    SELECT * FROM dbo.ActivityTaskPlan_JobProgress_Latest
),
ATP_Parsed AS (
    SELECT
        t.*,
        CAST(t.[text] AS varchar(max)) AS text_value,
        CASE
            WHEN t.code LIKE 'PW1.%' THEN
                CASE
                    WHEN CHARINDEX('.', t.code, 5) > 0
                        THEN SUBSTRING(t.code, 5, CHARINDEX('.', t.code, 5) - 5)
                    ELSE SUBSTRING(t.code, 5, 8000)
                END
            ELSE NULL
        END AS pw_well_key,
        CASE
            WHEN CHARINDEX('-', t.code) > 0
                THEN LEFT(t.code, CHARINDEX('-', t.code) - 1)
            ELSE t.code
        END AS code_before_dash,
        CHARINDEX('-', REVERSE(t.code)) AS rev_dash_1,
        CHARINDEX('-', REVERSE(t.code),
            NULLIF(CHARINDEX('-', REVERSE(t.code)), 0) + 1) AS rev_dash_2
    FROM ATP_Latest t
),
ATP_Dash AS (
    SELECT
        b.*,
        CASE
            WHEN b.rev_dash_2 > 0 THEN
                SUBSTRING(b.code,
                    LEN(b.code) - b.rev_dash_2 + 2,
                    (b.rev_dash_2 - b.rev_dash_1) - 1)
            WHEN b.rev_dash_1 > 0 THEN RIGHT(b.code, b.rev_dash_1 - 1)
            ELSE NULL
        END AS dash_well_token
    FROM ATP_Parsed b
),
ATP_DashWell AS (
    SELECT
        d.*,
        CASE
            WHEN d.dash_well_token IS NOT NULL
             AND d.dash_well_token <> ''
             AND d.dash_well_token NOT LIKE '%[^0-9]%'
                THEN TRY_CONVERT(int, d.dash_well_token)
            ELSE NULL
        END AS well_from_dash
    FROM ATP_Dash d
),
ATP_PWWell AS (
    SELECT
        x.*,
        CASE
            WHEN x.[type] = 'W' AND x.pw_well_key IS NOT NULL THEN
                TRY_CONVERT(int,
                    CASE
                        WHEN LEFT(pwBase.text_value, 1) = 'W'
                            THEN SUBSTRING(pwBase.text_value, 2, 100)
                        ELSE pwBase.text_value
                    END
                )
            ELSE NULL
        END AS well_from_pw_text
    FROM ATP_DashWell x
    OUTER APPLY (
        SELECT TOP (1) CAST(r.[text] AS varchar(max)) AS text_value
        FROM ATP_Latest r
        WHERE r.[type] = 'W'
          AND r.code = CONCAT('PW1.', x.pw_well_key)
          AND (r.schedule_id = x.schedule_id
               OR (r.schedule_id IS NULL AND x.schedule_id IS NULL))
          AND (r.project_id  = x.project_id
               OR (r.project_id  IS NULL AND x.project_id  IS NULL))
        ORDER BY
            CASE WHEN CAST(r.[text] AS varchar(max)) LIKE 'W%' THEN 0 ELSE 1 END,
            TRY_CONVERT(datetimeoffset, r.Time_Stamp) DESC,
            r.row_id DESC
    ) pwBase
),
ATP_Source AS (
    SELECT
        w.row_id, w.source_id, w.[Data], w.ancestor, w.duration,
        w.progress, w.crew_uid, w.crew_type, w.qty, w.manhours, w.weightage,
        w.parent, w.start_date, w.end_date, w.target_start, w.target_end,
        actual_start =
            CASE WHEN TRY_CONVERT(date, w.actual_start) <= '1900-01-01'
                 THEN NULL ELSE w.actual_start END,
        actual_end =
            CASE WHEN TRY_CONVERT(date, w.actual_end) <= '1900-01-01'
                 THEN NULL ELSE w.actual_end END,
        w.qtyactual, w.qtyforacst, w.manhoursactual, w.manhourforacst,
        Activity_Code = COALESCE(mm_text.New_Activity_Code, mm_code.New_Activity_Code),
        w.code, w.[text], w.[type], w.schedule_id, w.project_id,
        w.task_assignee, w.supervisor_email, w.attributes, w.remaining_duration,
        w.Resume_Suspend, w.data_nonprod, w.created_at, w.updated_at,
        w.Well_ID, w.Parent_WBS, w.Time_Stamp,
        New_Well_ID = COALESCE(w.well_from_pw_text, w.well_from_dash,
                               TRY_CONVERT(int, w.Well_ID))
    FROM ATP_PWWell w
    LEFT JOIN dbo.MappingMaster mm_text
        ON LTRIM(RTRIM(w.text_value))
         = LTRIM(RTRIM(CAST(mm_text.Activity_ID AS varchar(max))))
    LEFT JOIN dbo.MappingMaster mm_code
        ON LTRIM(RTRIM(w.code_before_dash))
         = LTRIM(RTRIM(CAST(mm_code.Activity_ID AS varchar(max))))
),
-- ── Inlined: dbo.Job_Progress_Report_GB ──────────────────────────────────────
WMR_1 AS (
    SELECT
        WellID               = TRY_CONVERT(nvarchar(50), pdo_well_id),
        well_name_after_spud = MAX(well_name_after_spud),
        location_po_no       = MAX(location_po_no),
        flow_line_po_no      = MAX(flow_line_po_no)
    FROM dbo.WMR
    GROUP BY TRY_CONVERT(nvarchar(50), pdo_well_id)
),
SAP_WellName_Latest AS (
    SELECT
        WellID    = LTRIM(RTRIM(TRY_CONVERT(nvarchar(50), s.Well_Id))),
        Well_Name = s.Well_Name,
        rn        = ROW_NUMBER() OVER (
            PARTITION BY LTRIM(RTRIM(TRY_CONVERT(nvarchar(50), s.Well_Id)))
            ORDER BY TRY_CONVERT(date, s.week_number) DESC
        )
    FROM dbo.SAP_DRILLING_SEQUENCE_Latest s
    WHERE s.Well_Id IS NOT NULL
),
Base AS (
    SELECT
        tp.project_id,
        tp.code,
        Well_ID      = LTRIM(RTRIM(TRY_CONVERT(nvarchar(50), tp.New_Well_ID))),
        target_start = TRY_CONVERT(date, tp.target_start),
        target_end   = TRY_CONVERT(date, tp.target_end),
        actual_start = TRY_CONVERT(date, tp.actual_start),
        actual_end   = TRY_CONVERT(date, tp.actual_end),
        qty_num      = TRY_CONVERT(float, tp.qty),
        weight_frac  =
            CASE
                WHEN tp.weightage IS NULL THEN 0.0
                WHEN TRY_CONVERT(float, REPLACE(TRY_CONVERT(nvarchar(50), tp.weightage), '%', '')) IS NULL THEN 0.0
                ELSE
                    CASE
                        WHEN TRY_CONVERT(nvarchar(50), tp.weightage) LIKE '%[%]%'
                            THEN TRY_CONVERT(float, REPLACE(TRY_CONVERT(nvarchar(50), tp.weightage), '%', '')) / 100.0
                        WHEN TRY_CONVERT(float, tp.weightage) > 1.0
                            THEN TRY_CONVERT(float, tp.weightage) / 100.0
                        ELSE TRY_CONVERT(float, tp.weightage)
                    END
            END,
        progress_frac =
            CASE
                WHEN tp.progress IS NULL THEN 0.0
                WHEN TRY_CONVERT(float, REPLACE(TRY_CONVERT(nvarchar(50), tp.progress), '%', '')) IS NULL THEN 0.0
                ELSE
                    CASE
                        WHEN TRY_CONVERT(nvarchar(50), tp.progress) LIKE '%[%]%'
                            THEN TRY_CONVERT(float, REPLACE(TRY_CONVERT(nvarchar(50), tp.progress), '%', '')) / 100.0
                        WHEN TRY_CONVERT(float, tp.progress) > 1.0
                            THEN TRY_CONVERT(float, tp.progress) / 100.0
                        ELSE TRY_CONVERT(float, tp.progress)
                    END
            END
    FROM ATP_Source tp
    WHERE tp.[type] = 'A'
      AND tp.New_Well_ID IS NOT NULL
      AND LTRIM(RTRIM(TRY_CONVERT(nvarchar(50), tp.New_Well_ID))) <> ''
      AND UPPER(LTRIM(RTRIM(COALESCE(TRY_CONVERT(nvarchar(100), tp.Resume_Suspend), '')))) <> 'SUSPEND'
),
Params AS (
    SELECT
        MonthStart = DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1),
        MonthEnd   = EOMONTH(GETDATE()),
        W1End      = DATEADD(day,  6, DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)),
        W2End      = DATEADD(day, 13, DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)),
        W3End      = DATEADD(day, 20, DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)),
        W4End      = DATEADD(day, 27, DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1))
),
Nums AS (
    SELECT TOP (5000)
        ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) - 1 AS n
    FROM sys.all_objects a
    CROSS JOIN sys.all_objects b
),
PlanSnap AS (
    SELECT
        Well_ID              = LTRIM(RTRIM(TRY_CONVERT(nvarchar(50), ps.Well_ID))),
        project_id           = ps.project_id,
        Cum_Prior_Plan_frac  = ISNULL(TRY_CONVERT(float, ps.Cum_Prior_Plan_frac), 0.0),
        W1_Plan_frac         = ISNULL(TRY_CONVERT(float, ps.W1_Plan_frac), 0.0),
        W2_Plan_frac         = ISNULL(TRY_CONVERT(float, ps.W2_Plan_frac), 0.0),
        W3_Plan_frac         = ISNULL(TRY_CONVERT(float, ps.W3_Plan_frac), 0.0),
        W4_Plan_frac         = ISNULL(TRY_CONVERT(float, ps.W4_Plan_frac), 0.0),
        W5_Plan_frac         = ISNULL(TRY_CONVERT(float, ps.W5_Plan_frac), 0.0),
        CurrentMonthPlanFrac = ISNULL(TRY_CONVERT(float, ps.CurrentMonthPlanFrac), 0.0),
        Latest_Target_End    = TRY_CONVERT(date, ps.Latest_Target_End)
    FROM dbo.Job_Progress_PlanSnapshot ps
    WHERE ps.SnapshotMonth = DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)
),
TargetEndAgg AS (
    SELECT
        b.Well_ID, b.project_id,
        Latest_Target_End = MAX(
            CASE
                WHEN b.actual_end IS NOT NULL AND b.actual_end < p.MonthStart THEN NULL
                ELSE b.target_end
            END
        )
    FROM Base b
    CROSS JOIN Params p
    GROUP BY b.Well_ID, b.project_id
),
ActualDateBase AS (
    SELECT * FROM Base
    WHERE actual_start IS NOT NULL
      AND actual_end   IS NOT NULL
      AND actual_end  >= actual_start
),
ActualDateDaily AS (
    SELECT
        b.Well_ID, b.project_id, b.code,
        ActualDate        = DATEADD(day, n.n, b.actual_start),
        daily_actual_frac =
            (ISNULL(b.progress_frac, 0.0) * ISNULL(b.weight_frac, 0.0))
            / NULLIF(DATEDIFF(day, b.actual_start, b.actual_end) + 1, 0)
    FROM ActualDateBase b
    INNER JOIN Nums n ON n.n <= DATEDIFF(day, b.actual_start, b.actual_end)
),
ActualDateAgg AS (
    SELECT
        d.Well_ID, d.project_id,
        Cum_Prior_Act_frac = SUM(CASE WHEN d.ActualDate <  prm.MonthStart                              THEN d.daily_actual_frac ELSE 0 END),
        W1_Act_frac        = SUM(CASE WHEN d.ActualDate >= prm.MonthStart AND d.ActualDate <= prm.W1End THEN d.daily_actual_frac ELSE 0 END),
        W2_Act_frac        = SUM(CASE WHEN d.ActualDate >  prm.W1End     AND d.ActualDate <= prm.W2End THEN d.daily_actual_frac ELSE 0 END),
        W3_Act_frac        = SUM(CASE WHEN d.ActualDate >  prm.W2End     AND d.ActualDate <= prm.W3End THEN d.daily_actual_frac ELSE 0 END),
        W4_Act_frac        = SUM(CASE WHEN d.ActualDate >  prm.W3End     AND d.ActualDate <= prm.W4End THEN d.daily_actual_frac ELSE 0 END),
        W5_Act_frac        = SUM(CASE WHEN d.ActualDate >  prm.W4End     AND d.ActualDate <= prm.MonthEnd THEN d.daily_actual_frac ELSE 0 END)
    FROM ActualDateDaily d
    CROSS JOIN Params prm
    GROUP BY d.Well_ID, d.project_id
),
FallbackBase AS (
    SELECT * FROM Base
    WHERE NOT (
        actual_start IS NOT NULL
        AND actual_end IS NOT NULL
        AND actual_end >= actual_start
    )
),
TaskDailyRanked AS (
    SELECT
        td.id,
        td.task_code,
        ActionDate    = TRY_CONVERT(date, td.ActionOn),
        data_qty_num  = TRY_CONVERT(float, td.data_qty),
        project_id_td = LTRIM(RTRIM(TRY_CONVERT(nvarchar(100), td.project_id))),
        rn = ROW_NUMBER() OVER (
            PARTITION BY
                LTRIM(RTRIM(TRY_CONVERT(nvarchar(200), td.task_code))),
                TRY_CONVERT(date, td.ActionOn)
            ORDER BY
                TRY_CONVERT(datetimeoffset, td.time_stamp) DESC,
                td.id DESC
        )
    FROM dbo.task_daily td
    WHERE td.task_code IS NOT NULL
      AND TRY_CONVERT(date, td.ActionOn) IS NOT NULL
      AND TRY_CONVERT(float, td.data_qty) IS NOT NULL
),
TaskDailyBase AS (
    SELECT id, task_code, ActionDate, data_qty_num, project_id_td
    FROM TaskDailyRanked WHERE rn = 1
),
TaskDailyBucketed AS (
    SELECT
        b.Well_ID, b.project_id, b.code, b.qty_num, b.weight_frac,
        td.ActionDate, td.data_qty_num,
        act_bucket =
            CASE
                WHEN td.ActionDate <  p.MonthStart                              THEN 'PRIOR'
                WHEN td.ActionDate >= p.MonthStart AND td.ActionDate <= p.W1End THEN 'W1'
                WHEN td.ActionDate >  p.W1End      AND td.ActionDate <= p.W2End THEN 'W2'
                WHEN td.ActionDate >  p.W2End      AND td.ActionDate <= p.W3End THEN 'W3'
                WHEN td.ActionDate >  p.W3End      AND td.ActionDate <= p.W4End THEN 'W4'
                WHEN td.ActionDate >  p.W4End      AND td.ActionDate <= p.MonthEnd THEN 'W5'
                ELSE 'FUTURE'
            END
    FROM FallbackBase b
    INNER JOIN TaskDailyBase td
        ON LTRIM(RTRIM(td.task_code)) = LTRIM(RTRIM(b.code))
       AND (
            td.project_id_td IS NULL OR td.project_id_td = ''
            OR LOWER(td.project_id_td) = LOWER(LTRIM(RTRIM(TRY_CONVERT(nvarchar(100), b.project_id))))
           )
    CROSS JOIN Params p
),
ActualPerActivityWeek AS (
    SELECT
        Well_ID, project_id, code, qty_num, weight_frac,
        act_bucket,
        week_qty = SUM(data_qty_num)
    FROM TaskDailyBucketed
    WHERE act_bucket <> 'FUTURE'
    GROUP BY Well_ID, project_id, code, qty_num, weight_frac, act_bucket
),
ActualFallbackAgg AS (
    SELECT
        Well_ID, project_id,
        Cum_Prior_Act_frac = SUM(CASE WHEN act_bucket = 'PRIOR' THEN CASE WHEN ISNULL(qty_num,0)<=0 THEN 0.0 WHEN (week_qty/NULLIF(qty_num,0))>=1 THEN weight_frac ELSE (week_qty/NULLIF(qty_num,0))*weight_frac END ELSE 0 END),
        W1_Act_frac        = SUM(CASE WHEN act_bucket = 'W1'    THEN CASE WHEN ISNULL(qty_num,0)<=0 THEN 0.0 WHEN (week_qty/NULLIF(qty_num,0))>=1 THEN weight_frac ELSE (week_qty/NULLIF(qty_num,0))*weight_frac END ELSE 0 END),
        W2_Act_frac        = SUM(CASE WHEN act_bucket = 'W2'    THEN CASE WHEN ISNULL(qty_num,0)<=0 THEN 0.0 WHEN (week_qty/NULLIF(qty_num,0))>=1 THEN weight_frac ELSE (week_qty/NULLIF(qty_num,0))*weight_frac END ELSE 0 END),
        W3_Act_frac        = SUM(CASE WHEN act_bucket = 'W3'    THEN CASE WHEN ISNULL(qty_num,0)<=0 THEN 0.0 WHEN (week_qty/NULLIF(qty_num,0))>=1 THEN weight_frac ELSE (week_qty/NULLIF(qty_num,0))*weight_frac END ELSE 0 END),
        W4_Act_frac        = SUM(CASE WHEN act_bucket = 'W4'    THEN CASE WHEN ISNULL(qty_num,0)<=0 THEN 0.0 WHEN (week_qty/NULLIF(qty_num,0))>=1 THEN weight_frac ELSE (week_qty/NULLIF(qty_num,0))*weight_frac END ELSE 0 END),
        W5_Act_frac        = SUM(CASE WHEN act_bucket = 'W5'    THEN CASE WHEN ISNULL(qty_num,0)<=0 THEN 0.0 WHEN (week_qty/NULLIF(qty_num,0))>=1 THEN weight_frac ELSE (week_qty/NULLIF(qty_num,0))*weight_frac END ELSE 0 END)
    FROM ActualPerActivityWeek
    GROUP BY Well_ID, project_id
),
ActualKeys AS (
    SELECT Well_ID, project_id FROM ActualDateAgg
    UNION
    SELECT Well_ID, project_id FROM ActualFallbackAgg
),
ActualAgg AS (
    SELECT
        k.Well_ID, k.project_id,
        Cum_Prior_Act_frac = ISNULL(d.Cum_Prior_Act_frac,0.0) + ISNULL(f.Cum_Prior_Act_frac,0.0),
        W1_Act_frac        = ISNULL(d.W1_Act_frac,0.0) + ISNULL(f.W1_Act_frac,0.0),
        W2_Act_frac        = ISNULL(d.W2_Act_frac,0.0) + ISNULL(f.W2_Act_frac,0.0),
        W3_Act_frac        = ISNULL(d.W3_Act_frac,0.0) + ISNULL(f.W3_Act_frac,0.0),
        W4_Act_frac        = ISNULL(d.W4_Act_frac,0.0) + ISNULL(f.W4_Act_frac,0.0),
        W5_Act_frac        = ISNULL(d.W5_Act_frac,0.0) + ISNULL(f.W5_Act_frac,0.0)
    FROM ActualKeys k
    LEFT JOIN ActualDateAgg     d ON d.Well_ID = k.Well_ID AND d.project_id = k.project_id
    LEFT JOIN ActualFallbackAgg f ON f.Well_ID = k.Well_ID AND f.project_id = k.project_id
),
Keys AS (
    SELECT Well_ID, project_id FROM PlanSnap
    UNION
    SELECT Well_ID, project_id FROM ActualAgg
),
AggRaw AS (
    SELECT
        k.Well_ID, k.project_id,
        HasPlan              = CASE WHEN p.Well_ID IS NULL THEN 0 ELSE 1 END,
        Cum_Prior_Plan_frac  = CASE WHEN p.Well_ID IS NULL THEN NULL ELSE p.Cum_Prior_Plan_frac  END,
        W1_Plan_frac         = CASE WHEN p.Well_ID IS NULL THEN NULL ELSE p.W1_Plan_frac         END,
        W2_Plan_frac         = CASE WHEN p.Well_ID IS NULL THEN NULL ELSE p.W2_Plan_frac         END,
        W3_Plan_frac         = CASE WHEN p.Well_ID IS NULL THEN NULL ELSE p.W3_Plan_frac         END,
        W4_Plan_frac         = CASE WHEN p.Well_ID IS NULL THEN NULL ELSE p.W4_Plan_frac         END,
        W5_Plan_frac         = CASE WHEN p.Well_ID IS NULL THEN NULL ELSE p.W5_Plan_frac         END,
        CurrentMonthPlanFrac = CASE WHEN p.Well_ID IS NULL THEN NULL ELSE p.CurrentMonthPlanFrac END,
        Cum_Prior_Act_frac   = ISNULL(a.Cum_Prior_Act_frac, 0.0),
        W1_Act_frac          = ISNULL(a.W1_Act_frac,  0.0),
        W2_Act_frac          = ISNULL(a.W2_Act_frac,  0.0),
        W3_Act_frac          = ISNULL(a.W3_Act_frac,  0.0),
        W4_Act_frac          = ISNULL(a.W4_Act_frac,  0.0),
        W5_Act_frac          = ISNULL(a.W5_Act_frac,  0.0),
        Snapshot_Target_End  = p.Latest_Target_End
    FROM Keys k
    LEFT JOIN PlanSnap  p ON p.Well_ID = k.Well_ID AND p.project_id = k.project_id
    LEFT JOIN ActualAgg a ON a.Well_ID = k.Well_ID AND a.project_id = k.project_id
),
Agg AS (
    SELECT
        Well_ID, project_id, HasPlan,
        Cum_Prior_Plan_frac  = CASE WHEN Cum_Prior_Plan_frac  IS NULL THEN NULL WHEN Cum_Prior_Plan_frac  > 1 THEN 1.0 WHEN Cum_Prior_Plan_frac  < 0 THEN 0.0 ELSE Cum_Prior_Plan_frac  END,
        W1_Plan_frac         = CASE WHEN W1_Plan_frac         IS NULL THEN NULL WHEN W1_Plan_frac         > 1 THEN 1.0 WHEN W1_Plan_frac         < 0 THEN 0.0 ELSE W1_Plan_frac         END,
        W2_Plan_frac         = CASE WHEN W2_Plan_frac         IS NULL THEN NULL WHEN W2_Plan_frac         > 1 THEN 1.0 WHEN W2_Plan_frac         < 0 THEN 0.0 ELSE W2_Plan_frac         END,
        W3_Plan_frac         = CASE WHEN W3_Plan_frac         IS NULL THEN NULL WHEN W3_Plan_frac         > 1 THEN 1.0 WHEN W3_Plan_frac         < 0 THEN 0.0 ELSE W3_Plan_frac         END,
        W4_Plan_frac         = CASE WHEN W4_Plan_frac         IS NULL THEN NULL WHEN W4_Plan_frac         > 1 THEN 1.0 WHEN W4_Plan_frac         < 0 THEN 0.0 ELSE W4_Plan_frac         END,
        W5_Plan_frac         = CASE WHEN W5_Plan_frac         IS NULL THEN NULL WHEN W5_Plan_frac         > 1 THEN 1.0 WHEN W5_Plan_frac         < 0 THEN 0.0 ELSE W5_Plan_frac         END,
        CurrentMonthPlanFrac = CASE WHEN CurrentMonthPlanFrac IS NULL THEN NULL WHEN CurrentMonthPlanFrac > 1 THEN 1.0 WHEN CurrentMonthPlanFrac < 0 THEN 0.0 ELSE CurrentMonthPlanFrac END,
        Cum_Prior_Act_frac   = CASE WHEN Cum_Prior_Act_frac  > 1 THEN 1.0 WHEN Cum_Prior_Act_frac  < 0 THEN 0.0 ELSE Cum_Prior_Act_frac  END,
        W1_Act_frac          = CASE WHEN W1_Act_frac         > 1 THEN 1.0 WHEN W1_Act_frac         < 0 THEN 0.0 ELSE W1_Act_frac         END,
        W2_Act_frac          = CASE WHEN W2_Act_frac         > 1 THEN 1.0 WHEN W2_Act_frac         < 0 THEN 0.0 ELSE W2_Act_frac         END,
        W3_Act_frac          = CASE WHEN W3_Act_frac         > 1 THEN 1.0 WHEN W3_Act_frac         < 0 THEN 0.0 ELSE W3_Act_frac         END,
        W4_Act_frac          = CASE WHEN W4_Act_frac         > 1 THEN 1.0 WHEN W4_Act_frac         < 0 THEN 0.0 ELSE W4_Act_frac         END,
        W5_Act_frac          = CASE WHEN W5_Act_frac         > 1 THEN 1.0 WHEN W5_Act_frac         < 0 THEN 0.0 ELSE W5_Act_frac         END,
        Snapshot_Target_End
    FROM AggRaw
),
SchedParsed AS (
    SELECT
        s.*,
        Well_ID_norm = LTRIM(RTRIM(CONVERT(nvarchar(50), s.Well_ID))),
        Cluster =
            CASE
                WHEN s.Source = 'NC-WD' THEN 'nimr'
                WHEN s.Source = 'MC-WD' THEN 'marmul'
                ELSE NULL
            END,
        ProjCode =
            CASE
                WHEN s.FileName IS NULL THEN NULL
                WHEN CHARINDEX('SCHED-', s.FileName) > 0
                 AND CHARINDEX('-RIG', s.FileName) > CHARINDEX('SCHED-', s.FileName)
                    THEN UPPER(LTRIM(RTRIM(SUBSTRING(s.FileName,
                        CHARINDEX('SCHED-', s.FileName) + 6,
                        CHARINDEX('-RIG', s.FileName) - (CHARINDEX('SCHED-', s.FileName) + 6)
                    ))))
                ELSE NULL
            END
    FROM dbo.data_table_sched_jsons s
),
SchedNorm AS (
    SELECT
        Well_ID_norm, Cluster,
        ProjCodeClean =
            CASE
                WHEN ProjCode IS NULL THEN NULL
                ELSE LEFT(
                    REPLACE(REPLACE(REPLACE(REPLACE(ProjCode,'_','-'),'.','-'),' ','-'),'--','-'),
                    CASE
                        WHEN CHARINDEX('-', REPLACE(REPLACE(REPLACE(REPLACE(ProjCode,'_','-'),'.','-'),' ','-'),'--','-')) > 0
                        THEN CHARINDEX('-', REPLACE(REPLACE(REPLACE(REPLACE(ProjCode,'_','-'),'.','-'),' ','-'),'--','-')) - 1
                        ELSE LEN(REPLACE(REPLACE(REPLACE(REPLACE(ProjCode,'_','-'),'.','-'),' ','-'),'--','-'))
                    END
                )
            END,
        purpose_value
    FROM SchedParsed
),
SchedAgg AS (
    SELECT
        Well_ID_norm, Cluster, ProjCodeClean,
        PurposeValue = SUM(TRY_CONVERT(float, NULLIF(LTRIM(RTRIM(purpose_value)), '')))
    FROM SchedNorm
    GROUP BY Well_ID_norm, Cluster, ProjCodeClean
)

SELECT
    SlNo                = ROW_NUMBER() OVER (ORDER BY TRY_CONVERT(int, a.Well_ID), pid.column2),
    Category            = pid.column2,
    WellId              = a.Well_ID,
    WellName            = COALESCE(sap.Well_Name, wmr1.well_name_after_spud),
    PoNo                =
        CASE
            WHEN LOWER(pid.column2) LIKE '%flowline%' OR LOWER(pid.column2) LIKE '%flc%'
              OR LOWER(pid.column2) LIKE '%conversion with%' OR LOWER(pid.column2) LIKE '%cwf%'
              OR LOWER(pid.column2) LIKE '%reopen with%'     OR LOWER(pid.column2) LIKE '%rwf%'
                THEN wmr1.flow_line_po_no
            ELSE wmr1.location_po_no
        END,
    WbsNo               = wbsPick.WBS_Code,
    CumPriorActualPct   = CAST(ROUND(100.0 * a.Cum_Prior_Act_frac, 2) AS decimal(18,2)),
    W1PlanPct           = CASE WHEN a.HasPlan=1 THEN CAST(ROUND(100.0*a.W1_Plan_frac, 2) AS decimal(18,2)) ELSE NULL END,
    W1ActualPct         = CAST(ROUND(100.0 * a.W1_Act_frac,  2) AS decimal(18,2)),
    W2PlanPct           = CASE WHEN a.HasPlan=1 THEN CAST(ROUND(100.0*a.W2_Plan_frac, 2) AS decimal(18,2)) ELSE NULL END,
    W2ActualPct         = CAST(ROUND(100.0 * a.W2_Act_frac,  2) AS decimal(18,2)),
    W3PlanPct           = CASE WHEN a.HasPlan=1 THEN CAST(ROUND(100.0*a.W3_Plan_frac, 2) AS decimal(18,2)) ELSE NULL END,
    W3ActualPct         = CAST(ROUND(100.0 * a.W3_Act_frac,  2) AS decimal(18,2)),
    W4PlanPct           = CASE WHEN a.HasPlan=1 THEN CAST(ROUND(100.0*a.W4_Plan_frac, 2) AS decimal(18,2)) ELSE NULL END,
    W4ActualPct         = CAST(ROUND(100.0 * a.W4_Act_frac,  2) AS decimal(18,2)),
    W5PlanPct           = CASE WHEN a.HasPlan=1 THEN CAST(ROUND(100.0*a.W5_Plan_frac, 2) AS decimal(18,2)) ELSE NULL END,
    W5ActualPct         = CAST(ROUND(100.0 * a.W5_Act_frac,  2) AS decimal(18,2)),
    CmPlanPct           = CASE WHEN a.HasPlan=1 THEN CAST(ROUND(100.0*a.CurrentMonthPlanFrac, 2) AS decimal(18,2)) ELSE NULL END,
    CmActualPct         = CAST(ROUND(100.0 * CASE
        WHEN (a.W1_Act_frac+a.W2_Act_frac+a.W3_Act_frac+a.W4_Act_frac+a.W5_Act_frac) > 1 THEN 1.0
        ELSE  (a.W1_Act_frac+a.W2_Act_frac+a.W3_Act_frac+a.W4_Act_frac+a.W5_Act_frac) END, 2) AS decimal(18,2)),
    CumCmPlanPct        = CASE WHEN a.HasPlan=1 THEN CAST(ROUND(100.0 * CASE
        WHEN (a.Cum_Prior_Act_frac+a.CurrentMonthPlanFrac) > 1 THEN 1.0
        ELSE  (a.Cum_Prior_Act_frac+a.CurrentMonthPlanFrac) END, 2) AS decimal(18,2)) ELSE NULL END,
    CumCmActualPct      = CAST(ROUND(100.0 * CASE
        WHEN (a.Cum_Prior_Act_frac+a.W1_Act_frac+a.W2_Act_frac+a.W3_Act_frac+a.W4_Act_frac+a.W5_Act_frac) > 1 THEN 1.0
        ELSE  (a.Cum_Prior_Act_frac+a.W1_Act_frac+a.W2_Act_frac+a.W3_Act_frac+a.W4_Act_frac+a.W5_Act_frac) END, 2) AS decimal(18,2)),
    TargetEnd           = COALESCE(a.Snapshot_Target_End, te2.Latest_Target_End),
    PurposeValue        = CAST(ROUND(ISNULL(pv.PurposeValue,0), 2) AS decimal(28,2)),
    CumPriorMonthPlan   = CASE WHEN a.HasPlan=1 THEN CAST(ROUND(ISNULL(pv.PurposeValue,0)*ISNULL(a.Cum_Prior_Plan_frac,0), 2) AS decimal(28,2)) ELSE NULL END,
    CumPriorMonthActual = CAST(ROUND(ISNULL(pv.PurposeValue,0)*a.Cum_Prior_Act_frac, 2) AS decimal(28,2)),
    CmPlanRevenue       = CASE WHEN a.HasPlan=1 THEN CAST(ROUND(ISNULL(pv.PurposeValue,0)*a.CurrentMonthPlanFrac, 2) AS decimal(28,2)) ELSE NULL END,
    CmActualRevenue     = CAST(ROUND(ISNULL(pv.PurposeValue,0) * CASE
        WHEN (a.W1_Act_frac+a.W2_Act_frac+a.W3_Act_frac+a.W4_Act_frac+a.W5_Act_frac) > 1 THEN 1.0
        ELSE  (a.W1_Act_frac+a.W2_Act_frac+a.W3_Act_frac+a.W4_Act_frac+a.W5_Act_frac) END, 2) AS decimal(28,2)),
    CumCmPlanRevenue    = CASE WHEN a.HasPlan=1 THEN CAST(ROUND(ISNULL(pv.PurposeValue,0) * CASE
        WHEN (a.Cum_Prior_Act_frac+a.CurrentMonthPlanFrac) > 1 THEN 1.0
        ELSE  (a.Cum_Prior_Act_frac+a.CurrentMonthPlanFrac) END, 2) AS decimal(28,2)) ELSE NULL END,
    CumCmActualRevenue  = CAST(ROUND(ISNULL(pv.PurposeValue,0) * CASE
        WHEN (a.Cum_Prior_Act_frac+a.W1_Act_frac+a.W2_Act_frac+a.W3_Act_frac+a.W4_Act_frac+a.W5_Act_frac) > 1 THEN 1.0
        ELSE  (a.Cum_Prior_Act_frac+a.W1_Act_frac+a.W2_Act_frac+a.W3_Act_frac+a.W4_Act_frac+a.W5_Act_frac) END, 2) AS decimal(28,2)),
    Remarks             = CAST('' AS nvarchar(200)),
    Cluster             = CAST('' AS nvarchar(50)),
    WellType            = CAST('' AS nvarchar(50))
FROM Agg a
LEFT JOIN dbo.ProjectIDs pid
    ON pid.ID = a.project_id
LEFT JOIN WMR_1 wmr1
    ON wmr1.WellID = a.Well_ID
LEFT JOIN SAP_WellName_Latest sap
    ON sap.WellID = a.Well_ID AND sap.rn = 1
LEFT JOIN TargetEndAgg te2
    ON te2.Well_ID = a.Well_ID AND te2.project_id = a.project_id
OUTER APPLY (
    SELECT TOP (1) t.WBS_Code
    FROM dbo.[WBS_Master_Tracker_] t
    WHERE t.Well_ID_Project_PO LIKE '%' + a.Well_ID + '%'
      AND (
            ((LOWER(pid.column2) LIKE '%flowline%' OR LOWER(pid.column2) LIKE '%flc%')
              AND (LOWER(t.Category) LIKE '%flowline%' OR LOWER(t.Category) LIKE '%flc%'))
         OR (LOWER(pid.column2) LIKE '%snlp%' AND LOWER(t.Category) LIKE '%snlp%')
         OR (NOT (LOWER(pid.column2) LIKE '%flowline%' OR LOWER(pid.column2) LIKE '%flc%'
                  OR LOWER(pid.column2) LIKE '%snlp%')
              AND (LOWER(t.Category) LIKE '%location%' OR LOWER(t.Category) LIKE '%loc%'))
          )
    ORDER BY t.WBS_Code
) wbsPick
OUTER APPLY (
    SELECT TOP (1) sa.PurposeValue
    FROM SchedAgg sa
    WHERE sa.Well_ID_norm = a.Well_ID
      AND sa.PurposeValue IS NOT NULL
      AND (
            (sa.Cluster = 'nimr'   AND LOWER(pid.column2) LIKE '%nimr%')
         OR (sa.Cluster = 'marmul' AND LOWER(pid.column2) LIKE '%marmul%')
          )
      AND sa.ProjCodeClean =
            CASE
                WHEN LOWER(pid.column2) LIKE '%conversion without%' OR LOWER(pid.column2) LIKE '%cof%' THEN 'COF'
                WHEN LOWER(pid.column2) LIKE '%conversion with%'    OR LOWER(pid.column2) LIKE '%cwf%' THEN 'CWF'
                WHEN LOWER(pid.column2) LIKE '%non-standard%'       OR LOWER(pid.column2) LIKE '%nsw%' THEN 'NSW'
                WHEN LOWER(pid.column2) LIKE '%reopen with%'        OR LOWER(pid.column2) LIKE '%rwf%' THEN 'RWF'
                WHEN LOWER(pid.column2) LIKE '%re-open%' OR LOWER(pid.column2) LIKE '%reopen without%' OR LOWER(pid.column2) LIKE '%rop%' THEN 'ROP'
                WHEN LOWER(pid.column2) LIKE '%yard%'               OR LOWER(pid.column2) LIKE '%yrd%' THEN 'YRD'
                WHEN LOWER(pid.column2) LIKE '%snlp%'               THEN 'SLP'
                WHEN LOWER(pid.column2) LIKE '%flowline%' OR LOWER(pid.column2) LIKE '%flc%' THEN 'FLC'
                ELSE 'LOC'
            END
    ORDER BY sa.PurposeValue DESC
) pv
WHERE (
    ISNULL(a.CurrentMonthPlanFrac, 0) > 0
    OR (  ISNULL(a.W1_Act_frac,0) + ISNULL(a.W2_Act_frac,0) + ISNULL(a.W3_Act_frac,0)
        + ISNULL(a.W4_Act_frac,0) + ISNULL(a.W5_Act_frac,0)) > 0
)
AND (@Category = 'All' OR pid.column2 = @Category)
ORDER BY TRY_CONVERT(int, a.Well_ID), pid.column2;";

    // ── Endpoint ─────────────────────────────────────────────────────────────
    /// <summary>
    /// Returns KPI summary tiles + full row data for the Job Progress popup.
    /// Results are cached for 5 minutes per cluster+category combination.
    /// </summary>
    [HttpGet("job-progress")]
    public async Task<IActionResult> GetJobProgress(
        [FromQuery] string cluster  = "All",
        [FromQuery] string category = "All",
        CancellationToken ct = default)
    {
        var cacheKey = $"jp_{cluster}_{category}";
        if (cache.TryGetValue(cacheKey, out object? cached))
            return Ok(cached);

        var rows = new List<Dictionary<string, object?>>();

        await using var conn = new SqlConnection(Cs);
        await conn.OpenAsync(ct);

        await using var cmd = new SqlCommand(QuerySql, conn) { CommandTimeout = 300 };
        cmd.Parameters.AddWithValue("@Category", category);

        await using (var r = await cmd.ExecuteReaderAsync(ct))
        {
            while (await r.ReadAsync(ct))
            {
                var row = new Dictionary<string, object?>(r.FieldCount, StringComparer.Ordinal);
                for (int i = 0; i < r.FieldCount; i++)
                    row[r.GetName(i)] = r.IsDBNull(i) ? null : r.GetValue(i);
                rows.Add(row);
            }
        }

        // ── Per-row status + cluster (computed here, not in view) ────────────
        foreach (var row in rows)
        {
            // Cluster is embedded in Category name (view has no Cluster output column)
            var cat = row["Category"]?.ToString() ?? "";
            row["Cluster"] = cat.Contains("nimr",   StringComparison.OrdinalIgnoreCase) ? "Nimr"
                           : cat.Contains("marmul", StringComparison.OrdinalIgnoreCase) ? "Marmul"
                           : "";
            if (row["CmPlanPct"] is null)
            {
                row["Status"]    = "New well";
                row["IsNewWell"] = true;
            }
            else
            {
                double a = D(row["CmActualPct"]);
                double p = D(row["CmPlanPct"]);
                row["Status"]    = a < p - 2.0 ? "Behind" : a > p + 2.0 ? "Ahead" : "On track";
                row["IsNewWell"] = false;
            }
        }

        // ── Apply cluster filter in C# (Cluster is derived from Category, not in SQL) ─
        if (!string.Equals(cluster, "All", StringComparison.OrdinalIgnoreCase))
            rows = rows.Where(r => string.Equals(r["Cluster"]?.ToString(), cluster, StringComparison.OrdinalIgnoreCase)).ToList();

        // ── KPI tiles (purpose-value weighted averages) ───────────────────────
        double totalPurpose = rows.Sum(r => D(r["PurposeValue"]));
        if (totalPurpose <= 0) totalPurpose = 1;

        double WAvg(string col)
        {
            var planRows = rows.Where(r => r[col] is not null).ToList();
            if (planRows.Count == 0) return 0;
            double num = planRows.Sum(r => D(r["PurposeValue"]) * D(r[col]));
            double den = planRows.Sum(r => D(r["PurposeValue"]));
            return den > 0 ? num / den : 0;
        }

        double cmPlanPct    = WAvg("CmPlanPct");
        double cmActualPct  = WAvg("CmActualPct");
        double cumActualPct = WAvg("CumCmActualPct");

        double cmActualRev  = rows.Sum(r => D(r["CmActualRevenue"]));
        double cumActualRev = rows.Sum(r => D(r["CumCmActualRevenue"]));

        int wellsBehind = rows.Count(r =>
            r["CmPlanPct"] is not null &&
            D(r["CmActualPct"]) < D(r["CmPlanPct"]) - 2.0);

        int newWells = rows.Count(r => r["CmPlanPct"] is null);

        // ── Dropdown options for frontend filters ─────────────────────────────
        var clusters = rows
            .Select(r => r["Cluster"]?.ToString() ?? "")
            .Where(s => s.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(s => s)
            .ToList();

        var categories = rows
            .Select(r => r["Category"]?.ToString() ?? "")
            .Where(s => s.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(s => s)
            .ToList();

        var result = new
        {
            Month = DateTime.Now.ToString("MMMM yyyy"),
            Kpis = new
            {
                CmPlanPct        = Math.Round(cmPlanPct,    1),
                CmActualPct      = Math.Round(cmActualPct,  1),
                CumActualPct     = Math.Round(cumActualPct, 1),
                CmActualRevenue  = Math.Round(cmActualRev,  0),
                CumActualRevenue = Math.Round(cumActualRev, 0),
                WellsBehind      = wellsBehind,
                TotalWells       = rows.Count,
                NewWells         = newWells
            },
            Clusters   = clusters,
            Categories = categories,
            Rows       = rows
        };

        cache.Set(cacheKey, result, CacheTtl);
        return Ok(result);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // DAILY PLAN REPORT
    // ═══════════════════════════════════════════════════════════════════════════
    // Fully inlined SQL — no dependency on any views.
    // Replaces logic from three views:
    //   [dbo].[Daily_Plan_Report_GB]
    //   [dbo].[vw_DailyWorkPlanC_TodayReport]
    //   [dbo].[vw_DailyWorkPlanC]
    //
    // Source tables:
    //   task_daily, Employee, WMR, ActivityMasterMapping, ActivityMasterCSV,
    //   SAP_DRILLING_SEQUENCE, crews, Equipment, EquipmentType,
    //   ProjectIDs, ActivityCodesNorms, PA_PH_CONTACT_Numbers, WBS_Master_Tracker_
    private const string DailyPlanSql = @"
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

WITH
-- ── Inline: dbo.vw_DailyWorkPlanC ────────────────────────────────────────────
raw AS
(
    SELECT
        td.ActionOn                                       AS [Date],
        emp.UId                                           AS [PH Emp ID],
        emp.Name                                          AS [PH Name],
        CASE
            WHEN emp.UId IS NULL OR LTRIM(RTRIM(emp.UId)) = ''  THEN NULL
            WHEN TRY_CONVERT(BIGINT, LTRIM(RTRIM(emp.UId))) IS NULL THEN NULL
            WHEN LEN(LTRIM(RTRIM(emp.UId))) = 6 THEN 'ATNM'
            WHEN LEN(LTRIM(RTRIM(emp.UId))) > 6 THEN 'SC'
            ELSE NULL
        END                                               AS [ATNM/SC],
        CASE
            WHEN td.task_assignee IS NOT NULL
                 AND CHARINDEX('.', td.task_assignee) > 0
            THEN LEFT(td.task_assignee, CHARINDEX('.', td.task_assignee) - 1)
            ELSE td.task_assignee
        END                                               AS [Permit Applicant Name],
        td.well_id                                        AS [Well ID],
        CASE
            WHEN UPPER(LTRIM(RTRIM(amm.[Type]))) = 'FLOWLINE' THEN wmr.flow_line_po_no
            WHEN UPPER(LTRIM(RTRIM(amm.[Type]))) = 'LOCATION' THEN wmr.location_po_no
            ELSE NULL
        END                                               AS [PO/WBS],
        wmr.well_location                                 AS [JOB TITLE/PROJECT NAME],
        sds.[field]                                       AS [LOCATION],
        LEFT(LTRIM(RTRIM(td.task_code)), 8)               AS [Activity ID],
        amc.ACTIVITY_DESCRIPTION                          AS [ACTIVITIES],
        td.crew_code                                      AS [Crew Code],
        td.time_stamp                                     AS [Time Stamp],
        td.task_code                                      AS [Linking_code],
        -- Extra columns needed by Daily_Plan_Report_GB (avoids later re-join)
        td.project_id                                     AS project_id,
        td.task_assignee                                  AS task_assignee_raw,
        td.crew_type                                      AS crew_type
    FROM dbo.task_daily td
    LEFT JOIN dbo.Employee emp
        ON  LTRIM(RTRIM(LOWER(emp.Email)))
          = LTRIM(RTRIM(LOWER(td.supervisor_email)))
    LEFT JOIN dbo.WMR wmr
        ON  LTRIM(RTRIM(td.well_id)) = LTRIM(RTRIM(wmr.pdo_well_id))
    LEFT JOIN dbo.ActivityMasterMapping amm
        ON  LTRIM(RTRIM(amm.ActivityID)) = LEFT(LTRIM(RTRIM(td.task_code)), 8)
    LEFT JOIN dbo.ActivityMasterCSV amc
        ON  LTRIM(RTRIM(amm.Activity_Code)) = LTRIM(RTRIM(amc.ACTIVITY_CODE))
    LEFT JOIN dbo.SAP_DRILLING_SEQUENCE sds
        ON  LTRIM(RTRIM(td.well_id)) = LTRIM(RTRIM(sds.Well_ID))
    WHERE CAST(td.ActionOn AS date) = CAST(@TargetDate AS date)
      AND emp.UId IS NOT NULL
      AND LTRIM(RTRIM(emp.UId)) <> ''
),
-- ── Inline: dbo.vw_DailyWorkPlanC_TodayReport (dedup) ────────────────────────
deduped AS
(
    SELECT
        *,
        ROW_NUMBER() OVER (
            PARTITION BY CAST([Date] AS date), [Linking_code]
            ORDER BY [Time Stamp] DESC, [Crew Code] DESC
        ) AS rn
    FROM raw
),
today AS
(
    SELECT * FROM deduped WHERE rn = 1
),
-- ── Inline: Daily_Plan_Report_GB – base CTE ───────────────────────────────────
base AS
(
    SELECT
        t.[Date],
        t.[PH Emp ID],
        t.[PH Name],
        t.[ATNM/SC],
        t.[Permit Applicant Name],
        t.[Well ID],
        t.[PO/WBS],
        t.[JOB TITLE/PROJECT NAME],
        t.[LOCATION],
        t.[Activity ID],
        t.[ACTIVITIES],
        t.[Crew Code],
        t.[Linking_code],
        t.project_id,
        t.crew_type,
        -- PA Emp ID: last-name portion from email (between first '.' and '@')
        CASE
            WHEN t.task_assignee_raw IS NOT NULL
                 AND CHARINDEX('.', t.task_assignee_raw) > 0
                 AND CHARINDEX('@', t.task_assignee_raw) > CHARINDEX('.', t.task_assignee_raw)
            THEN SUBSTRING(
                    t.task_assignee_raw,
                    CHARINDEX('.', t.task_assignee_raw) + 1,
                    CHARINDEX('@', t.task_assignee_raw) - CHARINDEX('.', t.task_assignee_raw) - 1
                 )
            ELSE NULL
        END AS [PA Emp ID],
        -- Last 4 chars after '-' in crew_type
        CASE
            WHEN t.crew_type IS NULL THEN NULL
            WHEN CHARINDEX('-', t.crew_type) > 0
                THEN SUBSTRING(t.crew_type, CHARINDEX('-', t.crew_type) + 1, 4)
            ELSE RIGHT(LTRIM(RTRIM(t.crew_type)), 4)
        END AS CrewTypeDigits
    FROM today t
),
-- ── Inline: Daily_Plan_Report_GB – veh CTE ────────────────────────────────────
veh AS
(
    SELECT
        b.*,
        TRY_CONVERT(INT, LEFT(b.CrewTypeDigits, 2))  AS ManpowerFromCrewType,
        TRY_CONVERT(INT, RIGHT(b.CrewTypeDigits, 2)) AS EquipmentFromCrewType,
        VehicleCount =
        (
            SELECT COUNT(DISTINCT e.ID)
            FROM dbo.crews c
            CROSS APPLY OPENJSON(c.Equipments) j
            OUTER APPLY (
                SELECT CleanVal =
                    LTRIM(RTRIM(REPLACE(REPLACE(CONVERT(NVARCHAR(200), j.[value]), '""', ''), ' ', '')))
            ) cv
            JOIN dbo.Equipment e
              ON  e.ID = TRY_CONVERT(INT, cv.CleanVal)
              OR  UPPER(LTRIM(RTRIM(e.LicensePlate))) = UPPER(LTRIM(RTRIM(cv.CleanVal)))
            JOIN dbo.EquipmentType et
              ON  et.ID = e.EquipmentType
            WHERE LTRIM(RTRIM(c.Code)) = LTRIM(RTRIM(b.[Crew Code]))
              AND (et.Code LIKE 'H%' OR et.Code LIKE 'L%')
        )
    FROM base b
),
-- ── Inline: Daily_Plan_Report_GB – final CTE ──────────────────────────────────
final AS
(
    SELECT
        CASE WHEN v.[ATNM/SC] = 'ATNM' THEN 1 ELSE 2 END     AS SortGroup,
        v.[ATNM/SC],
        ISNULL(am.DISCIPLINE, '')                              AS [Discipline],
        v.[Well ID],
        v.[Permit Applicant Name]                              AS [PA Name],
        ISNULL(paContact.GSM_NO, '')                           AS [PA Mob No],
        v.[PH Emp ID],
        v.[PH Name],
        ISNULL(phContact.GSM_NO, '')                           AS [PH Mob No],
        v.[PO/WBS]                                             AS [PO No],
        ISNULL(wbsPick.WBS_Code, '')                           AS [WBS],
        ISNULL(pid.column2, '')                                AS [Well Category],
        v.[LOCATION]                                           AS [Location],
        v.[JOB TITLE/PROJECT NAME]                             AS [Job Title],
        v.[ACTIVITIES]                                         AS [Activities],
        ISNULL(v.ManpowerFromCrewType, 0)                      AS [Manpower],
        CASE
            WHEN ISNULL(v.EquipmentFromCrewType, 0) - ISNULL(v.VehicleCount, 0) < 0 THEN 0
            ELSE ISNULL(v.EquipmentFromCrewType, 0) - ISNULL(v.VehicleCount, 0)
        END                                                    AS [Eqpt],
        ISNULL(v.VehicleCount, 0)                              AS [Vehicle],
        CAST(NULL AS NVARCHAR(500))                            AS [Remarks]
    FROM veh v
    LEFT JOIN dbo.ProjectIDs pid
        ON  pid.ID = v.project_id
    LEFT JOIN dbo.ActivityCodesNorms acn
        ON  acn.Activity_ID = v.[Activity ID]
    LEFT JOIN dbo.ActivityMasterCSV am
        ON  am.ACTIVITY_CODE = acn.Old_Activity_Code
    LEFT JOIN dbo.PA_PH_CONTACT_Numbers paContact
        ON  LTRIM(RTRIM(CONVERT(NVARCHAR(100), paContact.Personnel_Number)))
          = LTRIM(RTRIM(CONVERT(NVARCHAR(100), v.[PA Emp ID])))
    LEFT JOIN dbo.PA_PH_CONTACT_Numbers phContact
        ON  LTRIM(RTRIM(CONVERT(NVARCHAR(100), phContact.Personnel_Number)))
          = LTRIM(RTRIM(CONVERT(NVARCHAR(100), v.[PH Emp ID])))
    OUTER APPLY
    (
        SELECT TOP (1) w.WBS_Code
        FROM dbo.WBS_Master_Tracker_ w
        WHERE LTRIM(RTRIM(CONVERT(NVARCHAR(200), w.Well_ID_Project_PO)))
            = LTRIM(RTRIM(CONVERT(NVARCHAR(200), v.[Well ID])))
          AND
          (
              (w.[Category] LIKE '%Flowline%' AND ISNULL(pid.column2,'') LIKE '%Flowline%')
           OR (w.[Category] LIKE '%Location%' AND ISNULL(pid.column2,'') LIKE '%Location%')
           OR (
                w.[Category] NOT LIKE '%Flowline%'
            AND w.[Category] NOT LIKE '%Location%'
            AND ISNULL(pid.column2,'') NOT LIKE '%Flowline%'
            AND ISNULL(pid.column2,'') NOT LIKE '%Location%'
              )
          )
        ORDER BY
            CASE
                WHEN (w.[Category] LIKE '%Flowline%' AND ISNULL(pid.column2,'') LIKE '%Flowline%') THEN 1
                WHEN (w.[Category] LIKE '%Location%' AND ISNULL(pid.column2,'') LIKE '%Location%') THEN 2
                ELSE 3
            END
    ) wbsPick
)
-- ── Final projection → camelCase names match Angular _buildDpGrid ─────────────
SELECT
    ROW_NUMBER() OVER (
        ORDER BY SortGroup, [Location], [Well ID], [PO No], [PH Emp ID]
    )                   AS SlNo,
    [ATNM/SC]           AS AtnmSc,
    [Discipline],
    [Well ID]           AS WellId,
    [PA Name]           AS PaName,
    [PA Mob No]         AS PaMob,
    [PH Emp ID]         AS PhId,
    [PH Name]           AS PhName,
    [PH Mob No]         AS PhMob,
    [PO No]             AS PoNo,
    [WBS],
    [Well Category]     AS WellCategory,
    [Location],
    [Job Title]         AS JobTitle,
    [Activities],
    [Manpower],
    [Eqpt],
    [Vehicle],
    [Remarks]
FROM final
ORDER BY SortGroup, [Location], [Well ID], [PO No], [PH Emp ID];
";

    /// <summary>
    /// Returns daily work plan rows for the given date (defaults to tomorrow).
    /// Results are cached for 5 minutes per date.
    /// GET /reports/daily-plan?date=YYYY-MM-DD
    /// </summary>
    [HttpGet("daily-plan")]
    public async Task<IActionResult> GetDailyPlan(
        [FromQuery] string? date = null,
        CancellationToken ct = default)
    {
        var targetDate = date != null && DateTime.TryParse(date, out var parsed)
            ? parsed.Date
            : DateTime.Today.AddDays(1);

        var cacheKey = $"dp_{targetDate:yyyyMMdd}";
        if (cache.TryGetValue(cacheKey, out object? cached))
            return Ok(cached);

        var rows = new List<object>();

        await using var conn = new SqlConnection(Cs);
        await conn.OpenAsync(ct);

        await using var cmd = new SqlCommand(DailyPlanSql, conn) { CommandTimeout = 300 };
        cmd.Parameters.Add("@TargetDate", System.Data.SqlDbType.Date).Value = targetDate;

        await using var rdr = await cmd.ExecuteReaderAsync(ct);
        while (await rdr.ReadAsync(ct))
        {
            rows.Add(new
            {
                slNo   = rdr.IsDBNull(rdr.GetOrdinal("SlNo"))         ? 0     : Convert.ToInt32(rdr["SlNo"]),
                atnm   = !rdr.IsDBNull(rdr.GetOrdinal("AtnmSc")) &&
                          string.Equals(rdr["AtnmSc"]?.ToString(), "ATNM", StringComparison.OrdinalIgnoreCase),
                disc   = rdr.IsDBNull(rdr.GetOrdinal("Discipline"))   ? "" : rdr["Discipline"]?.ToString()   ?? "",
                well   = rdr.IsDBNull(rdr.GetOrdinal("WellId"))       ? "" : rdr["WellId"]?.ToString()       ?? "",
                pa     = rdr.IsDBNull(rdr.GetOrdinal("PaName"))       ? "" : rdr["PaName"]?.ToString()       ?? "",
                paMob  = rdr.IsDBNull(rdr.GetOrdinal("PaMob"))        ? "" : rdr["PaMob"]?.ToString()        ?? "",
                phId   = rdr.IsDBNull(rdr.GetOrdinal("PhId"))         ? "" : rdr["PhId"]?.ToString()         ?? "",
                phName = rdr.IsDBNull(rdr.GetOrdinal("PhName"))       ? "" : rdr["PhName"]?.ToString()       ?? "",
                phMob  = rdr.IsDBNull(rdr.GetOrdinal("PhMob"))        ? "" : rdr["PhMob"]?.ToString()        ?? "",
                po     = rdr.IsDBNull(rdr.GetOrdinal("PoNo"))         ? "" : rdr["PoNo"]?.ToString()         ?? "",
                wbs    = rdr.IsDBNull(rdr.GetOrdinal("WBS"))          ? "" : rdr["WBS"]?.ToString()          ?? "",
                cat    = rdr.IsDBNull(rdr.GetOrdinal("WellCategory")) ? "" : rdr["WellCategory"]?.ToString() ?? "",
                loc    = rdr.IsDBNull(rdr.GetOrdinal("Location"))     ? "" : rdr["Location"]?.ToString()     ?? "",
                job    = rdr.IsDBNull(rdr.GetOrdinal("JobTitle"))     ? "" : rdr["JobTitle"]?.ToString()     ?? "",
                act    = rdr.IsDBNull(rdr.GetOrdinal("Activities"))   ? "" : rdr["Activities"]?.ToString()   ?? "",
                man    = rdr.IsDBNull(rdr.GetOrdinal("Manpower"))     ? 0  : Convert.ToInt32(rdr["Manpower"]),
                eqpt   = rdr.IsDBNull(rdr.GetOrdinal("Eqpt"))         ? 0  : Convert.ToInt32(rdr["Eqpt"]),
                veh    = rdr.IsDBNull(rdr.GetOrdinal("Vehicle"))      ? 0  : Convert.ToInt32(rdr["Vehicle"]),
                rem    = rdr.IsDBNull(rdr.GetOrdinal("Remarks"))      ? "" : rdr["Remarks"]?.ToString()      ?? ""
            });
        }

        cache.Set(cacheKey, rows, CacheTtl);
        return Ok(rows);
    }

    // ── Helper ────────────────────────────────────────────────────────────────
    private static double D(object? v) =>
        v is null or DBNull ? 0.0 : Convert.ToDouble(v);
}
