using MediatR;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using SmartOps.Wells.Application.Features.Dashboard;
using SmartOps.Wells.Contracts;
using System.Data;

namespace SmartOps.Wells.API.Controllers;

[ApiController]
// [Authorize]
[Route("dashboard")]
public sealed class DashboardController(IMediator mediator, IConfiguration configuration) : ControllerBase
{
    // Short-lived in-memory cache for the ODC Overall Status endpoint.
    // Keyed by "from|to|cluster|site|wellType" � cached result is valid for 6 hours.
    // Eliminates repeated full-table SQL scans when the user changes the global filter rapidly.
    private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, (DateTime At, object Result)> _odcResultCache = new();

    // Cache for the cluster-wells endpoint (no filter params � always same data).
    // Valid for 6 hours; eliminates repeated DB calls every time the global filter dropdown opens.
    private static (DateTime At, object? Result) _clusterWellsCache = (DateTime.MinValue, null);

    // In-memory cache for cmd-readiness-kpi � keyed by "from|to|cluster|site|wellType|project|wellId", valid 30 min.
    private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, (DateTime At, object Result)> _cmdKpiCache = new();

    // In-memory cache for cmd-readiness-kpi-wells � keyed by "cat|from|to|cluster|site|wellType|project|wellId|page|pageSize", valid 30 min.
    private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, (DateTime At, object Result)> _cmdKpiWellsCache = new();
    private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, (DateTime At, object Result)> _cmdKpiActivitiesCache = new();

    [HttpGet("crews-deployed")]
    public async Task<ActionResult<CrewsDeployedKpiDto>> CrewsDeployed(
        [FromQuery] string? crewGroup,
        [FromQuery] string? cluster,
        [FromQuery] string? wellId,
        [FromQuery] DateOnly? from,
        [FromQuery] DateOnly? to,
        CancellationToken ct)
        => Ok(await mediator.Send(
            new GetCrewsDeployedKpiQuery(crewGroup, cluster, wellId, from, to), ct));

    [HttpGet("active-wells")]
    public async Task<ActionResult<ActiveWellsKpiDto>> ActiveWells(
        [FromQuery] string? cluster,
        [FromQuery] string? site,
        [FromQuery] string? wellType,
        [FromQuery] string? project,
        [FromQuery] string? wellId,
        [FromQuery] DateOnly? from,
        [FromQuery] DateOnly? to,
        [FromQuery] bool thisMonth = false,
        CancellationToken ct = default)
        => Ok(await mediator.Send(
            new GetActiveWellsKpiQuery(cluster, site, wellType, project, wellId, from, to, thisMonth), ct));

    /// <summary>
    /// KPI Tiles — 4 dashboard tiles driven entirely from WMR within the selected date range.
    ///
    /// Tile 1 – Total Wells   : all unique pdo_well_id in WMR with week_number in [from, to]
    ///   • Active   = progress > 0 AND progress &lt; 1
    ///   • Inactive = wells where New_Well_ID exists in WMR_TaskPlan_csv_imported with Resume_Suspend='Suspend'
    ///
    /// Tile 2 – Completed Wells : progress >= 1
    ///   • DueWells         = completed wells where actual_comm_date > DueDate
    ///   • NonDueWells      = completed wells where actual_comm_date &lt;= DueDate (or no due date)
    ///   DueDate = MAX(FLAF+90, SCR+90, RigOff+5, Handover+2)
    ///
    /// Tile 3 – Penalty Exposure : ALL total wells where actual_comm_date > DueDate
    ///
    /// Tile 4 – Bonus Potential  : ALL total wells where actual_comm_date &lt; DueDate
    ///
    /// GET /dashboard/kpi-tiles?from=2026-01-01&amp;to=2026-06-16
    /// </summary>
    [HttpGet("kpi-tiles")]
    public async Task<IActionResult> KpiTiles(
        [FromQuery] DateOnly? from = null,
        [FromQuery] DateOnly? to = null,
        [FromQuery] string? cluster = null,
        [FromQuery] string? site = null,
        [FromQuery] string? wellType = null,
        [FromQuery] string? project = null,
        CancellationToken ct = default)
    {
        var cs = configuration.GetConnectionString("Default")
            ?? throw new InvalidOperationException("ConnectionStrings:Default not configured.");

        var toDate   = to   ?? DateOnly.FromDateTime(DateTime.Today);
        var fromDate = from ?? new DateOnly(DateTime.Today.Year, 1, 1);

        var pidConditions = new System.Text.StringBuilder();
        if (!string.IsNullOrWhiteSpace(cluster))  pidConditions.Append(" AND LTRIM(RTRIM(CAST([Cluster] AS NVARCHAR(200)))) = @cluster");
        if (!string.IsNullOrWhiteSpace(site))     pidConditions.Append(" AND LTRIM(RTRIM(CAST([Site]    AS NVARCHAR(200)))) = @site");
        if (!string.IsNullOrWhiteSpace(wellType)) pidConditions.Append(" AND LTRIM(RTRIM(CAST([Type]    AS NVARCHAR(200)))) = @wellType");
        if (!string.IsNullOrWhiteSpace(project))  pidConditions.Append(" AND LTRIM(RTRIM(CAST([Project] AS NVARCHAR(200)))) = @project");
        var pidFilter = pidConditions.Length > 0
            ? $" AND project_id IN (SELECT CAST(ID AS NVARCHAR(100)) FROM [dbo].[ProjectIDs] WITH (NOLOCK) WHERE 1=1{pidConditions})"
            : "";

        var sql = $"""
            DECLARE @pFrom DATE = @from;
            DECLARE @pTo   DATE = @to;

            -- Step 1: Latest WMR snapshot per well within the selected date range
            ;WITH LatestSnapshot AS (
                SELECT
                    pdo_well_id,
                    project_id,
                    COALESCE(TRY_CAST(over_all_progress_percentages AS FLOAT), 0)                       AS progress,
                    TRY_CAST([flaf_issue_date] AS DATE)                                                 AS flaf_date,
                    TRY_CAST([scr_date] AS DATE)                                                        AS scr_date,
                    TRY_CAST(actual_rig_off_date AS DATE)                                               AS actual_rig_off_date,
                    TRY_CAST([wellpad_handover-2_from_hoist_fbu_rsr_off_date] AS DATE)                  AS handover_date,
                    TRY_CAST([actual_comm._finish_date_with_in_2_days_from_actual_engg._completion_date] AS DATE) AS actual_comm_date,
                    ROW_NUMBER() OVER (
                        PARTITION BY pdo_well_id
                        ORDER BY COALESCE(TRY_CONVERT(DATE, Week_Number, 23), TRY_CONVERT(DATE, '20' + Week_Number, 23)) DESC,
                                 project_id DESC
                    ) AS rn
                FROM [dbo].[WMR] WITH (NOLOCK)
                WHERE pdo_well_id IS NOT NULL AND pdo_well_id <> ''
                  AND COALESCE(TRY_CONVERT(DATE, Week_Number, 23), TRY_CONVERT(DATE, '20' + Week_Number, 23)) IS NOT NULL
                  AND COALESCE(TRY_CONVERT(DATE, Week_Number, 23), TRY_CONVERT(DATE, '20' + Week_Number, 23)) >= @pFrom
                  AND COALESCE(TRY_CONVERT(DATE, Week_Number, 23), TRY_CONVERT(DATE, '20' + Week_Number, 23)) <= @pTo
            ),
            -- Step 2: One row per well + optional cluster/project filter
            --         Total Wells = wells where progress > 0 AND <= 1 (excludes not-started)
            Wells AS (
                SELECT pdo_well_id, progress, flaf_date, scr_date,
                       actual_rig_off_date, handover_date, actual_comm_date
                FROM LatestSnapshot
                WHERE rn = 1
                  AND progress > 0 AND progress <= 1.0
                  {pidFilter}
            ),
            -- Step 3: Due Date per well = MAX(FLAF+90, SCR+90, RigOff+5, Handover+2)
            -- eff_comm_date = COALESCE(actual_comm_date, @pTo) — matches Due Wells widget logic exactly
            DueDateCalc AS (
                SELECT
                    pdo_well_id,
                    progress,
                    actual_comm_date,
                    COALESCE(actual_comm_date, @pTo) AS eff_comm_date,
                    (SELECT MAX(d) FROM (VALUES
                        (DATEADD(DAY, 90, flaf_date)),
                        (DATEADD(DAY, 90, scr_date)),
                        (DATEADD(DAY,  5, actual_rig_off_date)),
                        (DATEADD(DAY,  2, handover_date))
                    ) AS v(d)) AS due_date
                FROM Wells
            ),
            -- Step 4: Inactive = wells with Resume_Suspend='Suspend' in WMR_TaskPlan
            SuspendedWells AS (
                SELECT DISTINCT CAST([New_Well_ID] AS NVARCHAR(200)) AS pdo_well_id
                FROM [dbo].[WMR_TaskPlan_csv_imported] WITH (NOLOCK)
                WHERE CAST([Resume_Suspend] AS NVARCHAR(50)) = 'Suspend'
                  AND CAST([New_Well_ID] AS NVARCHAR(200)) IN (SELECT pdo_well_id FROM Wells)
            )
            SELECT
                -- Tile 1: Total Wells = all wells with progress > 0 AND <= 1
                COUNT(*)                                                                                        AS TotalWells,
                -- Active = progress > 0 AND < 1, NOT suspended
                SUM(CASE WHEN dc.progress > 0 AND dc.progress < 1.0
                          AND sw.pdo_well_id IS NULL THEN 1 ELSE 0 END)                                        AS ActiveWells,
                -- Inactive = suspended wells with progress < 1 (suspended+completed count as completed, not inactive)
                SUM(CASE WHEN sw.pdo_well_id IS NOT NULL AND dc.progress < 1.0 THEN 1 ELSE 0 END)             AS InactiveWells,
                -- Tile 2: Completed = progress >= 1 (regardless of suspend status)
                SUM(CASE WHEN dc.progress >= 1.0 THEN 1 ELSE 0 END)                                           AS CompletedWells,
                -- DueWells = completed AND eff_comm_date > due_date (matches Due Wells widget COALESCE logic)
                SUM(CASE WHEN dc.progress >= 1.0
                          AND dc.due_date IS NOT NULL
                          AND dc.eff_comm_date > dc.due_date THEN 1 ELSE 0 END)                                AS DueWellsCompleted,
                -- NonDue = completed AND NOT (eff_comm_date > due_date) (matches Due Wells widget logic)
                SUM(CASE WHEN dc.progress >= 1.0
                          AND NOT (dc.due_date IS NOT NULL
                                   AND dc.eff_comm_date > dc.due_date) THEN 1 ELSE 0 END)                      AS NonDueWellsCompleted,
                -- Tile 3: Penalty Exposure = any well where effective_comm_date > due_date
                SUM(CASE WHEN dc.due_date IS NOT NULL
                          AND dc.actual_comm_date > dc.due_date THEN 1 ELSE 0 END)                             AS PenaltyExposure,
                -- Tile 4: Bonus Potential = any well where effective_comm_date < due_date
                SUM(CASE WHEN dc.due_date IS NOT NULL
                          AND dc.actual_comm_date < dc.due_date THEN 1 ELSE 0 END)                             AS BonusPotential
            FROM DueDateCalc dc
            LEFT JOIN SuspendedWells sw ON sw.pdo_well_id = dc.pdo_well_id;
            """;

        await using var conn = new SqlConnection(cs);
        await conn.OpenAsync(ct);
        await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 120 };
        cmd.Parameters.AddWithValue("@from", fromDate.ToDateTime(TimeOnly.MinValue));
        cmd.Parameters.AddWithValue("@to",   toDate.ToDateTime(TimeOnly.MinValue));
        if (!string.IsNullOrWhiteSpace(cluster))  cmd.Parameters.AddWithValue("@cluster",  cluster.Trim());
        if (!string.IsNullOrWhiteSpace(site))     cmd.Parameters.AddWithValue("@site",     site.Trim());
        if (!string.IsNullOrWhiteSpace(wellType)) cmd.Parameters.AddWithValue("@wellType", wellType.Trim());
        if (!string.IsNullOrWhiteSpace(project))  cmd.Parameters.AddWithValue("@project",  project.Trim());

        await using var reader = await cmd.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct))
            return Ok(new { totalWells=0, activeWells=0, inactiveWells=0, completedWells=0,
                            dueWellsCompleted=0, nonDueWellsCompleted=0, penaltyExposure=0, bonusPotential=0 });

        return Ok(new
        {
            totalWells          = reader.IsDBNull(0) ? 0 : reader.GetInt32(0),
            activeWells         = reader.IsDBNull(1) ? 0 : reader.GetInt32(1),
            inactiveWells       = reader.IsDBNull(2) ? 0 : reader.GetInt32(2),
            completedWells      = reader.IsDBNull(3) ? 0 : reader.GetInt32(3),
            dueWellsCompleted   = reader.IsDBNull(4) ? 0 : reader.GetInt32(4),
            nonDueWellsCompleted= reader.IsDBNull(5) ? 0 : reader.GetInt32(5),
            penaltyExposure     = reader.IsDBNull(6) ? 0 : reader.GetInt32(6),
            bonusPotential      = reader.IsDBNull(7) ? 0 : reader.GetInt32(7)
        });
    }

    [HttpGet("well-progress")]
    public async Task<ActionResult<WellProgressPageDto>> WellProgress(
        [FromQuery] string? cluster,
        [FromQuery] string? wellId,
        [FromQuery] string? status,
        [FromQuery] bool thisMonth = false,
        [FromQuery] DateOnly? from = null,
        [FromQuery] DateOnly? to = null,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20,
        CancellationToken ct = default)
        => Ok(await mediator.Send(
            new GetWellProgressQuery(cluster, wellId, status, from, to, thisMonth, page, pageSize), ct));

    [HttpGet("well-progress-kpi")]
    public async Task<ActionResult<WellProgressKpiDto>> WellProgressKpi(
        [FromQuery] string? cluster, [FromQuery] string? wellId, [FromQuery] string? wellType,
        [FromQuery] DateOnly? from, [FromQuery] DateOnly? to,
        CancellationToken ct)
        => Ok(await mediator.Send(new GetWellProgressKpiQuery(cluster, wellId, wellType, from, to), ct));

    /// <summary>
    /// Drilled Wells Completion KPI tile � total wells, completed, in-progress, pending, and completion rate %.
    /// GET /dashboard/drilled-wells-completion?cluster=MARMUL&amp;from=2026-01-01&amp;to=2026-12-31
    /// </summary>
    [HttpGet("drilled-wells-completion")]
    public async Task<ActionResult<DrilledWellsCompletionDto>> DrilledWellsCompletion(
        [FromQuery] string? cluster = null,
        [FromQuery] string? wellId = null,
        [FromQuery] string? wellType = null,
        [FromQuery] string? site = null,
        [FromQuery] string? project = null,
        [FromQuery] DateOnly? from = null,
        [FromQuery] DateOnly? to = null,
        CancellationToken ct = default)
        => Ok(await mediator.Send(new GetDrilledWellsCompletionQuery(cluster, wellId, wellType, site, project, from, to), ct));

    /// <summary>
    /// Drilled Wells individual rows � same filter logic as drilled-wells-completion tiles
    /// so counts always match. Returns one row per well categorised as completed/inprogress/pending.
    /// GET /dashboard/drilled-wells-list?cluster=MARMUL&amp;from=2026-01-01&amp;to=2026-12-31
    /// </summary>
    [HttpGet("drilled-wells-list")]
    public async Task<IActionResult> DrilledWellsList(
        [FromQuery] string? cluster = null,
        [FromQuery] string? wellId  = null,
        [FromQuery] string? wellType = null,
        [FromQuery] DateOnly? from  = null,
        [FromQuery] DateOnly? to    = null,
        CancellationToken ct = default)
    {
        var cs = configuration.GetConnectionString("Default")
            ?? throw new InvalidOperationException("ConnectionStrings:Default not configured.");

        var fromDate = from ?? new DateOnly(DateTime.Today.Year, 1, 1);
        var toDate   = to   ?? new DateOnly(DateTime.Today.Year, 12, 31);
        var today    = DateOnly.FromDateTime(DateTime.Today);
        if (toDate > today) toDate = today;

        var extraWhere = "";
        if (!string.IsNullOrWhiteSpace(wellId))
            extraWhere += " AND w.pdo_well_id = @wellId";
        // Filter cluster/wellType via EXISTS on ProjectIDs — same pattern as due-wells-list
        // so counts always match getDrilledWellsCompletion.
        var pidConditions = new System.Collections.Generic.List<string>();
        if (!string.IsNullOrWhiteSpace(cluster))  pidConditions.Add("LTRIM(RTRIM(CAST(p.[Cluster] AS NVARCHAR(200)))) = @cluster");
        if (!string.IsNullOrWhiteSpace(wellType)) pidConditions.Add("LTRIM(RTRIM(CAST(p.[Type]    AS NVARCHAR(200)))) = @wellType");
        if (pidConditions.Count > 0)
            extraWhere += $" AND EXISTS (SELECT 1 FROM [dbo].[ProjectIDs] p WITH (NOLOCK) WHERE CAST(p.ID AS NVARCHAR(100)) = w.project_id AND {string.Join(" AND ", pidConditions)})";

        var wellTypeJoin = "";

        var sql = $"""
            WITH LatestSnapshot AS (
              SELECT
                pdo_well_id,
                well_location,
                rig_no,
                well_type,
                project_id,
                over_all_progress_percentages,
                ohl_progress,
                [overall_const._10_100],
                overall_comm_progress_100,
                [location_preparation_status_in_progress_completed],
                [flow_line_commi._status_in_progress_completed],
                [flow_line_const._status_in_progress_completed],
                actual_rig_on_date,
                actual_rig_off_date,
                ROW_NUMBER() OVER (
                  PARTITION BY pdo_well_id
                  ORDER BY COALESCE(TRY_CONVERT(DATE, Week_Number, 23),
                                    TRY_CONVERT(DATE, '20' + Week_Number, 23)) DESC,
                           project_id DESC
                ) AS rn
              FROM [dbo].[WMR] WITH (NOLOCK)
              WHERE pdo_well_id IS NOT NULL AND pdo_well_id <> ''
                AND COALESCE(TRY_CONVERT(DATE, Week_Number, 23),
                             TRY_CONVERT(DATE, '20' + Week_Number, 23)) IS NOT NULL
                AND COALESCE(TRY_CONVERT(DATE, Week_Number, 23),
                             TRY_CONVERT(DATE, '20' + Week_Number, 23)) >= @fromDate
                AND COALESCE(TRY_CONVERT(DATE, Week_Number, 23),
                             TRY_CONVERT(DATE, '20' + Week_Number, 23)) <= @toDate
            ),
            prog_prev AS (
              SELECT pdo_well_id,
                     COALESCE(TRY_CAST(over_all_progress_percentages AS FLOAT), 0) AS prev_prog
              FROM (
                SELECT pdo_well_id, over_all_progress_percentages,
                       ROW_NUMBER() OVER (PARTITION BY pdo_well_id ORDER BY
                           COALESCE(TRY_CONVERT(DATE, Week_Number, 23),
                                    TRY_CONVERT(DATE, '20' + Week_Number, 23)) DESC) AS rn
                FROM [dbo].[WMR] WITH (NOLOCK)
                WHERE pdo_well_id IS NOT NULL AND pdo_well_id <> ''
              ) r WHERE r.rn = 2
            ),
            SapPlan AS (
              SELECT Well_ID,
                     MIN(TRY_CAST(Earl_start_date AS DATE))    AS plan_start,
                     MAX(TRY_CAST(EarliestEndDate AS DATE))    AS plan_end
              FROM [dbo].[SAP_DRILLING_SEQUENCE_History] WITH (NOLOCK)
              WHERE Well_ID IS NOT NULL AND Well_ID <> ''
              GROUP BY Well_ID
            )
            SELECT
              w.pdo_well_id                                                        AS WellId,
              w.well_location                                                      AS WellName,
              p.[Cluster]                AS Field,
              w.rig_no                                                             AS Rig,
              w.well_type                                                          AS WellType,
              ROUND(COALESCE(TRY_CAST(w.over_all_progress_percentages AS FLOAT), 0) * 100.0, 1) AS ProgressPct,
              CASE
                WHEN sap.plan_start IS NOT NULL AND sap.plan_end IS NOT NULL
                     AND DATEDIFF(day, sap.plan_start, sap.plan_end) > 0
                THEN ROUND(
                       CASE
                         WHEN CAST(DATEDIFF(day, sap.plan_start, @toDate) AS FLOAT)
                              / DATEDIFF(day, sap.plan_start, sap.plan_end) < 0 THEN 0.0
                         WHEN CAST(DATEDIFF(day, sap.plan_start, @toDate) AS FLOAT)
                              / DATEDIFF(day, sap.plan_start, sap.plan_end) > 1 THEN 1.0
                         ELSE CAST(DATEDIFF(day, sap.plan_start, @toDate) AS FLOAT)
                              / DATEDIFF(day, sap.plan_start, sap.plan_end)
                       END * 100.0, 1)
                ELSE NULL
              END                                                                  AS PlannedPct,
              CASE
                WHEN COALESCE(TRY_CAST(w.over_all_progress_percentages AS FLOAT), 0) >= 1.0 THEN 'completed'
                WHEN COALESCE(TRY_CAST(w.over_all_progress_percentages AS FLOAT), 0) < 1.0
                     AND EXISTS (
                       SELECT 1 FROM [dbo].[WMR_TaskPlan_csv_imported] WITH (NOLOCK)
                       WHERE CAST([New_Well_ID]    AS NVARCHAR(200)) = w.pdo_well_id
                         AND CAST([Resume_Suspend] AS NVARCHAR(50))  = 'Suspend'
                     ) THEN 'suspended'
                WHEN COALESCE(TRY_CAST(w.over_all_progress_percentages AS FLOAT), 0) > 0 THEN 'inprogress'
                ELSE 'pending'
              END                                                                  AS DwcCategory,
              CASE
                WHEN COALESCE(TRY_CAST(w.over_all_progress_percentages AS FLOAT), 0) >= 1.0 THEN 'COMPLETED'
                WHEN COALESCE(TRY_CAST(w.over_all_progress_percentages AS FLOAT), 0) > 0    THEN 'ACTIVE'
                ELSE 'PLANNED'
              END                                                                  AS Status,
              w.[location_preparation_status_in_progress_completed]               AS LocPrepStatus,
              ROUND(COALESCE(TRY_CAST(w.ohl_progress AS FLOAT), 0) * 100.0, 1)   AS DrillingPct,
              w.[flow_line_commi._status_in_progress_completed]                   AS CommStatus,
              w.[flow_line_const._status_in_progress_completed]                   AS ConstrStatus,
              ROUND(COALESCE(TRY_CAST(w.[overall_const._10_100] AS FLOAT), 0) * 100.0, 1) AS ConstrPct,
              ROUND(COALESCE(TRY_CAST(w.overall_comm_progress_100 AS FLOAT), 0) * 100.0, 1) AS CommProgress,
              TRY_CAST(w.actual_rig_on_date AS DATE)                              AS RigBy,
              TRY_CAST(w.actual_rig_off_date AS DATE)                             AS RigTo
            FROM LatestSnapshot w
            LEFT JOIN prog_prev pw ON pw.pdo_well_id = w.pdo_well_id
            LEFT JOIN SapPlan sap ON sap.Well_ID = w.pdo_well_id
            LEFT JOIN (
              SELECT ID, MIN([Cluster]) AS [Cluster]
              FROM [dbo].[ProjectIDs] WITH (NOLOCK)
              GROUP BY ID
            ) p ON w.project_id = p.ID
            {wellTypeJoin}
            WHERE w.rn = 1
              AND w.actual_rig_off_date IS NOT NULL
              {extraWhere}
            ORDER BY DwcCategory, w.pdo_well_id;
            """;

        await using var conn = new SqlConnection(cs);
        await conn.OpenAsync(ct);
        await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 60 };
        cmd.Parameters.AddWithValue("@fromDate", fromDate.ToDateTime(TimeOnly.MinValue));
        cmd.Parameters.AddWithValue("@toDate",   toDate.ToDateTime(TimeOnly.MaxValue));
        if (!string.IsNullOrWhiteSpace(wellId))
            cmd.Parameters.AddWithValue("@wellId",   wellId);
        if (!string.IsNullOrWhiteSpace(cluster))
            cmd.Parameters.AddWithValue("@cluster",  cluster);
        if (!string.IsNullOrWhiteSpace(wellType))
            cmd.Parameters.AddWithValue("@wellType", wellType);

        await using var rdr = await cmd.ExecuteReaderAsync(ct);
        var results = new List<object>();
        while (await rdr.ReadAsync(ct))
        {
            var prog      = rdr.IsDBNull(5)  ? 0.0          : Convert.ToDouble(rdr.GetValue(5));
            var planned   = rdr.IsDBNull(6)  ? (double?)null : Convert.ToDouble(rdr.GetValue(6));
            var variance  = planned.HasValue  ? Math.Round(prog - planned.Value, 1) : (double?)null;
            var spi       = planned.HasValue && planned.Value > 0
                            ? Math.Round(Math.Min(Math.Max(prog / planned.Value, 0.40), 1.20), 2)
                            : (double?)null;
            var cpi       = spi.HasValue
                            ? Math.Round(Math.Min(Math.Max(0.85 + (spi.Value - 0.85) * 0.6, 0.65), 1.05), 2)
                            : (double?)null;

            results.Add(new
            {
                wellId        = rdr.IsDBNull(0)  ? ""    : rdr.GetValue(0).ToString(),
                wellName      = rdr.IsDBNull(1)  ? null  : rdr.GetValue(1).ToString(),
                field         = rdr.IsDBNull(2)  ? null  : rdr.GetValue(2).ToString(),
                rig           = rdr.IsDBNull(3)  ? null  : rdr.GetValue(3).ToString(),
                wellType      = rdr.IsDBNull(4)  ? null  : rdr.GetValue(4).ToString(),
                progressPct   = prog,
                plannedPct    = planned,
                variance,
                ratePerDay    = (double?)null,
                askRate       = 7.0,
                gapPerDay     = (double?)null,
                spi,
                cpi,
                dwcCategory   = rdr.IsDBNull(7)  ? "suspended" : rdr.GetValue(7).ToString(),
                status        = rdr.IsDBNull(8)  ? "PLANNED"  : rdr.GetValue(8).ToString(),
                odcCategory   = "drilled",
                locPrepStatus = rdr.IsDBNull(9)  ? null  : rdr.GetValue(9).ToString(),
                drillingPct   = rdr.IsDBNull(10) ? 0.0   : Convert.ToDouble(rdr.GetValue(10)),
                commStatus    = rdr.IsDBNull(11) ? null  : rdr.GetValue(11).ToString(),
                constrStatus  = rdr.IsDBNull(12) ? null  : rdr.GetValue(12).ToString(),
                constrPct     = rdr.IsDBNull(13) ? 0.0   : Convert.ToDouble(rdr.GetValue(13)),
                commProgress  = rdr.IsDBNull(14) ? 0.0   : Convert.ToDouble(rdr.GetValue(14)),
                rigBy         = rdr.IsDBNull(15) ? null  : rdr.GetValue(15).ToString(),
                rigTo         = rdr.IsDBNull(16) ? null  : rdr.GetValue(16).ToString()
            });
        }
        return Ok(results);
    }

    /// <summary>
    /// Due Wells individual rows � same filter logic as due-wells-completion KPI tiles so counts match.
    /// Due Wells logic: Week_Number BETWEEN from/to AND Week_Number &gt; actual_rig_on_date AND progress &gt; 0.
    /// Returns one row per well categorised as completed/inprogress/pending.
    /// GET /dashboard/due-wells-list?cluster=MARMUL&amp;from=2026-01-01&amp;to=2026-12-31
    /// </summary>
    [HttpGet("due-wells-list")]
    public async Task<IActionResult> DueWellsList(
        [FromQuery] string? cluster  = null,
        [FromQuery] string? wellId   = null,
        [FromQuery] string? wellType = null,
        [FromQuery] string? site     = null,
        [FromQuery] string? project  = null,
        [FromQuery] DateOnly? from   = null,
        [FromQuery] DateOnly? to     = null,
        CancellationToken ct = default)
    {
        var cs = configuration.GetConnectionString("Default")
            ?? throw new InvalidOperationException("ConnectionStrings:Default not configured.");

        var fromDate = from ?? new DateOnly(DateTime.Today.Year, 1, 1);
        var toDate   = to   ?? new DateOnly(DateTime.Today.Year, 12, 31);
        // No cap at today — use full year-end date so listing matches the widget totals

        // wellId filter stays in LatestPerWell — single-well lookup, no dedup issue.
        var wellIdWhere = "";
        if (!string.IsNullOrWhiteSpace(wellId))
            wellIdWhere += " AND w.pdo_well_id = @wellId";

        // Project/cluster/site filter applied AFTER rn=1 dedup to prevent double-counting wells
        // that have WMR rows in multiple projects. Uses CTE column 'project_id' (no 'w.' alias).
        var postWhere = "";
        // Combine all ProjectIDs filters into a single EXISTS � same pattern as GetDueWellsCompletionAsync.
        var pidConditions = new System.Collections.Generic.List<string>();
        if (!string.IsNullOrWhiteSpace(cluster))  pidConditions.Add("LTRIM(RTRIM(p.[Cluster])) = @cluster");
        if (!string.IsNullOrWhiteSpace(wellType)) pidConditions.Add("LTRIM(RTRIM(p.[Type]))    = @wellType");
        if (!string.IsNullOrWhiteSpace(site))     pidConditions.Add("LTRIM(RTRIM(p.[Site]))    = @site");
        if (!string.IsNullOrWhiteSpace(project))  pidConditions.Add("LTRIM(RTRIM(p.[Project])) = @project");
        if (pidConditions.Count > 0)
            postWhere += $" AND EXISTS (SELECT 1 FROM [dbo].[ProjectIDs] p WITH (NOLOCK) WHERE CAST(p.ID AS NVARCHAR(100)) = project_id AND {string.Join(" AND ", pidConditions)})";

        var wellTypeJoin = ""; // filters use EXISTS subquery above; no join needed inside CTE

        // Due Wells listing SQL � uses EXACT same CTE logic as GetDueWellsCompletionAsync:
        //   LatestPerWell: most-recent WMR row per well where Week_Number BETWEEN @fromDate AND @toDate
        //   DueWells: wells where Week_Number > actual_rig_on_date AND progress > 0
        // SAP_DRILLING_SEQUENCE_History is joined (same as drilled-wells-list) to compute PlannedPct.
        // The Due Wells filter logic is kept; only the column data matches drilled wells.
        var sql = $"""
            ;WITH LatestPerWell AS (
                SELECT
                    w.pdo_well_id,
                    w.over_all_progress_percentages,
                    w.Week_Number,
                    w.actual_rig_on_date,
                    w.actual_rig_off_date,
                    w.rig_no,
                    w.well_location,
                    w.well_type,
                    w.project_id,
                    TRY_CAST(w.[flaf_issue_date] AS DATE)                                           AS flaf_date,
                    TRY_CAST(w.[scr_date] AS DATE)                                                  AS scr_date,
                    TRY_CAST(w.[wellpad_handover-2_from_hoist_fbu_rsr_off_date] AS DATE)            AS handover_date,
                    TRY_CAST(w.[actual_comm._finish_date_with_in_2_days_from_actual_engg._completion_date] AS DATE) AS actual_comm_date,
                    w.[location_preparation_status_in_progress_completed]                           AS loc_status,
                    w.[flow_line_commi._status_in_progress_completed]                               AS comm_status,
                    w.[flow_line_const._status_in_progress_completed]                               AS constr_status,
                    w.ohl_progress,
                    w.[overall_const._10_100]                                                       AS constr_pct_raw,
                    w.overall_comm_progress_100                                                     AS comm_prog_raw,
                    ROW_NUMBER() OVER (
                        PARTITION BY w.pdo_well_id
                        ORDER BY COALESCE(TRY_CONVERT(DATE, w.Week_Number, 23),
                                          TRY_CONVERT(DATE, '20' + w.Week_Number, 23)) DESC,
                                 w.project_id DESC
                    ) AS rn
                FROM [dbo].[WMR] w WITH (NOLOCK)
                WHERE w.pdo_well_id IS NOT NULL AND w.pdo_well_id <> ''
                  AND COALESCE(TRY_CONVERT(DATE, w.Week_Number, 23),
                               TRY_CONVERT(DATE, '20' + w.Week_Number, 23)) IS NOT NULL
                  AND COALESCE(TRY_CONVERT(DATE, w.Week_Number, 23),
                               TRY_CONVERT(DATE, '20' + w.Week_Number, 23)) BETWEEN @fromDate AND @toDate
                  {wellIdWhere}
            ),
            prog_prev AS (
                SELECT pdo_well_id,
                       COALESCE(TRY_CAST(over_all_progress_percentages AS FLOAT), 0) AS prev_prog
                FROM (
                    SELECT pdo_well_id, over_all_progress_percentages,
                           ROW_NUMBER() OVER (PARTITION BY pdo_well_id ORDER BY Week_Number DESC) AS rn
                    FROM [dbo].[WMR] WITH (NOLOCK)
                    WHERE pdo_well_id IS NOT NULL AND pdo_well_id <> ''
                ) r WHERE r.rn = 2
            ),
            SapPlan AS (
                SELECT Well_ID,
                       MIN(TRY_CAST(Earl_start_date AS DATE)) AS plan_start,
                       MAX(TRY_CAST(EarliestEndDate AS DATE)) AS plan_end
                FROM [dbo].[SAP_DRILLING_SEQUENCE_History] WITH (NOLOCK)
                WHERE Well_ID IS NOT NULL AND Well_ID <> ''
                GROUP BY Well_ID
            ),
            DueDateCalc AS (
                SELECT
                    pdo_well_id,
                    COALESCE(TRY_CAST(over_all_progress_percentages AS FLOAT), 0)  AS progress,
                    COALESCE(actual_comm_date, CAST(@toDate AS DATE))               AS eff_comm_date,
                    (SELECT MAX(d) FROM (VALUES
                        (DATEADD(DAY, 90, flaf_date)),
                        (DATEADD(DAY, 90, scr_date)),
                        (DATEADD(DAY,  5, TRY_CAST(actual_rig_off_date AS DATE))),
                        (DATEADD(DAY,  2, handover_date))
                    ) AS v(d)) AS due_date
                FROM LatestPerWell
                WHERE rn = 1{postWhere}
            ),
            DueWells AS (
                SELECT pdo_well_id, progress
                FROM DueDateCalc
                WHERE due_date IS NOT NULL
                  AND eff_comm_date > due_date
            ),
            SuspendedDueWells AS (
                SELECT DISTINCT CAST(t.[New_Well_ID] AS NVARCHAR(200)) AS pdo_well_id
                FROM [dbo].[WMR_TaskPlan_csv_imported] t WITH (NOLOCK)
                WHERE CAST(t.[Resume_Suspend] AS NVARCHAR(50)) = 'Suspend'
                  AND CAST(t.[New_Well_ID] AS NVARCHAR(200)) IN (
                      SELECT pdo_well_id FROM DueWells WHERE progress < 1.0
                  )
            )
            SELECT
              lpw.pdo_well_id                                                              AS WellId,
              lpw.well_location                                                            AS WellName,
              p.[Cluster]                        AS Field,
              lpw.rig_no                                                                   AS Rig,
              lpw.well_type                                                                AS WellType,
              ROUND(COALESCE(TRY_CAST(lpw.over_all_progress_percentages AS FLOAT), 0) * 100.0, 1) AS ProgressPct,
              CASE
                WHEN sap.plan_start IS NOT NULL AND sap.plan_end IS NOT NULL
                     AND DATEDIFF(day, sap.plan_start, sap.plan_end) > 0
                THEN ROUND(
                       CASE
                         WHEN CAST(DATEDIFF(day, sap.plan_start, @toDate) AS FLOAT)
                              / DATEDIFF(day, sap.plan_start, sap.plan_end) < 0 THEN 0.0
                         WHEN CAST(DATEDIFF(day, sap.plan_start, @toDate) AS FLOAT)
                              / DATEDIFF(day, sap.plan_start, sap.plan_end) > 1 THEN 1.0
                         ELSE CAST(DATEDIFF(day, sap.plan_start, @toDate) AS FLOAT)
                              / DATEDIFF(day, sap.plan_start, sap.plan_end)
                       END * 100.0, 1)
                ELSE NULL
              END                                                                          AS PlannedPct,
              CASE
                WHEN COALESCE(TRY_CAST(lpw.over_all_progress_percentages AS FLOAT), 0) >= 1.0 THEN 'completed'
                WHEN s.pdo_well_id IS NOT NULL THEN 'suspended'
                WHEN COALESCE(TRY_CAST(lpw.over_all_progress_percentages AS FLOAT), 0) > 0 THEN 'inprogress'
                ELSE 'pending'
              END                                                                          AS DwcCategory,
              CASE
                WHEN COALESCE(TRY_CAST(lpw.over_all_progress_percentages AS FLOAT), 0) >= 1.0 THEN 'COMPLETED'
                WHEN COALESCE(TRY_CAST(lpw.over_all_progress_percentages AS FLOAT), 0) > 0    THEN 'ACTIVE'
                ELSE 'PLANNED'
              END                                                                          AS Status,
              lpw.loc_status                                                               AS LocPrepStatus,
              ROUND(COALESCE(TRY_CAST(lpw.ohl_progress AS FLOAT), 0) * 100.0, 1)         AS DrillingPct,
              lpw.comm_status                                                              AS CommStatus,
              lpw.constr_status                                                            AS ConstrStatus,
              ROUND(COALESCE(TRY_CAST(lpw.constr_pct_raw AS FLOAT), 0) * 100.0, 1)       AS ConstrPct,
              ROUND(COALESCE(TRY_CAST(lpw.comm_prog_raw  AS FLOAT), 0) * 100.0, 1)       AS CommProgress,
              TRY_CAST(lpw.actual_rig_on_date  AS DATE)                                   AS RigBy,
              TRY_CAST(lpw.actual_rig_off_date AS DATE)                                   AS RigTo
            FROM LatestPerWell lpw
            INNER JOIN DueWells dw        ON dw.pdo_well_id = lpw.pdo_well_id
            LEFT  JOIN SuspendedDueWells s ON s.pdo_well_id  = lpw.pdo_well_id
            LEFT  JOIN prog_prev pw        ON pw.pdo_well_id = lpw.pdo_well_id
            LEFT  JOIN SapPlan sap         ON sap.Well_ID    = lpw.pdo_well_id
            LEFT JOIN (
              SELECT ID, MIN([Cluster]) AS [Cluster]
              FROM [dbo].[ProjectIDs] WITH (NOLOCK)
              GROUP BY ID
            ) p ON lpw.project_id = p.ID
            WHERE lpw.rn = 1
            ORDER BY DwcCategory, lpw.pdo_well_id;
            """;

        await using var conn = new SqlConnection(cs);
        await conn.OpenAsync(ct);
        await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 60 };
        cmd.Parameters.AddWithValue("@fromDate", fromDate.ToDateTime(TimeOnly.MinValue));
        cmd.Parameters.AddWithValue("@toDate",   toDate.ToDateTime(TimeOnly.MaxValue));
        if (!string.IsNullOrWhiteSpace(wellId))   cmd.Parameters.AddWithValue("@wellId",   wellId);
        if (!string.IsNullOrWhiteSpace(cluster))  cmd.Parameters.AddWithValue("@cluster",  cluster);
        if (!string.IsNullOrWhiteSpace(wellType)) cmd.Parameters.AddWithValue("@wellType", wellType);
        if (!string.IsNullOrWhiteSpace(site))     cmd.Parameters.AddWithValue("@site",     site);
        if (!string.IsNullOrWhiteSpace(project))  cmd.Parameters.AddWithValue("@project",  project);

        await using var rdr = await cmd.ExecuteReaderAsync(ct);
        var results = new List<object>();
        while (await rdr.ReadAsync(ct))
        {
            var prog    = rdr.IsDBNull(5) ? 0.0           : Convert.ToDouble(rdr.GetValue(5));
            var planned = rdr.IsDBNull(6) ? (double?)null : Convert.ToDouble(rdr.GetValue(6));
            var variance = planned.HasValue ? Math.Round(prog - planned.Value, 1) : (double?)null;
            var spi      = planned.HasValue && planned.Value > 0
                           ? Math.Round(Math.Min(Math.Max(prog / planned.Value, 0.40), 1.20), 2)
                           : (double?)null;
            var cpi      = spi.HasValue
                           ? Math.Round(Math.Min(Math.Max(0.85 + (spi.Value - 0.85) * 0.6, 0.65), 1.05), 2)
                           : (double?)null;

            results.Add(new
            {
                wellId        = rdr.IsDBNull(0)  ? ""    : rdr.GetValue(0).ToString(),
                wellName      = rdr.IsDBNull(1)  ? null  : rdr.GetValue(1).ToString(),
                field         = rdr.IsDBNull(2)  ? null  : rdr.GetValue(2).ToString(),
                rig           = rdr.IsDBNull(3)  ? null  : rdr.GetValue(3).ToString(),
                wellType      = rdr.IsDBNull(4)  ? null  : rdr.GetValue(4).ToString(),
                progressPct   = prog,
                plannedPct    = planned,
                variance,
                ratePerDay    = (double?)null,
                askRate       = 7.0,
                gapPerDay     = (double?)null,
                spi,
                cpi,
                dwcCategory   = rdr.IsDBNull(7)  ? "suspended" : rdr.GetValue(7).ToString(),
                status        = rdr.IsDBNull(8)  ? "PLANNED"  : rdr.GetValue(8).ToString(),
                locPrepStatus = rdr.IsDBNull(9)  ? null  : rdr.GetValue(9).ToString(),
                drillingPct   = rdr.IsDBNull(10) ? 0.0   : Convert.ToDouble(rdr.GetValue(10)),
                commStatus    = rdr.IsDBNull(11) ? null  : rdr.GetValue(11).ToString(),
                constrStatus  = rdr.IsDBNull(12) ? null  : rdr.GetValue(12).ToString(),
                constrPct     = rdr.IsDBNull(13) ? 0.0   : Convert.ToDouble(rdr.GetValue(13)),
                commProgress  = rdr.IsDBNull(14) ? 0.0   : Convert.ToDouble(rdr.GetValue(14)),
                rigBy         = rdr.IsDBNull(15) ? null  : rdr.GetValue(15).ToString(),
                rigTo         = rdr.IsDBNull(16) ? null  : rdr.GetValue(16).ToString()
            });
        }
        return Ok(results);
    }

    /// <summary>
    /// Drilled Wells Commissioning Breakdown � commissioned, backlog in commissioning, suspended wells.
    /// GET /dashboard/drilled-wells-breakdown?cluster=MARMUL&amp;from=2026-01-01&amp;to=2026-12-31
    /// </summary>
    [HttpGet("drilled-wells-breakdown")]
    public async Task<ActionResult<DrilledWellsBreakdownDto>> DrilledWellsBreakdown(
        [FromQuery] string? cluster = null,
        [FromQuery] string? wellId = null,
        [FromQuery] string? project = null,
        [FromQuery] DateOnly? from = null,
        [FromQuery] DateOnly? to = null,
        CancellationToken ct = default)
        => Ok(await mediator.Send(new GetDrilledWellsBreakdownQuery(cluster, wellId, project, from, to), ct));

    /// <summary>
    /// Completed-wells % for the selected period vs the equivalent previous period.
    /// Accepts either from/to (preferred, forwarded from global date filter) or year/asOfDate (legacy).
    /// GET /dashboard/drilled-wells-ytd-completion?from=2026-01-01&amp;to=2026-06-17
    /// </summary>
    [HttpGet("drilled-wells-ytd-completion")]
    public async Task<ActionResult<DrilledWellsYtdCompletionDto>> DrilledWellsYtdCompletion(
        [FromQuery] DateOnly? from = null,
        [FromQuery] DateOnly? to = null,
        [FromQuery] int? year = null,
        [FromQuery] DateOnly? asOfDate = null,
        [FromQuery] string? cluster = null,
        [FromQuery] string? wellId = null,
        [FromQuery] string? project = null,
        [FromQuery] string? wellType = null,
        [FromQuery] string? site = null,
        CancellationToken ct = default)
        => Ok(await mediator.Send(new GetDrilledWellsYtdCompletionQuery(from, to, year, asOfDate, cluster, wellId, project, wellType, site), ct));

    /// <summary>
    /// Due Wells Completion KPI � wells with rig-on date in the selected period.
    /// GET /dashboard/due-wells-completion?cluster=MARMUL&amp;location=X&amp;wellId=Y&amp;from=2026-01-01&amp;to=2026-12-31
    /// </summary>
    [HttpGet("due-wells-completion")]
    public async Task<ActionResult<DueWellsCompletionDto>> DueWellsCompletion(
        [FromQuery] string? cluster = null,
        [FromQuery] string? location = null,
        [FromQuery] string? site = null,
        [FromQuery] string? project = null,
        [FromQuery] string? wellId = null,
        [FromQuery] DateOnly? from = null,
        [FromQuery] DateOnly? to = null,
        CancellationToken ct = default)
        => Ok(await mediator.Send(new GetDueWellsCompletionQuery(cluster, location, site, project, wellId, from, to), ct));

    /// <summary>
    /// Due Wells Completion Trend � groups wells by the month they first reached 100% progress.
    /// Separate from the tile/donut/breakdown API; does not affect KPI counts.
    /// GET /dashboard/due-wells-completion-trend?cluster=MARMUL&amp;from=2026-01-01&amp;to=2026-12-31
    /// </summary>
    [HttpGet("due-wells-completion-trend")]
    public async Task<ActionResult<DueWellsCompletionTrendDto>> DueWellsCompletionTrend(
        [FromQuery] string? cluster = null,
        [FromQuery] string? location = null,
        [FromQuery] string? site = null,
        [FromQuery] string? project = null,
        [FromQuery] string? wellId = null,
        [FromQuery] DateOnly? from = null,
        [FromQuery] DateOnly? to = null,
        CancellationToken ct = default)
        => Ok(await mediator.Send(new GetDueWellsCompletionTrendQuery(cluster, location, site, project, wellId, from, to), ct));

    [HttpGet("wells-list")]
    public async Task<ActionResult<IReadOnlyList<WmrWellDto>>> WellsList(
        [FromQuery] string? cluster,
        [FromQuery] string? wellId,
        [FromQuery] string? status,
        [FromQuery] string? wrFilter,
        [FromQuery] int? planYear,
        [FromQuery] bool thisMonth = false,
        [FromQuery] DateOnly? from = null,
        [FromQuery] DateOnly? to = null,
        [FromQuery] DateOnly? asOfDate = null,
        CancellationToken ct = default)
        => Ok(await mediator.Send(
            new GetWmrWellsQuery(cluster, wellId, status, from, to, thisMonth, wrFilter, planYear, asOfDate), ct));

    /// <summary>
    /// Paginated wells readiness overview for drill-down pages.
    /// GET /dashboard/wells-readiness-overview?planYear=2026&amp;wrFilter=flafscr&amp;page=1&amp;pageSize=50
    /// Returns total count alongside the page items so the UI can verify counts match the KPI.
    /// </summary>
    [HttpGet("wells-readiness-overview")]
    public async Task<ActionResult<WmrWellsPageDto>> WellsListPaged(
        [FromQuery] string? cluster,
        [FromQuery] string? wellId,
        [FromQuery] string? status,
        [FromQuery] string? wrFilter,
        [FromQuery] int? planYear,
        [FromQuery] bool thisMonth = false,
        [FromQuery] DateOnly? from = null,
        [FromQuery] DateOnly? to = null,
        [FromQuery] DateOnly? fromDate = null,
        [FromQuery] DateOnly? toDate = null,
        [FromQuery] DateOnly? asOfDate = null,
        [FromQuery] string? wellType = null,
        [FromQuery] string? project = null,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50,
        CancellationToken ct = default)
    {
        // Accept both "from"/"to" and "fromDate"/"toDate" query param conventions.
        var effectiveFrom = from ?? fromDate;
        var effectiveTo = to ?? toDate;

        // Always route through the funnel logic so drilldown counts match the WR funnel.
        // "plan" triggers the else branch in GetWmrWellsByFunnelLogicAsync (no category filter = show all).
        var effectiveWrFilter = wrFilter ?? (effectiveFrom.HasValue && effectiveTo.HasValue ? "plan" : null);

        var all = await mediator.Send(
            new GetWmrWellsQuery(cluster, wellId, status, effectiveFrom, effectiveTo, thisMonth, effectiveWrFilter, planYear, asOfDate, WellType: wellType, Project: project), ct);
        var totalCount = all.Count;
        var items = all.Skip((page - 1) * pageSize).Take(pageSize).ToList();
        return Ok(new WmrWellsPageDto(items, page, pageSize, totalCount));
    }

    [HttpGet("wells-status-list")]
    public async Task<ActionResult<IReadOnlyList<WellStatusListDto>>> WellsStatusList(
        [FromQuery] string? cluster,
        [FromQuery] string? site = null,
        [FromQuery] string? wellType = null,
        [FromQuery] string? project = null,
        [FromQuery] DateOnly? from = null,
        [FromQuery] DateOnly? to = null,
        [FromQuery] string? commStatus = null,
        [FromQuery] DateOnly? commFrom = null,
        [FromQuery] DateOnly? commTo = null,
        [FromQuery] bool bufferReady = false,
        [FromQuery] string? peggingBucket = null,
        [FromQuery] bool wlaMode = false,
        CancellationToken ct = default)
        => Ok(await mediator.Send(
            new GetWellStatusListQuery(cluster, site, wellType, project, from, to, commStatus, commFrom, commTo, bufferReady, peggingBucket, wlaMode), ct));

    [HttpGet("activities-progress")]
    public async Task<ActionResult<ActivitiesProgressResponse>> ActivitiesProgress(
        [FromQuery] string odc = "all",
        [FromQuery] string? cluster = null,
        [FromQuery] string? projectId = null,
        [FromQuery] string? scheduleId = null,
        [FromQuery] string? wellId = null,
        [FromQuery] DateTime? startDate = null,
        [FromQuery] DateTime? endDate = null,
        CancellationToken ct = default)
    {
        var result = await mediator.Send(
            new GetActivitiesProgressQuery(odc, cluster, projectId, scheduleId, wellId, startDate, endDate), ct);

        return Ok(new ActivitiesProgressResponse(
            Data: result,
            Filters: new ActivitiesProgressFilters(odc, cluster, projectId, scheduleId, wellId, startDate, endDate)
        ));
    }

    /// <summary>
    /// GET /dashboard/activities-list
    /// Returns paginated individual activity task rows matching the same filters as activities-progress.
    /// Summary counts are guaranteed to match the KPI card.
    /// </summary>
    [HttpGet("activities-list")]
    public async Task<ActionResult<ActivitiesListResponse>> ActivitiesList(
        [FromQuery] string odc = "all",
        [FromQuery] string? cluster = null,
        [FromQuery] string? wellId = null,
        [FromQuery] DateTime? startDate = null,
        [FromQuery] DateTime? endDate = null,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50,
        CancellationToken ct = default)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 200);
        return Ok(await mediator.Send(
            new GetActivitiesListQuery(odc, cluster, wellId, startDate, endDate, page, pageSize), ct));
    }

    /// <summary>
    /// Paginated well table (WMR data) � fast, WMR-only query.
    /// Activity/crew columns are populated by a separate per-well endpoint to avoid
    /// a full-table scan on ActivityTaskPlan (no index on Well_ID).
    /// GET /dashboard/get/well?page=1&amp;pageSize=20&amp;cluster=NIMR&amp;status=At+Risk&amp;search=36078
    /// </summary>
    [HttpGet("get/well")]
    public async Task<IActionResult> GetWells(
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20,
        [FromQuery] string? cluster = null,
        [FromQuery] string? status = null,
        [FromQuery] string? search = null,
        CancellationToken ct = default)
    {
        if (page < 1) page = 1;
        if (pageSize < 1 || pageSize > 200) pageSize = 20;
        int skip = (page - 1) * pageSize;

        // WHERE clauses � WMR only (no ActivityTaskPlan join to avoid full-table scan)
        var filters = new List<string> { "LTRIM(RTRIM(ISNULL(pdo_well_id, ''))) != ''" };
        if (!string.IsNullOrWhiteSpace(cluster)) filters.Add("station_name_no = @cluster");
        if (!string.IsNullOrWhiteSpace(status))  filters.Add("buffer_status   = @status");
        if (!string.IsNullOrWhiteSpace(search))
            filters.Add("(pdo_well_id LIKE @search OR well_location LIKE @search OR station_name_no LIKE @search)");

        var whereClause = string.Join(" AND ", filters);

        // COUNT distinct wells (WMR has duplicate rows per well)
        var countSql = $"SELECT COUNT(DISTINCT pdo_well_id) FROM dbo.WMR WITH (NOLOCK) WHERE {whereClause}";

        // Deduplicate WMR by pdo_well_id (take first row per well), then paginate
        var dataSql = $"""
            WITH Deduped AS (
                SELECT
                    pdo_well_id,
                    station_name_no,
                    well_location,
                    well_type,
                    over_all_progress_percentages,
                    actual_rig_on_date,
                    buffer_status,
                    ROW_NUMBER() OVER (PARTITION BY pdo_well_id ORDER BY pdo_well_id) AS rn
                FROM dbo.WMR WITH (NOLOCK)
                WHERE {whereClause}
            )
            SELECT
                pdo_well_id                                                                              AS WellId,
                ISNULL(station_name_no, '')                                                              AS Cluster,
                ISNULL(well_location,   '')                                                              AS Location,
                ISNULL(well_type,       '')                                                              AS WellType,
                ROUND(
                    ISNULL(TRY_CAST(
                        REPLACE(REPLACE(ISNULL(over_all_progress_percentages,'0'),'%',''),' ','')
                    AS FLOAT), 0.0) * 100.0, 1)                                                          AS Progress,
                ISNULL(CONVERT(VARCHAR(20), TRY_CAST(actual_rig_on_date AS DATE), 106), '')              AS RigOn,
                ISNULL(buffer_status, '')                                                                 AS Status
            FROM Deduped
            WHERE rn = 1
            ORDER BY pdo_well_id
            OFFSET {skip} ROWS FETCH NEXT {pageSize} ROWS ONLY
            """;

        var cs = configuration.GetConnectionString("Default")
            ?? throw new InvalidOperationException("ConnectionStrings:Default not configured.");

        // Always create a fresh connection � never reuse a connection that may be
        // left open/zombie from a previous timed-out request.
        await using var conn = new SqlConnection(cs);
        await conn.OpenAsync(ct);

        // COUNT � 30 s timeout (simple WMR scan, ~1800 rows)
        int total;
        await using (var cmd = new SqlCommand(countSql, conn) { CommandTimeout = 30 })
        {
            BindParams(cmd, cluster, status, search);
            total = Convert.ToInt32(await cmd.ExecuteScalarAsync(ct));
        }

        // DATA � 30 s timeout (WMR only, indexed ORDER BY + OFFSET/FETCH)
        var data = new List<Dictionary<string, object?>>();
        await using (var cmd = new SqlCommand(dataSql, conn) { CommandTimeout = 30 })
        {
            BindParams(cmd, cluster, status, search);
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                var row = new Dictionary<string, object?>();
                for (int i = 0; i < reader.FieldCount; i++)
                    row[reader.GetName(i)] = reader.IsDBNull(i) ? null : reader.GetValue(i);
                data.Add(row);
            }
        }

        return Ok(new
        {
            total,
            page,
            pageSize,
            totalPages = total == 0 ? 0 : (int)Math.Ceiling((double)total / pageSize),
            data
        });
    }

    private static void BindParams(SqlCommand cmd,
        string? cluster, string? status, string? search)
    {
        if (!string.IsNullOrWhiteSpace(cluster))
            cmd.Parameters.AddWithValue("@cluster", cluster);
        if (!string.IsNullOrWhiteSpace(status))
            cmd.Parameters.AddWithValue("@status", status);
        if (!string.IsNullOrWhiteSpace(search))
            cmd.Parameters.AddWithValue("@search", $"%{search}%");
    }
    /// Returns Critical Dates Timeline rows (paginated).
    /// page=1 (1-based), pageSize=50 (max 200).
    /// </summary>
    [HttpGet("critical-dates-timeline")]
    public async Task<ActionResult<CriticalDatesTimelinePageDto>> CriticalDatesTimeline(
        [FromQuery] int       page     = 1,
        [FromQuery] int       pageSize = 50,
        [FromQuery] string?   cluster  = null,
        [FromQuery] string?   site     = null,
        [FromQuery] string?   wellId   = null,
        [FromQuery] DateOnly? from     = null,
        [FromQuery] DateOnly? to       = null,
        [FromQuery] string?   wellType = null,
        CancellationToken ct = default)
    {
        page     = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 200);
        return Ok(await mediator.Send(new GetCriticalDatesTimelineQuery(page, pageSize, cluster, site, wellId, from, to, wellType), ct));
    }

    /// <summary>
    /// Target Finish Timeline � still-open wells bucketed by how close/overdue their
    /// ActivityTaskPlan target-finish date is. Honors cluster / well-type / well-id.
    /// GET /dashboard/target-finish-timeline
    /// </summary>
    [HttpGet("target-finish-timeline")]
    public async Task<ActionResult<TargetFinishTimelineDto>> TargetFinishTimeline(
        [FromQuery] string?   cluster  = null,
        [FromQuery] string?   site     = null,
        [FromQuery] string?   wellType = null,
        [FromQuery] string?   wellId   = null,
        [FromQuery] DateOnly? from     = null,
        [FromQuery] DateOnly? to       = null,
        [FromQuery] int       take     = 50,
        CancellationToken ct = default)
    {
        take = Math.Clamp(take, 1, 200);
        return Ok(await mediator.Send(new GetTargetFinishTimelineQuery(cluster, site, wellType, wellId, from, to, take), ct));
    }

    /// <summary>
    /// Full detail for a single well.
    /// GET /dashboard/wells/{wellId}
    /// </summary>
    [HttpGet("wells/{wellId}")]
    public async Task<IActionResult> GetWellDetail(string wellId, CancellationToken ct)
    {
        var dto = await mediator.Send(new GetWellDetailQuery(wellId), ct);
        if (dto is null) return NotFound();
        return Ok(dto);
    }

    /// <summary>
    /// Well Planner � per-well milestone/activity Gantt data.
    /// GET /dashboard/well-planner?cluster=NIMR&amp;from=2026-05-01&amp;to=2026-05-28
    /// </summary>
    [HttpGet("well-planner")]
    public async Task<ActionResult<WellPlannerResponseDto>> WellPlanner(
        [FromQuery] string?  cluster  = null,
        [FromQuery] string?  wellId   = null,
        [FromQuery] DateOnly? from    = null,
        [FromQuery] DateOnly? to      = null,
        CancellationToken ct = default)
        => Ok(await mediator.Send(new GetWellPlannerQuery(cluster, wellId, from, to), ct));

    /// <summary>
    /// Workload Analysis � monthly drilled and completed well counts by cluster.
    /// GET /dashboard/workload-analysis?from=2026-01-01&amp;to=2026-12-31&amp;cluster=nimr&amp;wellId=34565
    /// Defaults to full current year if no dates provided.
    /// </summary>
    [HttpGet("workload-analysis")]
    public async Task<ActionResult<WorkloadAnalysisResponse>> WorkloadAnalysis(
        [FromQuery] DateOnly? from = null,
        [FromQuery] DateOnly? to = null,
        [FromQuery] string? cluster = null,
        [FromQuery] string? wellId = null,
        [FromQuery] string? project = null,
        CancellationToken ct = default)
    {
        var year = DateTime.UtcNow.Year;
        var fromDate = from ?? new DateOnly(year, 1, 1);
        var toDate = to ?? new DateOnly(year, 12, 31);

        return Ok(await mediator.Send(new GetWorkloadAnalysisQuery(fromDate, toDate, cluster, wellId, project), ct));
    }

    /// <summary>Returns all clusters with their associated wells.</summary>
    [HttpGet("cluster-wells")]
    public async Task<ActionResult<IReadOnlyList<ClusterWellsDto>>> ClusterWells(CancellationToken ct)
    {
        if (_clusterWellsCache.Result != null && (DateTime.UtcNow - _clusterWellsCache.At).TotalHours < 6)
            return Ok(_clusterWellsCache.Result);

        var result = await mediator.Send(new GetClusterWellsQuery(), ct);
        _clusterWellsCache = (DateTime.UtcNow, result);
        return Ok(result);
    }

    /// <summary>Returns cluster-level health summary from WMR progress data.</summary>
    [HttpGet("cluster-health")]
    public async Task<ActionResult<ClusterHealthDto>> ClusterHealth([FromQuery] DateOnly? from, [FromQuery] DateOnly? to, [FromQuery] string? wellType, [FromQuery] string? cluster, [FromQuery] string? site, [FromQuery] string? project, CancellationToken ct)
        => Ok(await mediator.Send(new GetClusterHealthQuery(from, to, wellType, cluster, site, project), ct));

    /// <summary>Returns per-well progress grouped by cluster (from WMR).</summary>
    [HttpGet("cluster-wells-progress")]
    public async Task<ActionResult<IReadOnlyList<ClusterWellsProgressDto>>> ClusterWellsProgress([FromQuery] DateOnly? from, [FromQuery] DateOnly? to, [FromQuery] string? wellType, [FromQuery] string? project, CancellationToken ct)
        => Ok(await mediator.Send(new GetClusterWellsProgressQuery(from, to, wellType, project), ct));

    /// <summary>Returns top-level stages and their progress for a specific well (from ActivityTaskPlan).</summary>
    [HttpGet("well-stages/{wellId}")]
    public async Task<ActionResult<WellStagesDto>> WellStages(string wellId, [FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken ct)
        => Ok(await mediator.Send(new GetWellStagesQuery(wellId, from, to), ct));

    /// <summary>
    /// Returns the workgroups (type 'W') for a well with their child activities (type 'A')
    /// and a progress value averaged across each workgroup's activities. Drives the
    /// "Workgroup Progress" chart on the well detail page. Source: WMR_TaskPlan_csv_imported.
    /// </summary>
    [HttpGet("well-workgroups/{wellId}")]
    public async Task<ActionResult<WellWorkgroupsDto>> WellWorkgroups(string wellId, [FromQuery] string? projectId = null, CancellationToken ct = default)
        => Ok(await mediator.Send(new GetWellWorkgroupsQuery(wellId, projectId), ct));

    /// <summary>
    /// Returns distinct projects for a well from WMR_TaskPlan_csv_imported (via New_Well_ID).
    /// GET /dashboard/wells/{wellId}/projects
    /// </summary>
    [HttpGet("wells/{wellId}/projects")]
    public async Task<IActionResult> WellProjects(string wellId, CancellationToken ct)
    {
        var projects = await mediator.Send(new GetWellProjectsQuery(wellId), ct);
        return Ok(projects);
    }

    /// <summary>
    /// Returns ActivityTaskPlan rows where type is 'A' or 'M' � drives the
    /// Activity Gantt on the Well Execution Dashboard.
    /// GET /dashboard/activity-gantt
    /// </summary>
    [HttpGet("activity-gantt")]
    public async Task<ActionResult<IReadOnlyList<ActivityGanttRowDto>>> ActivityGantt(CancellationToken ct)
        => Ok(await mediator.Send(new GetActivityGanttQuery(), ct));

    /// <summary>
    /// Wells Readiness Overall Status funnel (Plan ? FLAF/SCR-cleaned ? PDO-cleaned ? Actual).
    /// GET /dashboard/wells-readiness?fromDate=2026-01-01&amp;toDate=2026-06-01&amp;cluster=NIMR
    /// <paramref name="fromDate"/> and <paramref name="toDate"/> are required.
    /// </summary>
    [HttpGet("wells-readiness")]
    public async Task<ActionResult<WellsReadinessDto>> WellsReadiness(
        [FromQuery] int? year = null,
        [FromQuery] DateOnly? asOfDate = null,
        [FromQuery] string? cluster = null,
        [FromQuery] DateOnly? fromDate = null,
        [FromQuery] DateOnly? toDate = null,
        [FromQuery] string? wellType = null,
        [FromQuery] string? project = null,
        CancellationToken ct = default)
        => Ok(await mediator.Send(new GetWellsReadinessQuery(year, asOfDate, cluster, fromDate, toDate, wellType, project), ct));

    /// <summary>
    /// Bulk endpoint: returns wells readiness for ALL well types in a single response.
    /// Use this instead of calling /wells-readiness N times with different wellType values.
    /// GET /dashboard/wells-readiness-by-type?fromDate=2026-03-06&amp;toDate=2026-06-03&amp;cluster=marmul
    /// </summary>
    [HttpGet("wells-readiness-by-type")]
    public async Task<ActionResult<WellsReadinessByTypeDto>> WellsReadinessByType(
        [FromQuery] DateOnly fromDate,
        [FromQuery] DateOnly toDate,
        [FromQuery] DateOnly? asOfDate = null,
        [FromQuery] string? cluster = null,
        [FromQuery] string? project = null,
        CancellationToken ct = default)
        => Ok(await mediator.Send(new GetWellsReadinessByTypeQuery(fromDate, toDate, asOfDate, cluster, project), ct));

    /// <summary>
    /// GET /dashboard/crew-p-rating-distribution?from=2026-01-01&amp;to=2026-12-31
    /// Returns crew count per P-Rating (P0-P8) ordered highest to lowest.
    /// Defaults to current year when no date range is provided.
    /// </summary>
    [HttpGet("crew-p-rating-distribution")]
    public async Task<ActionResult<IReadOnlyList<CrewPRatingDistributionDto>>> CrewPRatingDistribution(
        [FromQuery] string? cluster,
        [FromQuery] string? wellType,
        [FromQuery] string? site,
        [FromQuery] string? project,
        [FromQuery] DateOnly? from,
        [FromQuery] DateOnly? to,
        CancellationToken ct)
        => Ok(await mediator.Send(new GetCrewPRatingDistributionQuery(cluster, wellType, site, project, from, to), ct));

    /// <summary>
    /// GET /dashboard/crew-pi-heatmap?cluster=nimr&amp;wellType=Flowline&amp;wellId=27628&amp;from=2026-01-01&amp;to=2026-12-31
    /// Crew PI Rating heatmap for the well-execution page: KPI tiles plus Day/Week/Month
    /// grids (P0-P8 per crew over time) and insights, sourced from dbo.PH_Productivity.
    /// cluster / wellType / wellId restrict which crews appear (via task_daily ? ProjectIDs).
    /// </summary>
    [HttpGet("crew-pi-heatmap")]
    public async Task<ActionResult<CrewPiHeatmapResponse>> CrewPiHeatmap(
        [FromQuery] string? cluster,
        [FromQuery] string? wellType,
        [FromQuery] string? wellId,
        [FromQuery] DateOnly? from,
        [FromQuery] DateOnly? to,
        CancellationToken ct = default)
        => Ok(await mediator.Send(new GetCrewPiHeatmapQuery(cluster, wellType, wellId, from, to), ct));

    /// <summary>
    /// PDO Commissioning Status - counts wells ready for commissioning and their commissioned status.
    /// GET /dashboard/commissioning-status?cluster=MARMUL
    /// </summary>
    [HttpGet("commissioning-status")]
    public async Task<ActionResult<CommissioningStatusDto>> CommissioningStatus(
        [FromQuery] string? cluster = null,
        [FromQuery] string? wellId = null,
        [FromQuery] DateOnly? startDate = null,
        [FromQuery] DateOnly? endDate = null,
        [FromQuery] string? wellType = null,
        [FromQuery] string? project = null,
        CancellationToken ct = default)
        => Ok(await mediator.Send(new GetCommissioningStatusQuery(cluster, wellId, startDate, endDate, wellType, project), ct));

    /// <summary>
    /// Buffer Flowlines Ready - wells with construction complete but not yet drilled, grouped by area.
    /// GET /dashboard/buffer-flowlines-ready?cluster=Marmul
    /// </summary>
    [HttpGet("buffer-flowlines-ready")]
    public async Task<ActionResult<BufferFlowlinesReadyDto>> BufferFlowlinesReady(
        [FromQuery] string? cluster = null,
        [FromQuery] string? wellId = null,
        [FromQuery] DateOnly? startDate = null,
        [FromQuery] DateOnly? endDate = null,
        [FromQuery] string? wellType = null,
        [FromQuery] string? project = null,
        CancellationToken ct = default)
        => Ok(await mediator.Send(new GetBufferFlowlinesReadyQuery(cluster, wellId, startDate, endDate, wellType, project), ct));

    /// <summary>
    /// Construction Well Delivery Flowline &amp; OHL Progress � KPI cards + monthly cumulative trend.
    /// GET /dashboard/construction-progress?year=2026
    /// </summary>
    [HttpGet("construction-progress")]
    public async Task<ActionResult<ConstructionProgressResponse>> ConstructionProgress(
        [FromQuery] int? year = null,
        [FromQuery] DateOnly? asOfDate = null,
        [FromQuery] string? cluster = null,
        [FromQuery] string? wellId = null,
        [FromQuery] DateOnly? fromDate = null,
        [FromQuery] DateOnly? toDate = null,
        [FromQuery] string? wellType = null,
        [FromQuery] string? site = null,
        [FromQuery] string? project = null,
        CancellationToken ct = default)
        => Ok(await mediator.Send(new GetConstructionProgressQuery(year, asOfDate, cluster, wellId, fromDate, toDate, wellType, site, project), ct));

    /// <summary>
    /// Construction Progress Wells Drilldown � returns well details matching a specific KPI filter.
    /// GET /dashboard/construction-progress-wells?filter=plan&amp;year=2026&amp;page=1&amp;pageSize=50
    /// </summary>
    [HttpGet("construction-progress-wells")]
    public async Task<ActionResult<WmrWellsPageDto>> ConstructionProgressWells(
        [FromQuery] string filter = "plan",
        [FromQuery] int? year = null,
        [FromQuery] DateOnly? asOfDate = null,
        [FromQuery] string? cluster = null,
        [FromQuery] string? wellId = null,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50,
        [FromQuery] DateOnly? fromDate = null,
        [FromQuery] DateOnly? toDate = null,
        [FromQuery] string? wellType = null,
        [FromQuery] string? project = null,
        CancellationToken ct = default)
        => Ok(await mediator.Send(new GetConstructionProgressWellsQuery(filter, year, asOfDate, cluster, wellId, page, pageSize, fromDate, toDate, wellType, project), ct));

    /// <summary>
    /// Wells Readiness Flowline Funnel � Original plan, FLAF/SCR adjusted, PDO clean target, actual completed.
    /// GET /dashboard/flowline-readiness?year=2026&amp;fromDate=2026-01-01&amp;toDate=2026-12-31
    /// </summary>
    [HttpGet("flowline-readiness")]
    public async Task<ActionResult<FlowlineReadinessResponse>> FlowlineReadiness(
        [FromQuery] int? year = null,
        [FromQuery] DateOnly? asOfDate = null,
        [FromQuery] string? cluster = null,
        [FromQuery] string? wellId = null,
        [FromQuery] DateOnly? fromDate = null,
        [FromQuery] DateOnly? toDate = null,
        [FromQuery] string? wellType = null,
        [FromQuery] string? project = null,
        CancellationToken ct = default)
        => Ok(await mediator.Send(new GetFlowlineReadinessQuery(year, asOfDate, cluster, wellId, fromDate, toDate, wellType, project), ct));

    /// <summary>
    /// Wells Readiness OHL Funnel � Original plan, FLAF/SCR adjusted, PDO clean target, actual OHL completed.
    /// GET /dashboard/ohl-readiness?year=2026&amp;fromDate=2026-01-01&amp;toDate=2026-12-31
    /// </summary>
    [HttpGet("ohl-readiness")]
    public async Task<ActionResult<OhlReadinessResponse>> OhlReadiness(
        [FromQuery] int? year = null,
        [FromQuery] DateOnly? asOfDate = null,
        [FromQuery] string? cluster = null,
        [FromQuery] string? wellId = null,
        [FromQuery] DateOnly? fromDate = null,
        [FromQuery] DateOnly? toDate = null,
        [FromQuery] string? wellType = null,
        [FromQuery] string? project = null,
        CancellationToken ct = default)
        => Ok(await mediator.Send(new GetOhlReadinessQuery(year, asOfDate, cluster, wellId, fromDate, toDate, wellType, project), ct));

    /// <summary>
    /// Commissioning Completion Progress � Actual completion % vs 100% plan target per month
    /// for the PDO fiscal year (Oct�Sep).
    /// GET /dashboard/commissioning-progress?fiscalYear=2026&amp;asOfDate=2026-05-27
    /// </summary>
    [HttpGet("commissioning-progress")]
    public async Task<ActionResult<CommissioningProgressResponse>> CommissioningProgress(
        [FromQuery] int? fiscalYear = null,
        [FromQuery] DateOnly? asOfDate = null,
        CancellationToken ct = default)
        => Ok(await mediator.Send(new GetCommissioningProgressQuery(fiscalYear, asOfDate), ct));

    /// <summary>
    /// Daily Output Rate Trend - actual (avg data_hours) vs asking (avg required) per day.
    /// GET /dashboard/daily-output-rate?cluster=nimr&amp;from=2026-04-23&amp;to=2026-05-23
    /// </summary>
    [HttpGet("daily-output-rate")]
    public async Task<ActionResult<DailyOutputRateDto>> DailyOutputRate(
        [FromQuery] string?   cluster  = null,
        [FromQuery] string?   site     = null,
        [FromQuery] string?   wellId   = null,
        [FromQuery] string?   location = null,
        [FromQuery] string?   project  = null,
        [FromQuery] DateOnly? from     = null,
        [FromQuery] DateOnly? to       = null,
        CancellationToken ct = default)
        => Ok(await mediator.Send(new GetDailyOutputRateQuery(cluster, site, wellId, location, project, from, to), ct));

    /// <summary>
    /// Buffer Location Construction Progress � YTD KPI tiles + backlog/acceleration summary.
    /// Uses pegging delay (actual_pegged_date, 90 d) and SCR threshold of 60 d.
    /// GET /dashboard/buffer-location-progress?year=2026
    /// </summary>
    [HttpGet("buffer-location-progress")]
    public async Task<ActionResult<BufferLocationProgressResponse>> BufferLocationProgress(
        [FromQuery] int?      year     = null,
        [FromQuery] DateOnly? asOfDate = null,
        [FromQuery] string?   cluster  = null,
        [FromQuery] string?   wellType = null,
        [FromQuery] DateOnly? fromDate = null,
        [FromQuery] DateOnly? toDate   = null,
        [FromQuery] string?   project  = null,
        CancellationToken ct = default)
        => Ok(await mediator.Send(new GetBufferLocationProgressQuery(year, asOfDate, cluster, wellType, fromDate, toDate, project), ct));

    /// <summary>
    /// Construction Well Delivery � Pegging Status: KPI tiles, backlog, risk gauge, and monthly chart.
    /// GET /dashboard/pegging-status?year=2026&amp;cluster=nimr
    /// </summary>
    [HttpGet("pegging-status")]
    public async Task<ActionResult<PeggingStatusResponse>> PeggingStatus(
        [FromQuery] int? year = null,
        [FromQuery] DateOnly? asOfDate = null,
        [FromQuery] string? cluster = null,
        [FromQuery] string? site = null,
        [FromQuery] string? project = null,
        [FromQuery] string? wellType = null,
        [FromQuery] string? wellId = null,
        CancellationToken ct = default)
        => Ok(await mediator.Send(new GetPeggingStatusQuery(year, asOfDate, cluster, site, project, wellType, wellId), ct));

    /// <summary>
    /// Overall Pegging Status pie � wells with completed pegging split by whether
    /// pegging finished = 90 days (within) or &gt; 90 days before actual rig-on.
    /// GET /dashboard/overall-pegging-status?cluster=nimr
    /// </summary>
    [HttpGet("overall-pegging-status")]
    public async Task<ActionResult<OverallPeggingStatusResponse>> OverallPeggingStatus(
        [FromQuery] string? cluster = null,
        [FromQuery] string? site = null,
        [FromQuery] string? project = null,
        [FromQuery] string? wellType = null,
        [FromQuery] string? wellId = null,
        CancellationToken ct = default)
        => Ok(await mediator.Send(new GetOverallPeggingStatusQuery(cluster, site, project, wellType, wellId), ct));

    /// <summary>
    /// Well Delivery Cycle Time � rig-on ? delivery KPIs, monthly trend, and phase breakdown.
    /// GET /dashboard/well-delivery-cycle-time?cluster=nimr
    /// </summary>
    [HttpGet("well-delivery-cycle-time")]
    public async Task<ActionResult<WellDeliveryCycleTimeResponse>> WellDeliveryCycleTime(
        [FromQuery] string?   cluster  = null,
        [FromQuery] string?   site     = null,
        [FromQuery] string?   project  = null,
        [FromQuery] string?   wellType = null,
        [FromQuery] DateOnly? from     = null,
        [FromQuery] DateOnly? to       = null,
        CancellationToken ct = default)
        => Ok(await mediator.Send(new GetWellDeliveryCycleTimeQuery(cluster, site, project, wellType, from, to), ct));

    /// <summary>
    /// Construction Well Delivery � FLAF Status: KPI tiles, backlog, risk gauge, and monthly chart.
    /// GET /dashboard/flaf-status?year=2026&amp;cluster=nimr
    /// </summary>
    [HttpGet("flaf-status")]
    public async Task<ActionResult<FlafStatusResponse>> FlafStatus(
        [FromQuery] int? year = null,
        [FromQuery] DateOnly? asOfDate = null,
        [FromQuery] string? cluster = null,
        [FromQuery] string? site = null,
        [FromQuery] string? project = null,
        [FromQuery] string? wellType = null,
        [FromQuery] string? wellId = null,
        CancellationToken ct = default)
        => Ok(await mediator.Send(new GetFlafStatusQuery(year, asOfDate, cluster, site, project, wellType, wellId), ct));

    /// <summary>
    /// Well Execution Dashboard � KPI cards + Planned vs Actual chart + milestones.
    /// Sources: WellMonitoringReport_Latest, Job_Progress_Report_GB, vw_SchedulePerformance_WellLevel.
    /// GET /dashboard/well-execution-kpi?cluster=NIMR&amp;period=week
    /// </summary>
    [HttpGet("well-execution-kpi")]
    public async Task<ActionResult<WellExecKpiDto>> WellExecutionKpi(
        [FromQuery] string?   cluster   = null,
        [FromQuery] string?   wellType  = null,
        [FromQuery] string    period    = "week",
        [FromQuery] DateOnly? from      = null,
        [FromQuery] DateOnly? to        = null,
        [FromQuery] string?   wellId    = null,
        [FromQuery] bool      chartOnly = false,
        CancellationToken ct = default)
        => Ok(await mediator.Send(new GetWellExecKpiQuery(cluster, wellType, period, from, to, wellId, chartOnly), ct));

    /// <summary>
    /// ODC Overall Status � 12 KPI tile counts from the wells-status-summary SQL query.
    /// Classifies each well into: Due/Not Due/DNC/Accelerated/Backlog/Buffer/Hook-Up/
    /// Due Completed/Suspended/PDO Issues/Ready for Commissioning.
    /// Uses a date range on Week_Number (from/to) and compares rig dates against today.
    /// GET /dashboard/odc-overall-status?from=2026-03-03&amp;to=2026-05-31
    /// </summary>
    [HttpGet("odc-overall-status")]
    public async Task<IActionResult> OdcOverallStatus(
        [FromQuery] DateOnly? from = null,
        [FromQuery] DateOnly? to = null,
        [FromQuery] string? cluster = null,
        [FromQuery] string? site = null,
        [FromQuery] string? wellType = null,
        [FromQuery] string? project = null,
        CancellationToken ct = default)
    {
        var cs = configuration.GetConnectionString("Default")
            ?? throw new InvalidOperationException("ConnectionStrings:Default not configured.");

        var toDate   = to   ?? DateOnly.FromDateTime(DateTime.Today);
        var fromDate = from ?? new DateOnly(DateTime.Today.Year, 1, 1);   // default: This Year (Jan 1 → today)

        // Return cached result if fresh (< 6 hours old) � avoids repeated full-table scans
        var cacheKey = $"{fromDate}|{toDate}|{cluster}|{site}|{wellType}|{project}";
        if (_odcResultCache.TryGetValue(cacheKey, out var cached) && (DateTime.UtcNow - cached.At).TotalHours < 6)
            return Ok(cached.Result);

        // Build ProjectIDs filter for cluster/site/wellType/project
        var pidConditions = new System.Text.StringBuilder();
        if (!string.IsNullOrWhiteSpace(cluster))  pidConditions.Append(" AND LTRIM(RTRIM(CAST([Cluster] AS NVARCHAR(200)))) = @cluster");
        if (!string.IsNullOrWhiteSpace(site))     pidConditions.Append(" AND LTRIM(RTRIM(CAST([Site] AS NVARCHAR(200)))) = @site");
        if (!string.IsNullOrWhiteSpace(wellType)) pidConditions.Append(" AND LTRIM(RTRIM(CAST([Type] AS NVARCHAR(200)))) = @wellType");
        if (!string.IsNullOrWhiteSpace(project))  pidConditions.Append(" AND LTRIM(RTRIM(CAST([Project] AS NVARCHAR(200)))) = @project");
        var pidFilter = pidConditions.Length > 0
            ? $" AND project_id IN (SELECT CAST(ID AS NVARCHAR(100)) FROM [dbo].[ProjectIDs] WITH (NOLOCK) WHERE 1=1{pidConditions})"
            : "";

        var sql = $"""
            DECLARE @ReportDateFrom DATE = @pFrom;
            DECLARE @ReportDateTo   DATE = @pTo;

            -- ── Step 1: latest WMR snapshot per well within the date window ──────────
            -- Week_Number dual-format fix: handles both YYYY-MM-DD (10-char) and YY-MM-DD (8-char)
            ;WITH LatestSnapshot AS (
                SELECT
                    pdo_well_id,
                    project_id,
                    TRY_CAST(actual_rig_off_date AS DATE)                     AS actual_rig_off_date,
                    COALESCE(TRY_CAST(over_all_progress_percentages AS FLOAT), 0) AS progress,
                    TRY_CAST([actual_eng._completion_date] AS DATE)           AS eng_completion_date,
                    TRY_CAST([flaf_issue_date] AS DATE)                       AS flaf_date,
                    TRY_CAST([scr_date] AS DATE)                              AS scr_date,
                    TRY_CAST([wellpad_handover-2_from_hoist_fbu_rsr_off_date] AS DATE) AS handover_date,
                    TRY_CAST([actual_comm._finish_date_with_in_2_days_from_actual_engg._completion_date] AS DATE) AS actual_comm_date,
                    ROW_NUMBER() OVER (
                        PARTITION BY pdo_well_id
                        ORDER BY COALESCE(TRY_CONVERT(DATE, Week_Number, 23),
                                         TRY_CONVERT(DATE, '20' + Week_Number, 23)) DESC,
                                 project_id DESC
                    ) AS rn
                FROM [dbo].[WMR] WITH (NOLOCK)
                WHERE pdo_well_id IS NOT NULL
                  AND pdo_well_id <> ''
                  AND COALESCE(TRY_CONVERT(DATE, Week_Number, 23),
                               TRY_CONVERT(DATE, '20' + Week_Number, 23)) IS NOT NULL
                  AND COALESCE(TRY_CONVERT(DATE, Week_Number, 23),
                               TRY_CONVERT(DATE, '20' + Week_Number, 23)) >= @ReportDateFrom
                  AND COALESCE(TRY_CONVERT(DATE, Week_Number, 23),
                               TRY_CONVERT(DATE, '20' + Week_Number, 23)) <= @ReportDateTo
            ),
            -- ── Step 2: one row per well + optional cluster / project filter ─────────
            Wells AS (
                SELECT pdo_well_id, actual_rig_off_date, progress, eng_completion_date,
                       flaf_date, scr_date, handover_date, actual_comm_date
                FROM LatestSnapshot WHERE rn = 1
                  {pidFilter}
            ),
            -- ── Step 3: Total Drilled = wells where actual_rig_off_date IS NOT NULL ──
            DrilledWells AS (
                SELECT pdo_well_id, progress, eng_completion_date,
                       flaf_date, scr_date, handover_date, actual_comm_date,
                       actual_rig_off_date
                FROM Wells
                WHERE actual_rig_off_date IS NOT NULL
            ),
            -- ── Step 3b: Due Date per drilled well ──────────────────────────────────
            -- Due Date = latest of: (FLAF+90), (SCR+90), (RigOff+5), (Handover+2)
            -- actual_comm_date defaults to @ReportDateTo when NULL
            --   (wells not yet commissioned are treated as commissioned on the report end date)
            DueDateCalc AS (
                SELECT
                    pdo_well_id,
                    progress,
                    COALESCE(actual_comm_date, @ReportDateTo) AS actual_comm_date,
                    -- GREATEST equivalent for SQL Server <2022
                    (SELECT MAX(d) FROM (VALUES
                        (DATEADD(DAY, 90, flaf_date)),
                        (DATEADD(DAY, 90, scr_date)),
                        (DATEADD(DAY,  5, actual_rig_off_date)),
                        (DATEADD(DAY,  2, handover_date))
                    ) AS v(d)) AS due_date
                FROM DrilledWells
            ),
            -- ── Step 4a: Drilled & Not Completed = drilled wells where progress < 1 (< 100%) ──
            DrilledNotCompleted AS (
                SELECT pdo_well_id
                FROM DrilledWells
                WHERE progress < 1.0
            ),
            -- ── Step 4b: Due Wells = drilled wells where actual_comm_date > due_date ──
            DueWells AS (
                SELECT pdo_well_id, progress, actual_comm_date, due_date
                FROM DueDateCalc
                WHERE due_date IS NOT NULL
                  AND actual_comm_date > due_date
            ),
            -- ── Step 4c: Not Due Wells = drilled wells where actual_comm_date <= due_date ──
            NotDueWells AS (
                SELECT pdo_well_id
                FROM DueDateCalc
                WHERE due_date IS NOT NULL
                  AND actual_comm_date <= due_date
            ),
            -- ── Step 4c2: Accelerated Wells = not due wells where actual_comm_date < due_date (strictly early) ──
            AcceleratedWells AS (
                SELECT pdo_well_id
                FROM DueDateCalc
                WHERE due_date IS NOT NULL
                  AND actual_comm_date < due_date
            ),
            -- ── Step 4d: Due Wells Completed = due wells where progress >= 1 (100%) ──
            DueWellsCompleted AS (
                SELECT pdo_well_id
                FROM DueWells
                WHERE progress >= 1.0
            ),
            -- ── Step 4e: Suspended = drilled wells flagged Suspend in WMR_TaskPlan ───
            --            Excludes wells where progress >= 1 (completed wells are not suspended)
            SuspendedWells AS (
                SELECT DISTINCT d.pdo_well_id
                FROM DrilledWells d
                WHERE d.progress < 1.0
                  AND EXISTS (
                    SELECT 1 FROM [dbo].[WMR_TaskPlan_csv_imported] WITH (NOLOCK)
                    WHERE CAST([New_Well_ID]    AS NVARCHAR(200)) = d.pdo_well_id
                      AND CAST([Resume_Suspend] AS NVARCHAR(50))  = 'Suspend'
                )
            ),
            -- ── Step 5: Hook-Up Completed ──────────────────────────────────────────
            -- Logic: for each drilled well check the 5 hook-up workgroups in WMR_TaskPlan.
            -- SUM(wg.weightage) one entry per workgroup (deduplicated with MIN)
            -- must equal SUM(act.weightage) for all activities (actual_end IS NOT NULL)
            -- under those workgroups.
            -- 5 target workgroups:
            --   On Plot Foundation | On Plot Cable Trench | On Plot Electrical Works
            --   On Plot Instrument Works | Beam Pump, Hookup Spool Inst. & HT
            WgWeights AS (
                SELECT
                    CAST([New_Well_ID] AS NVARCHAR(200)) AS well_id,
                    CAST([text]        AS NVARCHAR(500)) AS wg_name,
                    MIN(TRY_CAST([weightage] AS FLOAT))  AS wg_weight   -- one per workgroup
                FROM [dbo].[WMR_TaskPlan_csv_imported] WITH (NOLOCK)
                WHERE CAST([type] AS NVARCHAR(10)) = 'W'
                  AND CAST([text] AS NVARCHAR(500)) IN (
                      'On Plot Foundation',
                      'On Plot Cable Trench',
                      'On Plot Electrical Works',
                      'On Plot Instrument Works',
                      'Beam Pump, Hookup Spool Inst. & HT'
                  )
                  AND CAST([New_Well_ID] AS NVARCHAR(200)) IN (SELECT pdo_well_id FROM DrilledWells)
                GROUP BY CAST([New_Well_ID] AS NVARCHAR(200)), CAST([text] AS NVARCHAR(500))
            ),
            WgTotals AS (
                SELECT well_id, SUM(wg_weight) AS total_wg_weight
                FROM WgWeights
                GROUP BY well_id
            ),
            ActCompleted AS (
                SELECT
                    CAST([New_Well_ID] AS NVARCHAR(200)) AS well_id,
                    SUM(TRY_CAST([weightage] AS FLOAT))  AS total_act_weight
                FROM [dbo].[WMR_TaskPlan_csv_imported] WITH (NOLOCK)
                WHERE CAST([type]       AS NVARCHAR(10))  = 'A'
                  AND CAST([parent_WBS] AS NVARCHAR(500)) IN (
                      'On Plot Foundation',
                      'On Plot Cable Trench',
                      'On Plot Electrical Works',
                      'On Plot Instrument Works',
                      'Beam Pump, Hookup Spool Inst. & HT'
                  )
                  AND [actual_end] IS NOT NULL
                  AND CAST([New_Well_ID] AS NVARCHAR(200)) IN (SELECT pdo_well_id FROM DrilledWells)
                GROUP BY CAST([New_Well_ID] AS NVARCHAR(200))
            ),
            HookupCompleted AS (
                SELECT wt.well_id
                FROM WgTotals wt
                LEFT JOIN ActCompleted ac ON ac.well_id = wt.well_id
                WHERE wt.total_wg_weight > 0
                  AND ABS(wt.total_wg_weight - ISNULL(ac.total_act_weight, 0)) < 0.0001
            )
            SELECT
                (SELECT COUNT(*) FROM Wells)              AS TotalWells,
                (SELECT COUNT(*) FROM HookupCompleted)    AS HookUpCompleted,
                (SELECT COUNT(*) FROM DueWells)           AS DueWells,
                (SELECT COUNT(*) FROM NotDueWells)         AS NotDueWells,
                (SELECT COUNT(*) FROM DrilledNotCompleted) AS DrilledNotCompleted,
                (SELECT COUNT(*) FROM AcceleratedWells)    AS WellsAccelerated,
                0                                         AS BacklogWells,
                0                                         AS BufferWells,
                (SELECT COUNT(*) FROM DueWellsCompleted)  AS DueWellsCompleted,
                (SELECT COUNT(*) FROM SuspendedWells)     AS SuspendedWells,
                0                                         AS PdoIssues,
                (SELECT COUNT(*) FROM HookupCompleted)    AS ReadyForCommissioning,
                (SELECT COUNT(*) FROM DrilledWells)       AS TotalDrilled;
            """;

        await using var conn = new SqlConnection(cs);
        await conn.OpenAsync(ct);

        await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 60 };
        cmd.Parameters.AddWithValue("@pFrom", fromDate.ToDateTime(TimeOnly.MinValue));
        cmd.Parameters.AddWithValue("@pTo", toDate.ToDateTime(TimeOnly.MinValue));
        if (!string.IsNullOrWhiteSpace(cluster))  cmd.Parameters.AddWithValue("@cluster",  cluster.Trim());
        if (!string.IsNullOrWhiteSpace(site))     cmd.Parameters.AddWithValue("@site",     site.Trim());
        if (!string.IsNullOrWhiteSpace(wellType)) cmd.Parameters.AddWithValue("@wellType", wellType.Trim());
        if (!string.IsNullOrWhiteSpace(project))  cmd.Parameters.AddWithValue("@project",  project.Trim());
        await using var reader = await cmd.ExecuteReaderAsync(ct);

        if (await reader.ReadAsync(ct))
        {
            var result = new
            {
                totalWells = reader.IsDBNull(0) ? 0 : reader.GetInt32(0),
                hookUpCompleted = reader.IsDBNull(1) ? 0 : reader.GetInt32(1),
                dueWells = reader.IsDBNull(2) ? 0 : reader.GetInt32(2),
                notDueWells = reader.IsDBNull(3) ? 0 : reader.GetInt32(3),
                drilledNotCompleted = reader.IsDBNull(4) ? 0 : reader.GetInt32(4),
                wellsAccelerated = reader.IsDBNull(5) ? 0 : reader.GetInt32(5),
                backlogWells = 0, // reader.IsDBNull(6) ? 0 : reader.GetInt32(6), // commented out � always 0
                bufferWells = reader.IsDBNull(7) ? 0 : reader.GetInt32(7),
                dueWellsCompleted = reader.IsDBNull(8) ? 0 : reader.GetInt32(8),
                suspendedWells = reader.IsDBNull(9) ? 0 : reader.GetInt32(9),
                pdoIssues = reader.IsDBNull(10) ? 0 : reader.GetInt32(10),
                readyForCommissioning = reader.IsDBNull(11) ? 0 : reader.GetInt32(11),
                totalDrilled = reader.IsDBNull(12) ? 0 : reader.GetInt32(12)
            };
            _odcResultCache[cacheKey] = (DateTime.UtcNow, result);
            return Ok(result);
        }

        return Ok(new
        {
            totalWells = 0, hookUpCompleted = 0, dueWells = 0, notDueWells = 0,
            drilledNotCompleted = 0, wellsAccelerated = 0, backlogWells = 0, bufferWells = 0,
            dueWellsCompleted = 0, suspendedWells = 0, pdoIssues = 0, readyForCommissioning = 0, totalDrilled = 0
        });
    }

    [HttpGet("well-hookup-kpi")]
    public async Task<ActionResult<WellHookupKpiDto>> WellHookupKpi(
        [FromQuery] string?   cluster  = null,
        [FromQuery] DateOnly? from     = null,
        [FromQuery] DateOnly? to       = null,
        CancellationToken ct = default)
        => Ok(await mediator.Send(new GetWellHookupKpiQuery(cluster, from, to), ct));

    [HttpGet("ns-hookup-waterfall")]
    public async Task<ActionResult<NsHookupWaterfallDto>> NsHookupWaterfall(
        [FromQuery] string?   cluster = null,
        [FromQuery] DateOnly? from    = null,
        [FromQuery] DateOnly? to      = null,
        CancellationToken ct = default)
        => Ok(await mediator.Send(new GetNsHookupWaterfallQuery(cluster, from, to), ct));

    [HttpGet("ns-hookup-completion")]
    public async Task<ActionResult<NsHookupCompletionDto>> NsHookupCompletion(
        [FromQuery] string?   cluster = null,
        [FromQuery] DateOnly? from    = null,
        [FromQuery] DateOnly? to      = null,
        CancellationToken ct = default)
        => Ok(await mediator.Send(new GetNsHookupCompletionQuery(cluster, from, to), ct));

    [HttpGet("ns-hookup-breakdown")]
    public async Task<ActionResult<NsHookupBreakdownDto>> NsHookupBreakdown(
        [FromQuery] string?   cluster = null,
        [FromQuery] DateOnly? from    = null,
        [FromQuery] DateOnly? to      = null,
        CancellationToken ct = default)
        => Ok(await mediator.Send(new GetNsHookupBreakdownQuery(cluster, from, to), ct));

    /// <summary>
    /// Well Hookup Progress Overview � Conventional tab
    /// wellType: conventional | non-standard | well-conversions
    /// GET /dashboard/hookup-progress?wellType=conventional
    /// </summary>
    [HttpGet("hookup-progress")]
    public async Task<ActionResult<HookupProgressDto>> HookupProgress(
        [FromQuery] string    wellType = "conventional",
        [FromQuery] string?   cluster  = null,
        [FromQuery] string?   location = null,
        [FromQuery] DateOnly? from     = null,
        [FromQuery] DateOnly? to       = null,
        [FromQuery] string?   site     = null,
        [FromQuery] string?   project  = null,
        CancellationToken ct = default)
        => Ok(await mediator.Send(new GetHookupProgressQuery(wellType, cluster, location, from, to, site, project), ct));

    /// <summary>
    /// Hookup Wells List — returns individual wells from WellMonitoringReport_Latest using the
    /// SAME project-type scoping as /hookup-progress so row counts always match the KPI tiles.
    /// Supports wellType = conventional (default) | non-standard | well-conversions.
    /// GET /dashboard/hookup-wells-list?wellType=conventional&amp;from=2026-01-01&amp;to=2026-12-31
    /// </summary>
    [HttpGet("hookup-wells-list")]
    public async Task<IActionResult> HookupWellsList(
        [FromQuery] string    wellType = "conventional",
        [FromQuery] string?   cluster  = null,
        [FromQuery] string?   site     = null,
        [FromQuery] string?   project  = null,
        [FromQuery] DateOnly? from     = null,
        [FromQuery] DateOnly? to       = null,
        CancellationToken ct = default)
    {
        var cs = configuration.GetConnectionString("Default")
            ?? throw new InvalidOperationException("ConnectionStrings:Default not configured.");

        var toDate   = to   ?? DateOnly.FromDateTime(DateTime.UtcNow);
        var fromDate = from ?? toDate.AddDays(-365);

        // Map Angular wellType values → ProjectIDs.Type values
        var pidType = wellType switch
        {
            "non-standard"    => "Non Standard Well",
            "well-conversions"=> "Conventional Well",   // conversions reuse Conventional scope per existing hookup-progress logic
            _                 => "Conventional Well"
        };

        // Build optional cluster/site/project scope conditions
        var scopeConditions = new System.Text.StringBuilder();
        if (!string.IsNullOrWhiteSpace(cluster)) scopeConditions.Append(" AND LTRIM(RTRIM(CAST(pid.[Cluster] AS NVARCHAR(200)))) = @cluster");
        if (!string.IsNullOrWhiteSpace(site))    scopeConditions.Append(" AND LTRIM(RTRIM(CAST(pid.[Site]    AS NVARCHAR(200)))) = @site");
        if (!string.IsNullOrWhiteSpace(project)) scopeConditions.Append(" AND LTRIM(RTRIM(CAST(pid.[Project] AS NVARCHAR(200)))) = @project");

        var sql = $"""
            WITH ScopedProjects AS (
                SELECT pid.ID AS project_id_key
                FROM [dbo].[ProjectIDs] pid WITH (NOLOCK)
                WHERE pid.Type = @pidType
                {scopeConditions}
            ),
            HookupWells AS (
                SELECT
                    wmr.pdo_well_id,
                    wmr.well_location,
                    wmr.rig_no,
                    wmr.project_id,
                    wmr.well_type,
                    wmr.scr_no,
                    wmr.buffer_status,
                    wmr.[remark_status_area_of_attention_issues_]                                       AS remark,
                    wmr.[actual_rig_off_date],
                    wmr.[actual_eng._completion_date]                                                   AS eng_completion_date,
                    wmr.[actual_comm._finish_date_with_in_2_days_from_actual_engg._completion_date]     AS hookup_completion_date,
                    COALESCE(TRY_CAST(wmr.over_all_progress_percentages AS FLOAT), 0)                  AS overall_progress,
                    COALESCE(TRY_CAST(wmr.[overall_const._10_100]        AS FLOAT), 0)                 AS constr_pct,
                    COALESCE(TRY_CAST(wmr.overall_comm_progress_100      AS FLOAT), 0)                 AS comm_progress,
                    COALESCE(TRY_CAST(wmr.ohl_progress                   AS FLOAT), 0)                 AS drilling_pct,
                    wmr.[location_preparation_status_in_progress_completed]                            AS loc_prep_status,
                    wmr.[flow_line_commi._status_in_progress_completed]                                AS comm_status,
                    wmr.[flow_line_const._status_in_progress_completed]                                AS constr_status,
                    TRY_CAST(wmr.[latest_exp.rig_on_location_sap_data]  AS DATE)                       AS expected_rig_on_date,
                    TRY_CAST(wmr.actual_rig_on_date                      AS DATE)                      AS actual_rig_on_date,
                    CASE WHEN (wmr.scr_no IS NOT NULL AND LTRIM(RTRIM(wmr.scr_no)) <> '')
                         THEN 1 ELSE 0 END                                                             AS is_flaf_scr_delayed,
                    CASE WHEN (wmr.[remark_status_area_of_attention_issues_] LIKE '%PDO%'
                            OR wmr.buffer_status IN ('PDO Issue','On Hold'))
                         THEN 1 ELSE 0 END                                                             AS is_pdo_issue,
                    CASE WHEN (wmr.[actual_eng._completion_date] IS NOT NULL
                            OR wmr.[actual_comm._finish_date_with_in_2_days_from_actual_engg._completion_date] IS NOT NULL)
                         THEN 1 ELSE 0 END                                                             AS is_hooked_up
                FROM [dbo].[WellMonitoringReport_Latest] wmr WITH (NOLOCK)
                INNER JOIN ScopedProjects sp ON wmr.project_id = CAST(sp.project_id_key AS NVARCHAR(50))
                WHERE wmr.pdo_well_id IS NOT NULL AND wmr.pdo_well_id <> ''
                  AND (@from IS NULL OR TRY_CONVERT(DATE, wmr.[actual_rig_off_date]) >= @from)
                  AND (@to   IS NULL OR TRY_CONVERT(DATE, wmr.[actual_rig_off_date]) <= @to)
            )
            SELECT
                hw.pdo_well_id                                          AS WellId,
                hw.well_location                                        AS WellName,
                CASE
                    WHEN hw.is_hooked_up = 1        THEN 'COMPLETED'
                    WHEN hw.overall_progress > 0    THEN 'ACTIVE'
                    ELSE                                 'PLANNED'
                END                                                     AS Status,
                p.[Cluster]   AS Field,
                hw.rig_no                                               AS Rig,
                hw.overall_progress                                     AS ProgressPct,
                hw.well_type                                            AS WellType,
                hw.loc_prep_status                                      AS LocPrepStatus,
                hw.drilling_pct                                         AS DrillingPct,
                hw.comm_status                                          AS CommStatus,
                hw.constr_status                                        AS ConstrStatus,
                hw.constr_pct                                           AS ConstrPct,
                hw.comm_progress                                        AS CommProgress,
                hw.actual_rig_on_date                                   AS RigBy,
                TRY_CAST(hw.[actual_rig_off_date] AS DATE)              AS RigTo,
                hw.is_flaf_scr_delayed                                  AS IsFlafScrDelayed,
                hw.is_pdo_issue                                         AS IsPdoIssue,
                hw.is_hooked_up                                         AS IsHookedUp,
                -- Waterfall bucket matching hookup-progress KPI logic exactly:
                -- flaf_scr checked FIRST (even if the well is also hooked-up),
                -- then pdo_issues, then completed, then backlog.
                CASE
                    WHEN hw.is_flaf_scr_delayed = 1                                          THEN 'flaf_scr'
                    WHEN hw.is_pdo_issue = 1                                                 THEN 'pdo_issues'
                    WHEN hw.is_hooked_up = 1                                                 THEN 'completed'
                    ELSE                                                                          'backlog'
                END                                                     AS WaterfallBucket
            FROM HookupWells hw
            LEFT JOIN (
                SELECT ID, MIN([Cluster]) AS [Cluster]
                FROM [dbo].[ProjectIDs] WITH (NOLOCK)
                GROUP BY ID
            ) p ON hw.project_id = p.ID
            ORDER BY hw.pdo_well_id;
            """;

        await using var conn = new SqlConnection(cs);
        await conn.OpenAsync(ct);
        await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 60 };

        cmd.Parameters.AddWithValue("@pidType", pidType);
        cmd.Parameters.Add(new SqlParameter("@from", System.Data.SqlDbType.Date)
            { Value = (object?)fromDate.ToDateTime(TimeOnly.MinValue) });
        cmd.Parameters.Add(new SqlParameter("@to", System.Data.SqlDbType.Date)
            { Value = (object?)toDate.ToDateTime(TimeOnly.MinValue) });
        if (!string.IsNullOrWhiteSpace(cluster)) cmd.Parameters.AddWithValue("@cluster", cluster.Trim());
        if (!string.IsNullOrWhiteSpace(site))    cmd.Parameters.AddWithValue("@site",    site.Trim());
        if (!string.IsNullOrWhiteSpace(project)) cmd.Parameters.AddWithValue("@project", project.Trim());

        await using var reader = await cmd.ExecuteReaderAsync(ct);
        var results = new List<object>();
        while (await reader.ReadAsync(ct))
        {
            var progressRaw = reader.IsDBNull(5)  ? 0.0 : Convert.ToDouble(reader.GetValue(5));
            var constrPct   = reader.IsDBNull(11) ? 0.0 : Convert.ToDouble(reader.GetValue(11));
            var commProg    = reader.IsDBNull(12) ? 0.0 : Convert.ToDouble(reader.GetValue(12));
            results.Add(new
            {
                wellId          = reader.IsDBNull(0)  ? "" : reader.GetValue(0)!.ToString(),
                wellName        = reader.IsDBNull(1)  ? null : reader.GetValue(1)!.ToString(),
                status          = reader.IsDBNull(2)  ? "PLANNED" : reader.GetValue(2)!.ToString(),
                field           = reader.IsDBNull(3)  ? null : reader.GetValue(3)!.ToString(),
                rig             = reader.IsDBNull(4)  ? null : reader.GetValue(4)!.ToString(),
                progressPct     = Math.Round(progressRaw * 100, 1),
                plannedPct      = (double?)null,
                variance        = (double?)null,
                ratePerDay      = (double?)null,
                askRate         = 7.0,
                gapPerDay       = (double?)null,
                spi             = (double?)null,
                cpi             = (double?)null,
                wellType        = reader.IsDBNull(6)  ? null : reader.GetValue(6)!.ToString(),
                odcCategory     = "hookup",
                locPrepStatus   = reader.IsDBNull(7)  ? null : reader.GetValue(7)!.ToString(),
                drillingPct     = reader.IsDBNull(8)  ? 0.0  : Convert.ToDouble(reader.GetValue(8)),
                commStatus      = reader.IsDBNull(9)  ? null : reader.GetValue(9)!.ToString(),
                constrStatus    = reader.IsDBNull(10) ? null : reader.GetValue(10)!.ToString(),
                constrPct,
                commProgress    = commProg,
                rigBy           = reader.IsDBNull(13) ? null : reader.GetValue(13)?.ToString(),
                rigTo           = reader.IsDBNull(14) ? null : reader.GetValue(14)?.ToString(),
                waterfallBucket = reader.IsDBNull(18) ? "backlog" : reader.GetValue(18)!.ToString()
            });
        }
        return Ok(results);
    }

    /// <summary>
    /// ODC Wells Status List — returns individual wells with their ODC classification category
    /// and full grid data (planned %, variance, rate/day, SPI, CPI) using the same SAP plan
    /// calculations as wells-status-list but with ODC classification and no progress>0 filter.
    /// GET /dashboard/odc-wells-status-list?from=2026-03-03&amp;to=2026-05-31
    /// </summary>
    [HttpGet("odc-wells-status-list")]
    public async Task<IActionResult> OdcWellsStatusList(
        [FromQuery] DateOnly? from = null,
        [FromQuery] DateOnly? to = null,
        [FromQuery] string? cluster = null,
        [FromQuery] string? site = null,
        [FromQuery] string? wellType = null,
        [FromQuery] string? project = null,
        CancellationToken ct = default)
    {
        var cs = configuration.GetConnectionString("Default")
            ?? throw new InvalidOperationException("ConnectionStrings:Default not configured.");

        var toDate   = to   ?? DateOnly.FromDateTime(DateTime.Today);
        var fromDate = from ?? new DateOnly(DateTime.Today.Year, 1, 1);   // This Year (Jan 1 → today)

        // Build ProjectIDs filter for cluster/site/wellType/project
        var pidConditions2 = new System.Text.StringBuilder();
        if (!string.IsNullOrWhiteSpace(cluster))  pidConditions2.Append(" AND LTRIM(RTRIM(CAST([Cluster] AS NVARCHAR(200)))) = @cluster");
        if (!string.IsNullOrWhiteSpace(site))     pidConditions2.Append(" AND LTRIM(RTRIM(CAST([Site] AS NVARCHAR(200)))) = @site");
        if (!string.IsNullOrWhiteSpace(wellType)) pidConditions2.Append(" AND LTRIM(RTRIM(CAST([Type] AS NVARCHAR(200)))) = @wellType");
        if (!string.IsNullOrWhiteSpace(project))  pidConditions2.Append(" AND LTRIM(RTRIM(CAST([Project] AS NVARCHAR(200)))) = @project");
        var pidFilter2 = pidConditions2.Length > 0
            ? $" AND project_id IN (SELECT CAST(ID AS NVARCHAR(100)) FROM [dbo].[ProjectIDs] WITH (NOLOCK) WHERE 1=1{pidConditions2})"
            : "";

        var sql = $"""
            DECLARE @ReportDateFrom DATE = @pFrom;
            DECLARE @ReportDateTo   DATE = @pTo;

            -- Step 1: Latest WMR snapshot per well in date range (same Week_Number dual-format fix as odc-overall-status)
            ;WITH LatestSnapshot AS (
                SELECT
                    pdo_well_id,
                    project_id,
                    TRY_CAST(actual_rig_off_date AS DATE)                                          AS actual_rig_off_date,
                    TRY_CAST(actual_rig_on_date  AS DATE)                                          AS actual_rig_on_date,
                    COALESCE(TRY_CAST(over_all_progress_percentages AS FLOAT), 0)                  AS progress,
                    TRY_CAST([flaf_issue_date] AS DATE)                                            AS flaf_date,
                    TRY_CAST([scr_date] AS DATE)                                                   AS scr_date,
                    TRY_CAST([wellpad_handover-2_from_hoist_fbu_rsr_off_date] AS DATE)             AS handover_date,
                    TRY_CAST([actual_comm._finish_date_with_in_2_days_from_actual_engg._completion_date] AS DATE) AS actual_comm_date,
                    COALESCE(TRY_CAST(overall_comm_progress_100 AS FLOAT), 0)                     AS comm_progress,
                    COALESCE(TRY_CAST(ohl_progress AS FLOAT), 0)                                  AS drilling_pct,
                    COALESCE(TRY_CAST([overall_const._10_100] AS FLOAT), 0)                       AS constr_pct,
                    rig_no,
                    well_location,
                    well_type,
                    [location_preparation_status_in_progress_completed],
                    [flow_line_commi._status_in_progress_completed],
                    [flow_line_const._status_in_progress_completed],
                    ROW_NUMBER() OVER (
                        PARTITION BY pdo_well_id
                        ORDER BY COALESCE(TRY_CONVERT(DATE, Week_Number, 23), TRY_CONVERT(DATE, '20' + Week_Number, 23)) DESC,
                                 project_id DESC
                    ) AS rn
                FROM [dbo].[WMR] WITH (NOLOCK)
                WHERE pdo_well_id IS NOT NULL AND pdo_well_id <> ''
                  AND COALESCE(TRY_CONVERT(DATE, Week_Number, 23), TRY_CONVERT(DATE, '20' + Week_Number, 23)) IS NOT NULL
                  AND COALESCE(TRY_CONVERT(DATE, Week_Number, 23), TRY_CONVERT(DATE, '20' + Week_Number, 23)) >= @ReportDateFrom
                  AND COALESCE(TRY_CONVERT(DATE, Week_Number, 23), TRY_CONVERT(DATE, '20' + Week_Number, 23)) <= @ReportDateTo
            ),
            -- Step 2: One row per well + cluster/project filter (same as odc-overall-status)
            Wells AS (
                SELECT pdo_well_id, project_id, actual_rig_off_date, actual_rig_on_date,
                       progress, flaf_date, scr_date, handover_date, actual_comm_date,
                       comm_progress, drilling_pct, constr_pct, rig_no, well_location, well_type,
                       [location_preparation_status_in_progress_completed],
                       [flow_line_commi._status_in_progress_completed],
                       [flow_line_const._status_in_progress_completed]
                FROM LatestSnapshot WHERE rn = 1
                  {pidFilter2}
            ),
            -- Step 3: Drilled wells (same as odc-overall-status)
            DrilledWells AS (
                SELECT pdo_well_id, progress, flaf_date, scr_date, handover_date,
                       actual_comm_date, actual_rig_off_date
                FROM Wells WHERE actual_rig_off_date IS NOT NULL
            ),
            -- Step 4: Due date per drilled well (same formula as odc-overall-status)
            -- actual_comm_date defaults to @ReportDateTo when NULL
            DueDateCalc AS (
                SELECT pdo_well_id, COALESCE(actual_comm_date, @ReportDateTo) AS actual_comm_date,
                    (SELECT MAX(d) FROM (VALUES
                        (DATEADD(DAY, 90, flaf_date)),
                        (DATEADD(DAY, 90, scr_date)),
                        (DATEADD(DAY,  5, actual_rig_off_date)),
                        (DATEADD(DAY,  2, handover_date))
                    ) AS v(d)) AS due_date
                FROM DrilledWells
            ),
            -- Step 5: Exact same independent category CTEs as odc-overall-status (these OVERLAP)
            DrilledNotCompleted AS (
                SELECT pdo_well_id FROM DrilledWells WHERE progress < 1.0
            ),
            DueWells AS (
                SELECT pdo_well_id FROM DueDateCalc
                WHERE due_date IS NOT NULL AND actual_comm_date > due_date
            ),
            NotDueWells AS (
                SELECT pdo_well_id FROM DueDateCalc
                WHERE due_date IS NOT NULL AND actual_comm_date <= due_date
            ),
            AcceleratedWells AS (
                SELECT pdo_well_id FROM DueDateCalc
                WHERE due_date IS NOT NULL AND actual_comm_date < due_date
            ),
            DueWellsCompleted AS (
                SELECT d.pdo_well_id FROM DrilledWells d
                WHERE d.progress >= 1.0
                  AND d.pdo_well_id IN (SELECT pdo_well_id FROM DueWells)
            ),
            SuspendedWells AS (
                SELECT DISTINCT d.pdo_well_id FROM DrilledWells d
                WHERE d.progress < 1.0
                  AND EXISTS (
                    SELECT 1 FROM [dbo].[WMR_TaskPlan_csv_imported] WITH (NOLOCK)
                    WHERE CAST([New_Well_ID]    AS NVARCHAR(200)) = d.pdo_well_id
                      AND CAST([Resume_Suspend] AS NVARCHAR(50))  = 'Suspend'
                )
            ),
            -- Step 6: Hook-Up Completed (exact same as odc-overall-status)
            WgWeights AS (
                SELECT CAST([New_Well_ID] AS NVARCHAR(200)) AS well_id,
                       CAST([text]        AS NVARCHAR(500)) AS wg_name,
                       MIN(TRY_CAST([weightage] AS FLOAT))  AS wg_weight
                FROM [dbo].[WMR_TaskPlan_csv_imported] WITH (NOLOCK)
                WHERE CAST([type] AS NVARCHAR(10)) = 'W'
                  AND CAST([text] AS NVARCHAR(500)) IN (
                      'On Plot Foundation','On Plot Cable Trench','On Plot Electrical Works',
                      'On Plot Instrument Works','Beam Pump, Hookup Spool Inst. & HT')
                  AND CAST([New_Well_ID] AS NVARCHAR(200)) IN (SELECT pdo_well_id FROM DrilledWells)
                GROUP BY CAST([New_Well_ID] AS NVARCHAR(200)), CAST([text] AS NVARCHAR(500))
            ),
            WgTotals AS (
                SELECT well_id, SUM(wg_weight) AS total_wg_weight FROM WgWeights GROUP BY well_id
            ),
            ActCompleted AS (
                SELECT CAST([New_Well_ID] AS NVARCHAR(200)) AS well_id,
                       SUM(TRY_CAST([weightage] AS FLOAT))  AS total_act_weight
                FROM [dbo].[WMR_TaskPlan_csv_imported] WITH (NOLOCK)
                WHERE CAST([type]       AS NVARCHAR(10))  = 'A'
                  AND CAST([parent_WBS] AS NVARCHAR(500)) IN (
                      'On Plot Foundation','On Plot Cable Trench','On Plot Electrical Works',
                      'On Plot Instrument Works','Beam Pump, Hookup Spool Inst. & HT')
                  AND [actual_end] IS NOT NULL
                  AND CAST([New_Well_ID] AS NVARCHAR(200)) IN (SELECT pdo_well_id FROM DrilledWells)
                GROUP BY CAST([New_Well_ID] AS NVARCHAR(200))
            ),
            HookupCompleted AS (
                SELECT wt.well_id FROM WgTotals wt
                LEFT JOIN ActCompleted ac ON ac.well_id = wt.well_id
                WHERE wt.total_wg_weight > 0
                  AND ABS(wt.total_wg_weight - ISNULL(ac.total_act_weight, 0)) < 0.0001
            ),
            -- Step 7: SAP plan for PlannedPct / Variance columns
            SapPlan AS (
                SELECT Well_ID,
                       MIN(TRY_CAST(Earl_start_date AS DATE)) AS plan_start,
                       MAX(TRY_CAST(EarliestEndDate AS DATE))  AS plan_end
                FROM [dbo].[SAP_DRILLING_SEQUENCE_History] WITH (NOLOCK)
                WHERE Well_ID IS NOT NULL AND Well_ID <> ''
                GROUP BY Well_ID
            )
            SELECT
                w.pdo_well_id                                                            AS WellId,         -- 0
                w.well_location                                                          AS WellName,       -- 1
                CASE WHEN w.progress >= 1.0 THEN 'COMPLETED'
                     WHEN w.progress  > 0   THEN 'ACTIVE'
                     ELSE                        'PLANNED' END                           AS Status,         -- 2
                p.[Cluster]                   AS Field,          -- 3
                w.rig_no                                                                 AS Rig,            -- 4
                w.progress                                                               AS ProgressPct,    -- 5
                -- PlannedPct = (ReportDateTo - plan_start) / (plan_end - plan_start), clamped 0-1
                CASE WHEN sap.plan_start IS NOT NULL AND sap.plan_end IS NOT NULL
                          AND DATEDIFF(day, sap.plan_start, sap.plan_end) > 0
                     THEN CASE
                            WHEN CAST(DATEDIFF(day, sap.plan_start, @ReportDateTo) AS FLOAT)
                                 / DATEDIFF(day, sap.plan_start, sap.plan_end) < 0 THEN 0.0
                            WHEN CAST(DATEDIFF(day, sap.plan_start, @ReportDateTo) AS FLOAT)
                                 / DATEDIFF(day, sap.plan_start, sap.plan_end) > 1 THEN 1.0
                            ELSE CAST(DATEDIFF(day, sap.plan_start, @ReportDateTo) AS FLOAT)
                                 / DATEDIFF(day, sap.plan_start, sap.plan_end)
                          END
                     ELSE NULL END                                                       AS PlannedPct,     -- 6
                -- Variance = progress - planned
                CASE WHEN sap.plan_start IS NOT NULL AND sap.plan_end IS NOT NULL
                          AND DATEDIFF(day, sap.plan_start, sap.plan_end) > 0
                     THEN w.progress - (CASE
                            WHEN CAST(DATEDIFF(day, sap.plan_start, @ReportDateTo) AS FLOAT)
                                 / DATEDIFF(day, sap.plan_start, sap.plan_end) < 0 THEN 0.0
                            WHEN CAST(DATEDIFF(day, sap.plan_start, @ReportDateTo) AS FLOAT)
                                 / DATEDIFF(day, sap.plan_start, sap.plan_end) > 1 THEN 1.0
                            ELSE CAST(DATEDIFF(day, sap.plan_start, @ReportDateTo) AS FLOAT)
                                 / DATEDIFF(day, sap.plan_start, sap.plan_end)
                          END)
                     ELSE NULL END                                                       AS Variance,       -- 7
                NULL                                                                     AS RatePerDay,     -- 8
                7.0                                                                      AS AskRate,        -- 9
                NULL                                                                     AS GapPerDay,      -- 10
                NULL                                                                     AS Spi,            -- 11
                NULL                                                                     AS Cpi,            -- 12
                w.well_type                                                              AS WellType,       -- 13
                -- Primary ODC category (exclusive, for ordering) — uses JOIN aliases, no per-row subqueries
                CASE
                    WHEN hc.well_id     IS NOT NULL THEN 'hookup'
                    WHEN sw.pdo_well_id IS NOT NULL THEN 'suspended'
                    WHEN dwc.pdo_well_id IS NOT NULL THEN 'completed'
                    WHEN dw.pdo_well_id IS NOT NULL THEN 'due'
                    WHEN ndw.pdo_well_id IS NOT NULL THEN 'notdue'
                    WHEN dnc.pdo_well_id IS NOT NULL THEN 'dnc'
                    WHEN w.actual_rig_off_date IS NOT NULL THEN 'drilled'
                    ELSE 'notdrilled'
                END                                                                      AS OdcCategory,    -- 14
                w.[location_preparation_status_in_progress_completed]                   AS LocPrepStatus,  -- 15
                w.drilling_pct                                                           AS DrillingPct,    -- 16
                w.[flow_line_commi._status_in_progress_completed]                       AS CommStatus,     -- 17
                w.[flow_line_const._status_in_progress_completed]                       AS ConstrStatus,   -- 18
                w.constr_pct                                                             AS ConstrPct,      -- 19
                w.comm_progress                                                          AS CommProgress,   -- 20
                w.actual_rig_on_date                                                     AS RigBy,          -- 21
                w.actual_rig_off_date                                                    AS RigTo,          -- 22
                -- Boolean flags via LEFT JOIN (evaluated once, not per-row — avoids timeout)
                CASE WHEN hc.well_id   IS NOT NULL THEN 1 ELSE 0 END AS IsHookup,       -- 23
                CASE WHEN sw.pdo_well_id IS NOT NULL THEN 1 ELSE 0 END AS IsSuspended,  -- 24
                CASE WHEN dw.pdo_well_id IS NOT NULL THEN 1 ELSE 0 END AS IsDue,        -- 25
                CASE WHEN ndw.pdo_well_id IS NOT NULL THEN 1 ELSE 0 END AS IsNotDue,    -- 26
                CASE WHEN dnc.pdo_well_id IS NOT NULL THEN 1 ELSE 0 END AS IsDnc,       -- 27
                CASE WHEN dwc.pdo_well_id IS NOT NULL THEN 1 ELSE 0 END AS IsDueCompleted, -- 28
                CASE WHEN acc.pdo_well_id IS NOT NULL THEN 1 ELSE 0 END AS IsAccelerated  -- 29
            FROM Wells w
            LEFT JOIN (SELECT ID, MIN([Cluster]) AS [Cluster] FROM [dbo].[ProjectIDs] WITH (NOLOCK) GROUP BY ID) p
                ON w.project_id = p.ID
            LEFT JOIN SapPlan           sap ON sap.Well_ID     = w.pdo_well_id
            LEFT JOIN HookupCompleted    hc  ON hc.well_id      = w.pdo_well_id
            LEFT JOIN SuspendedWells     sw  ON sw.pdo_well_id  = w.pdo_well_id
            LEFT JOIN DueWells           dw  ON dw.pdo_well_id  = w.pdo_well_id
            LEFT JOIN NotDueWells        ndw ON ndw.pdo_well_id = w.pdo_well_id
            LEFT JOIN DrilledNotCompleted dnc ON dnc.pdo_well_id = w.pdo_well_id
            LEFT JOIN DueWellsCompleted  dwc ON dwc.pdo_well_id = w.pdo_well_id
            LEFT JOIN AcceleratedWells   acc ON acc.pdo_well_id = w.pdo_well_id
            ORDER BY OdcCategory, w.pdo_well_id;
            """;

        await using var conn = new SqlConnection(cs);
        await conn.OpenAsync(ct);

        await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 300 };
        cmd.Parameters.AddWithValue("@pFrom", fromDate.ToDateTime(TimeOnly.MinValue));
        cmd.Parameters.AddWithValue("@pTo", toDate.ToDateTime(TimeOnly.MinValue));
        if (!string.IsNullOrWhiteSpace(cluster))  cmd.Parameters.AddWithValue("@cluster",  cluster.Trim());
        if (!string.IsNullOrWhiteSpace(site))     cmd.Parameters.AddWithValue("@site",     site.Trim());
        if (!string.IsNullOrWhiteSpace(wellType)) cmd.Parameters.AddWithValue("@wellType", wellType.Trim());
        if (!string.IsNullOrWhiteSpace(project))  cmd.Parameters.AddWithValue("@project",  project.Trim());
        await using var reader = await cmd.ExecuteReaderAsync(ct);

        var results = new List<object>();
        var seenOdcWells = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        while (await reader.ReadAsync(ct))
        {
            var odcWellId = reader.IsDBNull(0) ? "" : reader.GetValue(0).ToString()!;
            if (!seenOdcWells.Add(odcWellId)) continue;
            var progressRaw = reader.IsDBNull(5) ? 0.0 : Convert.ToDouble(reader.GetValue(5));
            var plannedRaw  = reader.IsDBNull(6) ? (double?)null : Convert.ToDouble(reader.GetValue(6));
            var varianceRaw = reader.IsDBNull(7) ? (double?)null : Convert.ToDouble(reader.GetValue(7));
            var ratePerDay  = reader.IsDBNull(8) ? (double?)null : Convert.ToDouble(reader.GetValue(8));
            var askRate     = reader.IsDBNull(9) ? 7.0 : Convert.ToDouble(reader.GetValue(9));
            var gapPerDay   = reader.IsDBNull(10) ? (double?)null : Convert.ToDouble(reader.GetValue(10));
            var spi         = reader.IsDBNull(11) ? (double?)null : Convert.ToDouble(reader.GetValue(11));
            var cpi         = reader.IsDBNull(12) ? (double?)null : Convert.ToDouble(reader.GetValue(12));
            var commProgress = reader.IsDBNull(20) ? 0.0 : Convert.ToDouble(reader.GetValue(20));

            results.Add(new
            {
                wellId      = reader.IsDBNull(0) ? "" : reader.GetValue(0).ToString(),
                wellName    = reader.IsDBNull(1) ? null : reader.GetValue(1).ToString(),
                status      = reader.IsDBNull(2) ? "PLANNED" : reader.GetValue(2).ToString(),
                field       = reader.IsDBNull(3) ? null : reader.GetValue(3).ToString(),
                rig         = reader.IsDBNull(4) ? null : reader.GetValue(4).ToString(),
                progressPct = Math.Round(progressRaw * 100.0, 1),
                plannedPct  = plannedRaw.HasValue ? Math.Round(plannedRaw.Value * 100.0, 1) : (double?)null,
                variance    = varianceRaw.HasValue ? Math.Round(varianceRaw.Value * 100.0, 1) : (double?)null,
                ratePerDay  = ratePerDay.HasValue ? Math.Round(ratePerDay.Value, 1) : (double?)null,
                askRate,
                gapPerDay   = gapPerDay.HasValue ? Math.Round(gapPerDay.Value, 1) : (double?)null,
                spi         = spi.HasValue ? Math.Round(spi.Value, 2) : (double?)null,
                cpi         = cpi.HasValue ? Math.Round(cpi.Value, 2) : (double?)null,
                wellType    = reader.IsDBNull(13) ? null : reader.GetValue(13).ToString(),
                odcCategory = reader.IsDBNull(14) ? "drilled" : reader.GetValue(14).ToString(),
                locPrepStatus = reader.IsDBNull(15) ? null : reader.GetValue(15).ToString(),
                drillingPct   = reader.IsDBNull(16) ? 0.0 : Math.Round(Convert.ToDouble(reader.GetValue(16)) * 100.0, 1),
                commStatus    = reader.IsDBNull(17) ? null : reader.GetValue(17).ToString(),
                constrStatus  = reader.IsDBNull(18) ? null : reader.GetValue(18).ToString(),
                constrPct     = reader.IsDBNull(19) ? 0.0 : Math.Round(Convert.ToDouble(reader.GetValue(19)) * 100.0, 1),
                commProgress  = Math.Round(commProgress * 100.0, 1),
                rigBy         = reader.IsDBNull(21) ? null : reader.GetValue(21).ToString(),
                rigTo         = reader.IsDBNull(22) ? null : reader.GetValue(22).ToString(),
                isHookup      = !reader.IsDBNull(23) && Convert.ToInt32(reader.GetValue(23)) == 1,
                isSuspended   = !reader.IsDBNull(24) && Convert.ToInt32(reader.GetValue(24)) == 1,
                isDue         = !reader.IsDBNull(25) && Convert.ToInt32(reader.GetValue(25)) == 1,
                isNotDue      = !reader.IsDBNull(26) && Convert.ToInt32(reader.GetValue(26)) == 1,
                isDnc         = !reader.IsDBNull(27) && Convert.ToInt32(reader.GetValue(27)) == 1,
                isDueCompleted = !reader.IsDBNull(28) && Convert.ToInt32(reader.GetValue(28)) == 1,
                isAccelerated  = !reader.IsDBNull(29) && Convert.ToInt32(reader.GetValue(29)) == 1
            });
        }

        return Ok(results);
    }

    /// <summary>
    /// CMD Weekly Readiness KPI � planned vs executed activities/wells, schedule alignment, document compliance.
    /// Uses ActivityTaskPlan (planned), task_daily (executed), WMR (documents).
    /// GET /dashboard/cmd-readiness-kpi?from=2026-05-23&amp;to=2026-05-29&amp;cluster=NIMR
    /// </summary>
    [HttpGet("cmd-readiness-kpi")]
    public async Task<IActionResult> CmdReadinessKpi(
        [FromQuery] DateOnly? from = null,
        [FromQuery] DateOnly? to = null,
        [FromQuery] string? cluster = null,
        [FromQuery] string? site = null,
        [FromQuery] string? wellType = null,
        [FromQuery] string? project = null,
        [FromQuery] string? wellId = null,
        CancellationToken ct = default)
    {
        // Check in-memory cache (5-minute TTL)
        var cacheKey = $"kpi|{from}|{to}|{cluster}|{site}|{wellType}|{project}|{wellId}";
        if (_cmdKpiCache.TryGetValue(cacheKey, out var cached) && (DateTime.UtcNow - cached.At).TotalMinutes < 30)
            return Ok(cached.Result);

        var cs = configuration.GetConnectionString("Default")
            ?? throw new InvalidOperationException("ConnectionStrings:Default not configured.");

        // Default: current week (Sunday�Saturday)
        var today = DateOnly.FromDateTime(DateTime.Today);
        var fromDate = from ?? today.AddDays(-(int)today.DayOfWeek);
        var toDateInclusive = to ?? fromDate.AddDays(6);
        var toDateExclusive = toDateInclusive.AddDays(1);

        // Build project filter via ProjectIDs table
        var pidSubquery = """
            SELECT CAST(ID AS NVARCHAR(100)) FROM [dbo].[ProjectIDs] WITH (NOLOCK)
            WHERE (@cluster = '' OR UPPER(LTRIM(RTRIM(CAST([Cluster] AS NVARCHAR(200))))) = UPPER(@cluster))
              AND (@site    = '' OR UPPER(LTRIM(RTRIM(CAST([Site]    AS NVARCHAR(200))))) = UPPER(@site))
              AND (@wellType= '' OR UPPER(LTRIM(RTRIM(CAST([Type]    AS NVARCHAR(200))))) = UPPER(@wellType))
              AND (@project = '' OR UPPER(LTRIM(RTRIM(CAST([Project] AS NVARCHAR(200))))) = UPPER(@project))
            """;

        var hasAnyFilter = !string.IsNullOrWhiteSpace(cluster) || !string.IsNullOrWhiteSpace(site)
                        || !string.IsNullOrWhiteSpace(wellType) || !string.IsNullOrWhiteSpace(project);

        var pidJoinP = hasAnyFilter
            ? @"LEFT JOIN [dbo].[ProjectIDs] p WITH (NOLOCK)
                ON CAST(t.project_id AS NVARCHAR(100)) = CAST(p.[ID] AS NVARCHAR(100))"
            : "";
        var pidJoinPAtp = hasAnyFilter
            ? @"LEFT JOIN [dbo].[ProjectIDs] p WITH (NOLOCK)
                ON CAST(atp.project_id AS NVARCHAR(100)) = CAST(p.[ID] AS NVARCHAR(100))"
            : "";
        var pidJoinPTd = hasAnyFilter
            ? @"LEFT JOIN [dbo].[ProjectIDs] p WITH (NOLOCK)
                ON td.[project_id] = TRY_CAST(p.[ID] AS UNIQUEIDENTIFIER)"
            : "";
        var pidWhereP = hasAnyFilter
            ? @"AND (@cluster  = '' OR UPPER(LTRIM(RTRIM(p.[Cluster]))) = UPPER(@cluster))
                AND (@site     = '' OR UPPER(LTRIM(RTRIM(p.[Site])))    = UPPER(@site))
                AND (@wellType = '' OR UPPER(LTRIM(RTRIM(p.[Type])))    = UPPER(@wellType))
                AND (@project  = '' OR UPPER(LTRIM(RTRIM(p.[Project]))) = UPPER(@project))"
            : "";

        var sql = $"""
            DECLARE @ws DATE = @pFrom;
            DECLARE @we DATE = @pTo;

            ;WITH

            -- BASE: ATP Planned Activities (WMR_TaskPlan_csv_imported, New_Well_ID)
            ATPPlanned AS (
                SELECT
                    t.New_Well_ID                               AS Well_ID,
                    t.code                                      AS code,
                    t.actual_start,
                    t.actual_end,
                    t.progress,
                    t.qtyforacst
                FROM [dbo].[WMR_TaskPlan_csv_imported] t WITH (NOLOCK)
                {pidJoinP}
                WHERE CAST(t.target_start AS DATE) >= @ws
                    AND CAST(t.target_start AS DATE) <= @we
                    AND CAST(t.target_end AS DATE)   >= @ws
                    AND CAST(t.target_end AS DATE)   <= @we
                    AND CAST(t.target_start AS DATE) > '1900-01-01'
                    AND CAST(t.target_end AS DATE)   > '1900-01-01'
                    AND t.qtyforacst IS NOT NULL
                    AND TRY_CAST(t.qtyforacst AS NUMERIC(18,5)) <> 0
                    AND TRY_CAST(t.qtyforacst AS NUMERIC(18,5)) <> 0.00001
                    AND (t.Resume_Suspend IS NULL OR t.Resume_Suspend = ''
                        OR UPPER(t.Resume_Suspend) NOT LIKE '%SUSPEND%')
                    AND t.New_Well_ID IS NOT NULL AND t.New_Well_ID <> ''
                    {pidWhereP}
            ),

            -- BASE: ATP Planned Activities WITH code (for activity matching)
            ATPPlannedWithCode AS (
                SELECT
                    t.New_Well_ID                               AS Well_ID,
                    t.code                                      AS code,
                    t.actual_start,
                    t.actual_end,
                    t.progress,
                    t.qtyforacst
                FROM [dbo].[WMR_TaskPlan_csv_imported] t WITH (NOLOCK)
                {pidJoinP}
                WHERE CAST(t.target_start AS DATE) >= @ws
                    AND CAST(t.target_start AS DATE) <= @we
                    AND CAST(t.target_end AS DATE)   >= @ws
                    AND CAST(t.target_end AS DATE)   <= @we
                    AND CAST(t.target_start AS DATE) > '1900-01-01'
                    AND CAST(t.target_end AS DATE)   > '1900-01-01'
                    AND t.qtyforacst IS NOT NULL
                    AND TRY_CAST(t.qtyforacst AS NUMERIC(18,5)) <> 0
                    AND TRY_CAST(t.qtyforacst AS NUMERIC(18,5)) <> 0.00001
                    AND (t.Resume_Suspend IS NULL OR t.Resume_Suspend = ''
                        OR UPPER(t.Resume_Suspend) NOT LIKE '%SUSPEND%')
                    AND t.New_Well_ID IS NOT NULL AND t.New_Well_ID <> ''
                    AND t.code IS NOT NULL AND t.code <> ''
                    {pidWhereP}
            ),

            -- BASE: task_daily Executed Activities
            TaskDailyExecuted AS (
                SELECT DISTINCT
                    LOWER(LTRIM(RTRIM(td.task_code)))           AS task_code,
                    td.well_id,
                    td.actual_start,
                    td.actual_end,
                    td.committed_start,
                    td.committed_end
                FROM [dbo].[task_daily] td WITH (NOLOCK)
                {pidJoinPTd}
                WHERE CAST(td.[ActionOn] AS DATE) BETWEEN @ws AND @we
                    AND td.data_qty IS NOT NULL
                    AND td.data_qty <> 0
                    AND td.data_qty <> 1
                    AND td.well_id NOT IN ('00000','00001','0')
                    AND td.task_code IS NOT NULL AND td.task_code <> ''
                    {pidWhereP}
            ),

            -- Planned Wells
            PlannedWells AS (
                SELECT DISTINCT Well_ID AS well_id FROM ATPPlanned
            ),

            -- Executed As Per Plan Wells (planned well + ANY work in task_daily)
            ExecutedAsPlannedWells AS (
                SELECT DISTINCT atp.Well_ID AS well_id
                FROM ATPPlanned atp
                INNER JOIN (
                    SELECT DISTINCT well_id
                    FROM [dbo].[task_daily] td WITH (NOLOCK)
                    {pidJoinPTd}
                    WHERE CAST(td.[ActionOn] AS DATE) BETWEEN @ws AND @we
                        AND td.data_qty IS NOT NULL
                        AND td.data_qty <> 0
                        AND td.data_qty <> 1
                        AND td.well_id NOT IN ('00000','00001','0')
                        AND td.task_code IS NOT NULL AND td.task_code <> ''
                        {pidWhereP}
                ) td ON atp.Well_ID = td.well_id
            ),

            -- Executed NOT As Per Plan Wells
            ExecutedNotAsPlannedWells AS (
                SELECT DISTINCT td.well_id
                FROM TaskDailyExecuted td
                WHERE td.well_id NOT IN (SELECT well_id FROM PlannedWells)
            ),

            -- Non Executed As Per Plan Wells
            NonExecutedAsPlannedWells AS (
                SELECT DISTINCT Well_ID AS well_id
                FROM ATPPlanned
                WHERE Well_ID NOT IN (SELECT DISTINCT well_id FROM TaskDailyExecuted)
            ),

            -- ALL UNIQUE WELLS
            AllWells AS (
                SELECT well_id FROM PlannedWells
                UNION
                SELECT well_id FROM ExecutedAsPlannedWells
                UNION
                SELECT well_id FROM ExecutedNotAsPlannedWells
                UNION
                SELECT well_id FROM NonExecutedAsPlannedWells
            ),

            -- Section 2: Total Activities Planned
            TotalActivitiesPlanned AS (
                SELECT COUNT(DISTINCT code) AS cnt FROM ATPPlannedWithCode
            ),

            -- Section 2: In Progress Activities Planned (started but not ended)
            InProgressActivitiesPlanned AS (
                SELECT COUNT(DISTINCT code) AS cnt
                FROM ATPPlannedWithCode
                WHERE actual_start IS NOT NULL
                    AND CAST(actual_start AS DATE) > '1900-01-01'
                    AND (actual_end IS NULL OR CAST(actual_end AS DATE) = '1900-01-01')
            ),

            -- Section 2: New Activities Planned (not started)
            NewActivitiesPlanned AS (
                SELECT COUNT(DISTINCT code) AS cnt
                FROM ATPPlannedWithCode
                WHERE actual_start IS NULL
                    OR CAST(actual_start AS DATE) = '1900-01-01'
            ),

            -- Section 2: Total Executed As Planned
            TotalExecutedAsPlanned AS (
                SELECT COUNT(*) AS cnt FROM (
                    SELECT DISTINCT atp.code
                    FROM ATPPlannedWithCode atp
                    INNER JOIN TaskDailyExecuted td
                        ON LOWER(LTRIM(RTRIM(atp.code))) = td.task_code
                ) x
            ),

            -- Section 2: In Progress Executed As Planned (started but not ended)
            InProgressExecutedAsPlanned AS (
                SELECT COUNT(*) AS cnt FROM (
                    SELECT DISTINCT atp.code
                    FROM ATPPlannedWithCode atp
                    INNER JOIN TaskDailyExecuted td
                        ON LOWER(LTRIM(RTRIM(atp.code))) = td.task_code
                    WHERE atp.actual_start IS NOT NULL
                        AND CAST(atp.actual_start AS DATE) > '1900-01-01'
                        AND (atp.actual_end IS NULL OR CAST(atp.actual_end AS DATE) = '1900-01-01')
                ) x
            ),

            -- Section 2: New Executed As Planned
            NewExecutedAsPlanned AS (
                SELECT COUNT(*) AS cnt FROM (
                    SELECT DISTINCT atp.code
                    FROM ATPPlannedWithCode atp
                    INNER JOIN TaskDailyExecuted td
                        ON LOWER(LTRIM(RTRIM(atp.code))) = td.task_code
                    WHERE atp.actual_start IS NULL
                        OR CAST(atp.actual_start AS DATE) = '1900-01-01'
                ) x
            ),

            -- Section 3: Total Activities Executed
            TotalActivitiesExecuted AS (
                SELECT COUNT(DISTINCT task_code) AS cnt FROM TaskDailyExecuted
            ),

            -- Section 5: New Activities Scheduled
            NewActivitiesScheduled AS (
                SELECT COUNT(DISTINCT code) AS cnt
                FROM ATPPlannedWithCode
                WHERE actual_start IS NULL
                    OR CAST(actual_start AS DATE) = '1900-01-01'
            ),

            -- Section 5: New Activities Committed (well_id match + committed_start in range)
            NewActivitiesCommitted AS (
                SELECT COUNT(*) AS cnt FROM (
                    SELECT DISTINCT atp.code
                    FROM ATPPlannedWithCode atp
                    INNER JOIN (
                        SELECT DISTINCT td.well_id, td.committed_start
                        FROM [dbo].[task_daily] td WITH (NOLOCK)
                        {pidJoinPTd}
                        WHERE CAST(td.[ActionOn] AS DATE) BETWEEN @ws AND @we
                            AND td.data_qty IS NOT NULL
                            AND td.data_qty <> 0
                            AND td.data_qty <> 1
                            AND td.well_id NOT IN ('00000','00001','0')
                            AND td.task_code IS NOT NULL AND td.task_code <> ''
                            AND td.committed_start IS NOT NULL
                            AND CAST(td.committed_start AS DATE) > '1900-01-01'
                            AND CAST(td.committed_start AS DATE) >= @ws
                            AND CAST(td.committed_start AS DATE) <= @we
                            {pidWhereP}
                    ) td ON atp.Well_ID = td.well_id
                    WHERE atp.actual_start IS NULL
                        OR CAST(atp.actual_start AS DATE) = '1900-01-01'
                ) x
            ),

            -- Section 6: Latest WMR row per well
            WmrLatest AS (
                SELECT
                    pdo_well_id, location_po_no, actual_pegged_date, flaf_issue_date, flow_line_po_no,
                    ROW_NUMBER() OVER (PARTITION BY pdo_well_id ORDER BY TRY_CAST(Week_Number AS DATE) DESC) AS rn
                FROM [dbo].[WMR] WITH (NOLOCK)
                WHERE TRY_CAST(Week_Number AS DATE) IS NOT NULL
            ),

            -- Section 6: Document Compliance
            DocCompliance AS (
                SELECT
                    COUNT(DISTINCT a.well_id) * 4 AS Total_Required_Documents,
                    SUM(
                        CASE WHEN w.location_po_no IS NOT NULL AND LTRIM(RTRIM(w.location_po_no)) <> '' THEN 1 ELSE 0 END
                      + CASE WHEN w.actual_pegged_date IS NOT NULL AND LTRIM(RTRIM(CAST(w.actual_pegged_date AS NVARCHAR(100)))) <> '' THEN 1 ELSE 0 END
                      + CASE WHEN w.flaf_issue_date IS NOT NULL AND LTRIM(RTRIM(CAST(w.flaf_issue_date AS NVARCHAR(100)))) <> '' THEN 1 ELSE 0 END
                      + CASE WHEN w.flow_line_po_no IS NOT NULL AND LTRIM(RTRIM(w.flow_line_po_no)) <> '' THEN 1 ELSE 0 END
                    ) AS Total_Submitted_Documents
                FROM AllWells a
                LEFT JOIN WmrLatest w ON w.pdo_well_id = a.well_id AND w.rn = 1
            )

            -- FINAL COMBINED RESULT (22 columns)
            SELECT
                -- Section 1: Wells
                (SELECT COUNT(*) FROM PlannedWells)                                        AS Planned_Wells,
                (SELECT COUNT(*) FROM ExecutedAsPlannedWells)                               AS Executed_Wells_As_Per_Plan,
                (SELECT COUNT(*) FROM ExecutedNotAsPlannedWells)                             AS Executed_Wells_Not_As_Per_Plan,
                (SELECT COUNT(*) FROM PlannedWells) - (SELECT COUNT(*) FROM ExecutedAsPlannedWells) AS Non_Executed_Wells,
                CASE WHEN (SELECT COUNT(*) FROM PlannedWells) = 0 THEN 0
                     ELSE CAST((SELECT COUNT(*) FROM ExecutedAsPlannedWells) AS FLOAT) / (SELECT COUNT(*) FROM PlannedWells) * 100
                END                                                                         AS Planned_Well_Coverage_Pct,
                -- Section 2: Activity Coverage
                tp.cnt                                                                      AS Total_Activities_Planned,
                ip.cnt                                                                      AS InProgress_Activities_Planned,
                np.cnt                                                                      AS New_Activities_Planned,
                te.cnt                                                                      AS Total_Executed_As_Planned,
                ie.cnt                                                                      AS InProgress_Executed_As_Planned,
                ne.cnt                                                                      AS New_Executed_As_Planned,
                CASE WHEN tp.cnt = 0 THEN 0 ELSE CAST(te.cnt AS FLOAT) / tp.cnt * 100 END  AS Planned_Activity_Coverage_Pct,
                -- Section 3: Unplanned
                ta.cnt                                                                      AS Total_Activities_Executed,
                (ta.cnt - te.cnt)                                                           AS Unplanned_Activities_Executed,
                CASE WHEN ta.cnt = 0 THEN 0 ELSE CAST((ta.cnt - te.cnt) AS FLOAT) / ta.cnt * 100 END AS Unplanned_Activities_Pct,
                -- Section 5: Schedule Alignment
                ns.cnt                                                                      AS New_Activities_Scheduled,
                nc.cnt                                                                      AS New_Activities_Committed,
                CASE WHEN ns.cnt = 0 THEN 0 ELSE CAST(nc.cnt AS FLOAT) / ns.cnt * 100 END  AS Schedule_Alignment_Pct,
                -- Section 6: Documents
                d.Total_Required_Documents,
                d.Total_Submitted_Documents,
                (d.Total_Required_Documents - d.Total_Submitted_Documents)                  AS Total_Missing_Documents,
                CASE WHEN d.Total_Required_Documents = 0 THEN 0
                     ELSE CAST(d.Total_Submitted_Documents AS FLOAT) / d.Total_Required_Documents * 100
                END                                                                         AS Document_Compliance_Pct
            FROM
                TotalActivitiesPlanned      tp,
                InProgressActivitiesPlanned ip,
                NewActivitiesPlanned        np,
                TotalExecutedAsPlanned      te,
                InProgressExecutedAsPlanned ie,
                NewExecutedAsPlanned        ne,
                TotalActivitiesExecuted     ta,
                NewActivitiesScheduled      ns,
                NewActivitiesCommitted      nc,
                DocCompliance               d
            """;

        await using var conn = new SqlConnection(cs);
        await conn.OpenAsync(ct);
        await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 120 };
        cmd.Parameters.AddWithValue("@pFrom", fromDate.ToDateTime(TimeOnly.MinValue));
        cmd.Parameters.AddWithValue("@pTo", toDateInclusive.ToDateTime(TimeOnly.MinValue));
        cmd.Parameters.AddWithValue("@cluster",  string.IsNullOrWhiteSpace(cluster)  ? "" : cluster.Trim());
        cmd.Parameters.AddWithValue("@site",     string.IsNullOrWhiteSpace(site)     ? "" : site.Trim());
        cmd.Parameters.AddWithValue("@wellType", string.IsNullOrWhiteSpace(wellType) ? "" : wellType.Trim());
        cmd.Parameters.AddWithValue("@project",  string.IsNullOrWhiteSpace(project)  ? "" : project.Trim());
        if (!string.IsNullOrWhiteSpace(wellId))   cmd.Parameters.AddWithValue("@wellId",   wellId.Trim());

        await using var reader = await cmd.ExecuteReaderAsync(ct);
        if (await reader.ReadAsync(ct))
        {
            // All 22 columns from SQL (percentages computed in SQL)
            var plannedWells               = reader.IsDBNull(0)  ? 0   : Convert.ToInt32(reader.GetValue(0));
            var executedWellsAsPerPlan     = reader.IsDBNull(1)  ? 0   : Convert.ToInt32(reader.GetValue(1));
            var executedWellsNotAsPerPlan  = reader.IsDBNull(2)  ? 0   : Convert.ToInt32(reader.GetValue(2));
            var nonExecutedWells           = reader.IsDBNull(3)  ? 0   : Convert.ToInt32(reader.GetValue(3));
            var wellCoveragePct            = reader.IsDBNull(4)  ? 0.0 : Convert.ToDouble(reader.GetValue(4));

            var totalActivitiesPlanned     = reader.IsDBNull(5)  ? 0   : Convert.ToInt32(reader.GetValue(5));
            var inProgressPlanned          = reader.IsDBNull(6)  ? 0   : Convert.ToInt32(reader.GetValue(6));
            var newPlanned                 = reader.IsDBNull(7)  ? 0   : Convert.ToInt32(reader.GetValue(7));
            var totalExecAsPlanned         = reader.IsDBNull(8)  ? 0   : Convert.ToInt32(reader.GetValue(8));
            var inProgressExec             = reader.IsDBNull(9)  ? 0   : Convert.ToInt32(reader.GetValue(9));
            var newExec                    = reader.IsDBNull(10) ? 0   : Convert.ToInt32(reader.GetValue(10));
            var activityCoveragePct        = reader.IsDBNull(11) ? 0.0 : Convert.ToDouble(reader.GetValue(11));

            var totalActivitiesExecuted    = reader.IsDBNull(12) ? 0   : Convert.ToInt32(reader.GetValue(12));
            var unplannedExecuted          = reader.IsDBNull(13) ? 0   : Convert.ToInt32(reader.GetValue(13));
            var unplannedPct               = reader.IsDBNull(14) ? 0.0 : Convert.ToDouble(reader.GetValue(14));

            var newScheduled               = reader.IsDBNull(15) ? 0   : Convert.ToInt32(reader.GetValue(15));
            var newCommitted               = reader.IsDBNull(16) ? 0   : Convert.ToInt32(reader.GetValue(16));
            var alignmentPct               = reader.IsDBNull(17) ? 0.0 : Convert.ToDouble(reader.GetValue(17));

            var totalRequired              = reader.IsDBNull(18) ? 0   : Convert.ToInt32(reader.GetValue(18));
            var totalSubmitted             = reader.IsDBNull(19) ? 0   : Convert.ToInt32(reader.GetValue(19));
            var totalMissing               = reader.IsDBNull(20) ? 0   : Convert.ToInt32(reader.GetValue(20));
            var docCompliancePct           = reader.IsDBNull(21) ? 0.0 : Convert.ToDouble(reader.GetValue(21));

            var result = new
            {
                plannedWells,
                executedWellsAsPerPlan,
                unplannedWellsExecuted = executedWellsNotAsPerPlan,
                nonExecutedWellsAsPerPlan = Math.Max(0, nonExecutedWells),
                plannedWellCoveragePct = Math.Round((decimal)wellCoveragePct, 2),
                totalActivitiesPlanned,
                inProgressActivitiesPlanned = inProgressPlanned,
                newActivitiesPlanned = newPlanned,
                totalExecutedAsPlanned = totalExecAsPlanned,
                inProgressExecutedAsPlanned = inProgressExec,
                newExecutedAsPlanned = newExec,
                plannedActivityCoveragePct = Math.Round((decimal)activityCoveragePct, 2),
                totalActivitiesExecuted,
                unplannedActivitiesExecuted = Math.Max(0, unplannedExecuted),
                unplannedActivitiesPct = Math.Round((decimal)unplannedPct, 2),
                newActivitiesScheduled = newScheduled,
                newActivitiesCommitted = newCommitted,
                scheduleAlignmentPct = Math.Round((decimal)alignmentPct, 2),
                totalRequiredDocuments = totalRequired,
                totalSubmittedDocuments = totalSubmitted,
                totalMissingDocuments = Math.Max(0, totalMissing),
                documentCompliancePct = Math.Round((decimal)docCompliancePct, 2)
            };
            _cmdKpiCache[cacheKey] = (DateTime.UtcNow, result);
            return Ok(result);
        }

        var emptyResult = new
        {
            plannedWells = 0, executedWellsAsPerPlan = 0,
            unplannedWellsExecuted = 0, nonExecutedWellsAsPerPlan = 0, plannedWellCoveragePct = 0m,
            totalActivitiesPlanned = 0, inProgressActivitiesPlanned = 0, newActivitiesPlanned = 0,
            totalExecutedAsPlanned = 0, inProgressExecutedAsPlanned = 0, newExecutedAsPlanned = 0,
            plannedActivityCoveragePct = 0m,
            totalActivitiesExecuted = 0, unplannedActivitiesExecuted = 0, unplannedActivitiesPct = 0m,
            newActivitiesScheduled = 0, newActivitiesCommitted = 0, scheduleAlignmentPct = 0m,
            totalRequiredDocuments = 0, totalSubmittedDocuments = 0, totalMissingDocuments = 0,
            documentCompliancePct = 0m
        };
        _cmdKpiCache[cacheKey] = (DateTime.UtcNow, emptyResult);
        return Ok(emptyResult);
    }

    /// <summary>
    /// Well-level drilldown for the "Wells � Planned vs. Actual" widget.
    /// Returns the individual wells that make up each WPA category: planned, executed_as_plan,
    /// executed_not_as_plan, non_executed.
    /// GET /dashboard/cmd-readiness-kpi-wells?from=2026-05-23&amp;to=2026-05-29&amp;category=planned&amp;page=1&amp;pageSize=50
    /// </summary>
    [HttpGet("cmd-readiness-kpi-wells")]
    public async Task<IActionResult> CmdReadinessKpiWells(
        [FromQuery] string category = "planned",
        [FromQuery] DateOnly? from = null,
        [FromQuery] DateOnly? to = null,
        [FromQuery] string? cluster = null,
        [FromQuery] string? site = null,
        [FromQuery] string? wellType = null,
        [FromQuery] string? project = null,
        [FromQuery] string? wellId = null,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50,
        CancellationToken ct = default)
    {
        // Check in-memory cache (5-minute TTL)
        var cacheKey = $"wells|{category}|{from}|{to}|{cluster}|{site}|{wellType}|{project}|{wellId}|{page}|{pageSize}";
        if (_cmdKpiWellsCache.TryGetValue(cacheKey, out var cached) && (DateTime.UtcNow - cached.At).TotalMinutes < 30)
            return Ok(cached.Result);

        var cs = configuration.GetConnectionString("Default")
            ?? throw new InvalidOperationException("ConnectionStrings:Default not configured.");

        var today = DateOnly.FromDateTime(DateTime.Today);
        var fromDate = from ?? today.AddDays(-(int)today.DayOfWeek);
        var toDateInclusive = to ?? fromDate.AddDays(6);
        var toDateExclusive = toDateInclusive.AddDays(1);

        var pidSubquery = """
            SELECT CAST(ID AS NVARCHAR(100)) FROM [dbo].[ProjectIDs] WITH (NOLOCK)
            WHERE (@cluster = '' OR UPPER(LTRIM(RTRIM(CAST([Cluster] AS NVARCHAR(200))))) = UPPER(@cluster))
              AND (@site    = '' OR UPPER(LTRIM(RTRIM(CAST([Site]    AS NVARCHAR(200))))) = UPPER(@site))
              AND (@wellType= '' OR UPPER(LTRIM(RTRIM(CAST([Type]    AS NVARCHAR(200))))) = UPPER(@wellType))
              AND (@project = '' OR UPPER(LTRIM(RTRIM(CAST([Project] AS NVARCHAR(200))))) = UPPER(@project))
            """;

        var hasAnyFilter = !string.IsNullOrWhiteSpace(cluster) || !string.IsNullOrWhiteSpace(site)
                        || !string.IsNullOrWhiteSpace(wellType) || !string.IsNullOrWhiteSpace(project);

        string projectFilter = hasAnyFilter ? $" AND t.project_id IN ({pidSubquery})" : "";

        string sql = "";
        string countSql = "";

        if (category.Equals("planned", StringComparison.OrdinalIgnoreCase))
        {
            // -- Planned Wells � uses Well_ID directly, target_start/target_end --
            sql = $"""
                DECLARE @ws DATE = @pFrom;
                DECLARE @we DATE = @pTo;

                ;WITH
                PlannedWells AS (
                    SELECT DISTINCT
                        CAST(t.New_Well_ID AS NVARCHAR(50)) AS well_id
                    FROM dbo.WMR_TaskPlan_csv_imported t WITH (NOLOCK)
                    WHERE CAST(t.target_start AS DATE) >= @ws
                        AND CAST(t.target_start AS DATE) <= @we
                        AND CAST(t.target_end AS DATE)   >= @ws
                        AND CAST(t.target_end AS DATE)   <= @we
                        AND CAST(t.target_start AS DATE) > '1900-01-01'
                        AND CAST(t.target_end AS DATE)   > '1900-01-01'
                        AND t.qtyforacst IS NOT NULL
                        AND TRY_CAST(t.qtyforacst AS NUMERIC(18,5)) <> 0
                        AND TRY_CAST(t.qtyforacst AS NUMERIC(18,5)) <> 0.00001
                        AND (t.Resume_Suspend IS NULL OR t.Resume_Suspend = '' OR UPPER(t.Resume_Suspend) NOT LIKE '%SUSPEND%')
                        AND t.New_Well_ID IS NOT NULL AND t.New_Well_ID <> ''
                        {projectFilter}
                ),
                WmrLatest AS (
                    SELECT
                        pdo_well_id, station_name_no, well_location, well_type, rig_no,
                        over_all_progress_percentages,
                        [overall_loc._preparation_10_100], [overall_const._10_100],
                        ohl_progress, [overall_comm_progress_100],
                        actual_rig_on_date, actual_rig_off_date,
                        ROW_NUMBER() OVER (PARTITION BY pdo_well_id ORDER BY TRY_CAST(CASE WHEN Week_Number LIKE '[0-9][0-9]-[0-9][0-9]-[0-9][0-9]' THEN '20' + Week_Number ELSE Week_Number END AS DATE) DESC) AS rn
                    FROM dbo.WMR WITH (NOLOCK)
                    WHERE TRY_CAST(CASE WHEN Week_Number LIKE '[0-9][0-9]-[0-9][0-9]-[0-9][0-9]' THEN '20' + Week_Number ELSE Week_Number END AS DATE) IS NOT NULL
                ),
                SapPlan AS (
                    SELECT Well_ID,
                           MIN(TRY_CAST(Earl_start_date AS DATE)) AS plan_start,
                           MAX(TRY_CAST(EarliestEndDate AS DATE)) AS plan_end
                    FROM [dbo].[SAP_DRILLING_SEQUENCE_History] WITH (NOLOCK)
                    WHERE Well_ID IS NOT NULL AND Well_ID <> ''

                    GROUP BY Well_ID
                )
                SELECT
                    p.well_id                   AS WellId,
                    ISNULL(w.well_location, '') AS WellName,
                    ISNULL(w.station_name_no, '') AS Field,
                    ISNULL(w.rig_no, '')        AS Rig,
                    ISNULL(w.well_type, '')     AS WellType,
                    ROUND(ISNULL(TRY_CAST(REPLACE(REPLACE(ISNULL(w.over_all_progress_percentages, '0'), '%', ''), ' ', '') AS FLOAT), 0) * 100, 1) AS ProgressPct,
                    CASE
                        WHEN sap.plan_start IS NOT NULL AND sap.plan_end IS NOT NULL
                             AND DATEDIFF(day, sap.plan_start, sap.plan_end) > 0
                        THEN ROUND(CASE
                               WHEN CAST(DATEDIFF(day, sap.plan_start, GETDATE()) AS FLOAT) / DATEDIFF(day, sap.plan_start, sap.plan_end) < 0 THEN 0.0
                               WHEN CAST(DATEDIFF(day, sap.plan_start, GETDATE()) AS FLOAT) / DATEDIFF(day, sap.plan_start, sap.plan_end) > 1 THEN 100.0
                               ELSE CAST(DATEDIFF(day, sap.plan_start, GETDATE()) AS FLOAT) / DATEDIFF(day, sap.plan_start, sap.plan_end) * 100.0
                             END, 1)
                        ELSE NULL
                    END AS PlannedPct,
                    ROUND(ISNULL(TRY_CAST(w.[overall_loc._preparation_10_100] AS FLOAT), 0) * 100, 1) AS LocPrepPct,
                    ROUND(ISNULL(TRY_CAST(w.[overall_const._10_100] AS FLOAT), 0) * 100, 1) AS FlConstructionPct,
                    ROUND(ISNULL(TRY_CAST(w.ohl_progress AS FLOAT), 0) * 100, 1) AS OhlPct,
                    ROUND(ISNULL(TRY_CAST(w.[overall_comm_progress_100] AS FLOAT), 0) * 100, 1) AS CommPct,
                    ISNULL(CONVERT(VARCHAR(20), TRY_CAST(w.actual_rig_on_date AS DATE), 126), '') AS RigOnDate,
                    ISNULL(CONVERT(VARCHAR(20), TRY_CAST(w.actual_rig_off_date AS DATE), 126), '') AS RigOffDate,
                    'planned' AS Category,
                    CASE
                        WHEN ROUND(ISNULL(TRY_CAST(REPLACE(REPLACE(ISNULL(w.over_all_progress_percentages,'0'),'%',''),' ','') AS FLOAT),0),4) > 0
                             AND DATEDIFF(day, COALESCE(TRY_CAST(w.actual_rig_on_date AS DATE), sap.plan_start), GETDATE()) > 0
                        THEN ROUND(ISNULL(TRY_CAST(REPLACE(REPLACE(ISNULL(w.over_all_progress_percentages,'0'),'%',''),' ','') AS FLOAT),0)
                             / DATEDIFF(day, COALESCE(TRY_CAST(w.actual_rig_on_date AS DATE), sap.plan_start), GETDATE()) * 100, 4)
                        ELSE NULL
                    END AS RatePerDay,
                    CASE
                        WHEN sap.plan_end IS NOT NULL AND DATEDIFF(day, GETDATE(), sap.plan_end) > 0
                             AND ISNULL(TRY_CAST(REPLACE(REPLACE(ISNULL(w.over_all_progress_percentages,'0'),'%',''),' ','') AS FLOAT),0) < 1.0
                        THEN ROUND((1.0 - ISNULL(TRY_CAST(REPLACE(REPLACE(ISNULL(w.over_all_progress_percentages,'0'),'%',''),' ','') AS FLOAT),0))
                             / DATEDIFF(day, GETDATE(), sap.plan_end) * 100, 4)
                        ELSE NULL
                    END AS AskRate
                FROM PlannedWells p
                LEFT JOIN WmrLatest w ON w.pdo_well_id = p.well_id AND w.rn = 1
                LEFT JOIN SapPlan sap ON sap.Well_ID = p.well_id
                ORDER BY p.well_id
                """;

            countSql = $"""
                DECLARE @ws DATE = @pFrom;
                DECLARE @we DATE = @pTo;

                SELECT COUNT(DISTINCT t.New_Well_ID)
                FROM dbo.WMR_TaskPlan_csv_imported t WITH (NOLOCK)
                WHERE CAST(t.target_start AS DATE) >= @ws
                    AND CAST(t.target_start AS DATE) <= @we
                    AND CAST(t.target_end AS DATE)   >= @ws
                    AND CAST(t.target_end AS DATE)   <= @we
                    AND CAST(t.target_start AS DATE) > '1900-01-01'
                    AND CAST(t.target_end AS DATE)   > '1900-01-01'
                    AND t.qtyforacst IS NOT NULL
                    AND TRY_CAST(t.qtyforacst AS NUMERIC(18,5)) <> 0
                    AND TRY_CAST(t.qtyforacst AS NUMERIC(18,5)) <> 0.00001
                    AND (t.Resume_Suspend IS NULL OR t.Resume_Suspend = '' OR UPPER(t.Resume_Suspend) NOT LIKE '%SUSPEND%')
                    AND t.New_Well_ID IS NOT NULL AND t.New_Well_ID <> ''
                    {projectFilter}
                """;
        }
        else if (category.Equals("executed_as_plan", StringComparison.OrdinalIgnoreCase))
        {
            // -- Executed As Planned � INNER JOIN ActivityTaskPlan ? task_daily on Well_ID --
            var pidJoinAtp = hasAnyFilter
                ? @"LEFT JOIN [dbo].[ProjectIDs] p WITH (NOLOCK)
                    ON CAST(atp.project_id AS NVARCHAR(100)) = CAST(p.[ID] AS NVARCHAR(100))"
                : "";
            var pidWhereAtp = hasAnyFilter
                ? @"AND (@cluster  = '' OR UPPER(LTRIM(RTRIM(p.[Cluster]))) = UPPER(@cluster))
                    AND (@site     = '' OR UPPER(LTRIM(RTRIM(p.[Site])))    = UPPER(@site))
                    AND (@wellType = '' OR UPPER(LTRIM(RTRIM(p.[Type])))    = UPPER(@wellType))
                    AND (@project  = '' OR UPPER(LTRIM(RTRIM(p.[Project]))) = UPPER(@project))"
                : "";

            sql = $"""
                DECLARE @ws DATE = @pFrom;
                DECLARE @we DATE = @pTo;

                ;WITH
                ExecutedAsPlanned AS (
                    SELECT DISTINCT
                        CAST(atp.New_Well_ID AS NVARCHAR(50)) AS well_id
                    FROM [dbo].[WMR_TaskPlan_csv_imported] atp WITH (NOLOCK)
                    {pidJoinAtp}
                    INNER JOIN (
                        SELECT DISTINCT well_id
                        FROM [dbo].[task_daily] WITH (NOLOCK)
                        WHERE CAST(ActionOn AS DATE) BETWEEN @ws AND @we
                            AND data_qty IS NOT NULL AND data_qty <> 0 AND data_qty <> 1
                            AND well_id NOT IN ('00000','00001','0')
                            AND task_code IS NOT NULL AND task_code <> ''
                    ) td ON atp.New_Well_ID = td.well_id
                    WHERE CAST(atp.target_start AS DATE) >= @ws
                        AND CAST(atp.target_start AS DATE) <= @we
                        AND CAST(atp.target_end AS DATE)   >= @ws
                        AND CAST(atp.target_end AS DATE)   <= @we
                        AND CAST(atp.target_start AS DATE) > '1900-01-01'
                        AND CAST(atp.target_end AS DATE)   > '1900-01-01'
                        AND atp.qtyforacst IS NOT NULL
                        AND TRY_CAST(atp.qtyforacst AS NUMERIC(18,5)) <> 0
                        AND TRY_CAST(atp.qtyforacst AS NUMERIC(18,5)) <> 0.00001
                        AND (atp.Resume_Suspend IS NULL OR atp.Resume_Suspend = '' OR UPPER(atp.Resume_Suspend) NOT LIKE '%SUSPEND%')
                        AND atp.New_Well_ID IS NOT NULL AND atp.New_Well_ID <> ''
                        {pidWhereAtp}
                ),
                WmrLatest AS (
                    SELECT
                        pdo_well_id, station_name_no, well_location, well_type, rig_no,
                        over_all_progress_percentages,
                        [overall_loc._preparation_10_100], [overall_const._10_100],
                        ohl_progress, [overall_comm_progress_100],
                        actual_rig_on_date, actual_rig_off_date,
                        ROW_NUMBER() OVER (PARTITION BY pdo_well_id ORDER BY TRY_CAST(CASE WHEN Week_Number LIKE '[0-9][0-9]-[0-9][0-9]-[0-9][0-9]' THEN '20' + Week_Number ELSE Week_Number END AS DATE) DESC) AS rn
                    FROM dbo.WMR WITH (NOLOCK)
                    WHERE TRY_CAST(CASE WHEN Week_Number LIKE '[0-9][0-9]-[0-9][0-9]-[0-9][0-9]' THEN '20' + Week_Number ELSE Week_Number END AS DATE) IS NOT NULL
                ),
                SapPlan AS (
                    SELECT Well_ID,
                           MIN(TRY_CAST(Earl_start_date AS DATE)) AS plan_start,
                           MAX(TRY_CAST(EarliestEndDate AS DATE)) AS plan_end
                    FROM [dbo].[SAP_DRILLING_SEQUENCE_History] WITH (NOLOCK)
                    WHERE Well_ID IS NOT NULL AND Well_ID <> ''

                    GROUP BY Well_ID
                )
                SELECT
                    e.well_id                   AS WellId,
                    ISNULL(w.well_location, '') AS WellName,
                    ISNULL(w.station_name_no, '') AS Field,
                    ISNULL(w.rig_no, '')        AS Rig,
                    ISNULL(w.well_type, '')     AS WellType,
                    ROUND(ISNULL(TRY_CAST(REPLACE(REPLACE(ISNULL(w.over_all_progress_percentages, '0'), '%', ''), ' ', '') AS FLOAT), 0) * 100, 1) AS ProgressPct,
                    CASE
                        WHEN sap.plan_start IS NOT NULL AND sap.plan_end IS NOT NULL
                             AND DATEDIFF(day, sap.plan_start, sap.plan_end) > 0
                        THEN ROUND(CASE
                               WHEN CAST(DATEDIFF(day, sap.plan_start, GETDATE()) AS FLOAT) / DATEDIFF(day, sap.plan_start, sap.plan_end) < 0 THEN 0.0
                               WHEN CAST(DATEDIFF(day, sap.plan_start, GETDATE()) AS FLOAT) / DATEDIFF(day, sap.plan_start, sap.plan_end) > 1 THEN 100.0
                               ELSE CAST(DATEDIFF(day, sap.plan_start, GETDATE()) AS FLOAT) / DATEDIFF(day, sap.plan_start, sap.plan_end) * 100.0
                             END, 1)
                        ELSE NULL
                    END AS PlannedPct,
                    ROUND(ISNULL(TRY_CAST(w.[overall_loc._preparation_10_100] AS FLOAT), 0) * 100, 1) AS LocPrepPct,
                    ROUND(ISNULL(TRY_CAST(w.[overall_const._10_100] AS FLOAT), 0) * 100, 1) AS FlConstructionPct,
                    ROUND(ISNULL(TRY_CAST(w.ohl_progress AS FLOAT), 0) * 100, 1) AS OhlPct,
                    ROUND(ISNULL(TRY_CAST(w.[overall_comm_progress_100] AS FLOAT), 0) * 100, 1) AS CommPct,
                    ISNULL(CONVERT(VARCHAR(20), TRY_CAST(w.actual_rig_on_date AS DATE), 126), '') AS RigOnDate,
                    ISNULL(CONVERT(VARCHAR(20), TRY_CAST(w.actual_rig_off_date AS DATE), 126), '') AS RigOffDate,
                    'executed_as_plan' AS Category,
                    CASE
                        WHEN ROUND(ISNULL(TRY_CAST(REPLACE(REPLACE(ISNULL(w.over_all_progress_percentages,'0'),'%',''),' ','') AS FLOAT),0),4) > 0
                             AND DATEDIFF(day, COALESCE(TRY_CAST(w.actual_rig_on_date AS DATE), sap.plan_start), GETDATE()) > 0
                        THEN ROUND(ISNULL(TRY_CAST(REPLACE(REPLACE(ISNULL(w.over_all_progress_percentages,'0'),'%',''),' ','') AS FLOAT),0)
                             / DATEDIFF(day, COALESCE(TRY_CAST(w.actual_rig_on_date AS DATE), sap.plan_start), GETDATE()) * 100, 4)
                        ELSE NULL
                    END AS RatePerDay,
                    CASE
                        WHEN sap.plan_end IS NOT NULL AND DATEDIFF(day, GETDATE(), sap.plan_end) > 0
                             AND ISNULL(TRY_CAST(REPLACE(REPLACE(ISNULL(w.over_all_progress_percentages,'0'),'%',''),' ','') AS FLOAT),0) < 1.0
                        THEN ROUND((1.0 - ISNULL(TRY_CAST(REPLACE(REPLACE(ISNULL(w.over_all_progress_percentages,'0'),'%',''),' ','') AS FLOAT),0))
                             / DATEDIFF(day, GETDATE(), sap.plan_end) * 100, 4)
                        ELSE NULL
                    END AS AskRate
                FROM ExecutedAsPlanned e
                LEFT JOIN WmrLatest w ON w.pdo_well_id = e.well_id AND w.rn = 1
                LEFT JOIN SapPlan sap ON sap.Well_ID = e.well_id
                ORDER BY e.well_id
                """;

            countSql = $"""
                DECLARE @ws DATE = @pFrom;
                DECLARE @we DATE = @pTo;

                SELECT COUNT(DISTINCT atp.New_Well_ID)
                FROM [dbo].[WMR_TaskPlan_csv_imported] atp WITH (NOLOCK)
                {pidJoinAtp}
                INNER JOIN (
                    SELECT DISTINCT well_id
                    FROM [dbo].[task_daily] WITH (NOLOCK)
                    WHERE CAST(ActionOn AS DATE) BETWEEN @ws AND @we
                        AND data_qty IS NOT NULL AND data_qty <> 0 AND data_qty <> 1
                        AND well_id NOT IN ('00000','00001','0')
                        AND task_code IS NOT NULL AND task_code <> ''
                ) td ON atp.New_Well_ID = td.well_id
                WHERE CAST(atp.target_start AS DATE) >= @ws
                    AND CAST(atp.target_start AS DATE) <= @we
                    AND CAST(atp.target_end AS DATE)   >= @ws
                    AND CAST(atp.target_end AS DATE)   <= @we
                    AND CAST(atp.target_start AS DATE) > '1900-01-01'
                    AND CAST(atp.target_end AS DATE)   > '1900-01-01'
                    AND atp.qtyforacst IS NOT NULL
                    AND TRY_CAST(atp.qtyforacst AS NUMERIC(18,5)) <> 0
                    AND TRY_CAST(atp.qtyforacst AS NUMERIC(18,5)) <> 0.00001
                    AND (atp.Resume_Suspend IS NULL OR atp.Resume_Suspend = '' OR UPPER(atp.Resume_Suspend) NOT LIKE '%SUSPEND%')
                    AND atp.New_Well_ID IS NOT NULL AND atp.New_Well_ID <> ''
                    {pidWhereAtp}
                """;
        }
        else if (category.Equals("non_executed", StringComparison.OrdinalIgnoreCase))
        {
            // -- Non Executed -- planned wells NOT IN task_daily executed wells --
            var pidJoinP = hasAnyFilter
                ? @"LEFT JOIN [dbo].[ProjectIDs] p WITH (NOLOCK)
                    ON CAST(t.project_id AS NVARCHAR(100)) = CAST(p.[ID] AS NVARCHAR(100))"
                : "";
            var pidWhereP = hasAnyFilter
                ? @"AND (@cluster  = '' OR UPPER(LTRIM(RTRIM(p.[Cluster]))) = UPPER(@cluster))
                    AND (@site     = '' OR UPPER(LTRIM(RTRIM(p.[Site])))    = UPPER(@site))
                    AND (@wellType = '' OR UPPER(LTRIM(RTRIM(p.[Type])))    = UPPER(@wellType))
                    AND (@project  = '' OR UPPER(LTRIM(RTRIM(p.[Project]))) = UPPER(@project))"
                : "";
            var pidJoinTd = hasAnyFilter
                ? @"LEFT JOIN [dbo].[ProjectIDs] p3 WITH (NOLOCK)
                    ON td.[project_id] = TRY_CAST(p3.[ID] AS UNIQUEIDENTIFIER)"
                : "";
            var pidWhereTd = hasAnyFilter
                ? @"AND (@cluster  = '' OR UPPER(LTRIM(RTRIM(p3.[Cluster]))) = UPPER(@cluster))
                    AND (@site     = '' OR UPPER(LTRIM(RTRIM(p3.[Site])))    = UPPER(@site))
                    AND (@wellType = '' OR UPPER(LTRIM(RTRIM(p3.[Type])))    = UPPER(@wellType))
                    AND (@project  = '' OR UPPER(LTRIM(RTRIM(p3.[Project]))) = UPPER(@project))"
                : "";

            sql = $"""
                DECLARE @ws DATE = @pFrom;
                DECLARE @we DATE = @pTo;

                ;WITH
                NonExecuted AS (
                    SELECT DISTINCT
                        CAST(t.New_Well_ID AS NVARCHAR(50)) AS well_id
                    FROM [dbo].[WMR_TaskPlan_csv_imported] t WITH (NOLOCK)
                    {pidJoinP}
                    WHERE CAST(t.target_start AS DATE) >= @ws
                        AND CAST(t.target_start AS DATE) <= @we
                        AND CAST(t.target_end AS DATE)   >= @ws
                        AND CAST(t.target_end AS DATE)   <= @we
                        AND CAST(t.target_start AS DATE) > '1900-01-01'
                        AND CAST(t.target_end AS DATE)   > '1900-01-01'
                        AND t.qtyforacst IS NOT NULL
                        AND TRY_CAST(t.qtyforacst AS NUMERIC(18,5)) <> 0
                        AND TRY_CAST(t.qtyforacst AS NUMERIC(18,5)) <> 0.00001
                        AND (t.Resume_Suspend IS NULL OR t.Resume_Suspend = '' OR UPPER(t.Resume_Suspend) NOT LIKE '%SUSPEND%')
                        AND t.New_Well_ID IS NOT NULL AND t.New_Well_ID <> ''
                        {pidWhereP}
                        AND t.New_Well_ID NOT IN (
                            SELECT DISTINCT td.well_id
                            FROM [dbo].[task_daily] td WITH (NOLOCK)
                            {pidJoinTd}
                            WHERE CAST(td.ActionOn AS DATE) BETWEEN @ws AND @we
                                AND td.data_qty IS NOT NULL AND td.data_qty <> 0 AND td.data_qty <> 1
                                AND td.well_id NOT IN ('00000','00001','0')
                                AND td.task_code IS NOT NULL AND td.task_code <> ''
                                {pidWhereTd}
                        )
                ),
                WmrLatest AS (
                    SELECT
                        pdo_well_id, station_name_no, well_location, well_type, rig_no,
                        over_all_progress_percentages,
                        [overall_loc._preparation_10_100], [overall_const._10_100],
                        ohl_progress, [overall_comm_progress_100],
                        actual_rig_on_date, actual_rig_off_date,
                        ROW_NUMBER() OVER (PARTITION BY pdo_well_id ORDER BY TRY_CAST(CASE WHEN Week_Number LIKE '[0-9][0-9]-[0-9][0-9]-[0-9][0-9]' THEN '20' + Week_Number ELSE Week_Number END AS DATE) DESC) AS rn
                    FROM dbo.WMR WITH (NOLOCK)
                    WHERE TRY_CAST(CASE WHEN Week_Number LIKE '[0-9][0-9]-[0-9][0-9]-[0-9][0-9]' THEN '20' + Week_Number ELSE Week_Number END AS DATE) IS NOT NULL
                ),
                SapPlan AS (
                    SELECT Well_ID,
                           MIN(TRY_CAST(Earl_start_date AS DATE)) AS plan_start,
                           MAX(TRY_CAST(EarliestEndDate AS DATE)) AS plan_end
                    FROM [dbo].[SAP_DRILLING_SEQUENCE_History] WITH (NOLOCK)
                    WHERE Well_ID IS NOT NULL AND Well_ID <> ''

                    GROUP BY Well_ID
                )
                SELECT
                    n.well_id                   AS WellId,
                    ISNULL(w.well_location, '') AS WellName,
                    ISNULL(w.station_name_no, '') AS Field,
                    ISNULL(w.rig_no, '')        AS Rig,
                    ISNULL(w.well_type, '')     AS WellType,
                    ROUND(ISNULL(TRY_CAST(REPLACE(REPLACE(ISNULL(w.over_all_progress_percentages, '0'), '%', ''), ' ', '') AS FLOAT), 0) * 100, 1) AS ProgressPct,
                    CASE
                        WHEN sap.plan_start IS NOT NULL AND sap.plan_end IS NOT NULL
                             AND DATEDIFF(day, sap.plan_start, sap.plan_end) > 0
                        THEN ROUND(CASE
                               WHEN CAST(DATEDIFF(day, sap.plan_start, GETDATE()) AS FLOAT) / DATEDIFF(day, sap.plan_start, sap.plan_end) < 0 THEN 0.0
                               WHEN CAST(DATEDIFF(day, sap.plan_start, GETDATE()) AS FLOAT) / DATEDIFF(day, sap.plan_start, sap.plan_end) > 1 THEN 100.0
                               ELSE CAST(DATEDIFF(day, sap.plan_start, GETDATE()) AS FLOAT) / DATEDIFF(day, sap.plan_start, sap.plan_end) * 100.0
                             END, 1)
                        ELSE NULL
                    END AS PlannedPct,
                    ROUND(ISNULL(TRY_CAST(w.[overall_loc._preparation_10_100] AS FLOAT), 0) * 100, 1) AS LocPrepPct,
                    ROUND(ISNULL(TRY_CAST(w.[overall_const._10_100] AS FLOAT), 0) * 100, 1) AS FlConstructionPct,
                    ROUND(ISNULL(TRY_CAST(w.ohl_progress AS FLOAT), 0) * 100, 1) AS OhlPct,
                    ROUND(ISNULL(TRY_CAST(w.[overall_comm_progress_100] AS FLOAT), 0) * 100, 1) AS CommPct,
                    ISNULL(CONVERT(VARCHAR(20), TRY_CAST(w.actual_rig_on_date AS DATE), 126), '') AS RigOnDate,
                    ISNULL(CONVERT(VARCHAR(20), TRY_CAST(w.actual_rig_off_date AS DATE), 126), '') AS RigOffDate,
                    'non_executed' AS Category,
                    CASE
                        WHEN ROUND(ISNULL(TRY_CAST(REPLACE(REPLACE(ISNULL(w.over_all_progress_percentages,'0'),'%',''),' ','') AS FLOAT),0),4) > 0
                             AND DATEDIFF(day, COALESCE(TRY_CAST(w.actual_rig_on_date AS DATE), sap.plan_start), GETDATE()) > 0
                        THEN ROUND(ISNULL(TRY_CAST(REPLACE(REPLACE(ISNULL(w.over_all_progress_percentages,'0'),'%',''),' ','') AS FLOAT),0)
                             / DATEDIFF(day, COALESCE(TRY_CAST(w.actual_rig_on_date AS DATE), sap.plan_start), GETDATE()) * 100, 4)
                        ELSE NULL
                    END AS RatePerDay,
                    CASE
                        WHEN sap.plan_end IS NOT NULL AND DATEDIFF(day, GETDATE(), sap.plan_end) > 0
                             AND ISNULL(TRY_CAST(REPLACE(REPLACE(ISNULL(w.over_all_progress_percentages,'0'),'%',''),' ','') AS FLOAT),0) < 1.0
                        THEN ROUND((1.0 - ISNULL(TRY_CAST(REPLACE(REPLACE(ISNULL(w.over_all_progress_percentages,'0'),'%',''),' ','') AS FLOAT),0))
                             / DATEDIFF(day, GETDATE(), sap.plan_end) * 100, 4)
                        ELSE NULL
                    END AS AskRate
                FROM NonExecuted n
                LEFT JOIN WmrLatest w ON w.pdo_well_id = n.well_id AND w.rn = 1
                LEFT JOIN SapPlan sap ON sap.Well_ID = n.well_id
                ORDER BY n.well_id
                """;

            countSql = $"""
                DECLARE @ws DATE = @pFrom;
                DECLARE @we DATE = @pTo;

                SELECT COUNT(DISTINCT t.New_Well_ID)
                FROM [dbo].[WMR_TaskPlan_csv_imported] t WITH (NOLOCK)
                {pidJoinP}
                WHERE CAST(t.target_start AS DATE) >= @ws
                    AND CAST(t.target_start AS DATE) <= @we
                    AND CAST(t.target_end AS DATE)   >= @ws
                    AND CAST(t.target_end AS DATE)   <= @we
                    AND CAST(t.target_start AS DATE) > '1900-01-01'
                    AND CAST(t.target_end AS DATE)   > '1900-01-01'
                    AND t.qtyforacst IS NOT NULL
                    AND TRY_CAST(t.qtyforacst AS NUMERIC(18,5)) <> 0
                    AND TRY_CAST(t.qtyforacst AS NUMERIC(18,5)) <> 0.00001
                    AND (t.Resume_Suspend IS NULL OR t.Resume_Suspend = '' OR UPPER(t.Resume_Suspend) NOT LIKE '%SUSPEND%')
                    AND t.New_Well_ID IS NOT NULL AND t.New_Well_ID <> ''
                    {pidWhereP}
                    AND t.New_Well_ID NOT IN (
                        SELECT DISTINCT td.well_id
                        FROM [dbo].[task_daily] td WITH (NOLOCK)
                        {pidJoinTd}
                        WHERE CAST(td.ActionOn AS DATE) BETWEEN @ws AND @we
                            AND td.data_qty IS NOT NULL AND td.data_qty <> 0 AND td.data_qty <> 1
                            AND td.well_id NOT IN ('00000','00001','0')
                            AND td.task_code IS NOT NULL AND td.task_code <> ''
                            {pidWhereTd}
                    )
                """;
        }
        else if (category.Equals("executed_not_as_plan", StringComparison.OrdinalIgnoreCase))
        {
            // -- Executed Not As Plan -- task_daily wells NOT IN planned wells --
            var pidJoinTd = hasAnyFilter
                ? @"LEFT JOIN [dbo].[ProjectIDs] p WITH (NOLOCK)
                    ON td.[project_id] = TRY_CAST(p.[ID] AS UNIQUEIDENTIFIER)"
                : "";
            var pidWhereTd = hasAnyFilter
                ? @"AND (@cluster  = '' OR UPPER(LTRIM(RTRIM(p.[Cluster]))) = UPPER(@cluster))
                    AND (@site     = '' OR UPPER(LTRIM(RTRIM(p.[Site])))    = UPPER(@site))
                    AND (@wellType = '' OR UPPER(LTRIM(RTRIM(p.[Type])))    = UPPER(@wellType))
                    AND (@project  = '' OR UPPER(LTRIM(RTRIM(p.[Project]))) = UPPER(@project))"
                : "";
            var pidJoinAtp2 = hasAnyFilter
                ? @"LEFT JOIN [dbo].[ProjectIDs] p2 WITH (NOLOCK)
                    ON CAST(t.project_id AS NVARCHAR(100)) = CAST(p2.[ID] AS NVARCHAR(100))"
                : "";
            var pidWhereAtp2 = hasAnyFilter
                ? @"AND (@cluster  = '' OR UPPER(LTRIM(RTRIM(p2.[Cluster]))) = UPPER(@cluster))
                    AND (@site     = '' OR UPPER(LTRIM(RTRIM(p2.[Site])))    = UPPER(@site))
                    AND (@wellType = '' OR UPPER(LTRIM(RTRIM(p2.[Type])))    = UPPER(@wellType))
                    AND (@project  = '' OR UPPER(LTRIM(RTRIM(p2.[Project]))) = UPPER(@project))"
                : "";

            sql = $"""
                DECLARE @ws DATE = @pFrom;
                DECLARE @we DATE = @pTo;

                ;WITH
                ExecutedNotAsPlanned AS (
                    SELECT DISTINCT
                        CAST(td.well_id AS NVARCHAR(50)) AS well_id
                    FROM [dbo].[task_daily] td WITH (NOLOCK)
                    {pidJoinTd}
                    WHERE CAST(td.ActionOn AS DATE) BETWEEN @ws AND @we
                        AND td.data_qty IS NOT NULL AND td.data_qty <> 0 AND td.data_qty <> 1
                        AND td.well_id NOT IN ('00000','00001','0')
                        AND td.task_code IS NOT NULL AND td.task_code <> ''
                        {pidWhereTd}
                        AND td.well_id NOT IN (
                            SELECT DISTINCT t.New_Well_ID
                            FROM [dbo].[WMR_TaskPlan_csv_imported] t WITH (NOLOCK)
                            {pidJoinAtp2}
                            WHERE CAST(t.target_start AS DATE) >= @ws
                                AND CAST(t.target_start AS DATE) <= @we
                                AND CAST(t.target_end AS DATE)   >= @ws
                                AND CAST(t.target_end AS DATE)   <= @we
                                AND CAST(t.target_start AS DATE) > '1900-01-01'
                                AND CAST(t.target_end AS DATE)   > '1900-01-01'
                                AND t.qtyforacst IS NOT NULL
                                AND TRY_CAST(t.qtyforacst AS NUMERIC(18,5)) <> 0
                                AND TRY_CAST(t.qtyforacst AS NUMERIC(18,5)) <> 0.00001
                                AND (t.Resume_Suspend IS NULL OR t.Resume_Suspend = '' OR UPPER(t.Resume_Suspend) NOT LIKE '%SUSPEND%')
                                AND t.New_Well_ID IS NOT NULL AND t.New_Well_ID <> ''
                                {pidWhereAtp2}
                        )
                ),
                WmrLatest AS (
                    SELECT
                        pdo_well_id, station_name_no, well_location, well_type, rig_no,
                        over_all_progress_percentages,
                        [overall_loc._preparation_10_100], [overall_const._10_100],
                        ohl_progress, [overall_comm_progress_100],
                        actual_rig_on_date, actual_rig_off_date,
                        ROW_NUMBER() OVER (PARTITION BY pdo_well_id ORDER BY TRY_CAST(CASE WHEN Week_Number LIKE '[0-9][0-9]-[0-9][0-9]-[0-9][0-9]' THEN '20' + Week_Number ELSE Week_Number END AS DATE) DESC) AS rn
                    FROM dbo.WMR WITH (NOLOCK)
                    WHERE TRY_CAST(CASE WHEN Week_Number LIKE '[0-9][0-9]-[0-9][0-9]-[0-9][0-9]' THEN '20' + Week_Number ELSE Week_Number END AS DATE) IS NOT NULL
                ),
                SapPlan AS (
                    SELECT Well_ID,
                           MIN(TRY_CAST(Earl_start_date AS DATE)) AS plan_start,
                           MAX(TRY_CAST(EarliestEndDate AS DATE)) AS plan_end
                    FROM [dbo].[SAP_DRILLING_SEQUENCE_History] WITH (NOLOCK)
                    WHERE Well_ID IS NOT NULL AND Well_ID <> ''

                    GROUP BY Well_ID
                )
                SELECT
                    e.well_id                   AS WellId,
                    ISNULL(w.well_location, '') AS WellName,
                    ISNULL(w.station_name_no, '') AS Field,
                    ISNULL(w.rig_no, '')        AS Rig,
                    ISNULL(w.well_type, '')     AS WellType,
                    ROUND(ISNULL(TRY_CAST(REPLACE(REPLACE(ISNULL(w.over_all_progress_percentages, '0'), '%', ''), ' ', '') AS FLOAT), 0) * 100, 1) AS ProgressPct,
                    CASE
                        WHEN sap.plan_start IS NOT NULL AND sap.plan_end IS NOT NULL
                             AND DATEDIFF(day, sap.plan_start, sap.plan_end) > 0
                        THEN ROUND(CASE
                               WHEN CAST(DATEDIFF(day, sap.plan_start, GETDATE()) AS FLOAT) / DATEDIFF(day, sap.plan_start, sap.plan_end) < 0 THEN 0.0
                               WHEN CAST(DATEDIFF(day, sap.plan_start, GETDATE()) AS FLOAT) / DATEDIFF(day, sap.plan_start, sap.plan_end) > 1 THEN 100.0
                               ELSE CAST(DATEDIFF(day, sap.plan_start, GETDATE()) AS FLOAT) / DATEDIFF(day, sap.plan_start, sap.plan_end) * 100.0
                             END, 1)
                        ELSE NULL
                    END AS PlannedPct,
                    ROUND(ISNULL(TRY_CAST(w.[overall_loc._preparation_10_100] AS FLOAT), 0) * 100, 1) AS LocPrepPct,
                    ROUND(ISNULL(TRY_CAST(w.[overall_const._10_100] AS FLOAT), 0) * 100, 1) AS FlConstructionPct,
                    ROUND(ISNULL(TRY_CAST(w.ohl_progress AS FLOAT), 0) * 100, 1) AS OhlPct,
                    ROUND(ISNULL(TRY_CAST(w.[overall_comm_progress_100] AS FLOAT), 0) * 100, 1) AS CommPct,
                    ISNULL(CONVERT(VARCHAR(20), TRY_CAST(w.actual_rig_on_date AS DATE), 126), '') AS RigOnDate,
                    ISNULL(CONVERT(VARCHAR(20), TRY_CAST(w.actual_rig_off_date AS DATE), 126), '') AS RigOffDate,
                    'executed_not_as_plan' AS Category,
                    CASE
                        WHEN ROUND(ISNULL(TRY_CAST(REPLACE(REPLACE(ISNULL(w.over_all_progress_percentages,'0'),'%',''),' ','') AS FLOAT),0),4) > 0
                             AND DATEDIFF(day, COALESCE(TRY_CAST(w.actual_rig_on_date AS DATE), sap.plan_start), GETDATE()) > 0
                        THEN ROUND(ISNULL(TRY_CAST(REPLACE(REPLACE(ISNULL(w.over_all_progress_percentages,'0'),'%',''),' ','') AS FLOAT),0)
                             / DATEDIFF(day, COALESCE(TRY_CAST(w.actual_rig_on_date AS DATE), sap.plan_start), GETDATE()) * 100, 4)
                        ELSE NULL
                    END AS RatePerDay,
                    CASE
                        WHEN sap.plan_end IS NOT NULL AND DATEDIFF(day, GETDATE(), sap.plan_end) > 0
                             AND ISNULL(TRY_CAST(REPLACE(REPLACE(ISNULL(w.over_all_progress_percentages,'0'),'%',''),' ','') AS FLOAT),0) < 1.0
                        THEN ROUND((1.0 - ISNULL(TRY_CAST(REPLACE(REPLACE(ISNULL(w.over_all_progress_percentages,'0'),'%',''),' ','') AS FLOAT),0))
                             / DATEDIFF(day, GETDATE(), sap.plan_end) * 100, 4)
                        ELSE NULL
                    END AS AskRate
                FROM ExecutedNotAsPlanned e
                LEFT JOIN WmrLatest w ON w.pdo_well_id = e.well_id AND w.rn = 1
                LEFT JOIN SapPlan sap ON sap.Well_ID = e.well_id
                ORDER BY e.well_id
                """;

            countSql = $"""
                DECLARE @ws DATE = @pFrom;
                DECLARE @we DATE = @pTo;

                SELECT COUNT(DISTINCT td.well_id)
                FROM [dbo].[task_daily] td WITH (NOLOCK)
                {pidJoinTd}
                WHERE CAST(td.ActionOn AS DATE) BETWEEN @ws AND @we
                    AND td.data_qty IS NOT NULL AND td.data_qty <> 0 AND td.data_qty <> 1
                    AND td.well_id NOT IN ('00000','00001','0')
                    AND td.task_code IS NOT NULL AND td.task_code <> ''
                    {pidWhereTd}
                    AND td.well_id NOT IN (
                        SELECT DISTINCT t.New_Well_ID
                        FROM [dbo].[WMR_TaskPlan_csv_imported] t WITH (NOLOCK)
                        {pidJoinAtp2}
                        WHERE CAST(t.target_start AS DATE) >= @ws
                            AND CAST(t.target_start AS DATE) <= @we
                            AND CAST(t.target_end AS DATE)   >= @ws
                            AND CAST(t.target_end AS DATE)   <= @we
                            AND CAST(t.target_start AS DATE) > '1900-01-01'
                            AND CAST(t.target_end AS DATE)   > '1900-01-01'
                            AND t.qtyforacst IS NOT NULL
                            AND TRY_CAST(t.qtyforacst AS NUMERIC(18,5)) <> 0
                            AND TRY_CAST(t.qtyforacst AS NUMERIC(18,5)) <> 0.00001
                            AND (t.Resume_Suspend IS NULL OR t.Resume_Suspend = '' OR UPPER(t.Resume_Suspend) NOT LIKE '%SUSPEND%')
                            AND t.New_Well_ID IS NOT NULL AND t.New_Well_ID <> ''
                            {pidWhereAtp2}
                    )
                """;
        }
        else if (category.Equals("documents", StringComparison.OrdinalIgnoreCase))
        {
            // -- Document Compliance -- PlannedWells UNION TaskDailyWells with WMR document fields --
            var pidJoinP2 = hasAnyFilter
                ? @"LEFT JOIN [dbo].[ProjectIDs] p WITH (NOLOCK)
                    ON CAST(t.project_id AS NVARCHAR(100)) = CAST(p.[ID] AS NVARCHAR(100))"
                : "";
            var pidWhereP2 = hasAnyFilter
                ? @"AND (@cluster  = '' OR UPPER(LTRIM(RTRIM(p.[Cluster]))) = UPPER(@cluster))
                    AND (@site     = '' OR UPPER(LTRIM(RTRIM(p.[Site])))    = UPPER(@site))
                    AND (@wellType = '' OR UPPER(LTRIM(RTRIM(p.[Type])))    = UPPER(@wellType))
                    AND (@project  = '' OR UPPER(LTRIM(RTRIM(p.[Project]))) = UPPER(@project))"
                : "";
            var pidJoinTd3 = hasAnyFilter
                ? @"LEFT JOIN [dbo].[ProjectIDs] p WITH (NOLOCK)
                    ON td.[project_id] = TRY_CAST(p.[ID] AS UNIQUEIDENTIFIER)"
                : "";
            var pidWhereTd3 = hasAnyFilter
                ? @"AND (@cluster  = '' OR UPPER(LTRIM(RTRIM(p.[Cluster]))) = UPPER(@cluster))
                    AND (@site     = '' OR UPPER(LTRIM(RTRIM(p.[Site])))    = UPPER(@site))
                    AND (@wellType = '' OR UPPER(LTRIM(RTRIM(p.[Type])))    = UPPER(@wellType))
                    AND (@project  = '' OR UPPER(LTRIM(RTRIM(p.[Project]))) = UPPER(@project))"
                : "";

            var docSql = $"""
                DECLARE @ws DATE = @pFrom;
                DECLARE @we DATE = @pTo;

                ;WITH
                PlannedWells AS (
                    SELECT DISTINCT CAST(t.New_Well_ID AS NVARCHAR(50)) AS well_id
                    FROM [dbo].[WMR_TaskPlan_csv_imported] t WITH (NOLOCK)
                    {pidJoinP2}
                    WHERE CAST(t.target_start AS DATE) >= @ws
                        AND CAST(t.target_start AS DATE) <= @we
                        AND CAST(t.target_end AS DATE)   >= @ws
                        AND CAST(t.target_end AS DATE)   <= @we
                        AND CAST(t.target_start AS DATE) > '1900-01-01'
                        AND CAST(t.target_end AS DATE)   > '1900-01-01'
                        AND t.qtyforacst IS NOT NULL
                        AND TRY_CAST(t.qtyforacst AS NUMERIC(18,5)) <> 0
                        AND TRY_CAST(t.qtyforacst AS NUMERIC(18,5)) <> 0.00001
                        AND (t.Resume_Suspend IS NULL OR t.Resume_Suspend = '' OR UPPER(t.Resume_Suspend) NOT LIKE '%SUSPEND%')
                        AND t.New_Well_ID IS NOT NULL AND t.New_Well_ID <> ''
                        {pidWhereP2}
                ),
                TaskDailyWells AS (
                    SELECT DISTINCT CAST(td.well_id AS NVARCHAR(50)) AS well_id
                    FROM [dbo].[task_daily] td WITH (NOLOCK)
                    {pidJoinTd3}
                    WHERE CAST(td.ActionOn AS DATE) BETWEEN @ws AND @we
                        AND td.data_qty IS NOT NULL AND td.data_qty <> 0 AND td.data_qty <> 1
                        AND td.well_id NOT IN ('00000','00001','0')
                        AND td.task_code IS NOT NULL AND td.task_code <> ''
                        {pidWhereTd3}
                ),
                AllWells AS (
                    SELECT well_id FROM PlannedWells
                    UNION
                    SELECT well_id FROM TaskDailyWells
                ),
                WmrLatest AS (
                    SELECT
                        pdo_well_id, well_location, station_name_no, well_type, rig_no,
                        location_po_no, actual_pegged_date, flaf_issue_date, flow_line_po_no,
                        ROW_NUMBER() OVER (PARTITION BY pdo_well_id ORDER BY TRY_CAST(CASE WHEN Week_Number LIKE '[0-9][0-9]-[0-9][0-9]-[0-9][0-9]' THEN '20' + Week_Number ELSE Week_Number END AS DATE) DESC) AS rn
                    FROM [dbo].[WMR] WITH (NOLOCK)
                    WHERE TRY_CAST(CASE WHEN Week_Number LIKE '[0-9][0-9]-[0-9][0-9]-[0-9][0-9]' THEN '20' + Week_Number ELSE Week_Number END AS DATE) IS NOT NULL
                )
                SELECT
                    a.well_id                         AS WellId,
                    ISNULL(w.well_location, '')        AS WellName,
                    ISNULL(w.station_name_no, '')      AS Field,
                    ISNULL(w.rig_no, '')               AS Rig,
                    ISNULL(w.well_type, '')             AS WellType,
                    CASE WHEN w.pdo_well_id IS NOT NULL THEN 'Found in WMR' ELSE 'NOT in WMR' END AS WmrStatus,
                    ISNULL(w.location_po_no, '')                                                    AS LocationPoNo,
                    ISNULL(LTRIM(RTRIM(CAST(w.actual_pegged_date AS NVARCHAR(100)))), '')           AS ActualPeggedDate,
                    ISNULL(LTRIM(RTRIM(CAST(w.flaf_issue_date AS NVARCHAR(100)))), '')              AS FlafIssueDate,
                    ISNULL(w.flow_line_po_no, '')                                                   AS FlowLinePoNo,
                    CASE WHEN w.location_po_no IS NOT NULL AND LTRIM(RTRIM(w.location_po_no)) <> '' THEN 1 ELSE 0 END             AS LocationPoNoSubmitted,
                    CASE WHEN w.actual_pegged_date IS NOT NULL AND LTRIM(RTRIM(CAST(w.actual_pegged_date AS NVARCHAR(100)))) <> '' THEN 1 ELSE 0 END AS ActualPeggedDateSubmitted,
                    CASE WHEN w.flaf_issue_date IS NOT NULL AND LTRIM(RTRIM(CAST(w.flaf_issue_date AS NVARCHAR(100)))) <> '' THEN 1 ELSE 0 END       AS FlafIssueDateSubmitted,
                    CASE WHEN w.flow_line_po_no IS NOT NULL AND LTRIM(RTRIM(w.flow_line_po_no)) <> '' THEN 1 ELSE 0 END           AS FlowLinePoNoSubmitted,
                    CASE WHEN w.location_po_no IS NOT NULL AND LTRIM(RTRIM(w.location_po_no)) <> '' THEN 1 ELSE 0 END
                  + CASE WHEN w.actual_pegged_date IS NOT NULL AND LTRIM(RTRIM(CAST(w.actual_pegged_date AS NVARCHAR(100)))) <> '' THEN 1 ELSE 0 END
                  + CASE WHEN w.flaf_issue_date IS NOT NULL AND LTRIM(RTRIM(CAST(w.flaf_issue_date AS NVARCHAR(100)))) <> '' THEN 1 ELSE 0 END
                  + CASE WHEN w.flow_line_po_no IS NOT NULL AND LTRIM(RTRIM(w.flow_line_po_no)) <> '' THEN 1 ELSE 0 END
                    AS TotalSubmitted,
                    4 AS TotalRequired
                FROM AllWells a
                LEFT JOIN WmrLatest w ON w.pdo_well_id = a.well_id AND w.rn = 1
                ORDER BY a.well_id
                """;

            var docCountSql = $"""
                DECLARE @ws DATE = @pFrom;
                DECLARE @we DATE = @pTo;

                ;WITH
                PlannedWells AS (
                    SELECT DISTINCT CAST(t.New_Well_ID AS NVARCHAR(50)) AS well_id
                    FROM [dbo].[WMR_TaskPlan_csv_imported] t WITH (NOLOCK)
                    {pidJoinP2}
                    WHERE CAST(t.target_start AS DATE) >= @ws
                        AND CAST(t.target_start AS DATE) <= @we
                        AND CAST(t.target_end AS DATE)   >= @ws
                        AND CAST(t.target_end AS DATE)   <= @we
                        AND CAST(t.target_start AS DATE) > '1900-01-01'
                        AND CAST(t.target_end AS DATE)   > '1900-01-01'
                        AND t.qtyforacst IS NOT NULL
                        AND TRY_CAST(t.qtyforacst AS NUMERIC(18,5)) <> 0
                        AND TRY_CAST(t.qtyforacst AS NUMERIC(18,5)) <> 0.00001
                        AND (t.Resume_Suspend IS NULL OR t.Resume_Suspend = '' OR UPPER(t.Resume_Suspend) NOT LIKE '%SUSPEND%')
                        AND t.New_Well_ID IS NOT NULL AND t.New_Well_ID <> ''
                        {pidWhereP2}
                ),
                TaskDailyWells AS (
                    SELECT DISTINCT CAST(td.well_id AS NVARCHAR(50)) AS well_id
                    FROM [dbo].[task_daily] td WITH (NOLOCK)
                    {pidJoinTd3}
                    WHERE CAST(td.ActionOn AS DATE) BETWEEN @ws AND @we
                        AND td.data_qty IS NOT NULL AND td.data_qty <> 0 AND td.data_qty <> 1
                        AND td.well_id NOT IN ('00000','00001','0')
                        AND td.task_code IS NOT NULL AND td.task_code <> ''
                        {pidWhereTd3}
                ),
                AllWells AS (
                    SELECT well_id FROM PlannedWells
                    UNION
                    SELECT well_id FROM TaskDailyWells
                )
                SELECT COUNT(*) FROM AllWells
                """;

            var docPagedSql = docSql + $"\nOFFSET {(page - 1) * pageSize} ROWS FETCH NEXT {pageSize} ROWS ONLY";

            await using var docConn = new SqlConnection(cs);
            await using var docConn2 = new SqlConnection(cs);
            await Task.WhenAll(docConn.OpenAsync(ct), docConn2.OpenAsync(ct));

            await using var docCountCmd = new SqlCommand(docCountSql, docConn2) { CommandTimeout = 120 };
            docCountCmd.Parameters.AddWithValue("@pFrom", fromDate.ToDateTime(TimeOnly.MinValue));
            docCountCmd.Parameters.AddWithValue("@pTo", toDateInclusive.ToDateTime(TimeOnly.MinValue));
            docCountCmd.Parameters.AddWithValue("@cluster",  string.IsNullOrWhiteSpace(cluster)  ? "" : cluster.Trim());
            docCountCmd.Parameters.AddWithValue("@site",     string.IsNullOrWhiteSpace(site)     ? "" : site.Trim());
            docCountCmd.Parameters.AddWithValue("@wellType", string.IsNullOrWhiteSpace(wellType) ? "" : wellType.Trim());
            docCountCmd.Parameters.AddWithValue("@project",  string.IsNullOrWhiteSpace(project)  ? "" : project.Trim());

            await using var docCmd = new SqlCommand(docPagedSql, docConn) { CommandTimeout = 120 };
            docCmd.Parameters.AddWithValue("@pFrom", fromDate.ToDateTime(TimeOnly.MinValue));
            docCmd.Parameters.AddWithValue("@pTo", toDateInclusive.ToDateTime(TimeOnly.MinValue));
            docCmd.Parameters.AddWithValue("@cluster",  string.IsNullOrWhiteSpace(cluster)  ? "" : cluster.Trim());
            docCmd.Parameters.AddWithValue("@site",     string.IsNullOrWhiteSpace(site)     ? "" : site.Trim());
            docCmd.Parameters.AddWithValue("@wellType", string.IsNullOrWhiteSpace(wellType) ? "" : wellType.Trim());
            docCmd.Parameters.AddWithValue("@project",  string.IsNullOrWhiteSpace(project)  ? "" : project.Trim());

            var docCountTask = docCountCmd.ExecuteScalarAsync(ct);
            var docReaderTask = docCmd.ExecuteReaderAsync(ct);
            await Task.WhenAll(docCountTask, docReaderTask);

            var docTotalCount = (int)(await docCountTask ?? 0);
            await using var docReader = await docReaderTask;

            var docItems = new List<object>();
            while (await docReader.ReadAsync(ct))
            {
                docItems.Add(new
                {
                    wellId                     = docReader.IsDBNull(0)  ? "" : Convert.ToString(docReader.GetValue(0)) ?? "",
                    location                   = docReader.IsDBNull(1)  ? "" : docReader.GetString(1),
                    field                      = docReader.IsDBNull(2)  ? "" : docReader.GetString(2),
                    rig                        = docReader.IsDBNull(3)  ? "" : docReader.GetString(3),
                    wellType                   = docReader.IsDBNull(4)  ? "" : docReader.GetString(4),
                    wmrStatus                  = docReader.IsDBNull(5)  ? "" : docReader.GetString(5),
                    locationPoNo               = docReader.IsDBNull(6)  ? "" : docReader.GetString(6),
                    actualPeggedDate           = docReader.IsDBNull(7)  ? "" : docReader.GetString(7),
                    flafIssueDate              = docReader.IsDBNull(8)  ? "" : docReader.GetString(8),
                    flowLinePoNo               = docReader.IsDBNull(9)  ? "" : docReader.GetString(9),
                    locationPoNoSubmitted      = docReader.IsDBNull(10) ? 0 : Convert.ToInt32(docReader.GetValue(10)),
                    actualPeggedDateSubmitted  = docReader.IsDBNull(11) ? 0 : Convert.ToInt32(docReader.GetValue(11)),
                    flafIssueDateSubmitted     = docReader.IsDBNull(12) ? 0 : Convert.ToInt32(docReader.GetValue(12)),
                    flowLinePoNoSubmitted      = docReader.IsDBNull(13) ? 0 : Convert.ToInt32(docReader.GetValue(13)),
                    submittedCount             = docReader.IsDBNull(14) ? 0 : Convert.ToInt32(docReader.GetValue(14)),
                    totalRequired              = docReader.IsDBNull(15) ? 4 : Convert.ToInt32(docReader.GetValue(15)),
                    status                     = "planned",
                    progressPct                = 0.0
                });
            }

            var docResult = new { items = docItems, page, pageSize, totalCount = docTotalCount };
            _cmdKpiWellsCache[cacheKey] = (DateTime.UtcNow, docResult);
            return Ok(docResult);
        }

        await using var conn = new SqlConnection(cs);
        await using var conn2 = new SqlConnection(cs);
        await Task.WhenAll(conn.OpenAsync(ct), conn2.OpenAsync(ct));

        // Run count and paged data queries in PARALLEL (halves response time)
        var pagedSql = sql + $"\nOFFSET {(page - 1) * pageSize} ROWS FETCH NEXT {pageSize} ROWS ONLY";

        await using var countCmd = new SqlCommand(countSql, conn2) { CommandTimeout = 120 };
        countCmd.Parameters.AddWithValue("@pFrom", fromDate.ToDateTime(TimeOnly.MinValue));
        countCmd.Parameters.AddWithValue("@pTo", toDateInclusive.ToDateTime(TimeOnly.MinValue));
        countCmd.Parameters.AddWithValue("@cluster",  string.IsNullOrWhiteSpace(cluster)  ? "" : cluster.Trim());
        countCmd.Parameters.AddWithValue("@site",     string.IsNullOrWhiteSpace(site)     ? "" : site.Trim());
        countCmd.Parameters.AddWithValue("@wellType", string.IsNullOrWhiteSpace(wellType) ? "" : wellType.Trim());
        countCmd.Parameters.AddWithValue("@project",  string.IsNullOrWhiteSpace(project)  ? "" : project.Trim());
        if (!string.IsNullOrWhiteSpace(wellId)) countCmd.Parameters.AddWithValue("@wellId", wellId.Trim());

        await using var cmd = new SqlCommand(pagedSql, conn) { CommandTimeout = 120 };
        cmd.Parameters.AddWithValue("@pFrom", fromDate.ToDateTime(TimeOnly.MinValue));
        cmd.Parameters.AddWithValue("@pTo", toDateInclusive.ToDateTime(TimeOnly.MinValue));
        cmd.Parameters.AddWithValue("@cluster",  string.IsNullOrWhiteSpace(cluster)  ? "" : cluster.Trim());
        cmd.Parameters.AddWithValue("@site",     string.IsNullOrWhiteSpace(site)     ? "" : site.Trim());
        cmd.Parameters.AddWithValue("@wellType", string.IsNullOrWhiteSpace(wellType) ? "" : wellType.Trim());
        cmd.Parameters.AddWithValue("@project",  string.IsNullOrWhiteSpace(project)  ? "" : project.Trim());
        if (!string.IsNullOrWhiteSpace(wellId)) cmd.Parameters.AddWithValue("@wellId", wellId.Trim());

        // Fire both at the same time
        var countTask = countCmd.ExecuteScalarAsync(ct);
        var readerTask = cmd.ExecuteReaderAsync(ct);
        await Task.WhenAll(countTask, readerTask);

        var totalCount = (int)(await countTask ?? 0);
        await using var reader = await readerTask;

        var items = new List<object>();
        while (await reader.ReadAsync(ct))
        {
            var wId = reader.IsDBNull(0) ? "" : reader.GetString(0);
            var wellName = reader.IsDBNull(1) ? "" : reader.GetString(1);
            var field = reader.IsDBNull(2) ? "" : reader.GetString(2);
            var rig = reader.IsDBNull(3) ? "" : reader.GetString(3);
            var wType = reader.IsDBNull(4) ? "" : reader.GetString(4);
            var progressPct = reader.IsDBNull(5) ? 0.0 : Convert.ToDouble(reader.GetValue(5));
            var plannedPct = reader.IsDBNull(6) ? 0.0 : Convert.ToDouble(reader.GetValue(6));
            var locPrepPct = reader.IsDBNull(7) ? 0.0 : Convert.ToDouble(reader.GetValue(7));
            var flConPct = reader.IsDBNull(8) ? 0.0 : Convert.ToDouble(reader.GetValue(8));
            var ohlPct = reader.IsDBNull(9) ? 0.0 : Convert.ToDouble(reader.GetValue(9));
            var commPct = reader.IsDBNull(10) ? 0.0 : Convert.ToDouble(reader.GetValue(10));
            var rigOn = reader.IsDBNull(11) ? "" : reader.GetString(11);
            var rigOff = reader.IsDBNull(12) ? "" : reader.GetString(12);
            var cat = reader.IsDBNull(13) ? "" : reader.GetString(13);
            var ratePerDay = reader.IsDBNull(14) ? (double?)null : Convert.ToDouble(reader.GetValue(14));
            var askRate = reader.IsDBNull(15) ? (double?)null : Convert.ToDouble(reader.GetValue(15));

            var status = progressPct >= 100 ? "completed" : progressPct > 0 ? "inprogress" : "planned";
            var variance = plannedPct > 0 ? Math.Round(progressPct - plannedPct, 1) : (double?)null;
            var gapPerDay = (ratePerDay.HasValue && askRate.HasValue) ? Math.Round(askRate.Value - ratePerDay.Value, 4) : (double?)null;
            var spi = (plannedPct > 0 && progressPct > 0) ? Math.Round(progressPct / plannedPct, 2) : (double?)null;

            items.Add(new
            {
                wellId = wId,
                location = wellName,
                field = field,
                rig = rig,
                wellType = wType,
                progressPct = progressPct,
                plannedPct = plannedPct,
                status = status,
                variance = variance,
                locPrepPct = locPrepPct,
                flConstructionPct = flConPct,
                ohlPct = ohlPct,
                commPct = commPct,
                rigOnDate = string.IsNullOrWhiteSpace(rigOn) ? (string?)null : rigOn,
                rigOffDate = string.IsNullOrWhiteSpace(rigOff) ? (string?)null : rigOff,
                ratePerDay = ratePerDay.HasValue ? Math.Round(ratePerDay.Value, 4) : (double?)null,
                askRate = askRate.HasValue ? Math.Round(askRate.Value, 4) : (double?)null,
                gapPerDay = gapPerDay,
                spi = spi,
                locPrepStatus = (string?)null,
                flStatus = (string?)null,
                commStatus = (string?)null
            });
        }

        var wellsResult = new { items, page, pageSize, totalCount };
        _cmdKpiWellsCache[cacheKey] = (DateTime.UtcNow, wellsResult);
        return Ok(wellsResult);
    }

    /// <summary>
    /// Activity-level drilldown for the Activities tab.
    /// Returns individual activity rows from WMR_TaskPlan_csv_imported / task_daily.
    /// Categories: total_planned, in_progress, new_planned, executed, unplanned
    /// GET /dashboard/cmd-readiness-kpi-activities?category=total_planned&amp;page=1&amp;pageSize=50
    /// </summary>
    [HttpGet("cmd-readiness-kpi-activities")]
    public async Task<IActionResult> CmdReadinessKpiActivities(
        [FromQuery] string category = "total_planned",
        [FromQuery] DateOnly? from = null,
        [FromQuery] DateOnly? to = null,
        [FromQuery] string? cluster = null,
        [FromQuery] string? site = null,
        [FromQuery] string? wellType = null,
        [FromQuery] string? project = null,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50,
        CancellationToken ct = default)
    {
        var cacheKey = $"act|{category}|{from}|{to}|{cluster}|{site}|{wellType}|{project}|{page}|{pageSize}";
        if (_cmdKpiActivitiesCache.TryGetValue(cacheKey, out var cached) && (DateTime.UtcNow - cached.At).TotalMinutes < 30)
            return Ok(cached.Result);

        var cs = configuration.GetConnectionString("Default")
            ?? throw new InvalidOperationException("ConnectionStrings:Default not configured.");

        var today = DateOnly.FromDateTime(DateTime.Today);
        var fromDate = from ?? today.AddDays(-(int)today.DayOfWeek);
        var toDateInclusive = to ?? fromDate.AddDays(6);

        var hasAnyFilter = !string.IsNullOrWhiteSpace(cluster) || !string.IsNullOrWhiteSpace(site)
                        || !string.IsNullOrWhiteSpace(wellType) || !string.IsNullOrWhiteSpace(project);

        var pidJoinP = hasAnyFilter
            ? @"LEFT JOIN [dbo].[ProjectIDs] p WITH (NOLOCK)
                ON CAST(t.project_id AS NVARCHAR(100)) = CAST(p.[ID] AS NVARCHAR(100))"
            : @"LEFT JOIN [dbo].[ProjectIDs] p WITH (NOLOCK)
                ON CAST(t.project_id AS NVARCHAR(100)) = CAST(p.[ID] AS NVARCHAR(100))";
        var pidWhereP = hasAnyFilter
            ? @"AND (@cluster  = '' OR UPPER(LTRIM(RTRIM(p.[Cluster]))) = UPPER(@cluster))
                AND (@site     = '' OR UPPER(LTRIM(RTRIM(p.[Site])))    = UPPER(@site))
                AND (@wellType = '' OR UPPER(LTRIM(RTRIM(p.[Type])))    = UPPER(@wellType))
                AND (@project  = '' OR UPPER(LTRIM(RTRIM(p.[Project]))) = UPPER(@project))"
            : "";
        var pidJoinPTd = @"LEFT JOIN [dbo].[ProjectIDs] p WITH (NOLOCK)
                ON td.[project_id] = TRY_CAST(p.[ID] AS UNIQUEIDENTIFIER)";
        var pidWherePTd = hasAnyFilter
            ? @"AND (@cluster  = '' OR UPPER(LTRIM(RTRIM(p.[Cluster]))) = UPPER(@cluster))
                AND (@site     = '' OR UPPER(LTRIM(RTRIM(p.[Site])))    = UPPER(@site))
                AND (@wellType = '' OR UPPER(LTRIM(RTRIM(p.[Type])))    = UPPER(@wellType))
                AND (@project  = '' OR UPPER(LTRIM(RTRIM(p.[Project]))) = UPPER(@project))"
            : "";

        var offset = (page - 1) * pageSize;
        string sql; string countSql;

        if (category == "unplanned")
        {
            // Unplanned = executed activities (task_daily) whose task_code is NOT a planned
            // activity code. This mirrors the dashboard KPI definition exactly
            // (Total_Activities_Executed - Total_Executed_As_Planned = distinct executed
            // task_codes not matched by any planned code), so the drilldown count matches the tile.
            sql = $@"
                DECLARE @ws DATE = @pFrom; DECLARE @we DATE = @pTo;
                ;WITH
                PlannedCodes AS (
                    SELECT DISTINCT LOWER(LTRIM(RTRIM(t.code))) AS code
                    FROM [dbo].[WMR_TaskPlan_csv_imported] t WITH (NOLOCK)
                    {pidJoinP}
                    WHERE CAST(t.target_start AS DATE) >= @ws AND CAST(t.target_start AS DATE) <= @we
                        AND CAST(t.target_end AS DATE) >= @ws AND CAST(t.target_end AS DATE) <= @we
                        AND CAST(t.target_start AS DATE) > '1900-01-01' AND CAST(t.target_end AS DATE) > '1900-01-01'
                        AND t.qtyforacst IS NOT NULL AND TRY_CAST(t.qtyforacst AS NUMERIC(18,5)) <> 0
                        AND TRY_CAST(t.qtyforacst AS NUMERIC(18,5)) <> 0.00001
                        AND (t.Resume_Suspend IS NULL OR t.Resume_Suspend = '' OR UPPER(t.Resume_Suspend) NOT LIKE '%SUSPEND%')
                        AND t.New_Well_ID IS NOT NULL AND t.New_Well_ID <> ''
                        AND t.code IS NOT NULL AND t.code <> ''
                        {pidWhereP}
                )
                SELECT
                    td.task_code   AS ActivityCode,
                    td.well_id     AS WellId,
                    ISNULL(atn.[text], '')  AS ActivityName,
                    'Unplanned'    AS Status,
                    ISNULL(CONVERT(VARCHAR(20), TRY_CAST(td.actual_start AS DATE), 126), '') AS ActualStart,
                    ISNULL(CONVERT(VARCHAR(20), TRY_CAST(td.actual_end   AS DATE), 126), '') AS ActualEnd,
                    ISNULL(CONVERT(VARCHAR(20), TRY_CAST(atn.target_start AS DATE), 126), '') AS TargetStart,
                    ISNULL(CONVERT(VARCHAR(20), TRY_CAST(atn.target_end   AS DATE), 126), '') AS TargetEnd,
                    ISNULL(TRY_CAST(td.data_qty AS FLOAT), 0)  AS Quantity,
                    ISNULL(TRY_CAST(td.progress AS FLOAT), 0)  AS Progress,
                    ISNULL(TRY_CAST(td.duration AS FLOAT), 0)  AS Duration,
                    ISNULL(td.crew_type, '')                    AS CrewType,
                    ISNULL(p.[Cluster], '')                     AS ClusterName,
                    ISNULL(p.[Project], '')                     AS ProjectName,
                    ISNULL(CONVERT(VARCHAR(20), TRY_CAST(td.committed_start AS DATE), 126), '') AS CommittedStart,
                    ISNULL(CONVERT(VARCHAR(20), TRY_CAST(td.committed_end   AS DATE), 126), '') AS CommittedEnd
                FROM (
                    SELECT
                        LOWER(LTRIM(RTRIM(td.task_code))) AS task_code_norm,
                        MAX(td.task_code)    AS task_code,
                        MAX(td.well_id)      AS well_id,
                        MAX(td.actual_start) AS actual_start,
                        MAX(td.actual_end)   AS actual_end,
                        MAX(td.data_qty)     AS data_qty,
                        MAX(td.progress)     AS progress,
                        MAX(td.duration)     AS duration,
                        MAX(td.crew_type)    AS crew_type,
                        MAX(td.committed_start) AS committed_start,
                        MAX(td.committed_end)   AS committed_end,
                        MAX(td.project_id)      AS project_id
                    FROM [dbo].[task_daily] td WITH (NOLOCK)
                    {pidJoinPTd}
                    WHERE CAST(td.[ActionOn] AS DATE) BETWEEN @ws AND @we
                        AND td.data_qty IS NOT NULL AND td.data_qty <> 0 AND td.data_qty <> 1
                        AND td.well_id NOT IN ('00000','00001','0')
                        AND td.task_code IS NOT NULL AND td.task_code <> ''
                        {pidWherePTd}
                    GROUP BY LOWER(LTRIM(RTRIM(td.task_code)))
                ) td
                LEFT JOIN [dbo].[ProjectIDs] p WITH (NOLOCK)
                    ON td.project_id = TRY_CAST(p.[ID] AS UNIQUEIDENTIFIER)
                OUTER APPLY (
                    SELECT TOP 1 x.[text], x.target_start, x.target_end
                    FROM [dbo].[WMR_TaskPlan_csv_imported] x WITH (NOLOCK)
                    WHERE x.code = td.task_code AND x.[text] IS NOT NULL AND x.[text] <> ''
                ) atn
                WHERE td.task_code_norm NOT IN (SELECT code FROM PlannedCodes)
                ORDER BY td.task_code
                OFFSET {offset} ROWS FETCH NEXT {pageSize} ROWS ONLY";

            countSql = $@"
                DECLARE @ws DATE = @pFrom; DECLARE @we DATE = @pTo;
                ;WITH
                PlannedCodes AS (
                    SELECT DISTINCT LOWER(LTRIM(RTRIM(t.code))) AS code
                    FROM [dbo].[WMR_TaskPlan_csv_imported] t WITH (NOLOCK)
                    {pidJoinP}
                    WHERE CAST(t.target_start AS DATE) >= @ws AND CAST(t.target_start AS DATE) <= @we
                        AND CAST(t.target_end AS DATE) >= @ws AND CAST(t.target_end AS DATE) <= @we
                        AND CAST(t.target_start AS DATE) > '1900-01-01' AND CAST(t.target_end AS DATE) > '1900-01-01'
                        AND t.qtyforacst IS NOT NULL AND TRY_CAST(t.qtyforacst AS NUMERIC(18,5)) <> 0
                        AND TRY_CAST(t.qtyforacst AS NUMERIC(18,5)) <> 0.00001
                        AND (t.Resume_Suspend IS NULL OR t.Resume_Suspend = '' OR UPPER(t.Resume_Suspend) NOT LIKE '%SUSPEND%')
                        AND t.New_Well_ID IS NOT NULL AND t.New_Well_ID <> ''
                        AND t.code IS NOT NULL AND t.code <> ''
                        {pidWhereP}
                )
                SELECT COUNT(*) FROM (
                    SELECT LOWER(LTRIM(RTRIM(td.task_code))) AS task_code_norm
                    FROM [dbo].[task_daily] td WITH (NOLOCK)
                    {pidJoinPTd}
                    WHERE CAST(td.[ActionOn] AS DATE) BETWEEN @ws AND @we
                        AND td.data_qty IS NOT NULL AND td.data_qty <> 0 AND td.data_qty <> 1
                        AND td.well_id NOT IN ('00000','00001','0')
                        AND td.task_code IS NOT NULL AND td.task_code <> ''
                        {pidWherePTd}
                    GROUP BY LOWER(LTRIM(RTRIM(td.task_code)))
                    HAVING LOWER(LTRIM(RTRIM(MAX(td.task_code)))) NOT IN (SELECT code FROM PlannedCodes)
                ) x";
        }
        else if (category == "scheduled")
        {
            sql = $@"
                DECLARE @ws DATE = @pFrom; DECLARE @we DATE = @pTo;
                SELECT DISTINCT
                    t.code         AS ActivityCode,
                    t.New_Well_ID  AS WellId,
                    ISNULL(t.[text], '')  AS ActivityName,
                    'Scheduled' AS Status,
                    ISNULL(CONVERT(VARCHAR(20), TRY_CAST(t.actual_start AS DATE), 126), '') AS ActualStart,
                    ISNULL(CONVERT(VARCHAR(20), TRY_CAST(t.actual_end   AS DATE), 126), '') AS ActualEnd,
                    ISNULL(CONVERT(VARCHAR(20), TRY_CAST(t.target_start AS DATE), 126), '') AS TargetStart,
                    ISNULL(CONVERT(VARCHAR(20), TRY_CAST(t.target_end   AS DATE), 126), '') AS TargetEnd,
                    ISNULL(TRY_CAST(t.qtyforacst AS FLOAT), 0) AS Quantity,
                    ISNULL(TRY_CAST(t.progress AS FLOAT), 0)   AS Progress,
                    ISNULL(TRY_CAST(t.duration AS FLOAT), 0)   AS Duration,
                    ISNULL(t.crew_type, '')                     AS CrewType,
                    ISNULL(p.[Cluster], '')                     AS ClusterName,
                    ISNULL(p.[Project], '')                     AS ProjectName,
                    ISNULL(CONVERT(VARCHAR(20), TRY_CAST(td.committed_start AS DATE), 126), '') AS CommittedStart,
                    ISNULL(CONVERT(VARCHAR(20), TRY_CAST(td.committed_end   AS DATE), 126), '') AS CommittedEnd
                FROM [dbo].[WMR_TaskPlan_csv_imported] t WITH (NOLOCK)
                {pidJoinP}
                LEFT JOIN (
                    SELECT td2.well_id, MIN(td2.committed_start) AS committed_start, MAX(td2.committed_end) AS committed_end
                    FROM [dbo].[task_daily] td2 WITH (NOLOCK)
                    WHERE CAST(td2.[ActionOn] AS DATE) BETWEEN @ws AND @we
                        AND td2.committed_start IS NOT NULL
                        AND CAST(td2.committed_start AS DATE) > '1900-01-01'
                        AND CAST(td2.committed_start AS DATE) >= @ws
                        AND CAST(td2.committed_start AS DATE) <= @we
                    GROUP BY td2.well_id
                ) td ON td.well_id = t.New_Well_ID
                WHERE CAST(t.target_start AS DATE) >= @ws AND CAST(t.target_start AS DATE) <= @we
                    AND CAST(t.target_end AS DATE) >= @ws AND CAST(t.target_end AS DATE) <= @we
                    AND CAST(t.target_start AS DATE) > '1900-01-01' AND CAST(t.target_end AS DATE) > '1900-01-01'
                    AND t.qtyforacst IS NOT NULL AND TRY_CAST(t.qtyforacst AS NUMERIC(18,5)) <> 0
                    AND TRY_CAST(t.qtyforacst AS NUMERIC(18,5)) <> 0.00001
                    AND (t.Resume_Suspend IS NULL OR t.Resume_Suspend = '' OR UPPER(t.Resume_Suspend) NOT LIKE '%SUSPEND%')
                    AND t.New_Well_ID IS NOT NULL AND t.New_Well_ID <> ''
                    AND t.code IS NOT NULL AND t.code <> ''
                    AND (t.actual_start IS NULL OR CAST(t.actual_start AS DATE) = '1900-01-01')
                    {pidWhereP}
                ORDER BY t.code
                OFFSET {offset} ROWS FETCH NEXT {pageSize} ROWS ONLY";

            countSql = $@"
                DECLARE @ws DATE = @pFrom; DECLARE @we DATE = @pTo;
                SELECT COUNT(DISTINCT t.code)
                FROM [dbo].[WMR_TaskPlan_csv_imported] t WITH (NOLOCK)
                {pidJoinP}
                WHERE CAST(t.target_start AS DATE) >= @ws AND CAST(t.target_start AS DATE) <= @we
                    AND CAST(t.target_end AS DATE) >= @ws AND CAST(t.target_end AS DATE) <= @we
                    AND CAST(t.target_start AS DATE) > '1900-01-01' AND CAST(t.target_end AS DATE) > '1900-01-01'
                    AND t.qtyforacst IS NOT NULL AND TRY_CAST(t.qtyforacst AS NUMERIC(18,5)) <> 0
                    AND TRY_CAST(t.qtyforacst AS NUMERIC(18,5)) <> 0.00001
                    AND (t.Resume_Suspend IS NULL OR t.Resume_Suspend = '' OR UPPER(t.Resume_Suspend) NOT LIKE '%SUSPEND%')
                    AND t.New_Well_ID IS NOT NULL AND t.New_Well_ID <> ''
                    AND t.code IS NOT NULL AND t.code <> ''
                    AND (t.actual_start IS NULL OR CAST(t.actual_start AS DATE) = '1900-01-01')
                    {pidWhereP}";
        }
        else if (category == "committed")
        {
            sql = $@"
                DECLARE @ws DATE = @pFrom; DECLARE @we DATE = @pTo;
                SELECT DISTINCT
                    t.code         AS ActivityCode,
                    t.New_Well_ID  AS WellId,
                    ISNULL(t.[text], '')  AS ActivityName,
                    'Committed' AS Status,
                    ISNULL(CONVERT(VARCHAR(20), TRY_CAST(t.actual_start AS DATE), 126), '') AS ActualStart,
                    ISNULL(CONVERT(VARCHAR(20), TRY_CAST(t.actual_end   AS DATE), 126), '') AS ActualEnd,
                    ISNULL(CONVERT(VARCHAR(20), TRY_CAST(t.target_start AS DATE), 126), '') AS TargetStart,
                    ISNULL(CONVERT(VARCHAR(20), TRY_CAST(t.target_end   AS DATE), 126), '') AS TargetEnd,
                    ISNULL(TRY_CAST(t.qtyforacst AS FLOAT), 0) AS Quantity,
                    ISNULL(TRY_CAST(t.progress AS FLOAT), 0)   AS Progress,
                    ISNULL(TRY_CAST(t.duration AS FLOAT), 0)   AS Duration,
                    ISNULL(t.crew_type, '')                     AS CrewType,
                    ISNULL(p.[Cluster], '')                     AS ClusterName,
                    ISNULL(p.[Project], '')                     AS ProjectName,
                    ISNULL(CONVERT(VARCHAR(20), TRY_CAST(td.committed_start AS DATE), 126), '') AS CommittedStart,
                    ISNULL(CONVERT(VARCHAR(20), TRY_CAST(td.committed_end   AS DATE), 126), '') AS CommittedEnd
                FROM [dbo].[WMR_TaskPlan_csv_imported] t WITH (NOLOCK)
                {pidJoinP}
                INNER JOIN (
                    SELECT DISTINCT td.well_id, td.task_code, td.committed_start, td.committed_end
                    FROM [dbo].[task_daily] td WITH (NOLOCK)
                    {pidJoinPTd}
                    WHERE CAST(td.[ActionOn] AS DATE) BETWEEN @ws AND @we
                        AND td.data_qty IS NOT NULL AND td.data_qty <> 0 AND td.data_qty <> 1
                        AND td.well_id NOT IN ('00000','00001','0')
                        AND td.task_code IS NOT NULL AND td.task_code <> ''
                        AND td.committed_start IS NOT NULL
                        AND CAST(td.committed_start AS DATE) > '1900-01-01'
                        AND CAST(td.committed_start AS DATE) >= @ws
                        AND CAST(td.committed_start AS DATE) <= @we
                        {pidWherePTd}
                ) td ON t.New_Well_ID = td.well_id
                WHERE CAST(t.target_start AS DATE) >= @ws AND CAST(t.target_start AS DATE) <= @we
                    AND CAST(t.target_end AS DATE) >= @ws AND CAST(t.target_end AS DATE) <= @we
                    AND CAST(t.target_start AS DATE) > '1900-01-01' AND CAST(t.target_end AS DATE) > '1900-01-01'
                    AND t.qtyforacst IS NOT NULL AND TRY_CAST(t.qtyforacst AS NUMERIC(18,5)) <> 0
                    AND TRY_CAST(t.qtyforacst AS NUMERIC(18,5)) <> 0.00001
                    AND (t.Resume_Suspend IS NULL OR t.Resume_Suspend = '' OR UPPER(t.Resume_Suspend) NOT LIKE '%SUSPEND%')
                    AND t.New_Well_ID IS NOT NULL AND t.New_Well_ID <> ''
                    AND t.code IS NOT NULL AND t.code <> ''
                    AND (t.actual_start IS NULL OR CAST(t.actual_start AS DATE) = '1900-01-01')
                    {pidWhereP}
                ORDER BY t.code
                OFFSET {offset} ROWS FETCH NEXT {pageSize} ROWS ONLY";

            countSql = $@"
                DECLARE @ws DATE = @pFrom; DECLARE @we DATE = @pTo;
                SELECT COUNT(DISTINCT t.code)
                FROM [dbo].[WMR_TaskPlan_csv_imported] t WITH (NOLOCK)
                {pidJoinP}
                INNER JOIN (
                    SELECT DISTINCT td.well_id, td.task_code
                    FROM [dbo].[task_daily] td WITH (NOLOCK)
                    {pidJoinPTd}
                    WHERE CAST(td.[ActionOn] AS DATE) BETWEEN @ws AND @we
                        AND td.data_qty IS NOT NULL AND td.data_qty <> 0 AND td.data_qty <> 1
                        AND td.well_id NOT IN ('00000','00001','0')
                        AND td.task_code IS NOT NULL AND td.task_code <> ''
                        AND td.committed_start IS NOT NULL
                        AND CAST(td.committed_start AS DATE) > '1900-01-01'
                        AND CAST(td.committed_start AS DATE) >= @ws
                        AND CAST(td.committed_start AS DATE) <= @we
                        {pidWherePTd}
                ) td ON t.New_Well_ID = td.well_id
                WHERE CAST(t.target_start AS DATE) >= @ws AND CAST(t.target_start AS DATE) <= @we
                    AND CAST(t.target_end AS DATE) >= @ws AND CAST(t.target_end AS DATE) <= @we
                    AND CAST(t.target_start AS DATE) > '1900-01-01' AND CAST(t.target_end AS DATE) > '1900-01-01'
                    AND t.qtyforacst IS NOT NULL AND TRY_CAST(t.qtyforacst AS NUMERIC(18,5)) <> 0
                    AND TRY_CAST(t.qtyforacst AS NUMERIC(18,5)) <> 0.00001
                    AND (t.Resume_Suspend IS NULL OR t.Resume_Suspend = '' OR UPPER(t.Resume_Suspend) NOT LIKE '%SUSPEND%')
                    AND t.New_Well_ID IS NOT NULL AND t.New_Well_ID <> ''
                    AND t.code IS NOT NULL AND t.code <> ''
                    AND (t.actual_start IS NULL OR CAST(t.actual_start AS DATE) = '1900-01-01')
                    {pidWhereP}";
        }
        else if (category == "executed" || category == "executed_completed" || category == "executed_inprogress" || category == "executed_new")
        {
            var execStatusFilter = category switch {
                "executed_completed"  => "AND t.actual_end IS NOT NULL AND CAST(t.actual_end AS DATE) > '1900-01-01'",
                "executed_inprogress" => "AND t.actual_start IS NOT NULL AND CAST(t.actual_start AS DATE) > '1900-01-01' AND (t.actual_end IS NULL OR CAST(t.actual_end AS DATE) = '1900-01-01') AND t.code NOT IN (SELECT DISTINCT code FROM [dbo].[WMR_TaskPlan_csv_imported] WHERE actual_end IS NOT NULL AND CAST(actual_end AS DATE) > '1900-01-01' AND code IS NOT NULL AND code <> '')",
                "executed_new"        => "AND (t.actual_start IS NULL OR CAST(t.actual_start AS DATE) = '1900-01-01') AND t.code NOT IN (SELECT DISTINCT code FROM [dbo].[WMR_TaskPlan_csv_imported] WHERE actual_start IS NOT NULL AND CAST(actual_start AS DATE) > '1900-01-01' AND code IS NOT NULL AND code <> '')",
                _ => ""
            };

            sql = $@"
                DECLARE @ws DATE = @pFrom; DECLARE @we DATE = @pTo;
                SELECT DISTINCT
                    t.code         AS ActivityCode,
                    t.New_Well_ID  AS WellId,
                    ISNULL(t.[text], '')  AS ActivityName,
                    CASE WHEN t.actual_end IS NOT NULL AND CAST(t.actual_end AS DATE) > '1900-01-01' THEN 'Completed'
                         WHEN t.actual_start IS NOT NULL AND CAST(t.actual_start AS DATE) > '1900-01-01' THEN 'In-Progress'
                         ELSE 'Planned' END AS Status,
                    ISNULL(CONVERT(VARCHAR(20), TRY_CAST(t.actual_start AS DATE), 126), '') AS ActualStart,
                    ISNULL(CONVERT(VARCHAR(20), TRY_CAST(t.actual_end   AS DATE), 126), '') AS ActualEnd,
                    ISNULL(CONVERT(VARCHAR(20), TRY_CAST(t.target_start AS DATE), 126), '') AS TargetStart,
                    ISNULL(CONVERT(VARCHAR(20), TRY_CAST(t.target_end   AS DATE), 126), '') AS TargetEnd,
                    ISNULL(TRY_CAST(t.qtyforacst AS FLOAT), 0) AS Quantity,
                    ISNULL(TRY_CAST(t.progress AS FLOAT), 0)   AS Progress,
                    ISNULL(TRY_CAST(t.duration AS FLOAT), 0)   AS Duration,
                    ISNULL(t.crew_type, '')                     AS CrewType,
                    ISNULL(p.[Cluster], '')                     AS ClusterName,
                    ISNULL(p.[Project], '')                     AS ProjectName,
                    ''             AS CommittedStart,
                    ''             AS CommittedEnd
                FROM [dbo].[WMR_TaskPlan_csv_imported] t WITH (NOLOCK)
                {pidJoinP}
                WHERE CAST(t.target_start AS DATE) >= @ws AND CAST(t.target_start AS DATE) <= @we
                    AND CAST(t.target_end AS DATE) >= @ws AND CAST(t.target_end AS DATE) <= @we
                    AND CAST(t.target_start AS DATE) > '1900-01-01' AND CAST(t.target_end AS DATE) > '1900-01-01'
                    AND t.qtyforacst IS NOT NULL AND TRY_CAST(t.qtyforacst AS NUMERIC(18,5)) <> 0
                    AND TRY_CAST(t.qtyforacst AS NUMERIC(18,5)) <> 0.00001
                    AND (t.Resume_Suspend IS NULL OR t.Resume_Suspend = '' OR UPPER(t.Resume_Suspend) NOT LIKE '%SUSPEND%')
                    AND t.New_Well_ID IS NOT NULL AND t.New_Well_ID <> ''
                    AND t.code IS NOT NULL AND t.code <> ''
                    AND LOWER(LTRIM(RTRIM(t.code))) IN (
                        SELECT DISTINCT LOWER(LTRIM(RTRIM(td.task_code)))
                        FROM [dbo].[task_daily] td WITH (NOLOCK)
                        WHERE CAST(td.[ActionOn] AS DATE) BETWEEN @ws AND @we
                            AND td.data_qty IS NOT NULL AND td.data_qty <> 0 AND td.data_qty <> 1
                            AND td.well_id NOT IN ('00000','00001','0')
                            AND td.task_code IS NOT NULL AND td.task_code <> ''
                    )
                    {execStatusFilter}
                    {pidWhereP}
                ORDER BY t.code
                OFFSET {offset} ROWS FETCH NEXT {pageSize} ROWS ONLY";

            countSql = $@"
                DECLARE @ws DATE = @pFrom; DECLARE @we DATE = @pTo;
                SELECT COUNT(DISTINCT t.code)
                FROM [dbo].[WMR_TaskPlan_csv_imported] t WITH (NOLOCK)
                {pidJoinP}
                WHERE CAST(t.target_start AS DATE) >= @ws AND CAST(t.target_start AS DATE) <= @we
                    AND CAST(t.target_end AS DATE) >= @ws AND CAST(t.target_end AS DATE) <= @we
                    AND CAST(t.target_start AS DATE) > '1900-01-01' AND CAST(t.target_end AS DATE) > '1900-01-01'
                    AND t.qtyforacst IS NOT NULL AND TRY_CAST(t.qtyforacst AS NUMERIC(18,5)) <> 0
                    AND TRY_CAST(t.qtyforacst AS NUMERIC(18,5)) <> 0.00001
                    AND (t.Resume_Suspend IS NULL OR t.Resume_Suspend = '' OR UPPER(t.Resume_Suspend) NOT LIKE '%SUSPEND%')
                    AND t.New_Well_ID IS NOT NULL AND t.New_Well_ID <> ''
                    AND t.code IS NOT NULL AND t.code <> ''
                    AND LOWER(LTRIM(RTRIM(t.code))) IN (
                        SELECT DISTINCT LOWER(LTRIM(RTRIM(td.task_code)))
                        FROM [dbo].[task_daily] td WITH (NOLOCK)
                        WHERE CAST(td.[ActionOn] AS DATE) BETWEEN @ws AND @we
                            AND td.data_qty IS NOT NULL AND td.data_qty <> 0 AND td.data_qty <> 1
                            AND td.well_id NOT IN ('00000','00001','0')
                            AND td.task_code IS NOT NULL AND td.task_code <> ''
                    )
                    {execStatusFilter}
                    {pidWhereP}";
        }
        else
        {
            var statusFilter = category switch {
                "in_progress" => "AND t.actual_start IS NOT NULL AND CAST(t.actual_start AS DATE) > '1900-01-01' AND (t.actual_end IS NULL OR CAST(t.actual_end AS DATE) = '1900-01-01')",
                "new_planned" => "AND (t.actual_start IS NULL OR CAST(t.actual_start AS DATE) = '1900-01-01')",
                "total_planned_completed" => "AND t.actual_end IS NOT NULL AND CAST(t.actual_end AS DATE) > '1900-01-01'",
                "total_planned_inprogress" => "AND t.actual_start IS NOT NULL AND CAST(t.actual_start AS DATE) > '1900-01-01' AND (t.actual_end IS NULL OR CAST(t.actual_end AS DATE) = '1900-01-01') AND t.code NOT IN (SELECT DISTINCT code FROM [dbo].[WMR_TaskPlan_csv_imported] WHERE actual_end IS NOT NULL AND CAST(actual_end AS DATE) > '1900-01-01' AND code IS NOT NULL AND code <> '')",
                "total_planned_new" => "AND (t.actual_start IS NULL OR CAST(t.actual_start AS DATE) = '1900-01-01') AND t.code NOT IN (SELECT DISTINCT code FROM [dbo].[WMR_TaskPlan_csv_imported] WHERE actual_start IS NOT NULL AND CAST(actual_start AS DATE) > '1900-01-01' AND code IS NOT NULL AND code <> '')",
                _ => ""
            };

            sql = $@"
                DECLARE @ws DATE = @pFrom; DECLARE @we DATE = @pTo;
                SELECT DISTINCT
                    t.code         AS ActivityCode,
                    t.New_Well_ID  AS WellId,
                    ISNULL(t.[text], '')  AS ActivityName,
                    CASE WHEN t.actual_end IS NOT NULL AND CAST(t.actual_end AS DATE) > '1900-01-01' THEN 'Completed'
                         WHEN t.actual_start IS NOT NULL AND CAST(t.actual_start AS DATE) > '1900-01-01' THEN 'In-Progress'
                         ELSE 'New' END AS Status,
                    ISNULL(CONVERT(VARCHAR(20), TRY_CAST(t.actual_start AS DATE), 126), '') AS ActualStart,
                    ISNULL(CONVERT(VARCHAR(20), TRY_CAST(t.actual_end   AS DATE), 126), '') AS ActualEnd,
                    ISNULL(CONVERT(VARCHAR(20), TRY_CAST(t.target_start AS DATE), 126), '') AS TargetStart,
                    ISNULL(CONVERT(VARCHAR(20), TRY_CAST(t.target_end   AS DATE), 126), '') AS TargetEnd,
                    ISNULL(TRY_CAST(t.qtyforacst AS FLOAT), 0) AS Quantity,
                    ISNULL(TRY_CAST(t.progress AS FLOAT), 0)   AS Progress,
                    ISNULL(TRY_CAST(t.duration AS FLOAT), 0)   AS Duration,
                    ISNULL(t.crew_type, '')                     AS CrewType,
                    ISNULL(p.[Cluster], '')                     AS ClusterName,
                    ISNULL(p.[Project], '')                     AS ProjectName,
                    ''             AS CommittedStart,
                    ''             AS CommittedEnd
                FROM [dbo].[WMR_TaskPlan_csv_imported] t WITH (NOLOCK)
                {pidJoinP}
                WHERE CAST(t.target_start AS DATE) >= @ws AND CAST(t.target_start AS DATE) <= @we
                    AND CAST(t.target_end AS DATE) >= @ws AND CAST(t.target_end AS DATE) <= @we
                    AND CAST(t.target_start AS DATE) > '1900-01-01' AND CAST(t.target_end AS DATE) > '1900-01-01'
                    AND t.qtyforacst IS NOT NULL AND TRY_CAST(t.qtyforacst AS NUMERIC(18,5)) <> 0
                    AND TRY_CAST(t.qtyforacst AS NUMERIC(18,5)) <> 0.00001
                    AND (t.Resume_Suspend IS NULL OR t.Resume_Suspend = '' OR UPPER(t.Resume_Suspend) NOT LIKE '%SUSPEND%')
                    AND t.New_Well_ID IS NOT NULL AND t.New_Well_ID <> ''
                    AND t.code IS NOT NULL AND t.code <> ''
                    {statusFilter}
                    {pidWhereP}
                ORDER BY t.code
                OFFSET {offset} ROWS FETCH NEXT {pageSize} ROWS ONLY";

            countSql = $@"
                DECLARE @ws DATE = @pFrom; DECLARE @we DATE = @pTo;
                SELECT COUNT(DISTINCT t.code)
                FROM [dbo].[WMR_TaskPlan_csv_imported] t WITH (NOLOCK)
                {pidJoinP}
                WHERE CAST(t.target_start AS DATE) >= @ws AND CAST(t.target_start AS DATE) <= @we
                    AND CAST(t.target_end AS DATE) >= @ws AND CAST(t.target_end AS DATE) <= @we
                    AND CAST(t.target_start AS DATE) > '1900-01-01' AND CAST(t.target_end AS DATE) > '1900-01-01'
                    AND t.qtyforacst IS NOT NULL AND TRY_CAST(t.qtyforacst AS NUMERIC(18,5)) <> 0
                    AND TRY_CAST(t.qtyforacst AS NUMERIC(18,5)) <> 0.00001
                    AND (t.Resume_Suspend IS NULL OR t.Resume_Suspend = '' OR UPPER(t.Resume_Suspend) NOT LIKE '%SUSPEND%')
                    AND t.New_Well_ID IS NOT NULL AND t.New_Well_ID <> ''
                    AND t.code IS NOT NULL AND t.code <> ''
                    {statusFilter}
                    {pidWhereP}";
        }

        await using var conn = new SqlConnection(cs);
        await conn.OpenAsync(ct);

        await using var cntCmd = new SqlCommand(countSql, conn) { CommandTimeout = 120 };
        cntCmd.Parameters.AddWithValue("@pFrom", fromDate.ToDateTime(TimeOnly.MinValue));
        cntCmd.Parameters.AddWithValue("@pTo", toDateInclusive.ToDateTime(TimeOnly.MinValue));
        cntCmd.Parameters.AddWithValue("@cluster",  string.IsNullOrWhiteSpace(cluster)  ? "" : cluster.Trim());
        cntCmd.Parameters.AddWithValue("@site",     string.IsNullOrWhiteSpace(site)     ? "" : site.Trim());
        cntCmd.Parameters.AddWithValue("@wellType", string.IsNullOrWhiteSpace(wellType) ? "" : wellType.Trim());
        cntCmd.Parameters.AddWithValue("@project",  string.IsNullOrWhiteSpace(project)  ? "" : project.Trim());
        var totalCount = Convert.ToInt32(await cntCmd.ExecuteScalarAsync(ct) ?? 0);

        await using var dataCmd = new SqlCommand(sql, conn) { CommandTimeout = 120 };
        dataCmd.Parameters.AddWithValue("@pFrom", fromDate.ToDateTime(TimeOnly.MinValue));
        dataCmd.Parameters.AddWithValue("@pTo", toDateInclusive.ToDateTime(TimeOnly.MinValue));
        dataCmd.Parameters.AddWithValue("@cluster",  string.IsNullOrWhiteSpace(cluster)  ? "" : cluster.Trim());
        dataCmd.Parameters.AddWithValue("@site",     string.IsNullOrWhiteSpace(site)     ? "" : site.Trim());
        dataCmd.Parameters.AddWithValue("@wellType", string.IsNullOrWhiteSpace(wellType) ? "" : wellType.Trim());
        dataCmd.Parameters.AddWithValue("@project",  string.IsNullOrWhiteSpace(project)  ? "" : project.Trim());

        var rows = new System.Collections.Generic.List<object>();
        await using var rdr = await dataCmd.ExecuteReaderAsync(ct);
        while (await rdr.ReadAsync(ct))
        {
            rows.Add(new {
                activityCode = rdr.IsDBNull(0) ? "" : rdr.GetValue(0).ToString(),
                wellId       = rdr.IsDBNull(1) ? "" : rdr.GetValue(1).ToString(),
                activityName = rdr.IsDBNull(2) ? "" : rdr.GetValue(2).ToString(),
                status       = rdr.IsDBNull(3) ? "" : rdr.GetValue(3).ToString(),
                actualStart  = rdr.IsDBNull(4) ? "" : rdr.GetValue(4).ToString(),
                actualEnd    = rdr.IsDBNull(5) ? "" : rdr.GetValue(5).ToString(),
                targetStart  = rdr.IsDBNull(6) ? "" : rdr.GetValue(6).ToString(),
                targetEnd    = rdr.IsDBNull(7) ? "" : rdr.GetValue(7).ToString(),
                quantity     = rdr.IsDBNull(8) ? 0.0 : Convert.ToDouble(rdr.GetValue(8)),
                progress     = rdr.IsDBNull(9) ? 0.0 : Convert.ToDouble(rdr.GetValue(9)),
                duration     = rdr.IsDBNull(10) ? 0.0 : Convert.ToDouble(rdr.GetValue(10)),
                crewType     = rdr.IsDBNull(11) ? "" : rdr.GetValue(11).ToString(),
                cluster      = rdr.IsDBNull(12) ? "" : rdr.GetValue(12).ToString(),
                project      = rdr.IsDBNull(13) ? "" : rdr.GetValue(13).ToString(),
                committedStart = rdr.IsDBNull(14) ? "" : rdr.GetValue(14).ToString(),
                committedEnd   = rdr.IsDBNull(15) ? "" : rdr.GetValue(15).ToString()
            });
        }

        var result = new { totalCount, page, pageSize, activities = rows };
        _cmdKpiActivitiesCache[cacheKey] = (DateTime.UtcNow, result);
        return Ok(result);
    }
}
