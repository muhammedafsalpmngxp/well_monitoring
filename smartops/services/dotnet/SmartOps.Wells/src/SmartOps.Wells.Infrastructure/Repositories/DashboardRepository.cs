using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using SmartOps.Wells.Application.Abstractions;
using SmartOps.Wells.Contracts;
using SmartOps.Wells.Domain.Entities;
using SmartOps.Wells.Infrastructure.Persistence;

namespace SmartOps.Wells.Infrastructure.Repositories;

/// <summary>
/// EF Core implementation of <see cref="IDashboardRepository"/>.
/// Uses raw SQL with NOLOCK + in-memory caching for the large remote AppMasterDB.
/// </summary>
public sealed class DashboardRepository(WellsDbContext db, IMemoryCache cache) : IDashboardRepository
{
    private static readonly TimeSpan CacheDuration = TimeSpan.FromMinutes(30);

    // projectId (as string) → (cluster, wellType) — loaded once from tiny ProjectIDs table
    private static volatile Dictionary<string, (string cluster, string site, string wellType)>? _projectInfoMap;
    private static readonly SemaphoreSlim _projectInfoLock = new(1, 1);
    // Known cluster keys â†’ HFB well IDs (mirrors window.HFB.clusters in app-globals.js).
    // Using an IN-list avoids dependence on rig_no / well_location column patterns.
    private static readonly IReadOnlyDictionary<string, string[]> ClusterWellIds =
        new Dictionary<string, string[]>(StringComparer.OrdinalIgnoreCase)
        {
            ["nimr"]   = new[] { "34565", "34561", "31780", "36078" },
            ["alburj"] = new[] { "34422", "37797", "34357", "24665" },
            ["amin"]   = new[] { "30330", "36076", "36075", "36106" },
            ["tuqaa"]  = new[] { "33146", "33147", "33152", "33153" },
            ["rakid"]  = new[] { "36748", "36749", "36757", "36758" },
        };

    // Cluster u2192 ProjectIDs.ID GUIDs (from ProjectIDs table, [Cluster] column).
    private static readonly IReadOnlyDictionary<string, string[]> ClusterProjectIds =
        new Dictionary<string, string[]>(StringComparer.OrdinalIgnoreCase)
        {
            ["nimr"] = new[]
            {
                "8c9c6b42-7a12-4eb3-935b-fc0437e7f33f",
                "278c5587-bba7-46ea-9c6a-d79aa8bd2a69",
                "6d07e3a5-d89b-47ac-9163-8a71e8ade03d",
                "ab623768-6e41-4a27-bea0-d509f828d32a",
                "25482266-1cfe-469a-be26-3f0d69bf61c4",
                "0b69907b-25e5-4165-8414-41ac56586d61",
                "7d73c8fe-b31b-4f9b-b616-855cc7388837",
                "fd0fd562-f8d1-4883-b61e-9cebc1943479",
                "b45b8a2e-c688-4ed1-a8be-a1223540ff1f",
                "91f79608-f510-459e-a13a-871006530a03",
            },
            ["marmul"] = new[]
            {
                "c247e7b4-0751-414a-b59b-701b8bf05443",
                "4f48fbf3-d6c1-472a-ba5f-48bb8efbb48f",
                "36ec3dc5-c0de-476e-9605-530ebd16c2fe",
                "39bb315b-6e9f-4433-b3ba-eaabbb34fd2d",
                "f102ddd1-cc28-4441-befc-0c01ecc795bf",
                "84ebfdb6-8f5d-4379-92cc-72498bd11146",
                "a4f2f41b-f539-4ad4-b275-95b53c5c9c7d",
                "b824c9d0-374f-494f-a1de-4daf2441051e",
                "47b5cdfb-4153-45cc-9555-831a493146ca",
            },
        };

    // Returns a SQL WHERE fragment for a cluster filter.
    // Matches wells whose project_id links to a ProjectIDs row where [Cluster] equals the supplied name.
    private static string ClusterFilter(string cluster, string col = "pdo_well_id")
    {
        var alias = col.Contains('.') ? col[..col.IndexOf('.')] : "w";
        return $"{alias}.project_id IN (" +
               "SELECT CAST(ID AS NVARCHAR(100)) FROM [dbo].[ProjectIDs] WITH (NOLOCK) " +
               "WHERE LTRIM(RTRIM(CAST([Cluster] AS NVARCHAR(200)))) = @cluster)";
    }

    // Returns a SQL WHERE fragment for a well-type filter.
    // Matches wells whose project_id links to a ProjectIDs row where [Type] equals the supplied value.
    private static string WellTypeFilter(string alias = "w")
    {
        var prefix = string.IsNullOrEmpty(alias) ? "" : $"{alias}.";
        return $"{prefix}project_id IN (" +
               "SELECT CAST(ID AS NVARCHAR(100)) FROM [dbo].[ProjectIDs] WITH (NOLOCK) " +
               "WHERE LTRIM(RTRIM([Type])) = @wellType)";
    }

    // Returns a SQL WHERE fragment for a site filter.
    // Matches wells whose project_id links to a ProjectIDs row where [Site] equals the supplied value.
    private static string SiteFilter(string alias = "w")
    {
        var prefix = string.IsNullOrEmpty(alias) ? "" : $"{alias}.";
        return $"{prefix}project_id IN (" +
               "SELECT CAST(ID AS NVARCHAR(100)) FROM [dbo].[ProjectIDs] WITH (NOLOCK) " +
               "WHERE LTRIM(RTRIM(CAST([Site] AS NVARCHAR(200)))) = @site)";
    }

    // Returns a SQL WHERE fragment for a project filter.
    // Matches wells whose project_id links to a ProjectIDs row where [Project] equals the supplied value.
    private static string ProjectFilter(string alias = "w")
    {
        var prefix = string.IsNullOrEmpty(alias) ? "" : $"{alias}.";
        return $"{prefix}project_id IN (" +
               "SELECT CAST(ID AS NVARCHAR(100)) FROM [dbo].[ProjectIDs] WITH (NOLOCK) " +
               "WHERE LTRIM(RTRIM([Project])) = @project)";
    }

    /// <summary>
    /// Opens a DB connection, retrying once after clearing the connection pool
    /// when the first attempt fails with a transient network error (e.g. 10060).
    /// </summary>
    private static async Task OpenWithRetryAsync(System.Data.Common.DbConnection conn, CancellationToken ct)
    {
        if (conn.State == System.Data.ConnectionState.Open) return;
        try
        {
            await conn.OpenAsync(ct);
        }
        catch (SqlException)
        {
            // Pool may be poisoned â€” clear it, close this instance, and try once more.
            SqlConnection.ClearAllPools();
            try { conn.Close(); } catch { /* ignore */ }
            await conn.OpenAsync(ct);
        }
    }

    // Cached crew group codes from OLD_NEW_CREW_MAPPING (rarely changes, loaded once per hour).
    private static string[]? _crewGroupCodes;
    private static DateTime _crewGroupCodesLoadedUtc = DateTime.MinValue;
    private static readonly TimeSpan CrewGroupCacheTtl = TimeSpan.FromHours(1);

    private async Task<string[]> GetCrewGroupCodesAsync(System.Data.Common.DbConnection conn, CancellationToken ct)
    {
        if (_crewGroupCodes is not null && DateTime.UtcNow - _crewGroupCodesLoadedUtc < CrewGroupCacheTtl)
            return _crewGroupCodes;

        const string sql = """
            SELECT DISTINCT LTRIM(RTRIM(CREW_GROUP_CODE))
            FROM dbo.OLD_NEW_CREW_MAPPING WITH (NOLOCK)
            WHERE CREW_GROUP_CODE IS NOT NULL AND LTRIM(RTRIM(CREW_GROUP_CODE)) <> ''
            """;

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        cmd.CommandTimeout = 15;

        var codes = new List<string>();
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
            codes.Add(reader.GetString(0));

        _crewGroupCodes = codes.ToArray();
        _crewGroupCodesLoadedUtc = DateTime.UtcNow;
        return _crewGroupCodes;
    }

    public async Task<CrewsDeployedKpiDto> GetCrewsDeployedKpiAsync(
        string? crewGroup,
        string? cluster,
        string? wellId,
        DateOnly? from,
        DateOnly? to,
        CancellationToken ct = default)
    {
        var cacheKey = $"crews-deployed:{crewGroup}:{cluster}:{wellId}:{from}:{to}";
        if (cache.TryGetValue(cacheKey, out CrewsDeployedKpiDto? cached) && cached is not null)
            return cached;

        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var fromDate = (from ?? today).ToDateTime(TimeOnly.MinValue);
        var toDate = (to ?? today).ToDateTime(TimeOnly.MinValue).AddDays(1);

        var conn = db.Database.GetDbConnection();
        await OpenWithRetryAsync(conn, ct);

        // Load crew group codes from in-memory cache (1 lightweight query per hour max).
        var crewCodes = await GetCrewGroupCodesAsync(conn, ct);
        var totalCrews = crewCodes.Length;

        // Build optional cluster filter using pre-resolved project GUIDs.
        var needsCluster = !string.IsNullOrWhiteSpace(cluster)
                           && ClusterProjectIds.ContainsKey(cluster!);
        var clusterInList = needsCluster
            ? string.Join(",", ClusterProjectIds[cluster!].Select(id => $"'{id}'"))
            : null;

        // Build a VALUES list of crew codes for the query (avoids repeated OLD_NEW_CREW_MAPPING reads).
        var valuesRows = string.Join(",", crewCodes.Select((c, i) => $"('{c.Replace("'", "''")}')"));

        var sql = needsCluster
            ? $"""
            ;WITH CrewCodes(Code) AS (SELECT Code FROM (VALUES {valuesRows}) AS V(Code)),
            DeployedCrews AS (
                SELECT DISTINCT cc.Code
                FROM CrewCodes cc
                WHERE EXISTS (
                    SELECT 1 FROM dbo.task_daily td WITH (NOLOCK)
                    WHERE CHARINDEX(cc.Code, td.crew_code) > 0
                      AND td.crew_code IS NOT NULL AND td.crew_code <> ''
                      AND td.ActionOn >= @fromDate
                      AND td.ActionOn < @toDate
                      AND CAST(td.project_id AS NVARCHAR(100)) IN ({clusterInList})
                )
            )
            SELECT COUNT(*) AS Deployed FROM DeployedCrews
            """
            : $"""
            ;WITH CrewCodes(Code) AS (SELECT Code FROM (VALUES {valuesRows}) AS V(Code)),
            DeployedCrews AS (
                SELECT DISTINCT cc.Code
                FROM CrewCodes cc
                WHERE EXISTS (
                    SELECT 1 FROM dbo.task_daily td WITH (NOLOCK)
                    WHERE CHARINDEX(cc.Code, td.crew_code) > 0
                      AND td.crew_code IS NOT NULL AND td.crew_code <> ''
                      AND td.ActionOn >= @fromDate
                      AND td.ActionOn < @toDate
                )
            )
            SELECT COUNT(*) AS Deployed FROM DeployedCrews
            """;

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        cmd.CommandTimeout = 60;

        cmd.Parameters.Add(new SqlParameter("@fromDate", fromDate));
        cmd.Parameters.Add(new SqlParameter("@toDate", toDate));

        await using var reader = await cmd.ExecuteReaderAsync(ct);
        await reader.ReadAsync(ct);

        var deployedCount = reader.GetInt32(0);
        var unassigned = totalCrews - deployedCount;

        var utilization = totalCrews > 0
            ? Math.Round(deployedCount * 100.0 / totalCrews, 1)
            : 0;

        var result = new CrewsDeployedKpiDto(totalCrews, deployedCount, unassigned, utilization, Array.Empty<CrewGroupBreakdownDto>());

        // Adaptive cache: historical ranges are stable (60 min), today/recent is shorter (10 min).
        var isHistorical = from.HasValue && from.Value < today.AddDays(-1);
        var ttl = isHistorical ? TimeSpan.FromMinutes(60) : TimeSpan.FromMinutes(10);
        cache.Set(cacheKey, result, ttl);
        return result;
    }

    public async Task<ActiveWellsKpiDto> GetActiveWellsKpiAsync(
        string? cluster,
        string? site,
        string? wellType,
        string? project,
        string? wellId,
        DateOnly? from,
        DateOnly? to,
        bool thisMonth = false,
        CancellationToken ct = default)
    {
        var cacheKey = $"active-wells:{cluster}:{site}:{wellType}:{project}:{wellId}:{from}:{to}:{thisMonth}";
        if (cache.TryGetValue(cacheKey, out ActiveWellsKpiDto? cached) && cached is not null)
            return cached;

        // Well-ID filter (applied directly in CTEs)
        var wellIdFilter = !string.IsNullOrWhiteSpace(wellId) ? " AND pdo_well_id = @wellId" : "";

        // Build ProjectIDs subquery conditions for cluster/site/wellType
        var pidConditions = new System.Text.StringBuilder();
        if (!string.IsNullOrWhiteSpace(cluster))
            pidConditions.Append(" AND LTRIM(RTRIM(CAST([Cluster] AS NVARCHAR(200)))) = @cluster");
        if (!string.IsNullOrWhiteSpace(site))
            pidConditions.Append(" AND LTRIM(RTRIM(CAST([Site] AS NVARCHAR(200)))) = @site");
        if (!string.IsNullOrWhiteSpace(wellType))
            pidConditions.Append(" AND LTRIM(RTRIM(CAST([Type] AS NVARCHAR(200)))) = @wellType");
        if (!string.IsNullOrWhiteSpace(project))
            pidConditions.Append(" AND LTRIM(RTRIM(CAST([Project] AS NVARCHAR(200)))) = @project");

        // Cluster/site/wellType/project filter — restricts to project_ids matching the selected filters
        var clusterFilter = pidConditions.Length > 0
            ? " AND project_id IN (SELECT CAST(ID AS NVARCHAR(100)) FROM [dbo].[ProjectIDs] WITH (NOLOCK) WHERE 1=1" + pidConditions + ")"
            : "";

        var wellTypeFilter = "";

        // Always compute start/end dates in C# — avoids DECLARE issues with ADO.NET params.
        // Default: Last 90 Days (matches wells-status-list default)
        var startDate = from.HasValue
            ? from.Value.ToDateTime(TimeOnly.MinValue)
            : DateTime.Today.AddDays(-90);
        var endDate = to.HasValue
            ? to.Value.ToDateTime(TimeOnly.MinValue)
            : DateTime.Today;
        // Matches the reference wells-status-summary.sql exactly:
        // - Uses TRY_CAST(Week_Number AS DATE) for proper date comparisons
        // - Inactive = suspended wells from WMR_TaskPlan_csv_imported (Resume_Suspend='Suspend') within date range
        // - Due/NotDue based on actual_rig_on_date comparison
        // - Variance-based tags: Critical, AtRisk, BonusPotential, HighPerformers
        var sql = $"""
            ;WITH LatestPerWell AS (
                SELECT
                    pdo_well_id,
                    project_id,
                    over_all_progress_percentages,
                    Week_Number,
                    TRY_CAST([latest_exp.rig_on_location_sap_data] AS DATE)                AS expected_rig_on_date,
                    TRY_CAST(actual_rig_off_date AS DATE)                                  AS actual_rig_off_date,
                    COALESCE(TRY_CAST(overall_comm_progress_100 AS FLOAT), 0)             AS comm_progress,
                    TRY_CAST([actual_eng._completion_date] AS DATE)                        AS eng_completion_date,
                    ROW_NUMBER() OVER (
                        PARTITION BY pdo_well_id
                        ORDER BY COALESCE(TRY_CONVERT(DATE, Week_Number, 23), TRY_CONVERT(DATE, '20' + Week_Number, 23)) DESC, project_id DESC
                    ) AS rn
                FROM [dbo].[WMR] WITH (NOLOCK)
                WHERE pdo_well_id IS NOT NULL
                  AND pdo_well_id <> ''
                  AND COALESCE(TRY_CONVERT(DATE, Week_Number, 23), TRY_CONVERT(DATE, '20' + Week_Number, 23)) IS NOT NULL
                  AND COALESCE(TRY_CONVERT(DATE, Week_Number, 23), TRY_CONVERT(DATE, '20' + Week_Number, 23)) BETWEEN @startDate AND @endDate
                  {wellIdFilter}
            ),
            CurrentState AS (
                SELECT
                    pdo_well_id,
                    COALESCE(TRY_CAST(over_all_progress_percentages AS FLOAT), 0) AS progress,
                    COALESCE(TRY_CONVERT(DATE, Week_Number, 23), TRY_CONVERT(DATE, '20' + Week_Number, 23)) AS latest_week_date,
                    expected_rig_on_date,
                    actual_rig_off_date,
                    comm_progress,
                    eng_completion_date
                FROM LatestPerWell
                WHERE rn = 1
                  {clusterFilter}
            ),
            -- Latest action per well in WMR_TaskPlan_csv_imported (by actual_start date)
            LatestTaskPlan AS (
                SELECT
                    t.[New_Well_ID]    AS pdo_well_id,
                    t.[Resume_Suspend] AS latest_action,
                    ROW_NUMBER() OVER (
                        PARTITION BY t.[New_Well_ID]
                        ORDER BY TRY_CAST(t.actual_start AS DATE) DESC,
                                 t.[New_Well_ID] DESC
                    ) AS rn
                FROM [dbo].[WMR_TaskPlan_csv_imported] t WITH (NOLOCK)
                INNER JOIN CurrentState cs ON cs.pdo_well_id = t.[New_Well_ID]
                WHERE t.[Resume_Suspend] IN ('Suspend', 'Resume')
                  AND TRY_CAST(t.actual_start AS DATE) IS NOT NULL
            ),
            -- A well is currently suspended only if its LATEST action is 'Suspend'
            SuspendedWells AS (
                SELECT pdo_well_id
                FROM LatestTaskPlan
                WHERE rn = 1
                  AND latest_action = 'Suspend'
            ),
            SapDates AS (
                SELECT Well_ID,
                       MIN(TRY_CAST(Earl_start_date AS DATE)) AS plan_start,
                       MAX(TRY_CAST(EarliestEndDate AS DATE)) AS plan_end
                FROM [dbo].[SAP_DRILLING_SEQUENCE_History] WITH (NOLOCK)
                WHERE Well_ID IS NOT NULL AND Well_ID <> ''
                GROUP BY Well_ID
            ),
            -- Aggregate rig-on date per well to avoid multi-row join (WMR has multiple project_ids per well)
            RigInfo AS (
                SELECT pdo_well_id,
                       MAX(TRY_CAST(actual_rig_on_date AS DATE)) AS rig_on
                FROM [dbo].[WMR] WITH (NOLOCK)
                WHERE pdo_well_id IS NOT NULL AND pdo_well_id <> ''
                GROUP BY pdo_well_id
            ),
            WellStatus AS (
                SELECT
                    cs.pdo_well_id,
                    cs.progress,
                    cs.latest_week_date,
                    -- Active = all in-progress wells (suspended or not)
                    CASE WHEN cs.progress > 0 AND cs.progress < 1.0 THEN 1 ELSE 0 END AS is_active,
                    CASE WHEN cs.progress >= 1.0 THEN 1 ELSE 0 END AS is_completed,
                    -- is_hold = suspended AND in-progress (inactive subset of active wells only)
                    CASE WHEN sw.pdo_well_id IS NOT NULL AND cs.progress > 0 AND cs.progress < 1.0 THEN 1 ELSE 0 END AS is_hold,
                    -- is_due: matches ODC 'Actual - Due Wells Completed'
                    -- = completed AND SAP planned date passed AND NOT hookup AND NOT readycomm
                    CASE
                        WHEN cs.progress >= 1.0
                             AND cs.expected_rig_on_date IS NOT NULL
                             AND cs.expected_rig_on_date < @endDate
                             AND NOT (cs.eng_completion_date IS NOT NULL AND cs.comm_progress >= 1.0)   -- exclude hookup
                             AND NOT (cs.actual_rig_off_date IS NOT NULL AND cs.comm_progress < 1.0)    -- exclude readycomm
                        THEN 1 ELSE 0
                    END AS is_due,
                    -- is_not_due: all other completed wells (hookup + readycomm + no SAP date + future SAP date)
                    CASE
                        WHEN cs.progress >= 1.0
                             AND NOT (
                                 cs.expected_rig_on_date IS NOT NULL
                                 AND cs.expected_rig_on_date < @endDate
                                 AND NOT (cs.eng_completion_date IS NOT NULL AND cs.comm_progress >= 1.0)
                                 AND NOT (cs.actual_rig_off_date IS NOT NULL AND cs.comm_progress < 1.0)
                             )
                        THEN 1 ELSE 0
                    END AS is_not_due,
                    -- Early Stage: progress < 15% AND active (not completed)
                    -- Matches frontend: ACTIVE wells with pct < 15 that are not critical (variance >= 0 or null)
                    CASE
                        WHEN cs.progress > 0 AND cs.progress < 0.15
                             AND cs.progress < 1.0
                        THEN 1 ELSE 0
                    END AS is_early,
                    -- Variance = actual_progress - planned_pct (clamped 0-1)
                    CASE
                        WHEN sap.plan_start IS NOT NULL AND sap.plan_end IS NOT NULL
                             AND DATEDIFF(day, sap.plan_start, sap.plan_end) > 0
                        THEN cs.progress - CASE
                               WHEN CAST(DATEDIFF(day, sap.plan_start, @endDate) AS FLOAT)
                                    / DATEDIFF(day, sap.plan_start, sap.plan_end) < 0 THEN 0.0
                               WHEN CAST(DATEDIFF(day, sap.plan_start, @endDate) AS FLOAT)
                                    / DATEDIFF(day, sap.plan_start, sap.plan_end) > 1 THEN 1.0
                               ELSE CAST(DATEDIFF(day, sap.plan_start, @endDate) AS FLOAT)
                                    / DATEDIFF(day, sap.plan_start, sap.plan_end)
                             END
                        ELSE NULL
                    END AS variance,
                    -- High Performers: SPI >= 1.0 OR (progress >= 85% AND completed)
                    -- Matches frontend: (spi >= 1) || (pct >= 85 && status === 'completed')
                    CASE
                        WHEN cs.progress >= 1.0 AND cs.progress >= 0.85
                        THEN 1
                        WHEN sap.plan_start IS NOT NULL AND sap.plan_end IS NOT NULL
                             AND DATEDIFF(day, sap.plan_start, sap.plan_end) > 0
                             AND CAST(DATEDIFF(day, sap.plan_start, @endDate) AS FLOAT)
                                 / DATEDIFF(day, sap.plan_start, sap.plan_end) > 0
                             AND CASE
                                   WHEN cs.progress / (CAST(DATEDIFF(day, sap.plan_start, @endDate) AS FLOAT)
                                        / DATEDIFF(day, sap.plan_start, sap.plan_end)) < 0.40 THEN 0.40
                                   WHEN cs.progress / (CAST(DATEDIFF(day, sap.plan_start, @endDate) AS FLOAT)
                                        / DATEDIFF(day, sap.plan_start, sap.plan_end)) > 1.20 THEN 1.20
                                   ELSE cs.progress / (CAST(DATEDIFF(day, sap.plan_start, @endDate) AS FLOAT)
                                        / DATEDIFF(day, sap.plan_start, sap.plan_end))
                                 END >= 1.0
                        THEN 1
                        ELSE 0
                    END AS is_high_performer
                FROM CurrentState cs
                LEFT JOIN SuspendedWells sw ON sw.pdo_well_id = cs.pdo_well_id
                LEFT JOIN RigInfo ri ON ri.pdo_well_id = cs.pdo_well_id
                LEFT JOIN SapDates sap ON sap.Well_ID = cs.pdo_well_id
            )
            SELECT
                ISNULL(SUM(is_active), 0)                                  AS ActiveWells,
                ISNULL(SUM(is_completed), 0)                               AS CompletedWells,
                ISNULL(SUM(is_hold), 0)                                    AS HoldWells,
                ISNULL(SUM(is_due), 0)                                     AS DueWells,
                ISNULL(SUM(is_not_due), 0)                                 AS NotDueWells,
                ISNULL(SUM(is_active), 0) + ISNULL(SUM(is_completed), 0)  AS Total,
                ISNULL(SUM(is_early), 0)                                   AS EarlyWells,
                ISNULL(SUM(CASE WHEN progress > 0 AND variance IS NOT NULL AND ROUND(variance * 100, 0) < 0 THEN 1 ELSE 0 END), 0) AS CriticalWells,
                ISNULL(SUM(CASE WHEN progress > 0 AND variance IS NOT NULL AND ROUND(variance * 100, 0) = 0 THEN 1 ELSE 0 END), 0) AS AtRiskWells,
                ISNULL(SUM(CASE WHEN progress > 0 AND variance IS NOT NULL AND ROUND(variance * 100, 0) > 0 THEN 1 ELSE 0 END), 0) AS BonusPotentialWells,
                ISNULL(SUM(CASE WHEN progress > 0 AND is_high_performer = 1 THEN 1 ELSE 0 END), 0) AS HighPerformerWells
            FROM WellStatus
            WHERE progress IS NOT NULL
              {(string.IsNullOrWhiteSpace(wellTypeFilter) ? "" : "AND pdo_well_id IN (SELECT DISTINCT pdo_well_id FROM [dbo].[WMR] WITH (NOLOCK) WHERE pdo_well_id IS NOT NULL AND pdo_well_id <> '' AND TRY_CAST(Week_Number AS DATE) BETWEEN @startDate AND @endDate " + wellTypeFilter + ")")};
            """;

        var conn = db.Database.GetDbConnection();
        await OpenWithRetryAsync(conn, ct);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        cmd.CommandTimeout = 60;

        cmd.Parameters.Add(new SqlParameter("@startDate", System.Data.SqlDbType.Date) { Value = startDate.Date });
        cmd.Parameters.Add(new SqlParameter("@endDate", System.Data.SqlDbType.Date) { Value = endDate.Date });
        if (!string.IsNullOrWhiteSpace(wellId))
            cmd.Parameters.Add(new SqlParameter("@wellId", wellId));
        if (!string.IsNullOrWhiteSpace(cluster))
            cmd.Parameters.Add(new SqlParameter("@cluster", cluster));
        if (!string.IsNullOrWhiteSpace(site))
            cmd.Parameters.Add(new SqlParameter("@site", site));
        if (!string.IsNullOrWhiteSpace(wellType))
            cmd.Parameters.Add(new SqlParameter("@wellType", wellType));
        if (!string.IsNullOrWhiteSpace(project))
            cmd.Parameters.Add(new SqlParameter("@project", project));

        await using var reader2 = await cmd.ExecuteReaderAsync(ct);
        await reader2.ReadAsync(ct);

        var activeWells      = reader2.GetInt32(0);
        var completedWells   = reader2.GetInt32(1);
        var suspendedWells   = reader2.GetInt32(2);  // Inactive = suspended (Resume_Suspend='Suspend')
        var dueWells         = reader2.GetInt32(3);
        var notDueWells      = reader2.GetInt32(4);
        var total            = reader2.GetInt32(5);
        var earlyWells       = reader2.GetInt32(6);
        var criticalWells    = reader2.GetInt32(7);
        var atRiskWells      = reader2.GetInt32(8);
        var bonusPotential   = reader2.GetInt32(9);
        var highPerformers   = reader2.GetInt32(10);

        // Total Wells = all in-progress + completed
        // Active chip = in-progress non-suspended = SUM(is_active) - SUM(is_hold)
        // Inactive chip = suspended in-progress wells only
        var inProgress = activeWells - suspendedWells;

        var kpi = new ActiveWellsKpiDto(total, total, inProgress, earlyWells, 0, suspendedWells, dueWells, notDueWells,
            Critical: criticalWells, AtRisk: atRiskWells, Completed: completedWells,
            BonusPotential: bonusPotential, HighPerformers: highPerformers);
        cache.Set(cacheKey, kpi, CacheDuration);
        return kpi;
    }

    public async Task<IReadOnlyList<WmrWellDto>> GetWmrWellsAsync(
        string? cluster,
        string? wellId,
        string? status,
        DateOnly? from,
        DateOnly? to,
        bool thisMonth = false,
        string? wrFilter = null,
        int? planYear = null,
        DateOnly? asOfDate = null,
        string? commStatus = null,
        string? wellType = null,
        string? project = null,
        CancellationToken ct = default)
    {
        var cacheKey = $"wmr-wells:{cluster}:{wellId}:{status}:{from}:{to}:{thisMonth}:{wrFilter}:{planYear}:{asOfDate}:{commStatus}:{wellType}:{project}";
        if (cache.TryGetValue(cacheKey, out IReadOnlyList<WmrWellDto>? cachedList) && cachedList is not null)
            return cachedList;

        // ──────────────────────────────────────────────────────────────────────────
        // DATE-RANGE FUNNEL PATH: Reuses the exact same CTEs as the WR funnel so
        // that drilldown counts are guaranteed to match funnel counts.
        // Triggered when from/to are provided with a wrFilter or status (WR drilldown),
        // or when the legacy planYear param is set.
        // ──────────────────────────────────────────────────────────────────────────
        if (from.HasValue && to.HasValue && (!string.IsNullOrWhiteSpace(wrFilter) || !string.IsNullOrWhiteSpace(status)))
        {
            var funnelResult = await GetWmrWellsByFunnelLogicAsync(from.Value, to.Value, asOfDate, wrFilter, status, cluster, wellId, wellType, project, ct);
            cache.Set(cacheKey, funnelResult, CacheDuration);
            return funnelResult;
        }
        if (planYear.HasValue)
        {
            var effectiveFrom = new DateOnly(planYear.Value, 1, 1);
            var effectiveTo   = new DateOnly(planYear.Value, 12, 31);
            var legacyResult = await GetWmrWellsByFunnelLogicAsync(effectiveFrom, effectiveTo, asOfDate, wrFilter, status, cluster, wellId, wellType, project, ct);
            cache.Set(cacheKey, legacyResult, CacheDuration);
            return legacyResult;
        }

        var extraWhere = "";
        if (!string.IsNullOrWhiteSpace(wellId))  extraWhere += " AND w.pdo_well_id = @wellId";
        if (!string.IsNullOrWhiteSpace(cluster)) extraWhere += " AND " + ClusterFilter(cluster, "w.pdo_well_id");
        // Plan-year filter: mirrors the WRO funnel's WmrLatest CTE.
        // When planYear is set we restrict the `latest` inner join to only valid-date
        // Week_Number rows (same as WmrLatest: AND COALESCE(TRY_CAST(Week_Number AS DATE), TRY_CONVERT(DATE, Week_Number, 5)) IS NOT NULL).
        // Without this, MAX(Week_Number) over ALL rows can return a string like 'W23' which
        // sorts alphabetically above '2026-05-20', so the INNER JOIN matches the wrong row
        // and the well is then excluded â€” producing 0 results.
        var latestDateFilter = planYear.HasValue
            ? $"AND COALESCE(TRY_CAST(Week_Number AS DATE), TRY_CONVERT(DATE, Week_Number, 5)) >= @planYearStart AND COALESCE(TRY_CAST(Week_Number AS DATE), TRY_CONVERT(DATE, Week_Number, 5)) <= @planYearEnd"
            : "";
        // TRY_CAST required: rig date columns are stored as nvarchar.
        // Date overlap: rig_on <= toDate  AND  (rig_off IS NULL OR rig_off >= fromDate).
        // Do NOT prefix rig_on with "IS NULL OR" â€” that caused every unstarted planned well
        // (NULL rig dates) to pass the filter, inflating totals by ~244 irrelevant wells.
        // Flowline-fallback wells (NULL rig_on but flow_line = 'In Progress') are preserved
        // via the explicit OR clause so they still appear in date-filtered views.
        if (to.HasValue || from.HasValue)
        {
            var rigOverlapParts = new System.Collections.Generic.List<string>();
            // Use EOMONTH(@toDate) so selecting any day within a month shows all wells
            // for that full month â€” consistent with the KPI card's totalThisMonth figure.
            if (to.HasValue)   rigOverlapParts.Add("TRY_CAST(w.actual_rig_on_date AS DATE) <= EOMONTH(@toDate)");
            if (from.HasValue) rigOverlapParts.Add("(w.actual_rig_off_date IS NULL OR TRY_CAST(w.actual_rig_off_date AS DATE) >= @fromDate)");
            var rigOverlap = string.Join(" AND ", rigOverlapParts);
            extraWhere += $" AND (({rigOverlap}) OR (w.actual_rig_on_date IS NULL AND w.[flow_line_const._status_in_progress_completed] = 'In Progress'))";
        }
        if (thisMonth)     extraWhere += """
             AND (
               (w.actual_rig_on_date IS NOT NULL
                AND TRY_CAST(w.actual_rig_on_date AS DATE) <= CAST(GETDATE() AS DATE)
                AND (w.actual_rig_off_date IS NULL
                     OR TRY_CAST(w.actual_rig_off_date AS DATE) >= DATEADD(day, -30, CAST(GETDATE() AS DATE))))
               OR
               (w.actual_rig_on_date IS NULL
                AND w.[flow_line_const._status_in_progress_completed] = 'In Progress')
               OR
               (w.actual_rig_on_date IS NULL
                AND COALESCE(TRY_CAST(w.over_all_progress_percentages AS FLOAT), 0) > 0
                AND COALESCE(TRY_CAST(w.over_all_progress_percentages AS FLOAT), 0) < 0.05)
             )
             """;

        // Reference date for status and active-count logic: use @toDate when a date filter is
        // set (e.g. Yesterday, Last Week, Custom), use @planAsOfDate when planYear is scoped,
        // fall back to GETDATE() for the default view.
        var refDateSql = (to.HasValue || from.HasValue)
            ? "CAST(@toDate AS DATE)"
            : (asOfDate.HasValue ? "CAST(@planAsOfDate AS DATE)" : "CAST(GETDATE() AS DATE)");
        var sql = $"""
            SELECT
              w.pdo_well_id,
              w.rig_no,
              p.[Cluster] AS field_name,
              w.well_location,
              w.well_type,
              COALESCE(TRY_CAST(w.over_all_progress_percentages AS FLOAT), 0) AS prog,
              w.[location_preparation_status_in_progress_completed] AS loc_status,
              w.[flow_line_const._status_in_progress_completed]     AS fl_status,
              w.[flow_line_commi._status_in_progress_completed]     AS comm_status,
              COALESCE(TRY_CAST(w.[overall_loc._preparation_10_100] AS FLOAT), 0)  AS loc_pct,
              COALESCE(TRY_CAST(w.[overall_const._10_100]           AS FLOAT), 0)  AS fl_pct,
              COALESCE(TRY_CAST(w.[overall_comm_progress_100]       AS FLOAT), 0)  AS comm_pct,
              COALESCE(TRY_CAST(w.ohl_progress                      AS FLOAT), 0)  AS ohl_pct,
              w.actual_rig_on_date,
              w.actual_rig_off_date,
              -- Drilled & Not Completed (Drilled but stuck in the construction
              -- pipeline): rig has physically left AND engineering completion is
              -- not yet recorded.
              CASE
                WHEN w.actual_rig_off_date         IS NOT NULL
                     AND w.[actual_eng._completion_date] IS NULL
                  THEN 1 ELSE 0
              END AS drilled_not_completed,
              -- PDO Issue (Not Due PDO Issues KPI):
              --   Condition 1: rig has physically left          (actual_rig_off_date IS NOT NULL)
              --   Condition 2: KPI deadline not yet passed      (SAP rig-on >= today)
              --   Condition 3: at least ONE PDO indicator true:
              --       â€¢ FLAF not given      (flaf_issue_date IS NULL)
              --       â€¢ SCR raised          (scr_no IS NOT NULL)
              --       â€¢ SSFD issue          (ssfd_wells IS NOT NULL)
              --       â€¢ IPM block           (ipm IS NOT NULL)
              --       â€¢ MOC pending approval (moc_raised IS NOT NULL AND moc_approved IS NULL)
              CASE
                WHEN w.actual_rig_off_date IS NOT NULL
                     AND wmro.sap_rig_on IS NOT NULL
                     AND wmro.sap_rig_on >= CAST(GETDATE() AS DATE)
                     AND (
                          w.flaf_issue_date IS NULL
                       OR w.scr_no          IS NOT NULL
                       OR w.ssfd_wells      IS NOT NULL
                       OR w.ipm             IS NOT NULL
                       OR (w.moc_raised IS NOT NULL AND w.moc_approved IS NULL)
                     )
                  THEN 1 ELSE 0
              END AS pdo_issue,
              -- FLAF/SCR blocked: mirrors the WRO funnel's DerivedStatus = 'FLAF/SCR & Other'.
              -- Funnel logic: first checks Progress >= 1.0 (completed), THEN checks FlafDate.
              -- So a well is FLAF/SCR only if NOT completed (progress < 1.0) AND flaf_date is set.
              CASE
                WHEN COALESCE(TRY_CAST(w.over_all_progress_percentages AS FLOAT), 0) < 1.0
                     AND w.flaf_issue_date IS NOT NULL
                     AND TRY_CAST(w.flaf_issue_date AS DATE) <= {refDateSql}
                  THEN 1 ELSE 0
              END AS flaf_scr,
              CASE
                -- 1. Completed: rig has physically left on/before the reference date.
                WHEN w.actual_rig_off_date IS NOT NULL
                     AND TRY_CAST(w.actual_rig_off_date AS DATE) <= {refDateSql}
                  THEN 'completed'
                -- 1b. Also completed if progress = 100% (aligns with kpi-tiles definition)
                WHEN COALESCE(TRY_CAST(w.over_all_progress_percentages AS FLOAT), 0) >= 1.0
                  THEN 'completed'
                -- 2. On Hold: progress in (0,1) AND no movement since last week
                WHEN COALESCE(TRY_CAST(w.over_all_progress_percentages AS FLOAT), 0) > 0
                     AND COALESCE(TRY_CAST(w.over_all_progress_percentages AS FLOAT), 0) < 1.0
                     AND COALESCE(TRY_CAST(w.over_all_progress_percentages AS FLOAT), 0)
                         = COALESCE(pw.prev_prog, -1)
                  THEN 'onhold'
                -- 3. Early: rig has not arrived yet AND progress is less than 5%
                --    (checked before critical so very-early moving wells aren't flagged
                --     critical just because actual hasn't caught up to plan yet)
                WHEN (w.actual_rig_on_date IS NULL
                      OR TRY_CAST(w.actual_rig_on_date AS DATE) > {refDateSql})
                     AND COALESCE(TRY_CAST(w.over_all_progress_percentages AS FLOAT), 0) > 0
                     AND COALESCE(TRY_CAST(w.over_all_progress_percentages AS FLOAT), 0) < 0.05
                  THEN 'early'
                -- 4. Critical: actual progress is 15+ percentage points behind plan
                --    (variance = actual âˆ’ planned_pct, where planned_pct is the linear
                --     fraction of SAP plan elapsed). Requires SAP plan dates.
                WHEN sap.plan_start IS NOT NULL AND sap.plan_end IS NOT NULL
                     AND DATEDIFF(day, sap.plan_start, sap.plan_end) > 0
                     AND (COALESCE(TRY_CAST(w.over_all_progress_percentages AS FLOAT), 0)
                          - CAST(DATEDIFF(day, sap.plan_start, {refDateSql}) AS FLOAT)
                            / DATEDIFF(day, sap.plan_start, sap.plan_end)) <= -0.15
                  THEN 'critical'
                -- 5. At Risk: variance strictly between âˆ’15% and âˆ’10%
                --    (i.e. behind plan by 10â€“15 pts, not yet critical). Requires SAP dates.
                WHEN sap.plan_start IS NOT NULL AND sap.plan_end IS NOT NULL
                     AND DATEDIFF(day, sap.plan_start, sap.plan_end) > 0
                     AND (COALESCE(TRY_CAST(w.over_all_progress_percentages AS FLOAT), 0)
                          - CAST(DATEDIFF(day, sap.plan_start, {refDateSql}) AS FLOAT)
                            / DATEDIFF(day, sap.plan_start, sap.plan_end)) < -0.10
                  THEN 'atrisk'
                -- 6. In Progress: any moving well with 0 < progress < 100%
                WHEN COALESCE(TRY_CAST(w.over_all_progress_percentages AS FLOAT), 0) > 0
                     AND COALESCE(TRY_CAST(w.over_all_progress_percentages AS FLOAT), 0) < 1.0
                  THEN 'inprogress'
                -- 7. Flowline fallback: no rig yet but construction is actively In Progress
                WHEN w.actual_rig_on_date IS NULL
                     AND w.[flow_line_const._status_in_progress_completed] = 'In Progress'
                  THEN 'inprogress'
                ELSE 'planned'
              END AS status,
              -- Planned progress % (linear interpolation of SAP schedule, clamped 0–1)
              CASE
                WHEN sap.plan_start IS NOT NULL AND sap.plan_end IS NOT NULL
                     AND DATEDIFF(day, sap.plan_start, sap.plan_end) > 0
                THEN CASE
                       WHEN CAST(DATEDIFF(day, sap.plan_start, {refDateSql}) AS FLOAT)
                            / DATEDIFF(day, sap.plan_start, sap.plan_end) < 0 THEN 0.0
                       WHEN CAST(DATEDIFF(day, sap.plan_start, {refDateSql}) AS FLOAT)
                            / DATEDIFF(day, sap.plan_start, sap.plan_end) > 1 THEN 1.0
                       ELSE CAST(DATEDIFF(day, sap.plan_start, {refDateSql}) AS FLOAT)
                            / DATEDIFF(day, sap.plan_start, sap.plan_end)
                     END
                ELSE NULL
              END AS planned_pct,
              -- Rate/Day: avg current rate from activities (qtyactual / days_completed)
              act_rates.avg_current_rate AS rate_per_day,
              -- Ask Rate: avg asking rate from activities (qty_remaining / days_remaining)
              act_rates.avg_asking_rate AS ask_rate
            FROM [dbo].[WMR] w WITH (NOLOCK)
            LEFT JOIN (SELECT ID, MIN([Cluster]) AS [Cluster] FROM [dbo].[ProjectIDs] WITH (NOLOCK) GROUP BY ID) p ON w.project_id = p.ID
            INNER JOIN (
              SELECT pdo_well_id, Week_Number AS max_wk
              FROM (
                SELECT pdo_well_id, Week_Number,
                       ROW_NUMBER() OVER (PARTITION BY pdo_well_id ORDER BY COALESCE(TRY_CONVERT(DATE, Week_Number, 23), TRY_CONVERT(DATE, '20' + Week_Number, 23)) DESC) AS rn
                FROM [dbo].[WMR] WITH (NOLOCK)
                WHERE pdo_well_id IS NOT NULL AND pdo_well_id <> ''
                  AND COALESCE(TRY_CONVERT(DATE, Week_Number, 23), TRY_CONVERT(DATE, '20' + Week_Number, 23)) IS NOT NULL
                  {latestDateFilter}
              ) deduped WHERE rn = 1
            ) latest ON w.pdo_well_id = latest.pdo_well_id AND w.Week_Number = latest.max_wk
            LEFT JOIN (
              SELECT pdo_well_id,
                     COALESCE(TRY_CAST(over_all_progress_percentages AS FLOAT), 0) AS prev_prog
              FROM (
                SELECT pdo_well_id, over_all_progress_percentages,
                       ROW_NUMBER() OVER (PARTITION BY pdo_well_id ORDER BY Week_Number DESC) AS rn
                FROM [dbo].[WMR] WITH (NOLOCK)
                WHERE pdo_well_id IS NOT NULL AND pdo_well_id <> ''
              ) r
              WHERE r.rn = 2
            ) pw ON pw.pdo_well_id = w.pdo_well_id
            LEFT JOIN (
              SELECT Well_ID,
                     MIN(TRY_CAST(Earl_start_date AS DATE)) AS plan_start,
                     MAX(TRY_CAST(EarliestEndDate AS DATE)) AS plan_end
              FROM [dbo].[SAP_DRILLING_SEQUENCE_History] WITH (NOLOCK)
              WHERE Well_ID IS NOT NULL AND Well_ID <> ''
              GROUP BY Well_ID
            ) sap ON sap.Well_ID = w.pdo_well_id
            LEFT JOIN (
              -- WMRO holds the SAP-planned rig_on date in [latest_exp.rig_on_location_sap_data].
              -- Take MAX per well in case WMRO has multiple rows (latest expected wins).
              SELECT pdo_well_id,
                     MAX(TRY_CAST([latest_exp.rig_on_location_sap_data] AS DATE)) AS sap_rig_on
              FROM [dbo].[WellMonitoringReportOptimized] WITH (NOLOCK)
              WHERE pdo_well_id IS NOT NULL AND pdo_well_id <> ''
              GROUP BY pdo_well_id
            ) wmro ON wmro.pdo_well_id = w.pdo_well_id
            LEFT JOIN (
              -- Activity-level avg rates from TaskPlanCSVImport
              SELECT
                CAST(act.Well_ID AS NVARCHAR(50)) AS well_id,
                AVG(TRY_CONVERT(DECIMAL(18,4), act.qtyactual)
                    / NULLIF(CAST(DATEDIFF(DAY, TRY_CONVERT(DATE, act.actual_start), CAST(GETDATE() AS DATE)) AS DECIMAL(18,4)), 0))
                    AS avg_current_rate,
                AVG(CASE WHEN act.actual_end IS NULL
                         AND DATEDIFF(DAY, CAST(GETDATE() AS DATE),
                             DATEADD(DAY, CEILING(TRY_CONVERT(DECIMAL(18,4), act.manhours) / 8.0),
                                 TRY_CONVERT(DATE, act.actual_start))) > 0
                    THEN (TRY_CONVERT(DECIMAL(18,4), act.qty) - ISNULL(TRY_CONVERT(DECIMAL(18,4), act.qtyactual), 0))
                         / CAST(DATEDIFF(DAY, CAST(GETDATE() AS DATE),
                             DATEADD(DAY, CEILING(TRY_CONVERT(DECIMAL(18,4), act.manhours) / 8.0),
                                 TRY_CONVERT(DATE, act.actual_start))) AS DECIMAL(18,4))
                    ELSE NULL END) AS avg_asking_rate
              FROM [dbo].[TaskPlanCSVImport] act WITH (NOLOCK)
              WHERE CAST(act.type AS NVARCHAR(10)) = 'A'
                AND act.actual_start IS NOT NULL
                AND DATEDIFF(DAY, TRY_CONVERT(DATE, act.actual_start), CAST(GETDATE() AS DATE)) > 0
              GROUP BY CAST(act.Well_ID AS NVARCHAR(50))
            ) act_rates ON act_rates.well_id = w.pdo_well_id
            WHERE w.pdo_well_id IS NOT NULL AND w.pdo_well_id <> ''
            {extraWhere}
            ORDER BY w.pdo_well_id;
            """;

        var conn2 = db.Database.GetDbConnection();
        await OpenWithRetryAsync(conn2, ct);

        await using var cmd2 = conn2.CreateCommand();
        cmd2.CommandText = sql;
        cmd2.CommandTimeout = 60;

        if (!string.IsNullOrWhiteSpace(wellId))
            cmd2.Parameters.Add(new SqlParameter("@wellId", wellId));
        if (!string.IsNullOrWhiteSpace(cluster))
            cmd2.Parameters.Add(new SqlParameter("@cluster", cluster));
        if (from.HasValue)
            cmd2.Parameters.Add(new SqlParameter("@fromDate", from.Value.ToDateTime(TimeOnly.MinValue)));
        if (to.HasValue)
            cmd2.Parameters.Add(new SqlParameter("@toDate", to.Value.ToDateTime(TimeOnly.MaxValue)));
        if (asOfDate.HasValue)
            cmd2.Parameters.Add(new SqlParameter("@planAsOfDate", asOfDate.Value.ToDateTime(TimeOnly.MaxValue)));
        if (planYear.HasValue)
        {
            cmd2.Parameters.Add(new SqlParameter("@planYearStart", new DateTime(planYear.Value, 1, 1)));
            cmd2.Parameters.Add(new SqlParameter("@planYearEnd", new DateTime(planYear.Value, 12, 31)));
        }

        await using var rdr = await cmd2.ExecuteReaderAsync(ct);
        var result = new List<WmrWellDto>();

        static double SafeDouble(object v) => v == DBNull.Value ? 0.0 : Convert.ToDouble(v);
        static string? SafeStr(object v)   => v == DBNull.Value ? null : v?.ToString();

        // Apply status filter after fetch (simpler than adding it to derived-column WHERE).
        // Read by column name rather than index so adding columns to the SELECT can't break this.
        while (await rdr.ReadAsync(ct))
        {
            var derivedStatus = rdr["status"]?.ToString() ?? "planned";
            var prog = SafeDouble(rdr["prog"]);

            // When navigating from the WR funnel (planYear is set), "completed" means
            // progress >= 1.0, matching the funnel's DerivedStatus logic. Without planYear,
            // keep the existing rig-off-based status derivation.
            if (!string.IsNullOrWhiteSpace(status))
            {
                if (planYear.HasValue && string.Equals(status, "completed", StringComparison.OrdinalIgnoreCase))
                {
                    if (prog < 1.0) continue;
                }
                else if (!string.Equals(derivedStatus, status, StringComparison.OrdinalIgnoreCase))
                    continue;
            }

            var isFlafScr = rdr["flaf_scr"] != DBNull.Value && Convert.ToInt32(rdr["flaf_scr"]) == 1;
            // wrFilter: 'flafscr' or 'clean' â†’ exclude FLAF/SCR-blocked wells
            if ((wrFilter == "flafscr" || wrFilter == "clean") && isFlafScr) continue;

            var rawPlannedPct = rdr["planned_pct"];
            double? plannedPctVal = rawPlannedPct == DBNull.Value ? null : Math.Round(Convert.ToDouble(rawPlannedPct) * 100, 1);

            // Compute SPI (Schedule Performance Index) = actual / planned
            double? spiVal = null;
            if (plannedPctVal.HasValue && plannedPctVal.Value > 0)
                spiVal = Math.Round((prog * 100) / plannedPctVal.Value, 2);

            // Rate per day (avg current rate from activities)
            var rawRate = rdr["rate_per_day"];
            double? ratePerDayVal = rawRate == DBNull.Value ? null : Math.Round(Convert.ToDouble(rawRate), 2);

            // Ask rate (avg asking rate from activities)
            var rawAsk = rdr["ask_rate"];
            double? askRateVal = rawAsk == DBNull.Value ? null : Math.Round(Convert.ToDouble(rawAsk), 2);

            result.Add(new WmrWellDto(
                WellId:         rdr.GetString(0),
                Rig:            SafeStr(rdr[1]),
                Field:          SafeStr(rdr["field_name"]),
                Location:       SafeStr(rdr[3]),
                WellType:       SafeStr(rdr[4]),
                ProgressPct:    Math.Round(prog * 100, 1),
                Status:         derivedStatus,
                LocPrepStatus:  SafeStr(rdr[6]),
                FlStatus:       SafeStr(rdr[7]),
                CommStatus:     SafeStr(rdr[8]),
                LocPrepPct:        Math.Round(SafeDouble(rdr["loc_pct"])  * 100, 1),
                FlConstructionPct: Math.Round(SafeDouble(rdr["fl_pct"])   * 100, 1),
                CommPct:           Math.Round(SafeDouble(rdr["comm_pct"]) * 100, 1),
                OhlPct:            Math.Round(SafeDouble(rdr["ohl_pct"])  * 100, 1),
                RigOnDate:           SafeStr(rdr[13]),
                RigOffDate:          SafeStr(rdr[14]),
                PlannedPct:          plannedPctVal,
                PdoIssue:            rdr["pdo_issue"] != DBNull.Value && Convert.ToInt32(rdr["pdo_issue"]) == 1,
                DrilledNotCompleted: rdr["drilled_not_completed"] != DBNull.Value && Convert.ToInt32(rdr["drilled_not_completed"]) == 1,
                FlafScr:             isFlafScr,
                Spi:                 spiVal,
                RatePerDay:          ratePerDayVal,
                AskRate:             askRateVal
            ));
        }

        // When scoped to a plan year (WRO drill-through), deduplicate to one row per well.
        // The wells-list SQL uses MAX(Week_Number) which can return multiple WMR rows that
        // tie on the same week â€” mirroring the WRO funnel's WmrLatest ROW_NUMBER logic.
        if (planYear.HasValue)
        {
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            result = result
                .Where(r => !string.IsNullOrEmpty(r.WellId) && seen.Add(r.WellId))
                .ToList();
        }

        // commStatus filter: restrict to wells that are commissioned / not commissioned
        // using the same WMRO logic as the PDO Commissioning Status widget.
        if (!string.IsNullOrWhiteSpace(commStatus))
        {
            if (string.Equals(commStatus, "commissioned", StringComparison.OrdinalIgnoreCase))
            {
                var commWellIds = await GetCommissionedWellIdsAsync(cluster, null, null, ct);
                result = result.Where(r => commWellIds.Contains(r.WellId)).ToList();
            }
            else if (string.Equals(commStatus, "notCommissioned", StringComparison.OrdinalIgnoreCase))
            {
                var notCommWellIds = await GetNotCommissionedWellIdsAsync(cluster, null, null, ct);
                result = result.Where(r => notCommWellIds.Contains(r.WellId)).ToList();
            }
        }

        cache.Set(cacheKey, (IReadOnlyList<WmrWellDto>)result, CacheDuration);
        return result;
    }

    /// <summary>
    /// Drilldown for the Wells Readiness funnel: uses the EXACT same CTEs
    /// (SapPlan → WmrLatest → Tracked) as GetWellsReadinessAsync so that
    /// counts are guaranteed to match the funnel card numbers.
    /// </summary>
    private async Task<IReadOnlyList<WmrWellDto>> GetWmrWellsByFunnelLogicAsync(
        DateOnly from,
        DateOnly to,
        DateOnly? asOfDate,
        string? wrFilter,
        string? status,
        string? cluster,
        string? wellId,
        string? wellType = null,
        string? project = null,
        CancellationToken ct = default)
    {
        // ── Scope-specific drilldown: detect prefixes flowline_, ohl_, buffer_ ──
        if (!string.IsNullOrWhiteSpace(wrFilter))
        {
            string? scope = null;
            string? innerFilter = null;
            if (wrFilter.StartsWith("flowline_", StringComparison.OrdinalIgnoreCase))
            {
                scope = "flowline";
                innerFilter = wrFilter["flowline_".Length..];
            }
            else if (wrFilter.StartsWith("ohl_", StringComparison.OrdinalIgnoreCase))
            {
                scope = "ohl";
                innerFilter = wrFilter["ohl_".Length..];
            }
            else if (wrFilter.StartsWith("buffer_", StringComparison.OrdinalIgnoreCase))
            {
                scope = "buffer";
                innerFilter = wrFilter["buffer_".Length..];
            }

            if (scope is not null)
            {
                return scope switch
                {
                    "flowline" => await GetFlowlineWellsByFunnelLogicAsync(from, to, asOfDate, innerFilter, cluster, wellId, wellType, project, ct),
                    "ohl"      => await GetOhlWellsByFunnelLogicAsync(from, to, asOfDate, innerFilter, cluster, wellId, wellType, project, ct),
                    "buffer"   => await GetBufferWellsByFunnelLogicAsync(from, to, asOfDate, innerFilter, cluster, wellId, wellType, project, ct),
                    _          => Array.Empty<WmrWellDto>()
                };
            }
        }

        var planYearStart = from.ToDateTime(TimeOnly.MinValue);
        var planYearEnd   = to.ToDateTime(TimeOnly.MinValue);
        var asOf          = asOfDate?.ToDateTime(TimeOnly.MinValue) ?? planYearEnd;

        // Determine the WHERE filter on DerivedStatus based on wrFilter/status
        string categoryFilter;
        if (!string.IsNullOrWhiteSpace(wrFilter) && wrFilter == "flafscr")
            categoryFilter = "WHERE t.DerivedStatus <> 'FLAF/SCR & Other'";
        else if (!string.IsNullOrWhiteSpace(wrFilter) && wrFilter == "clean")
            categoryFilter = @"WHERE t.DerivedStatus <> 'FLAF/SCR & Other'
                                AND NOT (t.DerivedStatus = 'Backlog' AND t.WellId IN (
                                    SELECT DISTINCT pdo_well_id FROM [dbo].[WellMonitoringReportOptimized] WITH (NOLOCK)
                                    WHERE pdo_well_id IS NOT NULL AND pdo_well_id <> ''
                                      AND reason_if_kpi_not_met IS NOT NULL AND LTRIM(RTRIM(reason_if_kpi_not_met)) <> ''
                                      AND (
                                          LOWER(LTRIM(RTRIM(reason_if_kpi_not_met))) IN ('awaiting handover','awaiting manifold','msv','material availability','scope change','operation issue','appraisal well','technical issue')
                                          OR LOWER(reason_if_kpi_not_met) LIKE '%rsr%'
                                          OR LOWER(reason_if_kpi_not_met) LIKE '%hoist delay%'
                                      )
                                ))";
        else if ((!string.IsNullOrWhiteSpace(wrFilter) && wrFilter.Equals("completed", StringComparison.OrdinalIgnoreCase)) || (!string.IsNullOrWhiteSpace(status) && status.Equals("completed", StringComparison.OrdinalIgnoreCase)))
            categoryFilter = "WHERE t.DerivedStatus IN ('Due Completed', 'Not Due Accelerated')";
        else
            categoryFilter = "WHERE 1=1"; // always include WHERE so AND clauses below are valid

        var clusterFilter = "";
        if (!string.IsNullOrWhiteSpace(cluster))
            clusterFilter = "AND d.project_id IN (SELECT CAST(ID AS NVARCHAR(100)) FROM [dbo].[ProjectIDs] WITH (NOLOCK) WHERE LTRIM(RTRIM([Cluster])) = @cluster)";
        var wellTypeFilterSql = "";
        if (!string.IsNullOrWhiteSpace(wellType))
            wellTypeFilterSql = "AND " + WellTypeFilter("t").Replace("project_id", "ProjectId");
        var projectFilterSql = "";
        if (!string.IsNullOrWhiteSpace(project))
            projectFilterSql = "AND " + ProjectFilter("t").Replace("project_id", "ProjectId");
        var wellIdFilter = "";
        if (!string.IsNullOrWhiteSpace(wellId))
            wellIdFilter = "AND t.WellId = @wellId";

        var sql = $"""
            SET NOCOUNT ON;
            ;WITH SapPlan AS (
                SELECT Well_ID,
                       MIN(TRY_CAST(Earl_start_date AS DATE)) AS PlanStart
                FROM dbo.SAP_DRILLING_SEQUENCE_History WITH (NOLOCK)
                WHERE Well_ID IS NOT NULL AND Well_ID <> ''
                  AND Well_Function NOT IN ('Unspecified', 'RIG MOVE', 'RIG MAINTENANCE')
                  AND TRY_CAST(Earl_start_date AS DATE) >= @planYearStart
                  AND TRY_CAST(Earl_start_date AS DATE) <= @planYearEnd
                GROUP BY Well_ID
            ),
            -- WmrLatest: get the most-recent WMR row per well up to @planYearEnd
            -- (no lower bound — so we always capture the true latest status)
            WmrLatest AS (
                SELECT pdo_well_id, RigOff, FlafDate, Progress, LatestWeekDate, project_id
                FROM (
                    SELECT w.pdo_well_id,
                           TRY_CAST(w.actual_rig_off_date AS DATE) AS RigOff,
                           TRY_CAST(w.flaf_issue_date     AS DATE) AS FlafDate,
                           COALESCE(TRY_CAST(w.over_all_progress_percentages AS FLOAT), 0) AS Progress,
                           w.project_id,
                           TRY_CAST(w.Week_Number AS DATE) AS LatestWeekDate,
                           ROW_NUMBER() OVER (
                               PARTITION BY w.pdo_well_id
                                ORDER BY TRY_CAST(w.Week_Number AS DATE) DESC, w.project_id
                           ) AS rn
                    FROM dbo.WMR w WITH (NOLOCK)
                    WHERE w.pdo_well_id IS NOT NULL AND w.pdo_well_id <> ''
                      AND TRY_CAST(w.Week_Number AS DATE) IS NOT NULL
                      AND TRY_CAST(w.Week_Number AS DATE) <= @planYearEnd
                ) deduped
                WHERE rn = 1
            ),
            -- Tracked: INNER JOIN so drilldown matches summary (SAP ∩ WMR only)
            Tracked AS (
                SELECT sp.Well_ID AS WellId,
                       wl.Progress,
                       wl.project_id AS ProjectId,
                       wl.LatestWeekDate,
                       CASE
                           WHEN wl.Progress >= 1.0 AND wl.LatestWeekDate < sp.PlanStart THEN 'Not Due Accelerated'
                           WHEN wl.Progress >= 1.0                                      THEN 'Due Completed'
                           WHEN wl.FlafDate IS NOT NULL AND wl.FlafDate <= @asOfDate     THEN 'FLAF/SCR & Other'
                           ELSE 'Backlog'
                       END AS DerivedStatus
                FROM SapPlan sp
                INNER JOIN WmrLatest wl ON sp.Well_ID = wl.pdo_well_id
            )
            SELECT
              t.WellId AS pdo_well_id,
              d.rig_no,
              p.[Cluster] AS field_name,
              d.well_location,
              d.well_type,
              t.Progress AS prog,
              d.[location_preparation_status_in_progress_completed] AS loc_status,
              d.[flow_line_const._status_in_progress_completed] AS fl_status,
              d.[flow_line_commi._status_in_progress_completed] AS comm_status,
              COALESCE(TRY_CAST(d.[overall_loc._preparation_10_100] AS FLOAT), 0) AS loc_pct,
              COALESCE(TRY_CAST(d.[overall_const._10_100] AS FLOAT), 0) AS fl_pct,
              COALESCE(TRY_CAST(d.[overall_comm_progress_100] AS FLOAT), 0) AS comm_pct,
              COALESCE(TRY_CAST(d.ohl_progress AS FLOAT), 0) AS ohl_pct,
              d.actual_rig_on_date,
              d.actual_rig_off_date,
              CASE WHEN d.actual_rig_off_date IS NOT NULL AND d.[actual_eng._completion_date] IS NULL THEN 1 ELSE 0 END AS drilled_not_completed,
              0 AS pdo_issue,
              CASE WHEN t.DerivedStatus = 'FLAF/SCR & Other' THEN 1 ELSE 0 END AS flaf_scr,
              CASE
                WHEN t.DerivedStatus IN ('Due Completed', 'Not Due Accelerated') THEN 'completed'
                WHEN t.Progress > 0 AND t.Progress < 1.0 THEN 'inprogress'
                ELSE 'planned'
              END AS status,
              CASE
                WHEN sap.plan_start IS NOT NULL AND sap.plan_end IS NOT NULL
                     AND DATEDIFF(day, sap.plan_start, sap.plan_end) > 0
                THEN CASE
                       WHEN CAST(DATEDIFF(day, sap.plan_start, @asOfDate) AS FLOAT)
                            / DATEDIFF(day, sap.plan_start, sap.plan_end) < 0 THEN 0.0
                       WHEN CAST(DATEDIFF(day, sap.plan_start, @asOfDate) AS FLOAT)
                            / DATEDIFF(day, sap.plan_start, sap.plan_end) > 1 THEN 1.0
                       ELSE CAST(DATEDIFF(day, sap.plan_start, @asOfDate) AS FLOAT)
                            / DATEDIFF(day, sap.plan_start, sap.plan_end)
                     END
                ELSE NULL
              END AS planned_pct,
              CASE
                WHEN t.Progress > 0
                     AND DATEDIFF(day,
                           COALESCE(TRY_CAST(d.actual_rig_on_date AS DATE), sap.plan_start),
                           @asOfDate) > 0
                THEN t.Progress
                     / DATEDIFF(day,
                           COALESCE(TRY_CAST(d.actual_rig_on_date AS DATE), sap.plan_start),
                           @asOfDate)
                ELSE NULL
              END AS rate_per_day,
              CASE
                WHEN sap.plan_end IS NOT NULL
                     AND DATEDIFF(day, @asOfDate, sap.plan_end) > 0
                     AND t.Progress < 1.0
                THEN (1.0 - t.Progress)
                     / DATEDIFF(day, @asOfDate, sap.plan_end)
                ELSE NULL
              END AS ask_rate
            FROM Tracked t
            OUTER APPLY (
              SELECT TOP 1 w.rig_no, w.well_location, w.well_type, w.project_id,
                     w.actual_rig_on_date, w.actual_rig_off_date,
                     w.[actual_eng._completion_date],
                     w.[location_preparation_status_in_progress_completed],
                     w.[flow_line_const._status_in_progress_completed],
                     w.[flow_line_commi._status_in_progress_completed],
                     w.[overall_loc._preparation_10_100],
                     w.[overall_const._10_100],
                     w.[overall_comm_progress_100],
                     w.ohl_progress
              FROM dbo.WMR w WITH (NOLOCK)
              WHERE w.pdo_well_id = t.WellId
                AND TRY_CAST(w.Week_Number AS DATE) = t.LatestWeekDate
            ) d
            LEFT JOIN (SELECT ID, MIN([Cluster]) AS [Cluster] FROM [dbo].[ProjectIDs] WITH (NOLOCK) GROUP BY ID) p ON d.project_id = p.ID
            LEFT JOIN (
              SELECT Well_ID,
                     MIN(TRY_CAST(Earl_start_date AS DATE)) AS plan_start,
                     MAX(TRY_CAST(EarliestEndDate AS DATE)) AS plan_end
              FROM [dbo].[SAP_DRILLING_SEQUENCE_History] WITH (NOLOCK)
              WHERE Well_ID IS NOT NULL AND Well_ID <> ''
              GROUP BY Well_ID
            ) sap ON sap.Well_ID = t.WellId
            {categoryFilter}
            {clusterFilter}
            {wellTypeFilterSql}
            {projectFilterSql}
            {wellIdFilter}
            ORDER BY t.WellId;
            """;

        var connStr = db.Database.GetConnectionString()!;
        await using var conn = new SqlConnection(connStr);
        await OpenWithRetryAsync(conn, ct);

        await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 60 };
        cmd.Parameters.Add(new SqlParameter("@planYearStart", System.Data.SqlDbType.Date) { Value = planYearStart.Date });
        cmd.Parameters.Add(new SqlParameter("@planYearEnd", System.Data.SqlDbType.Date) { Value = planYearEnd.Date });
        cmd.Parameters.Add(new SqlParameter("@asOfDate", System.Data.SqlDbType.Date) { Value = asOf.Date });
        if (!string.IsNullOrWhiteSpace(wellId))
            cmd.Parameters.Add(new SqlParameter("@wellId", wellId));
        if (!string.IsNullOrWhiteSpace(cluster))
            cmd.Parameters.Add(new SqlParameter("@cluster", cluster));
        if (!string.IsNullOrWhiteSpace(wellType))
            cmd.Parameters.Add(new SqlParameter("@wellType", wellType));
        if (!string.IsNullOrWhiteSpace(project))
            cmd.Parameters.Add(new SqlParameter("@project", project));

        await using var rdr = await cmd.ExecuteReaderAsync(ct);
        var result = new List<WmrWellDto>();

        static double SafeDouble(object v) => v == DBNull.Value ? 0.0 : Convert.ToDouble(v);
        static string? SafeStr(object v)   => v == DBNull.Value ? null : v?.ToString();

        while (await rdr.ReadAsync(ct))
        {
            var prog = SafeDouble(rdr["prog"]);
            var derivedStatus = rdr["status"]?.ToString() ?? "planned";
            var isFlafScr = rdr["flaf_scr"] != DBNull.Value && Convert.ToInt32(rdr["flaf_scr"]) == 1;

            var rawPlannedPct = rdr["planned_pct"];
            double? plannedPctVal = rawPlannedPct == DBNull.Value ? null : Math.Round(Convert.ToDouble(rawPlannedPct) * 100, 1);

            double? spiVal = null;
            if (plannedPctVal.HasValue && plannedPctVal.Value > 0)
                spiVal = Math.Round((prog * 100) / plannedPctVal.Value, 2);

            var rawRate = rdr["rate_per_day"];
            double? ratePerDayVal = rawRate == DBNull.Value ? null : Math.Round(Convert.ToDouble(rawRate) * 100, 2);

            var rawAsk = rdr["ask_rate"];
            double? askRateVal = rawAsk == DBNull.Value ? null : Math.Round(Convert.ToDouble(rawAsk) * 100, 2);

            result.Add(new WmrWellDto(
                WellId:         rdr.GetString(0),
                Rig:            SafeStr(rdr[1]),
                Field:          SafeStr(rdr["field_name"]),
                Location:       SafeStr(rdr[3]),
                WellType:       SafeStr(rdr[4]),
                ProgressPct:    Math.Round(prog * 100, 1),
                Status:         derivedStatus,
                LocPrepStatus:  SafeStr(rdr["loc_status"]),
                FlStatus:       SafeStr(rdr["fl_status"]),
                CommStatus:     SafeStr(rdr["comm_status"]),
                LocPrepPct:        Math.Round(SafeDouble(rdr["loc_pct"])  * 100, 1),
                FlConstructionPct: Math.Round(SafeDouble(rdr["fl_pct"])   * 100, 1),
                CommPct:           Math.Round(SafeDouble(rdr["comm_pct"]) * 100, 1),
                OhlPct:            Math.Round(SafeDouble(rdr["ohl_pct"])  * 100, 1),
                RigOnDate:           SafeStr(rdr["actual_rig_on_date"]),
                RigOffDate:          SafeStr(rdr["actual_rig_off_date"]),
                PlannedPct:          plannedPctVal,
                PdoIssue:            false,
                DrilledNotCompleted: rdr["drilled_not_completed"] != DBNull.Value && Convert.ToInt32(rdr["drilled_not_completed"]) == 1,
                FlafScr:             isFlafScr,
                Spi:                 spiVal,
                RatePerDay:          ratePerDayVal,
                AskRate:             askRateVal
            ));
        }

        return result;
    }

    // ─── Scope-specific Funnel Drilldowns ────────────────────────────────────────
    // These methods mirror the exact CTEs used by the respective KPI endpoints
    // (GetFlowlineReadinessAsync, GetOhlReadinessAsync, GetBufferLocationProgressAsync)
    // but return individual well rows for drilldown grid display.
    // Data integrity: drilldown count == funnel card count because the same CTEs are used.

    /// <summary>
    /// Flowline-scope drilldown: uses the same CTE logic as GetFlowlineReadinessAsync
    /// with flowline-specific completion = fl_done (overall_const = 100% or flowline status = Completed).
    /// </summary>
    private async Task<IReadOnlyList<WmrWellDto>> GetFlowlineWellsByFunnelLogicAsync(
        DateOnly from, DateOnly to, DateOnly? asOfDate,
        string? innerFilter, string? cluster, string? wellId, string? wellType, string? project, CancellationToken ct)
    {
        // Use today as asOf (matches KPI endpoint default) unless explicitly provided
        var asOf = asOfDate?.ToDateTime(TimeOnly.MinValue) ?? DateTime.UtcNow.Date;
        var extraWhere = "";
        if (!string.IsNullOrEmpty(cluster)) extraWhere += " AND " + ClusterFilter(cluster, "w.[pdo_well_id]");
        if (!string.IsNullOrEmpty(wellId))  extraWhere += " AND w.[pdo_well_id] = @wellId";

        // Category filter based on innerFilter (plan/flafscr/pdo/clean/completed)
        string categoryFilter;
        if (innerFilter == "flafscr" || innerFilter == "pdo" || innerFilter == "clean")
            categoryFilter = "WHERE t.DerivedStatus <> 'FLAF/SCR'";
        else if (innerFilter == "completed")
            categoryFilter = "WHERE t.DerivedStatus = 'Completed'";
        else
            categoryFilter = "WHERE 1=1"; // plan: show all, WHERE needed for AND clauses

        var clusterTrackedFilter = !string.IsNullOrWhiteSpace(cluster) ? "AND " + ClusterFilter(cluster, "t.WellId") : "";
        var wellIdTrackedFilter = !string.IsNullOrWhiteSpace(wellId) ? "AND t.WellId = @wellId" : "";
        var wellTypeTrackedFilter = !string.IsNullOrWhiteSpace(wellType) ? "AND " + WellTypeFilter("t") : "";
        var projectTrackedFilter = !string.IsNullOrWhiteSpace(project) ? "AND " + ProjectFilter("t") : "";

        var sql = $"""
            SET NOCOUNT ON;
            ;WITH sap_planned AS (
                SELECT DISTINCT s.Well_ID
                FROM dbo.SAP_DRILLING_SEQUENCE_History s WITH (NOLOCK)
                WHERE s.Well_ID IS NOT NULL AND s.Well_ID <> ''
                  AND s.Well_Function NOT IN ('Unspecified', 'RIG MOVE', 'RIG MAINTENANCE')
                  AND TRY_CAST(s.Earl_start_date AS DATE) >= @fromDate
                  AND TRY_CAST(s.Earl_start_date AS DATE) <= @toDate
            ),
            WmrLatest AS (
                SELECT pdo_well_id,
                       TRY_CAST(flaf_issue_date AS DATE) AS FlafDate,
                       TRY_CAST(actual_rig_off_date AS DATE) AS RigOff,
                       CASE WHEN TRY_CAST([overall_const._10_100] AS FLOAT) = 100
                              OR [flow_line_const._status_in_progress_completed] = 'Completed'
                              OR ([const._complete_date_including_f_l_final_hydro_test_1_day_before_rig_on_date] IS NOT NULL
                                  AND LTRIM(RTRIM([const._complete_date_including_f_l_final_hydro_test_1_day_before_rig_on_date])) != '')
                            THEN 1 ELSE 0 END AS fl_done,
                       rig_no, well_location, well_type, project_id,
                       actual_rig_on_date, actual_rig_off_date AS rig_off_raw,
                       [actual_eng._completion_date],
                       [location_preparation_status_in_progress_completed],
                       [flow_line_const._status_in_progress_completed],
                       [flow_line_commi._status_in_progress_completed],
                       COALESCE(TRY_CAST([overall_loc._preparation_10_100] AS FLOAT), 0) AS loc_pct,
                       COALESCE(TRY_CAST([overall_const._10_100] AS FLOAT), 0) AS fl_pct,
                       COALESCE(TRY_CAST([overall_comm_progress_100] AS FLOAT), 0) AS comm_pct,
                       COALESCE(TRY_CAST(ohl_progress AS FLOAT), 0) AS ohl_pct,
                       COALESCE(TRY_CAST(over_all_progress_percentages AS FLOAT), 0) AS Progress
                FROM (
                    SELECT w.*,
                           ROW_NUMBER() OVER (
                               PARTITION BY w.pdo_well_id
                               ORDER BY w.actual_rig_off_date DESC,
                                        w.flaf_issue_date DESC,
                                        w.over_all_progress_percentages DESC, w.project_id
                           ) AS rn
                    FROM dbo.WMR w WITH (NOLOCK)
                    INNER JOIN (
                        SELECT pdo_well_id, MAX(Week_Number) AS max_wk
                        FROM dbo.WMR WITH (NOLOCK)
                        WHERE pdo_well_id IS NOT NULL AND pdo_well_id <> ''
                          AND COALESCE(TRY_CAST(Week_Number AS DATE), TRY_CONVERT(DATE, Week_Number, 5)) <= @asOfDate
                        GROUP BY pdo_well_id
                    ) lts ON w.pdo_well_id = lts.pdo_well_id AND w.Week_Number = lts.max_wk
                    WHERE w.pdo_well_id IS NOT NULL AND w.pdo_well_id <> ''
                    {extraWhere}
                ) deduped
                WHERE rn = 1
            ),
            Tracked AS (
                SELECT sp.Well_ID AS WellId, wl.FlafDate, wl.RigOff, wl.fl_done,
                       wl.rig_no, wl.well_location, wl.well_type, wl.project_id,
                       wl.actual_rig_on_date, wl.rig_off_raw, wl.[actual_eng._completion_date],
                       wl.[location_preparation_status_in_progress_completed],
                       wl.[flow_line_const._status_in_progress_completed],
                       wl.[flow_line_commi._status_in_progress_completed],
                       wl.loc_pct, wl.fl_pct, wl.comm_pct, wl.ohl_pct, wl.Progress,
                       CASE
                           WHEN wl.fl_done = 1 THEN 'Completed'
                           WHEN (wl.RigOff IS NULL OR wl.RigOff > @asOfDate) AND wl.FlafDate IS NOT NULL AND wl.FlafDate <= @asOfDate THEN 'FLAF/SCR'
                           ELSE 'Backlog'
                       END AS DerivedStatus
                FROM sap_planned sp
                INNER JOIN WmrLatest wl ON sp.Well_ID = wl.pdo_well_id
                UNION
                SELECT wl.pdo_well_id, wl.FlafDate, wl.RigOff, wl.fl_done,
                       wl.rig_no, wl.well_location, wl.well_type, wl.project_id,
                       wl.actual_rig_on_date, wl.rig_off_raw, wl.[actual_eng._completion_date],
                       wl.[location_preparation_status_in_progress_completed],
                       wl.[flow_line_const._status_in_progress_completed],
                       wl.[flow_line_commi._status_in_progress_completed],
                       wl.loc_pct, wl.fl_pct, wl.comm_pct, wl.ohl_pct, wl.Progress,
                       CASE
                           WHEN wl.fl_done = 1 THEN 'Completed'
                           WHEN (wl.RigOff IS NULL OR wl.RigOff > @asOfDate) AND wl.FlafDate IS NOT NULL AND wl.FlafDate <= @asOfDate THEN 'FLAF/SCR'
                           ELSE 'Backlog'
                       END
                FROM WmrLatest wl
                WHERE NOT EXISTS (SELECT 1 FROM sap_planned sp WHERE sp.Well_ID = wl.pdo_well_id)
            )
            SELECT
              t.WellId AS pdo_well_id,
              t.rig_no,
              p.[Cluster] AS field_name,
              t.well_location,
              t.well_type,
              t.Progress AS prog,
              t.[location_preparation_status_in_progress_completed] AS loc_status,
              t.[flow_line_const._status_in_progress_completed] AS fl_status,
              t.[flow_line_commi._status_in_progress_completed] AS comm_status,
              t.loc_pct, t.fl_pct, t.comm_pct, t.ohl_pct,
              t.actual_rig_on_date, t.rig_off_raw AS actual_rig_off_date,
              t.DerivedStatus,
              t.fl_done
            FROM Tracked t
            LEFT JOIN (SELECT ID, MIN([Cluster]) AS [Cluster] FROM [dbo].[ProjectIDs] WITH (NOLOCK) GROUP BY ID) p ON t.project_id = p.ID
            {categoryFilter}
            {clusterTrackedFilter}
            {wellIdTrackedFilter}
            {wellTypeTrackedFilter}
            {projectTrackedFilter}
            ORDER BY t.WellId;
            """;

        var connStr = db.Database.GetConnectionString()!;
        await using var conn = new SqlConnection(connStr);
        await OpenWithRetryAsync(conn, ct);
        await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 120 };
        cmd.Parameters.AddWithValue("@fromDate", from.ToDateTime(TimeOnly.MinValue));
        cmd.Parameters.AddWithValue("@toDate", to.ToDateTime(TimeOnly.MinValue));
        cmd.Parameters.AddWithValue("@asOfDate", asOf);
        if (!string.IsNullOrEmpty(cluster)) cmd.Parameters.AddWithValue("@cluster", cluster);
        if (!string.IsNullOrEmpty(wellId))  cmd.Parameters.AddWithValue("@wellId", wellId);
        if (!string.IsNullOrEmpty(wellType)) cmd.Parameters.AddWithValue("@wellType", wellType);
        if (!string.IsNullOrEmpty(project)) cmd.Parameters.AddWithValue("@project", project);

        await using var rdr = await cmd.ExecuteReaderAsync(ct);
        var result = new List<WmrWellDto>();
        static string? SafeStr(object v) => v == DBNull.Value ? null : v?.ToString();
        static double SafeDouble(object v) => v == DBNull.Value ? 0.0 : Convert.ToDouble(v);

        while (await rdr.ReadAsync(ct))
        {
            var prog = SafeDouble(rdr["prog"]);
            var derivedStatus = rdr["DerivedStatus"]?.ToString() ?? "Backlog";
            var status = derivedStatus == "Completed" ? "completed"
                       : prog > 0 && prog < 1.0 ? "inprogress"
                       : "planned";

            result.Add(new WmrWellDto(
                WellId:            rdr.GetString(0),
                Rig:               SafeStr(rdr["rig_no"]),
                Field:             SafeStr(rdr["field_name"]),
                Location:          SafeStr(rdr["well_location"]),
                WellType:          SafeStr(rdr["well_type"]),
                ProgressPct:       Math.Round(prog * 100, 1),
                Status:            status,
                LocPrepStatus:     SafeStr(rdr["loc_status"]),
                FlStatus:          SafeStr(rdr["fl_status"]),
                CommStatus:        SafeStr(rdr["comm_status"]),
                LocPrepPct:        Math.Round(SafeDouble(rdr["loc_pct"]) * 100, 1),
                FlConstructionPct: Math.Round(SafeDouble(rdr["fl_pct"]) * 100, 1),
                CommPct:           Math.Round(SafeDouble(rdr["comm_pct"]) * 100, 1),
                OhlPct:            Math.Round(SafeDouble(rdr["ohl_pct"]) * 100, 1),
                RigOnDate:         SafeStr(rdr["actual_rig_on_date"]),
                RigOffDate:        SafeStr(rdr["actual_rig_off_date"]),
                PlannedPct:        null,
                PdoIssue:          false,
                DrilledNotCompleted: false,
                FlafScr:           derivedStatus == "FLAF/SCR",
                Spi:               null,
                RatePerDay:        null,
                AskRate:           null
            ));
        }
        return result;
    }

    /// <summary>
    /// OHL-scope drilldown: uses the same CTE logic as GetOhlReadinessAsync
    /// with OHL-specific completion = ohl_done (ohl_progress >= 100 or ohl_completion_date set).
    /// </summary>
    private async Task<IReadOnlyList<WmrWellDto>> GetOhlWellsByFunnelLogicAsync(
        DateOnly from, DateOnly to, DateOnly? asOfDate,
        string? innerFilter, string? cluster, string? wellId, string? wellType, string? project, CancellationToken ct)
    {
        // Use today as asOf (matches KPI endpoint default) unless explicitly provided
        var asOf = asOfDate?.ToDateTime(TimeOnly.MinValue) ?? DateTime.UtcNow.Date;
        var extraWhere = "";
        if (!string.IsNullOrEmpty(cluster)) extraWhere += " AND " + ClusterFilter(cluster, "w.[pdo_well_id]");
        if (!string.IsNullOrEmpty(wellId))  extraWhere += " AND w.[pdo_well_id] = @wellId";

        string categoryFilter;
        if (innerFilter == "flafscr" || innerFilter == "pdo" || innerFilter == "clean")
            categoryFilter = "WHERE t.DerivedStatus <> 'FLAF/SCR'";
        else if (innerFilter == "completed")
            categoryFilter = "WHERE t.DerivedStatus = 'Completed'";
        else
            categoryFilter = "WHERE 1=1"; // plan: show all, WHERE needed for AND clauses

        var clusterTrackedFilter = !string.IsNullOrWhiteSpace(cluster) ? "AND " + ClusterFilter(cluster, "t.WellId") : "";
        var wellIdTrackedFilter = !string.IsNullOrWhiteSpace(wellId) ? "AND t.WellId = @wellId" : "";
        var wellTypeTrackedFilter = !string.IsNullOrWhiteSpace(wellType) ? "AND " + WellTypeFilter("t") : "";
        var projectTrackedFilter = !string.IsNullOrWhiteSpace(project) ? "AND " + ProjectFilter("t") : "";

        var sql = $"""
            SET NOCOUNT ON;
            ;WITH sap_planned AS (
                SELECT DISTINCT s.Well_ID
                FROM dbo.SAP_DRILLING_SEQUENCE_History s WITH (NOLOCK)
                WHERE s.Well_ID IS NOT NULL AND s.Well_ID <> ''
                  AND s.Well_Function NOT IN ('Unspecified', 'RIG MOVE', 'RIG MAINTENANCE')
                  AND TRY_CAST(s.Earl_start_date AS DATE) >= @fromDate
                  AND TRY_CAST(s.Earl_start_date AS DATE) <= @toDate
            ),
            WmrLatest AS (
                SELECT pdo_well_id,
                       TRY_CAST(flaf_issue_date AS DATE) AS FlafDate,
                       TRY_CAST(actual_rig_off_date AS DATE) AS RigOff,
                       CASE WHEN TRY_CAST(ohl_progress AS FLOAT) >= 100
                              OR (ohl_completion_date IS NOT NULL AND LTRIM(RTRIM(ohl_completion_date)) != '')
                            THEN 1 ELSE 0 END AS ohl_done,
                       rig_no, well_location, well_type, project_id,
                       actual_rig_on_date, actual_rig_off_date AS rig_off_raw,
                       [actual_eng._completion_date],
                       [location_preparation_status_in_progress_completed],
                       [flow_line_const._status_in_progress_completed],
                       [flow_line_commi._status_in_progress_completed],
                       COALESCE(TRY_CAST([overall_loc._preparation_10_100] AS FLOAT), 0) AS loc_pct,
                       COALESCE(TRY_CAST([overall_const._10_100] AS FLOAT), 0) AS fl_pct,
                       COALESCE(TRY_CAST([overall_comm_progress_100] AS FLOAT), 0) AS comm_pct,
                       COALESCE(TRY_CAST(ohl_progress AS FLOAT), 0) AS ohl_pct,
                       COALESCE(TRY_CAST(over_all_progress_percentages AS FLOAT), 0) AS Progress
                FROM (
                    SELECT w.*,
                           ROW_NUMBER() OVER (
                               PARTITION BY w.pdo_well_id
                               ORDER BY w.actual_rig_off_date DESC,
                                        w.flaf_issue_date DESC,
                                        w.over_all_progress_percentages DESC, w.project_id
                           ) AS rn
                    FROM dbo.WMR w WITH (NOLOCK)
                    INNER JOIN (
                        SELECT pdo_well_id, MAX(Week_Number) AS max_wk
                        FROM dbo.WMR WITH (NOLOCK)
                        WHERE pdo_well_id IS NOT NULL AND pdo_well_id <> ''
                          AND COALESCE(TRY_CAST(Week_Number AS DATE), TRY_CONVERT(DATE, Week_Number, 5)) <= @asOfDate
                        GROUP BY pdo_well_id
                    ) lts ON w.pdo_well_id = lts.pdo_well_id AND w.Week_Number = lts.max_wk
                    WHERE w.pdo_well_id IS NOT NULL AND w.pdo_well_id <> ''
                    {extraWhere}
                ) deduped
                WHERE rn = 1
            ),
            Tracked AS (
                SELECT sp.Well_ID AS WellId, wl.FlafDate, wl.RigOff, wl.ohl_done,
                       wl.rig_no, wl.well_location, wl.well_type, wl.project_id,
                       wl.actual_rig_on_date, wl.rig_off_raw, wl.[actual_eng._completion_date],
                       wl.[location_preparation_status_in_progress_completed],
                       wl.[flow_line_const._status_in_progress_completed],
                       wl.[flow_line_commi._status_in_progress_completed],
                       wl.loc_pct, wl.fl_pct, wl.comm_pct, wl.ohl_pct, wl.Progress,
                       CASE
                           WHEN wl.ohl_done = 1 THEN 'Completed'
                           WHEN (wl.RigOff IS NULL OR wl.RigOff > @asOfDate) AND wl.FlafDate IS NOT NULL AND wl.FlafDate <= @asOfDate THEN 'FLAF/SCR'
                           ELSE 'Backlog'
                       END AS DerivedStatus
                FROM sap_planned sp
                INNER JOIN WmrLatest wl ON sp.Well_ID = wl.pdo_well_id
                UNION
                SELECT wl.pdo_well_id, wl.FlafDate, wl.RigOff, wl.ohl_done,
                       wl.rig_no, wl.well_location, wl.well_type, wl.project_id,
                       wl.actual_rig_on_date, wl.rig_off_raw, wl.[actual_eng._completion_date],
                       wl.[location_preparation_status_in_progress_completed],
                       wl.[flow_line_const._status_in_progress_completed],
                       wl.[flow_line_commi._status_in_progress_completed],
                       wl.loc_pct, wl.fl_pct, wl.comm_pct, wl.ohl_pct, wl.Progress,
                       CASE
                           WHEN wl.ohl_done = 1 THEN 'Completed'
                           WHEN (wl.RigOff IS NULL OR wl.RigOff > @asOfDate) AND wl.FlafDate IS NOT NULL AND wl.FlafDate <= @asOfDate THEN 'FLAF/SCR'
                           ELSE 'Backlog'
                       END
                FROM WmrLatest wl
                WHERE NOT EXISTS (SELECT 1 FROM sap_planned sp WHERE sp.Well_ID = wl.pdo_well_id)
            )
            SELECT
              t.WellId AS pdo_well_id,
              t.rig_no,
              p.[Cluster] AS field_name,
              t.well_location,
              t.well_type,
              t.Progress AS prog,
              t.[location_preparation_status_in_progress_completed] AS loc_status,
              t.[flow_line_const._status_in_progress_completed] AS fl_status,
              t.[flow_line_commi._status_in_progress_completed] AS comm_status,
              t.loc_pct, t.fl_pct, t.comm_pct, t.ohl_pct,
              t.actual_rig_on_date, t.rig_off_raw AS actual_rig_off_date,
              t.DerivedStatus,
              t.ohl_done
            FROM Tracked t
            LEFT JOIN (SELECT ID, MIN([Cluster]) AS [Cluster] FROM [dbo].[ProjectIDs] WITH (NOLOCK) GROUP BY ID) p ON t.project_id = p.ID
            {categoryFilter}
            {clusterTrackedFilter}
            {wellIdTrackedFilter}
            {wellTypeTrackedFilter}
            {projectTrackedFilter}
            ORDER BY t.WellId;
            """;

        var connStr = db.Database.GetConnectionString()!;
        await using var conn = new SqlConnection(connStr);
        await OpenWithRetryAsync(conn, ct);
        await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 120 };
        cmd.Parameters.AddWithValue("@fromDate", from.ToDateTime(TimeOnly.MinValue));
        cmd.Parameters.AddWithValue("@toDate", to.ToDateTime(TimeOnly.MinValue));
        cmd.Parameters.AddWithValue("@asOfDate", asOf);
        if (!string.IsNullOrEmpty(cluster)) cmd.Parameters.AddWithValue("@cluster", cluster);
        if (!string.IsNullOrEmpty(wellId))  cmd.Parameters.AddWithValue("@wellId", wellId);
        if (!string.IsNullOrEmpty(wellType)) cmd.Parameters.AddWithValue("@wellType", wellType);
        if (!string.IsNullOrEmpty(project)) cmd.Parameters.AddWithValue("@project", project);

        await using var rdr = await cmd.ExecuteReaderAsync(ct);
        var result = new List<WmrWellDto>();
        static string? SafeStr(object v) => v == DBNull.Value ? null : v?.ToString();
        static double SafeDouble(object v) => v == DBNull.Value ? 0.0 : Convert.ToDouble(v);

        while (await rdr.ReadAsync(ct))
        {
            var prog = SafeDouble(rdr["prog"]);
            var derivedStatus = rdr["DerivedStatus"]?.ToString() ?? "Backlog";
            var status = derivedStatus == "Completed" ? "completed"
                       : prog > 0 && prog < 1.0 ? "inprogress"
                       : "planned";

            result.Add(new WmrWellDto(
                WellId:            rdr.GetString(0),
                Rig:               SafeStr(rdr["rig_no"]),
                Field:             SafeStr(rdr["field_name"]),
                Location:          SafeStr(rdr["well_location"]),
                WellType:          SafeStr(rdr["well_type"]),
                ProgressPct:       Math.Round(prog * 100, 1),
                Status:            status,
                LocPrepStatus:     SafeStr(rdr["loc_status"]),
                FlStatus:          SafeStr(rdr["fl_status"]),
                CommStatus:        SafeStr(rdr["comm_status"]),
                LocPrepPct:        Math.Round(SafeDouble(rdr["loc_pct"]) * 100, 1),
                FlConstructionPct: Math.Round(SafeDouble(rdr["fl_pct"]) * 100, 1),
                CommPct:           Math.Round(SafeDouble(rdr["comm_pct"]) * 100, 1),
                OhlPct:            Math.Round(SafeDouble(rdr["ohl_pct"]) * 100, 1),
                RigOnDate:         SafeStr(rdr["actual_rig_on_date"]),
                RigOffDate:        SafeStr(rdr["actual_rig_off_date"]),
                PlannedPct:        null,
                PdoIssue:          false,
                DrilledNotCompleted: false,
                FlafScr:           derivedStatus == "FLAF/SCR",
                Spi:               null,
                RatePerDay:        null,
                AskRate:           null
            ));
        }
        return result;
    }

    /// <summary>
    /// Buffer-location-scope drilldown: uses the same CTE logic as GetBufferLocationProgressAsync
    /// with buffer-specific criteria (pegging, SCR days, PDO issues, buffer_status).
    /// </summary>
    private async Task<IReadOnlyList<WmrWellDto>> GetBufferWellsByFunnelLogicAsync(
        DateOnly from, DateOnly to, DateOnly? asOfDate,
        string? innerFilter, string? cluster, string? wellId, string? wellType, string? project, CancellationToken ct)
    {
        var year = from.Year;
        var asOf = asOfDate?.ToDateTime(TimeOnly.MinValue) ?? to.ToDateTime(TimeOnly.MinValue);

        // Buffer filter categories:
        // plan → all wells, pegging/flafscr/clean → exclude pegging+SCR excluded, completed → only completed
        string categoryFilter;
        if (innerFilter == "pegging" || innerFilter == "flafscr" || innerFilter == "clean")
            categoryFilter = "WHERE f.peg_excl = 0 AND f.scr_excl = 0";
        else if (innerFilter == "completed")
            categoryFilter = "WHERE f.is_done = 1";
        else
            categoryFilter = "WHERE 1=1"; // plan: show all, WHERE needed for AND clauses

        var sql = $"""
            SET NOCOUNT ON;
            DECLARE @pegging_days INT = 90;
            DECLARE @scr_days     INT = 60;

            ;WITH buffer_wells AS (
                SELECT * FROM (
                    SELECT
                        w2.pdo_well_id,
                        TRY_CAST(w2.[latest_exp.rig_on_location_sap_data] AS DATE) AS kpi_dl,
                        TRY_CAST(w2.actual_finish_date AS DATE) AS done_dt,
                        TRY_CAST(w2.actual_pegged_date AS DATE) AS pegged_dt,
                        TRY_CAST(w2.actual_start_date AS DATE) AS start_dt,
                        w2.scr_no,
                        TRY_CAST(w2.scr_date AS DATE) AS scr_dt,
                        w2.ssfd_wells, w2.ipm, w2.moc_raised, w2.moc_approved,
                        w2.buffer_status,
                        w2.rig_no, w2.well_location, w2.well_type, w2.project_id,
                        w2.actual_rig_on_date,
                        w2.actual_rig_off_date,
                        w2.[actual_eng._completion_date],
                        w2.[location_preparation_status_in_progress_completed],
                        w2.[flow_line_const._status_in_progress_completed],
                        w2.[flow_line_commi._status_in_progress_completed],
                        COALESCE(TRY_CAST(w2.[overall_loc._preparation_10_100] AS FLOAT), 0) AS loc_pct,
                        COALESCE(TRY_CAST(w2.[overall_const._10_100] AS FLOAT), 0) AS fl_pct,
                        COALESCE(TRY_CAST(w2.[overall_comm_progress_100] AS FLOAT), 0) AS comm_pct,
                        COALESCE(TRY_CAST(w2.ohl_progress AS FLOAT), 0) AS ohl_pct,
                        COALESCE(TRY_CAST(w2.over_all_progress_percentages AS FLOAT), 0) AS Progress,
                        ROW_NUMBER() OVER (
                            PARTITION BY w2.pdo_well_id
                            ORDER BY COALESCE(TRY_CAST(w2.Week_Number AS DATE), TRY_CONVERT(DATE, w2.Week_Number, 5)) DESC
                        ) AS rn
                    FROM dbo.WMR w2 WITH (NOLOCK)
                    WHERE w2.pdo_well_id IS NOT NULL
                      AND w2.project_id IN (
                          SELECT p.ID FROM dbo.ProjectIDs p WITH (NOLOCK)
                          WHERE LTRIM(RTRIM(p.[Project])) = 'Location'
                            AND LTRIM(RTRIM(p.[Cluster])) IN ('Nimr','Marmul')
                            {(!string.IsNullOrEmpty(cluster) ? "AND LTRIM(RTRIM(p.[Cluster])) = @clusterParam" : "")}
                            {(!string.IsNullOrEmpty(wellType) ? "AND LTRIM(RTRIM(p.[Type])) = @wellType" : "")}
                            {(!string.IsNullOrEmpty(project) ? "AND LTRIM(RTRIM(p.[Project])) = @project" : "")}
                      )
                ) w WHERE w.rn = 1
                AND YEAR(w.kpi_dl) = @year
                {(!string.IsNullOrEmpty(wellId) ? "AND w.pdo_well_id = @wellId" : "")}
            ),
            flags AS (
                SELECT *,
                    CASE
                        WHEN pegged_dt IS NULL THEN 1
                        WHEN start_dt IS NOT NULL AND DATEDIFF(DAY, start_dt, pegged_dt) > @pegging_days THEN 1
                        ELSE 0
                    END AS peg_excl,
                    CASE
                        WHEN scr_no IS NOT NULL AND scr_dt IS NOT NULL AND DATEDIFF(DAY, scr_dt, kpi_dl) <= @scr_days
                        THEN 1 ELSE 0
                    END AS scr_excl,
                    CASE WHEN (actual_rig_on_date IS NULL OR LTRIM(RTRIM(actual_rig_on_date)) = '') AND LTRIM(RTRIM([location_preparation_status_in_progress_completed])) = 'Completed' THEN 1 ELSE 0 END AS is_done,
                    CASE WHEN done_dt IS NOT NULL AND done_dt < kpi_dl THEN 1 ELSE 0 END AS is_accel,
                    CASE
                        WHEN kpi_dl < GETDATE() AND done_dt IS NULL
                         AND (buffer_status NOT IN ('Suspended','Hold','On Hold') OR buffer_status IS NULL)
                        THEN 1 ELSE 0
                    END AS is_backlog
                FROM buffer_wells
            )
            SELECT
              f.pdo_well_id,
              f.rig_no,
              p2.[Cluster] AS field_name,
              f.well_location,
              f.well_type,
              f.Progress AS prog,
              f.[location_preparation_status_in_progress_completed] AS loc_status,
              f.[flow_line_const._status_in_progress_completed] AS fl_status,
              f.[flow_line_commi._status_in_progress_completed] AS comm_status,
              f.loc_pct, f.fl_pct, f.comm_pct, f.ohl_pct,
              f.actual_rig_on_date, f.actual_rig_off_date,
              f.is_done, f.peg_excl, f.scr_excl, f.buffer_status
            FROM flags f
            LEFT JOIN (SELECT ID, MIN([Cluster]) AS [Cluster] FROM [dbo].[ProjectIDs] WITH (NOLOCK) GROUP BY ID) p2 ON f.project_id = p2.ID
            {categoryFilter}
            ORDER BY f.pdo_well_id;
            """;

        var connStr = db.Database.GetConnectionString()!;
        await using var conn = new SqlConnection(connStr);
        await OpenWithRetryAsync(conn, ct);
        await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 120 };
        cmd.Parameters.AddWithValue("@year", year);
        if (!string.IsNullOrEmpty(cluster))
            cmd.Parameters.AddWithValue("@clusterParam", char.ToUpper(cluster[0]) + cluster[1..].ToLower());
        if (!string.IsNullOrEmpty(wellId)) cmd.Parameters.AddWithValue("@wellId", wellId);
        if (!string.IsNullOrEmpty(wellType)) cmd.Parameters.AddWithValue("@wellType", wellType);
        if (!string.IsNullOrEmpty(project)) cmd.Parameters.AddWithValue("@project", project);

        await using var rdr = await cmd.ExecuteReaderAsync(ct);
        var result = new List<WmrWellDto>();
        static string? SafeStr(object v) => v == DBNull.Value ? null : v?.ToString();
        static double SafeDouble(object v) => v == DBNull.Value ? 0.0 : Convert.ToDouble(v);

        while (await rdr.ReadAsync(ct))
        {
            var prog = SafeDouble(rdr["prog"]);
            var isDone = rdr["is_done"] != DBNull.Value && Convert.ToInt32(rdr["is_done"]) == 1;
            var status = isDone ? "completed"
                       : prog > 0 && prog < 1.0 ? "inprogress"
                       : "planned";

            result.Add(new WmrWellDto(
                WellId:            rdr.GetString(0),
                Rig:               SafeStr(rdr["rig_no"]),
                Field:             SafeStr(rdr["field_name"]),
                Location:          SafeStr(rdr["well_location"]),
                WellType:          SafeStr(rdr["well_type"]),
                ProgressPct:       Math.Round(prog * 100, 1),
                Status:            status,
                LocPrepStatus:     SafeStr(rdr["loc_status"]),
                FlStatus:          SafeStr(rdr["fl_status"]),
                CommStatus:        SafeStr(rdr["comm_status"]),
                LocPrepPct:        Math.Round(SafeDouble(rdr["loc_pct"]) * 100, 1),
                FlConstructionPct: Math.Round(SafeDouble(rdr["fl_pct"]) * 100, 1),
                CommPct:           Math.Round(SafeDouble(rdr["comm_pct"]) * 100, 1),
                OhlPct:            Math.Round(SafeDouble(rdr["ohl_pct"]) * 100, 1),
                RigOnDate:         SafeStr(rdr["actual_rig_on_date"]),
                RigOffDate:        SafeStr(rdr["actual_rig_off_date"]),
                PlannedPct:        null,
                PdoIssue:          false,
                DrilledNotCompleted: false,
                FlafScr:           false,
                Spi:               null,
                RatePerDay:        null,
                AskRate:           null
            ));
        }

        await rdr.CloseAsync();

        // ── Post-process: compute DrillingBufferStatus (Drilled / ROL / Buffer 1-3) ──
        return await ComputeDrillingBufferStatusAsync(result, conn, ct);
    }

    /// <summary>
    /// Computes DrillingBufferStatus for buffer location wells:
    /// - Drilled: actual_rig_on AND actual_rig_off are set
    /// - ROL: actual_rig_on is set but actual_rig_off is NOT set
    /// - Buffer 1/2/3: no actual_rig_on, LCCC1040 activity = 100%, ranked by SAP Earl_start_date ASC (top 3)
    /// </summary>
    private async Task<IReadOnlyList<WmrWellDto>> ComputeDrillingBufferStatusAsync(
        List<WmrWellDto> wells, SqlConnection conn, CancellationToken ct)
    {
        if (wells.Count == 0) return wells;

        // Step 1: Get wells where LCCC1040 activity is 100% complete.
        // Code format in ActivityTaskPlan: "LCCC1040-{targetWellId}" — the suffix is the target well.
        var lccc1040Sql = """
            SELECT DISTINCT SUBSTRING(code, CHARINDEX('-', code) + 1, 100) AS target_well
            FROM [dbo].[ActivityTaskPlan] WITH (NOLOCK)
            WHERE code LIKE 'LCCC1040%'
              AND TRY_CAST(progress AS FLOAT) >= 1.0
            """;

        var lcccCompleteWells = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        try
        {
            await using var cmd1 = new SqlCommand(lccc1040Sql, conn) { CommandTimeout = 30 };
            await using var rdr1 = await cmd1.ExecuteReaderAsync(ct);
            while (await rdr1.ReadAsync(ct))
            {
                var w = rdr1.IsDBNull(0) ? null : rdr1.GetString(0);
                if (!string.IsNullOrWhiteSpace(w)) lcccCompleteWells.Add(w);
            }
        }
        catch (SqlException) { /* ActivityTaskPlan unavailable — skip buffer classification */ }

        // Step 2: Get Earl_start_date from SAP_DRILLING_SEQUENCE_History for buffer candidates.
        // Buffer candidates = wells with no rig_on + LCCC1040 = 100%.
        var bufferCandidateIds = wells
            .Where(w => string.IsNullOrWhiteSpace(w.RigOnDate) && lcccCompleteWells.Contains(w.WellId))
            .Select(w => w.WellId)
            .ToList();

        var sapEarlStart = new Dictionary<string, DateTime>(StringComparer.OrdinalIgnoreCase);
        if (bufferCandidateIds.Count > 0)
        {
            var idList = string.Join(",", bufferCandidateIds.Select(id => $"'{id.Replace("'", "''")}'"));
            var sapSql = $"""
                SELECT s.Well_ID, MIN(s.Earl_start_date) AS earl_start
                FROM [dbo].[SAP_DRILLING_SEQUENCE_History] s WITH (NOLOCK)
                WHERE s.Well_ID IN ({idList})
                  AND s.Earl_start_date IS NOT NULL
                GROUP BY s.Well_ID
                ORDER BY earl_start
                """;

            try
            {
                await using var cmd2 = new SqlCommand(sapSql, conn) { CommandTimeout = 30 };
                await using var rdr2 = await cmd2.ExecuteReaderAsync(ct);
                while (await rdr2.ReadAsync(ct))
                {
                    var wid = rdr2.GetString(0);
                    if (!rdr2.IsDBNull(1))
                    {
                        sapEarlStart[wid] = rdr2.GetDateTime(1);
                    }
                }
            }
            catch (SqlException) { /* SAP unavailable — skip buffer ranking */ }
        }

        // Step 3: Rank buffer candidates by Earl_start_date ASC → top 3 get Buffer 1/2/3.
        var bufferRanking = bufferCandidateIds
            .Where(id => sapEarlStart.ContainsKey(id))
            .OrderBy(id => sapEarlStart[id])
            .Take(3)
            .Select((id, idx) => (id, label: $"Buffer {idx + 1}"))
            .ToDictionary(x => x.id, x => x.label, StringComparer.OrdinalIgnoreCase);

        // Step 4: Assign DrillingBufferStatus to each well.
        var enriched = new List<WmrWellDto>(wells.Count);
        foreach (var w in wells)
        {
            var rigOn = !string.IsNullOrWhiteSpace(w.RigOnDate);
            var rigOff = !string.IsNullOrWhiteSpace(w.RigOffDate);

            string? bufferStatus;
            if (rigOn && rigOff)
                bufferStatus = "Drilled";
            else if (rigOn && !rigOff)
                bufferStatus = "ROL";
            else if (bufferRanking.TryGetValue(w.WellId, out var label))
                bufferStatus = label;
            else
                bufferStatus = null;

            enriched.Add(w with { DrillingBufferStatus = bufferStatus });
        }

        return enriched;
    }

    /// <summary>
    /// Returns the set of well IDs from WMRO that have ATNM handover AND actual commissioning date set
    /// (same criteria as the PDO Commissioning Status widget's "Commissioned" count).
    /// </summary>
    private async Task<HashSet<string>> GetCommissionedWellIdsAsync(string? cluster, DateOnly? commFrom, DateOnly? commTo, CancellationToken ct)
    {
        var commCacheKey = $"comm-well-ids:{cluster ?? "all"}:{commFrom}:{commTo}";
        if (cache.TryGetValue(commCacheKey, out HashSet<string>? cached) && cached is not null)
            return cached;

        var filterParts = new List<string>();
        filterParts.Add("[wellpad_handover-2_from_hoist_fbu_rsr_off_date] IS NOT NULL");
        if (!string.IsNullOrEmpty(cluster)) filterParts.Add("[Cluster] = @cluster");
        if (commFrom.HasValue) filterParts.Add("[wellpad_handover-2_from_hoist_fbu_rsr_off_date] >= @commFrom");
        if (commTo.HasValue) filterParts.Add("[wellpad_handover-2_from_hoist_fbu_rsr_off_date] <= @commTo");

        var where = string.Join(" AND ", filterParts);
        var sql = $"""
            SELECT DISTINCT [pdo_well_id]
            FROM [dbo].[WellMonitoringReportOptimized] WITH (NOLOCK)
            WHERE {where}
              AND [actual_comm._finish_date_with_in_2_days_from_actual_engg._completion_date] IS NOT NULL
              AND [pdo_well_id] IS NOT NULL AND [pdo_well_id] <> ''
            """;

        var connStr = db.Database.GetConnectionString()!;
        await using var conn = new SqlConnection(connStr);
        await OpenWithRetryAsync(conn, ct);

        await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 60 };
        if (!string.IsNullOrEmpty(cluster)) cmd.Parameters.AddWithValue("@cluster", cluster);
        if (commFrom.HasValue) cmd.Parameters.Add(new SqlParameter("@commFrom", System.Data.SqlDbType.DateTime) { Value = commFrom.Value.ToDateTime(TimeOnly.MinValue) });
        if (commTo.HasValue) cmd.Parameters.Add(new SqlParameter("@commTo", System.Data.SqlDbType.DateTime) { Value = commTo.Value.ToDateTime(TimeOnly.MinValue) });

        var ids = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        await using var rdr = await cmd.ExecuteReaderAsync(ct);
        while (await rdr.ReadAsync(ct))
        {
            var id = rdr.IsDBNull(0) ? null : rdr.GetString(0);
            if (!string.IsNullOrEmpty(id)) ids.Add(id);
        }

        cache.Set(commCacheKey, ids, TimeSpan.FromMinutes(10));
        return ids;
    }

    /// <summary>
    /// Returns the set of well IDs from WMRO that have ATNM handover but are NOT yet commissioned
    /// (same criteria as the PDO Commissioning Status widget's "Not Commissioned" count).
    /// </summary>
    private async Task<HashSet<string>> GetNotCommissionedWellIdsAsync(string? cluster, DateOnly? commFrom, DateOnly? commTo, CancellationToken ct)
    {
        var cacheKey2 = $"not-comm-well-ids:{cluster ?? "all"}:{commFrom}:{commTo}";
        if (cache.TryGetValue(cacheKey2, out HashSet<string>? cached2) && cached2 is not null)
            return cached2;

        var filterParts = new List<string>();
        filterParts.Add("[wellpad_handover-2_from_hoist_fbu_rsr_off_date] IS NOT NULL");
        if (!string.IsNullOrEmpty(cluster)) filterParts.Add("[Cluster] = @cluster");
        if (commFrom.HasValue) filterParts.Add("[wellpad_handover-2_from_hoist_fbu_rsr_off_date] >= @commFrom");
        if (commTo.HasValue) filterParts.Add("[wellpad_handover-2_from_hoist_fbu_rsr_off_date] <= @commTo");

        var where = string.Join(" AND ", filterParts);
        var sql = $"""
            SELECT DISTINCT [pdo_well_id]
            FROM [dbo].[WellMonitoringReportOptimized] WITH (NOLOCK)
            WHERE {where}
              AND [actual_comm._finish_date_with_in_2_days_from_actual_engg._completion_date] IS NULL
              AND [pdo_well_id] IS NOT NULL AND [pdo_well_id] <> ''
            """;

        var connStr = db.Database.GetConnectionString()!;
        await using var conn = new SqlConnection(connStr);
        await OpenWithRetryAsync(conn, ct);

        await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 60 };
        if (!string.IsNullOrEmpty(cluster)) cmd.Parameters.AddWithValue("@cluster", cluster);
        if (commFrom.HasValue) cmd.Parameters.Add(new SqlParameter("@commFrom", System.Data.SqlDbType.DateTime) { Value = commFrom.Value.ToDateTime(TimeOnly.MinValue) });
        if (commTo.HasValue) cmd.Parameters.Add(new SqlParameter("@commTo", System.Data.SqlDbType.DateTime) { Value = commTo.Value.ToDateTime(TimeOnly.MinValue) });

        var ids = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        await using var rdr = await cmd.ExecuteReaderAsync(ct);
        while (await rdr.ReadAsync(ct))
        {
            var id = rdr.IsDBNull(0) ? null : rdr.GetString(0);
            if (!string.IsNullOrEmpty(id)) ids.Add(id);
        }

        cache.Set(cacheKey2, ids, TimeSpan.FromMinutes(10));
        return ids;
    }

    public async Task<WellProgressPageDto> GetWellProgressAsync(
        string? cluster,
        string? wellId,
        string? status,
        DateOnly? from,
        DateOnly? to,
        bool thisMonth = false,
        int page = 1,
        int pageSize = 20,
        CancellationToken ct = default)
    {
        page     = Math.Max(1, Math.Min(page, 20));     // clamp 1-20
        pageSize = Math.Max(1, Math.Min(pageSize, 100)); // clamp 1-100
        var cacheKey = $"well-progress:{cluster}:{wellId}:{status}:{from}:{to}:{thisMonth}:p{page}:ps{pageSize}";
        if (cache.TryGetValue(cacheKey, out WellProgressPageDto? hit) && hit is not null)
            return hit;

        var extraWhere = "";
        if (!string.IsNullOrWhiteSpace(wellId))  extraWhere += " AND w.pdo_well_id = @wellId";
        if (!string.IsNullOrWhiteSpace(cluster)) extraWhere += " AND " + ClusterFilter(cluster, "w.pdo_well_id");
        if (from.HasValue) extraWhere += " AND (w.actual_rig_off_date IS NULL OR TRY_CAST(w.actual_rig_off_date AS DATE) >= @fromDate)";
        if (to.HasValue)   extraWhere += " AND (w.actual_rig_on_date IS NULL OR TRY_CAST(w.actual_rig_on_date AS DATE) <= @toDate)";
        if (thisMonth)     extraWhere += """
             AND w.actual_rig_on_date IS NOT NULL
             AND TRY_CAST(w.actual_rig_on_date AS DATE) <= EOMONTH(GETDATE())
             AND (w.actual_rig_off_date IS NULL
                  OR TRY_CAST(w.actual_rig_off_date AS DATE) >= DATEFROMPARTS(YEAR(GETDATE()),MONTH(GETDATE()),1))
             """;

        var sql = $"""
            WITH latest AS (
              SELECT pdo_well_id, MAX(Week_Number) AS max_wk
              FROM [dbo].[WMR] WITH (NOLOCK)
              WHERE pdo_well_id IS NOT NULL AND pdo_well_id <> ''
              GROUP BY pdo_well_id
            ),
            sap_agg AS (
              SELECT Well_ID,
                     MIN(TRY_CAST(Earl_start_date  AS DATE)) AS plan_start,
                     MAX(TRY_CAST(EarliestEndDate  AS DATE)) AS plan_end
              FROM [dbo].[SAP_DRILLING_SEQUENCE_History] WITH (NOLOCK)
              WHERE Well_ID IS NOT NULL AND Well_ID <> ''
              GROUP BY Well_ID
            )
            SELECT
              w.pdo_well_id,
              w.rig_no,
              UPPER(LTRIM(RTRIM(p.[Cluster]))) AS cluster_name,
              w.well_location,
              COALESCE(TRY_CAST(w.over_all_progress_percentages AS FLOAT), 0) AS prog,
              COALESCE(TRY_CAST(w.[overall_loc._preparation_10_100] AS FLOAT), 0)  AS loc_pct,
              COALESCE(TRY_CAST(w.[overall_const._10_100]           AS FLOAT), 0)  AS fl_pct,
              COALESCE(TRY_CAST(w.[overall_comm_progress_100]       AS FLOAT), 0)  AS comm_pct,
              COALESCE(TRY_CAST(w.ohl_progress                      AS FLOAT), 0)  AS ohl_pct,
              w.actual_rig_on_date,
              w.actual_rig_off_date,
              NULL AS crew_type,
              CASE
                WHEN sap.plan_start IS NOT NULL AND sap.plan_end IS NOT NULL
                     AND DATEDIFF(day, sap.plan_start, sap.plan_end) > 0
                THEN CAST(DATEDIFF(day, sap.plan_start, CAST(GETDATE() AS DATE)) AS FLOAT)
                     / DATEDIFF(day, sap.plan_start, sap.plan_end)
                ELSE 0.0
              END AS planned_pct,
              CASE
                WHEN w.actual_rig_on_date IS NOT NULL
                     AND TRY_CAST(w.actual_rig_on_date AS DATE) <= CAST(GETDATE() AS DATE)
                     AND (w.actual_rig_off_date IS NULL
                          OR TRY_CAST(w.actual_rig_off_date AS DATE) >= CAST(GETDATE() AS DATE))
                  THEN CASE
                         -- No progress change from previous week = on hold
                         WHEN COALESCE(TRY_CAST(w.over_all_progress_percentages AS FLOAT), 0)
                              = COALESCE(pw2.prev_prog, -1)
                           THEN 'onhold'
                         -- Flowline completed OR positive variance â†’ ahead
                         WHEN w.[flow_line_const._status_in_progress_completed] = 'Completed'
                           THEN 'early'
                         WHEN sap.plan_start IS NOT NULL AND sap.plan_end IS NOT NULL
                              AND DATEDIFF(day, sap.plan_start, sap.plan_end) > 0
                              AND (COALESCE(TRY_CAST(w.over_all_progress_percentages AS FLOAT), 0)
                                   - CAST(DATEDIFF(day, sap.plan_start, CAST(GETDATE() AS DATE)) AS FLOAT)
                                     / DATEDIFF(day, sap.plan_start, sap.plan_end)) > 0
                           THEN 'early'
                         -- Critical: variance < -15% (or no SAP and progress < 25%)
                         WHEN sap.plan_start IS NOT NULL AND sap.plan_end IS NOT NULL
                              AND DATEDIFF(day, sap.plan_start, sap.plan_end) > 0
                              AND (COALESCE(TRY_CAST(w.over_all_progress_percentages AS FLOAT), 0)
                                   - CAST(DATEDIFF(day, sap.plan_start, CAST(GETDATE() AS DATE)) AS FLOAT)
                                     / DATEDIFF(day, sap.plan_start, sap.plan_end)) < -0.15
                           THEN 'critical'
                         WHEN (sap.plan_start IS NULL OR sap.plan_end IS NULL)
                              AND COALESCE(TRY_CAST(w.over_all_progress_percentages AS FLOAT), 0) < 0.25
                           THEN 'critical'
                         -- At Risk: variance < -10% (or no SAP and progress < 40%)
                         WHEN sap.plan_start IS NOT NULL AND sap.plan_end IS NOT NULL
                              AND DATEDIFF(day, sap.plan_start, sap.plan_end) > 0
                              AND (COALESCE(TRY_CAST(w.over_all_progress_percentages AS FLOAT), 0)
                                   - CAST(DATEDIFF(day, sap.plan_start, CAST(GETDATE() AS DATE)) AS FLOAT)
                                     / DATEDIFF(day, sap.plan_start, sap.plan_end)) < -0.10
                           THEN 'atrisk'
                         WHEN (sap.plan_start IS NULL OR sap.plan_end IS NULL)
                              AND COALESCE(TRY_CAST(w.over_all_progress_percentages AS FLOAT), 0) < 0.40
                           THEN 'atrisk'
                         ELSE 'inprogress'
                       END
                WHEN TRY_CAST(w.over_all_progress_percentages AS FLOAT) >= 0.95
                  THEN 'completed'
                WHEN w.actual_rig_on_date IS NOT NULL
                     AND w.actual_rig_off_date IS NOT NULL
                     AND TRY_CAST(w.actual_rig_off_date AS DATE) < CAST(GETDATE() AS DATE)
                  THEN 'onhold'
                ELSE 'planned'
              END AS status,
              w.[location_preparation_status_in_progress_completed] AS loc_status,
              w.[flow_line_const._status_in_progress_completed]     AS fl_status,
              w.[flow_line_commi._status_in_progress_completed]     AS comm_status,
              w.completion_type_rig_fbu_or_rsr_hoist                AS completion_type,
              0 AS ask_rate,
              0 AS act_rate,
              0 AS total_count
            FROM [dbo].[WMR] w WITH (NOLOCK)
            INNER JOIN latest ON w.pdo_well_id = latest.pdo_well_id AND w.Week_Number = latest.max_wk
            LEFT JOIN  sap_agg sap ON sap.Well_ID = w.pdo_well_id
            LEFT JOIN (SELECT ID, MIN([Cluster]) AS [Cluster] FROM [dbo].[ProjectIDs] WITH (NOLOCK) GROUP BY ID) p ON w.project_id = p.ID
            LEFT JOIN (
              SELECT w2.pdo_well_id,
                     COALESCE(TRY_CAST(w2.over_all_progress_percentages AS FLOAT), 0) AS prev_prog
              FROM [dbo].[WMR] w2 WITH (NOLOCK)
              INNER JOIN (
                SELECT pdo_well_id, Week_Number,
                       ROW_NUMBER() OVER (PARTITION BY pdo_well_id ORDER BY Week_Number DESC) AS rn
                FROM [dbo].[WMR] WITH (NOLOCK)
                WHERE pdo_well_id IS NOT NULL AND pdo_well_id <> ''
              ) r ON w2.pdo_well_id = r.pdo_well_id AND w2.Week_Number = r.Week_Number AND r.rn = 2
            ) pw2 ON pw2.pdo_well_id = w.pdo_well_id
            WHERE w.pdo_well_id IS NOT NULL AND w.pdo_well_id <> ''
              AND (
                (w.actual_rig_on_date IS NOT NULL
                 AND TRY_CAST(w.actual_rig_on_date AS DATE) <= EOMONTH(GETDATE())
                 AND (w.actual_rig_off_date IS NULL
                      OR TRY_CAST(w.actual_rig_off_date AS DATE) >= DATEFROMPARTS(YEAR(GETDATE()),MONTH(GETDATE()),1)))
                OR
                (w.actual_rig_on_date IS NULL
                 AND w.[flow_line_const._status_in_progress_completed] = 'In Progress')
              )
            {extraWhere}
            ORDER BY w.pdo_well_id
            OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;
            """;

        var conn3 = db.Database.GetDbConnection();
        if (conn3.State != System.Data.ConnectionState.Open)
            await conn3.OpenAsync(ct);

        static double D(object v) => v == DBNull.Value ? 0.0 : Convert.ToDouble(v);
        static string? S(object v) => v == DBNull.Value ? null : v?.ToString();

        // Activity/crew enrichment: loaded once in background (5-min SQL timeout).
        // First request uses empty map; all subsequent requests use the populated cache.
        if (_actEnrichCache == null && !_actEnrichLoading)
        {
            _actEnrichLoading = true;
            _ = LoadActEnrichmentAsync(db.Database.GetConnectionString()!);
        }
        var actMap = _actEnrichCache
            ?? new Dictionary<string, (string? Code, string? Text, string? CrewUid, string? CrewType)>(StringComparer.OrdinalIgnoreCase);

        await using var cmd3 = conn3.CreateCommand();
        cmd3.CommandText = sql;
        cmd3.CommandTimeout = 60;

        if (!string.IsNullOrWhiteSpace(wellId))
            cmd3.Parameters.Add(new SqlParameter("@wellId", wellId));
        if (!string.IsNullOrWhiteSpace(cluster))
            cmd3.Parameters.Add(new SqlParameter("@cluster", cluster));
        if (from.HasValue)
            cmd3.Parameters.Add(new SqlParameter("@fromDate", from.Value.ToDateTime(TimeOnly.MinValue)));
        if (to.HasValue)
            cmd3.Parameters.Add(new SqlParameter("@toDate", to.Value.ToDateTime(TimeOnly.MaxValue)));
        cmd3.Parameters.Add(new SqlParameter("@offset",   (page - 1) * pageSize));
        cmd3.Parameters.Add(new SqlParameter("@pageSize", pageSize));

        await using var rdr3 = await cmd3.ExecuteReaderAsync(ct);
        var result3 = new List<WellProgressDto>();
        var totalCount = 0;

        while (await rdr3.ReadAsync(ct))
        {
            var derivedStatus = S(rdr3["status"]) ?? "planned";
            if (!string.IsNullOrWhiteSpace(status) &&
                !string.Equals(derivedStatus, status, StringComparison.OrdinalIgnoreCase))
                continue;

            var prog        = Math.Round(D(rdr3["prog"])        * 100, 1);
            var rawPlanned  = D(rdr3["planned_pct"]);
            var planned     = Math.Round(Math.Max(0.0, Math.Min(1.0, rawPlanned)) * 100, 1);

            // CurrentActivity: ActivityTaskPlan code + text (latest row); "N/A" if not found
            actMap.TryGetValue(rdr3.GetString(0), out var actInfo);
            var actCode  = actInfo.Code;
            var actText  = actInfo.Text;
            var actLabel = string.Join(" - ", new[] { actCode, actText }.Where(x => !string.IsNullOrWhiteSpace(x)));
            var currentActivity = !string.IsNullOrWhiteSpace(actLabel) ? actLabel : "N/A";

            // CrewGroup: ActivityTaskPlan crew_uid + crew_type (latest row); "N/A" if not found
            var atpCrewUid  = actInfo.CrewUid;
            var atpCrewType = actInfo.CrewType;
            var crewGroup   = !string.IsNullOrWhiteSpace(atpCrewUid) || !string.IsNullOrWhiteSpace(atpCrewType)
                ? string.Join(" - ", new[] { atpCrewUid, atpCrewType }.Where(x => !string.IsNullOrWhiteSpace(x)))
                : "N/A";

            // rate/askRate/gapPerDay: no reliable source yet â€” return null (grid shows N/A)

            result3.Add(new WellProgressDto(
                WellId:          rdr3.GetString(0),
                Cluster:         S(rdr3["cluster_name"]) ?? string.Empty,
                CurrentActivity: currentActivity,
                CrewGroup:       crewGroup,
                Progress:        prog,
                Variance:        Math.Round(prog - planned, 1),
                Planned:         planned,
                Rate:            null,
                AskRate:         null,
                GapPerDay:       null,
                RigOn:           S(rdr3["actual_rig_on_date"]),
                Spi:             null,
                Cpi:             null,
                Status:          derivedStatus
            ));
        }

        var pageDto = new WellProgressPageDto(result3, page, pageSize, totalCount);
        cache.Set(cacheKey, pageDto, CacheDuration);
        return pageDto;
    }

    // â”€â”€â”€ Well Progress KPI tiles (fast COUNT-only query) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    public async Task<WellProgressKpiDto> GetWellProgressKpiAsync(
        string? cluster = null, string? wellId = null, string? wellType = null,
        DateOnly? from = null, DateOnly? to = null,
        CancellationToken ct = default)
    {
        var cacheKey      = $"well-progress-kpi:{cluster}:{wellId}:{wellType}:{from}:{to}";
        var staleCacheKey = $"well-progress-kpi:stale:{cluster}:{wellId}:{wellType}:{from}:{to}";

        // ── 1. Serve from live cache (no DB hit) ──────────────────────────
        if (cache.TryGetValue(cacheKey, out WellProgressKpiDto? kpiHit) && kpiHit is not null)
            return kpiHit;

        var extraWhere = "";
        if (!string.IsNullOrWhiteSpace(wellId))   extraWhere += " AND w.pdo_well_id = @wellId";
        if (!string.IsNullOrWhiteSpace(cluster))  extraWhere += " AND " + ClusterFilter(cluster, "w.pdo_well_id");
        if (!string.IsNullOrWhiteSpace(wellType)) extraWhere += " AND UPPER(w.well_type) = UPPER(@wellType)";
        if (from.HasValue) extraWhere += " AND (w.actual_rig_off_date IS NULL OR TRY_CAST(w.actual_rig_off_date AS DATE) >= @fromDate)";
        if (to.HasValue)   extraWhere += " AND (w.actual_rig_on_date IS NULL OR TRY_CAST(w.actual_rig_on_date AS DATE) <= @toDate)";

        // Variance-based categorisation â€” mirrors the frontend logic in mapRows():
        // Pure variance-based KPI classification (SAP dates only):
        //   Ahead    â†’ variance  >   0%
        //   On Track â†’ -10% â‰¤ variance â‰¤ 0%  (also default when no SAP dates)
        //   At Risk  â†’ variance  < -10%
        //   Critical â†’ variance  < -15%
        var kpiSql = $"""
            WITH latest AS (
              SELECT pdo_well_id, MAX(Week_Number) AS max_wk
              FROM [dbo].[WMR] WITH (NOLOCK)
              WHERE pdo_well_id IS NOT NULL AND pdo_well_id <> ''
              GROUP BY pdo_well_id
            ),
            sap_agg AS (
              SELECT Well_ID,
                     MIN(TRY_CAST(Earl_start_date AS DATE)) AS plan_start,
                     MAX(TRY_CAST(EarliestEndDate AS DATE)) AS plan_end
              FROM [dbo].[SAP_DRILLING_SEQUENCE_History] WITH (NOLOCK)
              WHERE Well_ID IS NOT NULL AND Well_ID <> ''
              GROUP BY Well_ID
            ),
            derived AS (
              SELECT
                CASE
                  WHEN sap.plan_start IS NOT NULL AND sap.plan_end IS NOT NULL
                       AND DATEDIFF(day, sap.plan_start, sap.plan_end) > 0
                  THEN CASE
                         WHEN (COALESCE(TRY_CAST(w.over_all_progress_percentages AS FLOAT), 0)
                               - CAST(DATEDIFF(day, sap.plan_start, CAST(GETDATE() AS DATE)) AS FLOAT)
                                 / DATEDIFF(day, sap.plan_start, sap.plan_end)) > 0.05
                           THEN 'bonus'
                         WHEN (COALESCE(TRY_CAST(w.over_all_progress_percentages AS FLOAT), 0)
                               - CAST(DATEDIFF(day, sap.plan_start, CAST(GETDATE() AS DATE)) AS FLOAT)
                                 / DATEDIFF(day, sap.plan_start, sap.plan_end)) > 0
                           THEN 'ahead'
                         WHEN (COALESCE(TRY_CAST(w.over_all_progress_percentages AS FLOAT), 0)
                               - CAST(DATEDIFF(day, sap.plan_start, CAST(GETDATE() AS DATE)) AS FLOAT)
                                 / DATEDIFF(day, sap.plan_start, sap.plan_end)) < -0.15
                           THEN 'critical'
                         WHEN (COALESCE(TRY_CAST(w.over_all_progress_percentages AS FLOAT), 0)
                               - CAST(DATEDIFF(day, sap.plan_start, CAST(GETDATE() AS DATE)) AS FLOAT)
                                 / DATEDIFF(day, sap.plan_start, sap.plan_end)) < -0.10
                           THEN 'atrisk'
                         ELSE 'ontrack'
                       END
                  ELSE 'ontrack'
                END AS status
              FROM [dbo].[WMR] w WITH (NOLOCK)
              INNER JOIN latest ON w.pdo_well_id = latest.pdo_well_id AND w.Week_Number = latest.max_wk
              LEFT JOIN sap_agg sap ON sap.Well_ID = w.pdo_well_id
              WHERE w.pdo_well_id IS NOT NULL AND w.pdo_well_id <> ''
                AND (
                  (w.actual_rig_on_date IS NOT NULL
                   AND TRY_CAST(w.actual_rig_on_date AS DATE) <= EOMONTH(GETDATE())
                   AND (w.actual_rig_off_date IS NULL
                        OR TRY_CAST(w.actual_rig_off_date AS DATE) >= DATEFROMPARTS(YEAR(GETDATE()),MONTH(GETDATE()),1)))
                  OR
                  (w.actual_rig_on_date IS NULL
                   AND w.[flow_line_const._status_in_progress_completed] = 'In Progress')
                )
              {extraWhere}
            )
            SELECT status, COUNT(*) AS cnt FROM derived GROUP BY status;
            """;

        var conn = db.Database.GetDbConnection();

        await using var cmd = conn.CreateCommand();
        cmd.CommandText    = kpiSql;

        if (!string.IsNullOrWhiteSpace(wellId))
            cmd.Parameters.Add(new SqlParameter("@wellId",   wellId));
        if (!string.IsNullOrWhiteSpace(cluster))
            cmd.Parameters.Add(new SqlParameter("@cluster",  cluster));
        if (!string.IsNullOrWhiteSpace(wellType))
            cmd.Parameters.Add(new SqlParameter("@wellType", wellType));
        if (from.HasValue)
            cmd.Parameters.Add(new SqlParameter("@fromDate", from.Value.ToDateTime(TimeOnly.MinValue)));
        if (to.HasValue)
            cmd.Parameters.Add(new SqlParameter("@toDate",   to.Value.ToDateTime(TimeOnly.MaxValue)));

        // ── 2. Query DB — fall back to stale cache on timeout / error ─────
        Dictionary<string, int> counts;
        try
        {
            await OpenWithRetryAsync(conn, ct);
            cmd.CommandTimeout = 30;

            counts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
                counts[rdr.GetString(0)] = Convert.ToInt32(rdr[1]);
        }
        catch (Exception)
        {
            // DB slow or unavailable — serve last-known stale result if available
            if (cache.TryGetValue(staleCacheKey, out WellProgressKpiDto? stale) && stale is not null)
                return stale;
            throw;
        }

        // SQL emits: 'bonus', 'ahead', 'ontrack', 'atrisk', 'critical'
        var bonus    = counts.GetValueOrDefault("bonus",    0);  // variance > +5%
        var ahead    = counts.GetValueOrDefault("ahead",    0);  // 0% < variance ≤ +5%
        var onTrack  = counts.GetValueOrDefault("ontrack",  0);  // -10% ≤ variance ≤ 0% (or no SAP)
        var atRisk   = counts.GetValueOrDefault("atrisk",   0);  // variance < -10%
        var critical = counts.GetValueOrDefault("critical", 0);  // variance < -15%
        var total    = counts.Values.Sum();

        var dueWells = counts.GetValueOrDefault("due", 0);
        var kpiDto = new WellProgressKpiDto(ahead, onTrack, atRisk, dueWells, total, critical, bonus);

        // ── 3. Live cache: 5 min sliding / 15 min absolute ───────────────
        var liveOpts = new MemoryCacheEntryOptions()
            .SetSlidingExpiration(TimeSpan.FromMinutes(5))
            .SetAbsoluteExpiration(TimeSpan.FromMinutes(15));
        cache.Set(cacheKey, kpiDto, liveOpts);

        // ── 4. Stale cache: kept 2 h as fallback during DB delays ─────────
        cache.Set(staleCacheKey, kpiDto, TimeSpan.FromHours(2));

        return kpiDto;
    }

    // â”€â”€â”€ Drilled Wells Completion â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    public async Task<DrilledWellsCompletionDto> GetDrilledWellsCompletionAsync(
        string? cluster = null, string? wellId = null, string? wellType = null,
        string? site = null, string? project = null,
        DateOnly? from = null, DateOnly? to = null,
        CancellationToken ct = default)
    {
        var cacheKey = $"drilled-wells-completion:{cluster}:{wellId}:{wellType}:{site}:{project}:{from}:{to}";
        if (cache.TryGetValue(cacheKey, out DrilledWellsCompletionDto? hit) && hit is not null)
            return hit;

        // Map Angular wellType values → ProjectIDs.Type DB values (same as odc-overall-status)
        var mappedWellType = wellType switch
        {
            "non-standard"     => "Non Standard Well",
            "well-conversions" => "Conventional Well",
            "conventional"     => "Conventional Well",
            _                  => wellType
        };

        // Default date range: current year (same as GetDueWellsCompletionAsync)
        var fromDate = from ?? new DateOnly(DateTime.Today.Year, 1, 1);
        var toDate   = to   ?? new DateOnly(DateTime.Today.Year, 12, 31);
        var today    = DateOnly.FromDateTime(DateTime.Today);
        if (toDate > today) toDate = today;

        // rewrite extraWhere to use bare column names (no 'w.' alias) since filters
        // are now applied inside LatestSnapshot WHERE on the raw WMR table.
        // wellId filter goes inside LatestSnapshot (direct column, no join needed)
        var snapshotWhere = "";
        if (!string.IsNullOrWhiteSpace(wellId))
            snapshotWhere += " AND pdo_well_id = @wellId";

        // cluster/site/wellType/project applied AFTER rn=1 — same as odc-overall-status
        // so that the latest WMR snapshot per well is selected first, then filtered.
        var pidConditions = new System.Collections.Generic.List<string>();
        if (!string.IsNullOrWhiteSpace(cluster))  pidConditions.Add("LTRIM(RTRIM(CAST([Cluster] AS NVARCHAR(200)))) = @cluster");
        if (!string.IsNullOrWhiteSpace(site))     pidConditions.Add("LTRIM(RTRIM(CAST([Site]    AS NVARCHAR(200)))) = @site");
        if (!string.IsNullOrWhiteSpace(wellType)) pidConditions.Add("LTRIM(RTRIM(CAST([Type]    AS NVARCHAR(200)))) = @wellType");
        if (!string.IsNullOrWhiteSpace(project))  pidConditions.Add("LTRIM(RTRIM(CAST([Project] AS NVARCHAR(200)))) = @project");
        var pidFilter = pidConditions.Count > 0
            ? $" AND project_id IN (SELECT CAST(ID AS NVARCHAR(100)) FROM [dbo].[ProjectIDs] WITH (NOLOCK) WHERE {string.Join(" AND ", pidConditions)})"
            : "";

        // ── KPI counts query — mirrors odc-overall-status logic exactly:
        //   Step 1: ROW_NUMBER per well ordered by Week_Number DESC, scoped to [fromDate, toDate]
        //           (no cluster/wellType filter here — unbiased latest snapshot)
        //   Step 2: rn=1 gives exactly one row per well, THEN cluster/wellType filter applied
        //   Step 3: count those where actual_rig_off_date IS NOT NULL = drilled
        var sql = $"""
            WITH LatestSnapshot AS (
              SELECT
                pdo_well_id,
                project_id,
                actual_rig_off_date,
                over_all_progress_percentages,
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
                {snapshotWhere}
            ),
            Wells AS (
              SELECT pdo_well_id, actual_rig_off_date, over_all_progress_percentages
              FROM LatestSnapshot WHERE rn = 1
                {pidFilter}
            ),
            -- Step 3: Drilled wells — mirrors ODC DrilledWells CTE exactly
            DrilledWells AS (
              SELECT pdo_well_id,
                     COALESCE(TRY_CAST(over_all_progress_percentages AS FLOAT), 0) AS progress
              FROM Wells
              WHERE actual_rig_off_date IS NOT NULL
            ),
            -- Step 4e: Suspended — exact same logic as odc-overall-status SuspendedWells CTE
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
            )
            SELECT
              COUNT(*) AS TotalDrilledWells,
              SUM(CASE WHEN COALESCE(TRY_CAST(over_all_progress_percentages AS FLOAT), 0) = 1.0
                        THEN 1 ELSE 0 END) AS CompletedWells,
              SUM(CASE WHEN COALESCE(TRY_CAST(over_all_progress_percentages AS FLOAT), 0) > 0
                        AND COALESCE(TRY_CAST(over_all_progress_percentages AS FLOAT), 0) < 1.0
                        AND COALESCE(TRY_CAST(over_all_progress_percentages AS FLOAT), 0)
                            = COALESCE(pw.prev_prog, -1)
                        THEN 1 ELSE 0 END) AS HoldWells,
              SUM(CASE WHEN COALESCE(TRY_CAST(over_all_progress_percentages AS FLOAT), 0) > 0
                        AND COALESCE(TRY_CAST(over_all_progress_percentages AS FLOAT), 0) < 1.0
                        AND s.pdo_well_id IS NULL
                        THEN 1 ELSE 0 END) AS InProgressWells,
              SUM(CASE WHEN s.pdo_well_id IS NOT NULL THEN 1 ELSE 0 END) AS SuspendedWells,
              ROUND(
                SUM(CASE WHEN COALESCE(TRY_CAST(over_all_progress_percentages AS FLOAT), 0) = 1.0
                          THEN 1.0 ELSE 0 END)
                / NULLIF(COUNT(*), 0) * 100.0, 2) AS CompletionRate
            FROM Wells w
            LEFT JOIN prog_prev pw ON pw.pdo_well_id = w.pdo_well_id
            LEFT JOIN SuspendedWells s ON s.pdo_well_id = w.pdo_well_id
            WHERE w.actual_rig_off_date IS NOT NULL;
            """;

        var conn = db.Database.GetDbConnection();
        await OpenWithRetryAsync(conn, ct);

        void AddParams(System.Data.Common.DbCommand cmd)
        {
            cmd.Parameters.Add(new SqlParameter("@fromDate", fromDate.ToDateTime(TimeOnly.MinValue)));
            cmd.Parameters.Add(new SqlParameter("@toDate",   toDate.ToDateTime(TimeOnly.MaxValue)));
            if (!string.IsNullOrWhiteSpace(wellId))
                cmd.Parameters.Add(new SqlParameter("@wellId",   wellId));
            if (!string.IsNullOrWhiteSpace(cluster))
                cmd.Parameters.Add(new SqlParameter("@cluster",  cluster));
            if (!string.IsNullOrWhiteSpace(site))
                cmd.Parameters.Add(new SqlParameter("@site",     site));
            if (!string.IsNullOrWhiteSpace(wellType))
                cmd.Parameters.Add(new SqlParameter("@wellType", mappedWellType));
            if (!string.IsNullOrWhiteSpace(project))
                cmd.Parameters.Add(new SqlParameter("@project",  project));
        }

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        cmd.CommandTimeout = 60;
        AddParams(cmd);

        await using var rdr = await cmd.ExecuteReaderAsync(ct);
        await rdr.ReadAsync(ct);

        var totalDrilled   = rdr.IsDBNull(0) ? 0   : rdr.GetInt32(0);
        var completed      = rdr.IsDBNull(1) ? 0   : rdr.GetInt32(1);
        var hold           = rdr.IsDBNull(2) ? 0   : rdr.GetInt32(2);
        var inProgress     = rdr.IsDBNull(3) ? 0   : rdr.GetInt32(3);
        var suspended      = rdr.IsDBNull(4) ? 0   : rdr.GetInt32(4);
        var completionRate = rdr.IsDBNull(5) ? 0.0 : Convert.ToDouble(rdr[5]);
        await rdr.CloseAsync();

        // ── Monthly trend — same ROW_NUMBER scoping as KPI query above ──
        var trendSql = $"""
            WITH LatestSnapshot AS (
              SELECT
                pdo_well_id,
                project_id,
                actual_rig_off_date,
                over_all_progress_percentages,
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
                {snapshotWhere}
            ),
            Wells AS (
              SELECT pdo_well_id, actual_rig_off_date, over_all_progress_percentages
              FROM LatestSnapshot WHERE rn = 1
                {pidFilter}
            )
            SELECT
              FORMAT(TRY_CAST(actual_rig_off_date AS DATE), 'yyyy-MM') AS YearMonth,
              FORMAT(TRY_CAST(actual_rig_off_date AS DATE), 'MMM')     AS MonthLabel,
              COUNT(*)                                                  AS TotalDrilled,
              SUM(CASE WHEN COALESCE(TRY_CAST(over_all_progress_percentages AS FLOAT), 0) = 1.0
                        THEN 1 ELSE 0 END)                             AS CompletedCount
            FROM Wells
            WHERE actual_rig_off_date IS NOT NULL
            GROUP BY FORMAT(TRY_CAST(actual_rig_off_date AS DATE), 'yyyy-MM'),
                     FORMAT(TRY_CAST(actual_rig_off_date AS DATE), 'MMM')
            ORDER BY YearMonth;
            """;

        await using var trendCmd = conn.CreateCommand();
        trendCmd.CommandText = trendSql;
        trendCmd.CommandTimeout = 60;
        AddParams(trendCmd);

        await using var trendRdr = await trendCmd.ExecuteReaderAsync(ct);
        var monthlyRows = new System.Collections.Generic.List<(string Label, int Total, int Comp)>();
        while (await trendRdr.ReadAsync(ct))
        {
            var label  = trendRdr.IsDBNull(1) ? "" : trendRdr.GetString(1);
            var mTotal = trendRdr.IsDBNull(2) ? 0  : trendRdr.GetInt32(2);
            var mComp  = trendRdr.IsDBNull(3) ? 0  : trendRdr.GetInt32(3);
            monthlyRows.Add((label, mTotal, mComp));
        }

        // Fallback label for wells with unparseable actual_rig_off_date (TRY_CAST returns NULL)
        var allMonthNames = new[] { "Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec" };
        var fallbackLabel = allMonthNames[fromDate.Month - 1];

        // Build cumulative by month from SQL results.
        // Use accumulation (not overwrite) to handle:
        //   1) Same 3-letter label from different years (e.g., 2025-Jan vs 2026-Jan) — MonthlyTotal is summed.
        //   2) Invalid-date wells (empty label) — assigned to the fromDate month so they are visible.
        // This guarantees SUM(MonthlyTotal across all displayed months) == TotalDrilledWells KPI.
        var cumTotal = 0; var cumComp = 0;
        var byMonth = new System.Collections.Generic.Dictionary<string, (double Pct, int CumComp, int MonthlyComp, int MonthlyTotal)>();
        foreach (var row in monthlyRows)
        {
            cumTotal += row.Total;
            cumComp  += row.Comp;
            var pct = cumTotal > 0 ? Math.Round((double)cumComp / cumTotal * 100, 1) : 0.0;
            var key = string.IsNullOrEmpty(row.Label) ? fallbackLabel : row.Label;
            if (byMonth.TryGetValue(key, out var existing))
                byMonth[key] = (pct, cumComp, existing.MonthlyComp + row.Comp, existing.MonthlyTotal + row.Total);
            else
                byMonth[key] = (pct, cumComp, row.Comp, row.Total);
        }

        // Pad to all 12 months — past months with no data get 0; future empty months carry
        // the last known cumulative rate forward so the line stays flat rather than dropping to 0.
        var allMonths = new[] { "Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec" };
        var trend = new System.Collections.Generic.List<DrilledWellsMonthlyPointDto>();
        double lastPct = 0.0; int lastCumComp = 0;
        var todayMonth = allMonthNames[today.Month - 1];
        bool passedToday = false;
        foreach (var m in allMonths)
        {
            if (m == todayMonth) passedToday = true;
            if (byMonth.TryGetValue(m, out var v))
            {
                lastPct = v.Pct; lastCumComp = v.CumComp;
                trend.Add(new DrilledWellsMonthlyPointDto(m, v.Pct, v.CumComp, v.MonthlyComp, v.MonthlyTotal));
            }
            else if (passedToday && lastCumComp > 0)
                // Future month: carry last known rate forward (0 new drilled/completed this month)
                trend.Add(new DrilledWellsMonthlyPointDto(m, lastPct, lastCumComp, 0, 0));
            else
                trend.Add(new DrilledWellsMonthlyPointDto(m, 0.0, 0, 0, 0));
        }

        var dto = new DrilledWellsCompletionDto(totalDrilled, completed, hold, inProgress, suspended, completionRate, trend);
        cache.Set(cacheKey, dto, CacheDuration);
        return dto;
    }

    // ─── Drilled Wells Breakdown (Commissioning) ──────────────────────────────
    public async Task<DrilledWellsBreakdownDto> GetDrilledWellsBreakdownAsync(
        string? cluster = null, string? wellId = null, string? project = null,
        DateOnly? from = null, DateOnly? to = null,
        CancellationToken ct = default)
    {
        var cacheKey = $"drilled-wells-breakdown:{cluster}:{wellId}:{project}:{from}:{to}";
        if (cache.TryGetValue(cacheKey, out DrilledWellsBreakdownDto? hit) && hit is not null)
            return hit;

        var extraWhere = "";
        if (!string.IsNullOrWhiteSpace(wellId))
            extraWhere += " AND w.pdo_well_id = @wellId";
        if (!string.IsNullOrWhiteSpace(cluster))
            extraWhere += " AND " + ClusterFilter(cluster, "w.pdo_well_id");
        if (!string.IsNullOrWhiteSpace(project))
            extraWhere += " AND " + ProjectFilter("w");
        if (to.HasValue || from.HasValue)
        {
            var parts = new System.Collections.Generic.List<string>();
            if (to.HasValue)   parts.Add("TRY_CAST(w.actual_rig_on_date AS DATE) <= EOMONTH(@toDate)");
            if (from.HasValue) parts.Add("(w.actual_rig_off_date IS NULL OR TRY_CAST(w.actual_rig_off_date AS DATE) >= @fromDate)");
            extraWhere += $" AND ({string.Join(" AND ", parts)})";
        }

        // Only drilled wells: rig has arrived (actual_rig_on_date is set) and
        // overall progress > 0 (drilling has physically started on site).
        var sql = $"""
            WITH prog_prev AS (
              SELECT pdo_well_id,
                     COALESCE(TRY_CAST(over_all_progress_percentages AS FLOAT), 0) AS prev_prog
              FROM (
                SELECT pdo_well_id, over_all_progress_percentages,
                       ROW_NUMBER() OVER (PARTITION BY pdo_well_id ORDER BY Week_Number DESC) AS rn
                FROM [dbo].[WMR] WITH (NOLOCK)
                WHERE pdo_well_id IS NOT NULL AND pdo_well_id <> ''
              ) r WHERE r.rn = 2
            )
            SELECT
              SUM(CASE WHEN w.[actual_comm._finish_date_with_in_2_days_from_actual_engg._completion_date] IS NOT NULL
                        THEN 1 ELSE 0 END) AS commissioned,
              SUM(CASE WHEN w.[actual_comm._finish_date_with_in_2_days_from_actual_engg._completion_date] IS NULL
                        AND w.[actual_comm._start_date] IS NOT NULL
                        THEN 1 ELSE 0 END) AS backlog_in_comm,
              SUM(CASE WHEN COALESCE(TRY_CAST(w.over_all_progress_percentages AS FLOAT), 0) > 0
                        AND COALESCE(TRY_CAST(w.over_all_progress_percentages AS FLOAT), 0) < 1.0
                        AND COALESCE(TRY_CAST(w.over_all_progress_percentages AS FLOAT), 0)
                            = COALESCE(pw.prev_prog, -1)
                        THEN 1 ELSE 0 END) AS suspended_wells
            FROM [dbo].[WMR] w WITH (NOLOCK)
            INNER JOIN (
              SELECT pdo_well_id, MAX(Week_Number) AS max_wk
              FROM [dbo].[WMR] WITH (NOLOCK)
              WHERE pdo_well_id IS NOT NULL AND pdo_well_id <> ''
              GROUP BY pdo_well_id
            ) latest ON w.pdo_well_id = latest.pdo_well_id AND w.Week_Number = latest.max_wk
            LEFT JOIN prog_prev pw ON pw.pdo_well_id = w.pdo_well_id
            WHERE w.pdo_well_id IS NOT NULL AND w.pdo_well_id <> ''
              AND w.actual_rig_on_date IS NOT NULL
              AND COALESCE(TRY_CAST(w.over_all_progress_percentages AS FLOAT), 0) > 0
            {extraWhere};
            """;

        var conn = db.Database.GetDbConnection();
        await OpenWithRetryAsync(conn, ct);
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        cmd.CommandTimeout = 60;

        if (!string.IsNullOrWhiteSpace(wellId))
            cmd.Parameters.Add(new SqlParameter("@wellId", wellId));
        if (!string.IsNullOrWhiteSpace(cluster))
            cmd.Parameters.Add(new SqlParameter("@cluster", cluster));
        if (!string.IsNullOrWhiteSpace(project))
            cmd.Parameters.Add(new SqlParameter("@project", project));
        if (from.HasValue)
            cmd.Parameters.Add(new SqlParameter("@fromDate", from.Value.ToDateTime(TimeOnly.MinValue)));
        if (to.HasValue)
            cmd.Parameters.Add(new SqlParameter("@toDate", to.Value.ToDateTime(TimeOnly.MaxValue)));

        await using var rdr = await cmd.ExecuteReaderAsync(ct);
        await rdr.ReadAsync(ct);

        var commissioned = rdr.IsDBNull(0) ? 0 : rdr.GetInt32(0);
        var backlog      = rdr.IsDBNull(1) ? 0 : rdr.GetInt32(1);
        var suspended    = rdr.IsDBNull(2) ? 0 : rdr.GetInt32(2);
        var totalBreakdown = commissioned + backlog;
        var commPct = totalBreakdown > 0
            ? Math.Round((double)commissioned / totalBreakdown * 100, 1)
            : 0.0;

        var dto = new DrilledWellsBreakdownDto(backlog, commissioned);
        cache.Set(cacheKey, dto, TimeSpan.FromMinutes(2));
        return dto;
    }

    // ─── Drilled Wells YTD Completion (Year-over-Year) ────────────────────────
    public async Task<DrilledWellsYtdCompletionDto> GetDrilledWellsYtdCompletionAsync(
        DateOnly? from = null,
        DateOnly? to = null,
        int? year = null,
        DateOnly? asOfDate = null,
        string? cluster = null,
        string? wellId = null,
        string? project = null,
        string? wellType = null,
        string? site = null,
        CancellationToken ct = default)
    {
        var today = DateOnly.FromDateTime(DateTime.Today);

        // Derive fromDate / toDate: prefer explicit from/to (global filter), fall back to year/asOfDate (legacy)
        DateOnly fromDate, toDate;
        if (from.HasValue || to.HasValue)
        {
            fromDate = from ?? new DateOnly(today.Year, 1, 1);
            toDate   = to   ?? today;
            if (toDate > today) toDate = today;
        }
        else
        {
            var targetYear = year ?? today.Year;
            var asOf       = asOfDate ?? today;
            fromDate = new DateOnly(targetYear, 1, 1);
            toDate   = asOf < new DateOnly(targetYear, 12, 31) ? asOf : new DateOnly(targetYear, 12, 31);
        }

        var displayYear = fromDate.Year;
        var cacheKey = $"drilled-wells-ytd-completion:{fromDate:yyyy-MM-dd}:{toDate:yyyy-MM-dd}:{cluster}:{wellId}:{project}:{wellType}:{site}";
        if (cache.TryGetValue(cacheKey, out DrilledWellsYtdCompletionDto? hit) && hit is not null)
            return hit;

        // ── Current period: reuse the tile method so numbers are identical ──────
        var current = await GetDrilledWellsCompletionAsync(cluster, wellId, wellType, site, project, fromDate, toDate, ct);

        // ── Previous equivalent period: same duration, one year earlier, same dimension filters ──
        var spanDays   = toDate.DayNumber - fromDate.DayNumber;
        var prevFrom   = fromDate.AddYears(-1);
        var prevTo     = toDate.AddYears(-1);
        var prevCutoff = prevTo.ToDateTime(TimeOnly.MaxValue);
        var prevFromDt = prevFrom.ToDateTime(TimeOnly.MinValue);

        // Build dimension filter for previous period (same cluster/wellType/site/project)
        var prevPidConditions = new System.Collections.Generic.List<string>();
        if (!string.IsNullOrWhiteSpace(cluster))  prevPidConditions.Add("LTRIM(RTRIM(CAST([Cluster] AS NVARCHAR(200)))) = @cluster");
        if (!string.IsNullOrWhiteSpace(site))     prevPidConditions.Add("LTRIM(RTRIM(CAST([Site]    AS NVARCHAR(200)))) = @site");
        if (!string.IsNullOrWhiteSpace(wellType)) prevPidConditions.Add("LTRIM(RTRIM(CAST([Type]    AS NVARCHAR(200)))) = @wellType");
        if (!string.IsNullOrWhiteSpace(project))  prevPidConditions.Add("LTRIM(RTRIM(CAST([Project] AS NVARCHAR(200)))) = @project");
        var prevPidFilter  = prevPidConditions.Count > 0
            ? $" AND project_id IN (SELECT CAST(ID AS NVARCHAR(100)) FROM [dbo].[ProjectIDs] WITH (NOLOCK) WHERE {string.Join(" AND ", prevPidConditions)})"
            : "";
        var prevWellWhere  = !string.IsNullOrWhiteSpace(wellId) ? "AND pdo_well_id = @wellId" : "";

        var prevSql = $"""
            WITH PrevLatest AS (
              SELECT pdo_well_id,
                     COALESCE(TRY_CAST(over_all_progress_percentages AS FLOAT), 0) AS progress,
                     actual_rig_off_date,
                     ROW_NUMBER() OVER (PARTITION BY pdo_well_id
                         ORDER BY COALESCE(TRY_CONVERT(DATE, Week_Number, 23),
                                           TRY_CONVERT(DATE, '20' + Week_Number, 23)) DESC) AS rn
              FROM [dbo].[WMR] WITH (NOLOCK)
              WHERE pdo_well_id IS NOT NULL AND pdo_well_id <> ''
                AND COALESCE(TRY_CONVERT(DATE, Week_Number, 23),
                             TRY_CONVERT(DATE, '20' + Week_Number, 23)) IS NOT NULL
                AND COALESCE(TRY_CONVERT(DATE, Week_Number, 23),
                             TRY_CONVERT(DATE, '20' + Week_Number, 23)) >= @prevFromDate
                AND COALESCE(TRY_CONVERT(DATE, Week_Number, 23),
                             TRY_CONVERT(DATE, '20' + Week_Number, 23)) <= @prevCutoff
                {prevWellWhere}
                {prevPidFilter}
            )
            SELECT ROUND(100.0
                * SUM(CASE WHEN progress = 1.0 AND actual_rig_off_date IS NOT NULL THEN 1.0 ELSE 0 END)
                / NULLIF(SUM(CASE WHEN actual_rig_off_date IS NOT NULL THEN 1 ELSE 0 END), 0), 1) AS PrevPct
            FROM PrevLatest WHERE rn = 1;
            """;

        var conn = db.Database.GetDbConnection();
        await OpenWithRetryAsync(conn, ct);
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = prevSql;
        cmd.CommandTimeout = 60;
        cmd.Parameters.Add(new SqlParameter("@prevFromDate", prevFromDt));
        cmd.Parameters.Add(new SqlParameter("@prevCutoff",   prevCutoff));
        if (!string.IsNullOrWhiteSpace(wellId))   cmd.Parameters.Add(new SqlParameter("@wellId",   wellId));
        if (!string.IsNullOrWhiteSpace(cluster))  cmd.Parameters.Add(new SqlParameter("@cluster",  cluster));
        if (!string.IsNullOrWhiteSpace(site))     cmd.Parameters.Add(new SqlParameter("@site",     site));
        if (!string.IsNullOrWhiteSpace(wellType)) cmd.Parameters.Add(new SqlParameter("@wellType", wellType));
        if (!string.IsNullOrWhiteSpace(project))  cmd.Parameters.Add(new SqlParameter("@project",  project));

        await using var rdr = await cmd.ExecuteReaderAsync(ct);
        await rdr.ReadAsync(ct);
        var previousPct = rdr.IsDBNull(0) ? 0.0 : Convert.ToDouble(rdr.GetValue(0));

        var completedPct = current.CompletionRatePct;
        var delta        = Math.Round(completedPct - previousPct, 1);

        var dto = new DrilledWellsYtdCompletionDto(
            displayYear, completedPct, displayYear - 1, previousPct, delta,
            TotalDrilled: current.TotalWells,
            Completed:    current.Completed,
            InProgress:   current.InProgress,
            Suspended:    current.Suspended);
        cache.Set(cacheKey, dto, TimeSpan.FromMinutes(5));
        return dto;
    }

    public async Task<DueWellsCompletionDto> GetDueWellsCompletionAsync(
        string? cluster = null, string? location = null, string? site = null, string? project = null,
        string? wellId = null, DateOnly? from = null, DateOnly? to = null,
        CancellationToken ct = default)
    {
        var cacheKey = $"due-wells-completion:{cluster}:{location}:{site}:{project}:{wellId}:{from}:{to}";
        if (cache.TryGetValue(cacheKey, out DueWellsCompletionDto? hit) && hit is not null)
            return hit;

        // Default date range: full current year (no cap at today — include all planned wells YTD)
        var fromDate = from ?? new DateOnly(DateTime.Today.Year, 1, 1);
        var toDate   = to   ?? new DateOnly(DateTime.Today.Year, 12, 31);

        // wellId filter stays in LatestPerWell — single-well lookup, no dedup issue.
        var wellIdWhere = "";
        if (!string.IsNullOrWhiteSpace(wellId))
            wellIdWhere += " AND w.pdo_well_id = @wellId";

        // Project/cluster/site filter applied AFTER rn=1 dedup to prevent double-counting wells
        // that have WMR rows in multiple projects (e.g. a well in both Flowline and Location).
        // Uses CTE column 'project_id' — no 'w.' alias, since it runs outside the WMR FROM scope.
        var postWhere = "";
        var pidConditions = new System.Collections.Generic.List<string>();
        if (!string.IsNullOrWhiteSpace(cluster))  pidConditions.Add("LTRIM(RTRIM(p.[Cluster])) = @cluster");
        if (!string.IsNullOrWhiteSpace(location)) pidConditions.Add("LTRIM(RTRIM(p.[Type]))    = @location");
        if (!string.IsNullOrWhiteSpace(site))     pidConditions.Add("LTRIM(RTRIM(p.[Site]))    = @site");
        if (!string.IsNullOrWhiteSpace(project))  pidConditions.Add("LTRIM(RTRIM(p.[Project])) = @project");
        if (pidConditions.Count > 0)
            postWhere += $" AND EXISTS (SELECT 1 FROM [dbo].[ProjectIDs] p WITH (NOLOCK) WHERE CAST(p.ID AS NVARCHAR(100)) = project_id AND {string.Join(" AND ", pidConditions)})";

        // ── ODC-style Due Wells logic ──────────────────────────────────────────────────────────────────
        // due_date = MAX(FLAF+90, SCR+90, actual_rig_off+5, wellpad_handover+2)
        // eff_comm_date = COALESCE(actual_comm_date, @toDate)
        // A well is "due" when eff_comm_date > due_date (same formula as kpi-tiles PenaltyExposure).
        // Completed   = progress >= 1.0
        // In Progress = 0 < progress < 1.0 AND NOT in WMR_TaskPlan_csv_imported Suspend
        // Suspended   = in WMR_TaskPlan_csv_imported with Resume_Suspend='Suspend' AND progress < 1.0
        var kpiSql = $"""
            ;WITH LatestPerWell AS (
                SELECT
                    w.pdo_well_id,
                    w.project_id,
                    COALESCE(TRY_CAST(w.over_all_progress_percentages AS FLOAT), 0)       AS progress,
                    TRY_CAST(w.[flaf_issue_date] AS DATE)                                  AS flaf_date,
                    TRY_CAST(w.[scr_date] AS DATE)                                         AS scr_date,
                    TRY_CAST(w.actual_rig_off_date AS DATE)                                AS rig_off_date,
                    TRY_CAST(w.[wellpad_handover-2_from_hoist_fbu_rsr_off_date] AS DATE)   AS handover_date,
                    TRY_CAST(w.[actual_comm._finish_date_with_in_2_days_from_actual_engg._completion_date] AS DATE) AS actual_comm_date,
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
            DueDateCalc AS (
                SELECT
                    pdo_well_id,
                    progress,
                    COALESCE(actual_comm_date, CAST(@toDate AS DATE)) AS eff_comm_date,
                    (SELECT MAX(d) FROM (VALUES
                        (DATEADD(DAY, 90, flaf_date)),
                        (DATEADD(DAY, 90, scr_date)),
                        (DATEADD(DAY,  5, rig_off_date)),
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
                COUNT(*)                                                                                              AS total_due,
                SUM(CASE WHEN d.progress >= 1.0                                              THEN 1 ELSE 0 END)      AS completed,
                SUM(CASE WHEN d.progress > 0 AND d.progress < 1.0 AND sw.pdo_well_id IS NULL THEN 1 ELSE 0 END)     AS in_progress,
                SUM(CASE WHEN sw.pdo_well_id IS NOT NULL                                     THEN 1 ELSE 0 END)      AS suspended
            FROM DueWells d
            LEFT JOIN SuspendedDueWells sw ON sw.pdo_well_id = d.pdo_well_id;
            """;

        // Monthly trend — group due wells by the month of their computed due_date.
        var trendSql = $"""
            ;WITH LatestPerWell AS (
                SELECT
                    w.pdo_well_id,
                    w.project_id,
                    COALESCE(TRY_CAST(w.over_all_progress_percentages AS FLOAT), 0)       AS progress,
                    TRY_CAST(w.[flaf_issue_date] AS DATE)                                  AS flaf_date,
                    TRY_CAST(w.[scr_date] AS DATE)                                         AS scr_date,
                    TRY_CAST(w.actual_rig_off_date AS DATE)                                AS rig_off_date,
                    TRY_CAST(w.[wellpad_handover-2_from_hoist_fbu_rsr_off_date] AS DATE)   AS handover_date,
                    TRY_CAST(w.[actual_comm._finish_date_with_in_2_days_from_actual_engg._completion_date] AS DATE) AS actual_comm_date,
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
            DueDateCalc AS (
                SELECT
                    pdo_well_id,
                    progress,
                    COALESCE(actual_comm_date, CAST(@toDate AS DATE)) AS eff_comm_date,
                    (SELECT MAX(d) FROM (VALUES
                        (DATEADD(DAY, 90, flaf_date)),
                        (DATEADD(DAY, 90, scr_date)),
                        (DATEADD(DAY,  5, rig_off_date)),
                        (DATEADD(DAY,  2, handover_date))
                    ) AS v(d)) AS due_date
                FROM LatestPerWell
                WHERE rn = 1{postWhere}
            ),
            DueWells AS (
                SELECT pdo_well_id, progress, due_date
                FROM DueDateCalc
                WHERE due_date IS NOT NULL
                  AND eff_comm_date > due_date
            )
            SELECT
                FORMAT(due_date, 'yyyy-MM')                              AS due_month,
                COUNT(*)                                                  AS month_total,
                SUM(CASE WHEN progress >= 1.0 THEN 1 ELSE 0 END)         AS month_completed
            FROM DueWells
            GROUP BY FORMAT(due_date, 'yyyy-MM')
            ORDER BY due_month;
            """;

        var conn = db.Database.GetDbConnection();
        await OpenWithRetryAsync(conn, ct);

        void AddParams(System.Data.Common.DbCommand cmd)
        {
            cmd.Parameters.Add(new SqlParameter("@fromDate", fromDate.ToDateTime(TimeOnly.MinValue)));
            cmd.Parameters.Add(new SqlParameter("@toDate",   toDate.ToDateTime(TimeOnly.MaxValue)));
            if (!string.IsNullOrWhiteSpace(wellId))
                cmd.Parameters.Add(new SqlParameter("@wellId", wellId));
            if (!string.IsNullOrWhiteSpace(cluster))
                cmd.Parameters.Add(new SqlParameter("@cluster", cluster));
            if (!string.IsNullOrWhiteSpace(location))
                cmd.Parameters.Add(new SqlParameter("@location", location));
            if (!string.IsNullOrWhiteSpace(site))
                cmd.Parameters.Add(new SqlParameter("@site", site));
            if (!string.IsNullOrWhiteSpace(project))
                cmd.Parameters.Add(new SqlParameter("@project", project));
        }

        // Execute combined KPI + suspended query
        await using var kpiCmd = conn.CreateCommand();
        kpiCmd.CommandText = kpiSql;
        kpiCmd.CommandTimeout = 120;
        AddParams(kpiCmd);

        await using var kpiRdr = await kpiCmd.ExecuteReaderAsync(ct);
        await kpiRdr.ReadAsync(ct);

        var totalDueWells = kpiRdr.IsDBNull(0) ? 0 : kpiRdr.GetInt32(0);
        var completed     = kpiRdr.IsDBNull(1) ? 0 : kpiRdr.GetInt32(1);
        var inProgress    = kpiRdr.IsDBNull(2) ? 0 : kpiRdr.GetInt32(2);
        var suspended     = kpiRdr.IsDBNull(3) ? 0 : kpiRdr.GetInt32(3);
        await kpiRdr.CloseAsync();

        var completionRate = totalDueWells > 0 ? Math.Round((double)completed / totalDueWells * 100, 1) : 0.0;

        // Execute monthly trend query
        await using var trendCmd = conn.CreateCommand();
        trendCmd.CommandText = trendSql;
        trendCmd.CommandTimeout = 120;
        AddParams(trendCmd);

        await using var trendRdr = await trendCmd.ExecuteReaderAsync(ct);
        var monthlyRows = new System.Collections.Generic.List<(string Month, int Total, int Comp)>();
        while (await trendRdr.ReadAsync(ct))
        {
            var month  = trendRdr.IsDBNull(0) ? "" : trendRdr.GetString(0);
            var mTotal = trendRdr.IsDBNull(1) ? 0  : trendRdr.GetInt32(1);
            var mComp  = trendRdr.IsDBNull(2) ? 0  : trendRdr.GetInt32(2);
            monthlyRows.Add((month, mTotal, mComp));
        }

        // Build cumulative trend: running completed / totalDueWells
        var cumComp = 0;
        var trend   = new System.Collections.Generic.List<DueWellsMonthlyPointDto>();
        foreach (var row in monthlyRows)
        {
            cumComp += row.Comp;
            var pct = totalDueWells > 0 ? Math.Round((double)cumComp / totalDueWells * 100, 1) : 0.0;
            trend.Add(new DueWellsMonthlyPointDto(row.Month, pct));
        }

        var dto = new DueWellsCompletionDto(
            totalDueWells, completed, inProgress, 0, completionRate,
            0, 0, suspended, totalDueWells, completionRate, trend);

        cache.Set(cacheKey, dto, TimeSpan.FromMinutes(2));
        return dto;
    }

    // ─── Due Wells Completion Trend (by completion date) ─────────────────────

    public async Task<DueWellsCompletionTrendDto> GetDueWellsCompletionTrendAsync(
        string? cluster = null, string? location = null, string? site = null, string? project = null,
        string? wellId = null, DateOnly? from = null, DateOnly? to = null,
        CancellationToken ct = default)
    {
        var cacheKey = $"due-wells-completion-trend:{cluster}:{location}:{site}:{project}:{wellId}:{from}:{to}";
        if (cache.TryGetValue(cacheKey, out DueWellsCompletionTrendDto? hit) && hit is not null)
            return hit;

        var fromDate = from ?? new DateOnly(DateTime.Today.Year, 1, 1);
        var toDate   = to   ?? new DateOnly(DateTime.Today.Year, 12, 31);

        // wellId filter stays in LatestPerWell — single-well lookup, no dedup issue.
        var wellIdWhere = "";
        if (!string.IsNullOrWhiteSpace(wellId))
            wellIdWhere += " AND w.pdo_well_id = @wellId";

        // Project/cluster/site filter applied AFTER rn=1 dedup to prevent double-counting wells
        // that have WMR rows in multiple projects. Uses CTE column 'project_id' (no 'w.' alias).
        var postWhere = "";
        var pidConditions = new System.Collections.Generic.List<string>();
        if (!string.IsNullOrWhiteSpace(cluster))  pidConditions.Add("LTRIM(RTRIM(p.[Cluster])) = @cluster");
        if (!string.IsNullOrWhiteSpace(location)) pidConditions.Add("LTRIM(RTRIM(p.[Type]))    = @location");
        if (!string.IsNullOrWhiteSpace(site))     pidConditions.Add("LTRIM(RTRIM(p.[Site]))    = @site");
        if (!string.IsNullOrWhiteSpace(project))  pidConditions.Add("LTRIM(RTRIM(p.[Project])) = @project");
        if (pidConditions.Count > 0)
            postWhere += $" AND EXISTS (SELECT 1 FROM [dbo].[ProjectIDs] p WITH (NOLOCK) WHERE CAST(p.ID AS NVARCHAR(100)) = project_id AND {string.Join(" AND ", pidConditions)})";

        // ODC-style due well definition: eff_comm_date > due_date (same as GetDueWellsCompletionAsync)
        var countSql = $"""
            ;WITH LatestPerWell AS (
                SELECT
                    w.pdo_well_id,
                    w.project_id,
                    TRY_CAST(w.[flaf_issue_date] AS DATE)                                  AS flaf_date,
                    TRY_CAST(w.[scr_date] AS DATE)                                         AS scr_date,
                    TRY_CAST(w.actual_rig_off_date AS DATE)                                AS rig_off_date,
                    TRY_CAST(w.[wellpad_handover-2_from_hoist_fbu_rsr_off_date] AS DATE)   AS handover_date,
                    TRY_CAST(w.[actual_comm._finish_date_with_in_2_days_from_actual_engg._completion_date] AS DATE) AS actual_comm_date,
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
            DueDateCalc AS (
                SELECT
                    pdo_well_id,
                    COALESCE(actual_comm_date, CAST(@toDate AS DATE)) AS eff_comm_date,
                    (SELECT MAX(d) FROM (VALUES
                        (DATEADD(DAY, 90, flaf_date)),
                        (DATEADD(DAY, 90, scr_date)),
                        (DATEADD(DAY,  5, rig_off_date)),
                        (DATEADD(DAY,  2, handover_date))
                    ) AS v(d)) AS due_date
                FROM LatestPerWell
                WHERE rn = 1{postWhere}
            )
            SELECT COUNT(*) AS total_due
            FROM DueDateCalc
            WHERE due_date IS NOT NULL
              AND eff_comm_date > due_date;
            """;

        // For each due well that became completed, find the first week it hit 100% progress,
        // then group by that month to build the completion trend chart.
        var trendSql = $"""
            ;WITH LatestPerWell AS (
                SELECT
                    w.pdo_well_id,
                    w.project_id,
                    TRY_CAST(w.[flaf_issue_date] AS DATE)                                  AS flaf_date,
                    TRY_CAST(w.[scr_date] AS DATE)                                         AS scr_date,
                    TRY_CAST(w.actual_rig_off_date AS DATE)                                AS rig_off_date,
                    TRY_CAST(w.[wellpad_handover-2_from_hoist_fbu_rsr_off_date] AS DATE)   AS handover_date,
                    TRY_CAST(w.[actual_comm._finish_date_with_in_2_days_from_actual_engg._completion_date] AS DATE) AS actual_comm_date,
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
            DueDateCalc AS (
                SELECT
                    pdo_well_id,
                    COALESCE(actual_comm_date, CAST(@toDate AS DATE)) AS eff_comm_date,
                    (SELECT MAX(d) FROM (VALUES
                        (DATEADD(DAY, 90, flaf_date)),
                        (DATEADD(DAY, 90, scr_date)),
                        (DATEADD(DAY,  5, rig_off_date)),
                        (DATEADD(DAY,  2, handover_date))
                    ) AS v(d)) AS due_date
                FROM LatestPerWell
                WHERE rn = 1{postWhere}
            ),
            DueWells AS (
                SELECT pdo_well_id
                FROM DueDateCalc
                WHERE due_date IS NOT NULL
                  AND eff_comm_date > due_date
            ),
            FirstCompletion AS (
                SELECT
                    dw.pdo_well_id,
                    MIN(COALESCE(TRY_CONVERT(DATE, w2.Week_Number, 23),
                                 TRY_CONVERT(DATE, '20' + w2.Week_Number, 23))) AS first_complete_date
                FROM DueWells dw
                INNER JOIN [dbo].[WMR] w2 WITH (NOLOCK) ON w2.pdo_well_id = dw.pdo_well_id
                WHERE COALESCE(TRY_CAST(w2.over_all_progress_percentages AS FLOAT), 0) >= 1.0
                  AND COALESCE(TRY_CONVERT(DATE, w2.Week_Number, 23),
                               TRY_CONVERT(DATE, '20' + w2.Week_Number, 23)) IS NOT NULL
                GROUP BY dw.pdo_well_id
            )
            SELECT
                FORMAT(first_complete_date, 'yyyy-MM') AS completion_month,
                COUNT(*) AS completed_count
            FROM FirstCompletion
            GROUP BY FORMAT(first_complete_date, 'yyyy-MM')
            ORDER BY completion_month;
            """;

        var conn = db.Database.GetDbConnection();
        await OpenWithRetryAsync(conn, ct);

        void AddParams(System.Data.Common.DbCommand cmd)
        {
            cmd.Parameters.Add(new SqlParameter("@fromDate", fromDate.ToDateTime(TimeOnly.MinValue)));
            cmd.Parameters.Add(new SqlParameter("@toDate",   toDate.ToDateTime(TimeOnly.MaxValue)));
            if (!string.IsNullOrWhiteSpace(wellId))
                cmd.Parameters.Add(new SqlParameter("@wellId", wellId));
            if (!string.IsNullOrWhiteSpace(cluster))
                cmd.Parameters.Add(new SqlParameter("@cluster", cluster));
            if (!string.IsNullOrWhiteSpace(location))
                cmd.Parameters.Add(new SqlParameter("@location", location));
            if (!string.IsNullOrWhiteSpace(site))
                cmd.Parameters.Add(new SqlParameter("@site", site));
            if (!string.IsNullOrWhiteSpace(project))
                cmd.Parameters.Add(new SqlParameter("@project", project));
        }

        // Execute count query
        await using var countCmd = conn.CreateCommand();
        countCmd.CommandText = countSql;
        countCmd.CommandTimeout = 120;
        AddParams(countCmd);

        await using var countRdr = await countCmd.ExecuteReaderAsync(ct);
        await countRdr.ReadAsync(ct);
        var totalDueWells = countRdr.IsDBNull(0) ? 0 : countRdr.GetInt32(0);
        await countRdr.CloseAsync();

        // Execute trend query
        await using var trendCmd = conn.CreateCommand();
        trendCmd.CommandText = trendSql;
        trendCmd.CommandTimeout = 120;
        AddParams(trendCmd);

        await using var trendRdr = await trendCmd.ExecuteReaderAsync(ct);
        var rows = new System.Collections.Generic.List<(string Month, int Count)>();
        while (await trendRdr.ReadAsync(ct))
        {
            var month = trendRdr.IsDBNull(0) ? "" : trendRdr.GetString(0);
            var count = trendRdr.IsDBNull(1) ? 0  : trendRdr.GetInt32(1);
            rows.Add((month, count));
        }

        var totalCompleted = rows.Sum(r => r.Count);
        var cumComp  = 0;
        var points = new System.Collections.Generic.List<DueWellsCompletionTrendPointDto>();
        foreach (var row in rows)
        {
            cumComp += row.Count;
            var rate = totalDueWells > 0 ? Math.Round((double)cumComp / totalDueWells * 100, 1) : 0.0;
            points.Add(new DueWellsCompletionTrendPointDto(row.Month, row.Count, rate));
        }

        var trendDto = new DueWellsCompletionTrendDto(totalDueWells, totalCompleted, points);
        cache.Set(cacheKey, trendDto, TimeSpan.FromMinutes(2));
        return trendDto;
    }

    // ─── Buffer Location Construction Progress ────────────────────────────────

    public async Task<BufferLocationProgressResponse> GetBufferLocationProgressAsync(
        int? planYear = null,
        DateOnly? asOfDate = null,
        string? cluster = null,
        string? wellType = null,
        DateOnly? fromDate = null,
        DateOnly? toDate = null,
        string? project = null,
        CancellationToken ct = default)
    {
        var year = planYear ?? DateTime.UtcNow.Year;
        var asOf = asOfDate ?? DateOnly.FromDateTime(DateTime.UtcNow);
        var useDateRange = fromDate.HasValue && toDate.HasValue;
        var cacheKey = $"buffer-location-progress:{year}:{asOf:yyyy-MM-dd}:{cluster ?? "all"}:{wellType ?? "all"}:{fromDate?.ToString("yyyy-MM-dd") ?? "all"}:{toDate?.ToString("yyyy-MM-dd") ?? "all"}:{project ?? "all"}";
        if (cache.TryGetValue(cacheKey, out BufferLocationProgressResponse? cached) && cached is not null)
            return cached;

        // Build dynamic date filter: use fromDate/toDate range if provided, else YEAR()
        var dateFilter = useDateRange
            ? "AND TRY_CAST(w.[latest_exp.rig_on_location_sap_data] AS DATE) >= @fromDate AND TRY_CAST(w.[latest_exp.rig_on_location_sap_data] AS DATE) <= @toDate"
            : "AND YEAR(TRY_CAST(w.[latest_exp.rig_on_location_sap_data] AS DATE)) = @year";
        var wellTypeWhere = !string.IsNullOrEmpty(wellType)
            ? "AND LTRIM(RTRIM(p.[Type])) = @wellType"
            : "";
        var projectWhere = !string.IsNullOrEmpty(project)
            ? "AND LTRIM(RTRIM(p.[Project])) = @project"
            : "";

        var sql = $"""
            SET NOCOUNT ON;

            DECLARE @year         INT = @yearParam;
            DECLARE @pegging_days INT = 90;
            DECLARE @scr_days     INT = 60;

            ;WITH buffer_wells AS (
                SELECT
                    w.pdo_well_id,
                    TRY_CAST(w.[latest_exp.rig_on_location_sap_data] AS DATE) AS kpi_dl,
                    TRY_CAST(w.actual_finish_date                     AS DATE) AS done_dt,
                    TRY_CAST(w.actual_pegged_date                     AS DATE) AS pegged_dt,
                    TRY_CAST(w.actual_start_date                      AS DATE) AS start_dt,
                    w.scr_no,
                    TRY_CAST(w.scr_date AS DATE) AS scr_dt,
                    w.ssfd_wells,
                    w.ipm,
                    w.moc_raised,
                    w.moc_approved,
                    w.buffer_status,
                    w.actual_rig_on_date,
                    w.[location_preparation_status_in_progress_completed] AS loc_prep_status
                FROM (
                    SELECT w2.*,
                           ROW_NUMBER() OVER (
                               PARTITION BY w2.pdo_well_id
                               ORDER BY COALESCE(TRY_CAST(w2.Week_Number AS DATE), TRY_CONVERT(DATE, w2.Week_Number, 5)) DESC
                           ) AS rn
                    FROM dbo.WMR w2 WITH (NOLOCK)
                    WHERE w2.pdo_well_id IS NOT NULL
                      AND w2.project_id IN (
                          SELECT p.ID FROM dbo.ProjectIDs p WITH (NOLOCK)
                          WHERE LTRIM(RTRIM(p.[Project])) = 'Location'
                            AND LTRIM(RTRIM(p.[Cluster])) IN ('Nimr','Marmul')
                            AND (@clusterParam IS NULL OR LTRIM(RTRIM(p.[Cluster])) = @clusterParam)
                            {wellTypeWhere}
                            {projectWhere}
                      )
                ) w
                WHERE w.rn = 1
                  {dateFilter}
            ),
            flags AS (
                SELECT *,
                    -- Pegging excluded: not assigned to rig (no pegged date),
                    -- or start→pegged delay > 90 days.
                    -- Wells with a pegged date but no start yet are future scheduled
                    -- wells — they remain in the effective target.
                    CASE
                        WHEN pegged_dt IS NULL THEN 1
                        WHEN start_dt IS NOT NULL
                         AND DATEDIFF(DAY, start_dt, pegged_dt) > @pegging_days THEN 1
                        ELSE 0
                    END AS peg_excl,
                    -- SCR excluded (Row 22): SCR raised within 60 days of KPI deadline
                    CASE
                        WHEN scr_no IS NOT NULL
                         AND scr_dt IS NOT NULL
                         AND DATEDIFF(DAY, scr_dt, kpi_dl) <= @scr_days
                        THEN 1 ELSE 0
                    END AS scr_excl,
                    -- PDO issue (Row 24)
                    CASE
                        WHEN (ssfd_wells IS NOT NULL
                              OR ipm IS NOT NULL
                              OR (moc_raised IS NOT NULL
                                  AND (moc_approved IS NULL
                                       OR LTRIM(RTRIM(moc_approved)) = '')))
                         AND scr_no IS NULL
                        THEN 1 ELSE 0
                    END AS pdo_issue,
                    -- Completed: rig not yet on location but location prep is done
                    CASE WHEN (actual_rig_on_date IS NULL OR LTRIM(RTRIM(actual_rig_on_date)) = '')
                          AND LTRIM(RTRIM(loc_prep_status)) = 'Completed'
                         THEN 1 ELSE 0 END AS is_done,
                    -- Accelerated (done before KPI deadline)
                    CASE WHEN done_dt IS NOT NULL AND done_dt < kpi_dl THEN 1 ELSE 0 END AS is_accel,
                    -- Backlog (deadline passed, not done, not on hold)
                    CASE
                        WHEN kpi_dl < GETDATE()
                         AND done_dt IS NULL
                         AND (buffer_status NOT IN ('Suspended','Hold','On Hold')
                              OR buffer_status IS NULL)
                        THEN 1 ELSE 0
                    END AS is_backlog
                FROM buffer_wells
            )
            SELECT
                -- Tile 1: As per PDO Rig Sequence
                COUNT(*)                                                        AS RigSequencePlan,
                -- Tile 2: After Pegging / SCR Delays
                COUNT(*) - SUM(peg_excl) - SUM(scr_excl)                       AS AfterPeggingScr,
                SUM(peg_excl) + SUM(scr_excl)                                   AS PeggingScrExcluded,
                -- Tile 3: After PDO Issues Resolution (Clean Target)
                COUNT(*) - SUM(peg_excl) - SUM(scr_excl)
                    - SUM(CASE WHEN pdo_issue=1 AND peg_excl=0 AND scr_excl=0
                               THEN 1 ELSE 0 END)                               AS CleanTarget,
                -- Tile 4: Due Wells Completed
                SUM(CASE WHEN is_done=1 AND kpi_dl < GETDATE()
                         THEN 1 ELSE 0 END)                                     AS DueWellsCompleted,
                -- Tile 5: Actual Completed (due + accelerated)
                SUM(is_done)                                                    AS ActualCompleted,
                -- Backlog / Acceleration
                SUM(is_accel)                                                   AS Accelerated,
                SUM(is_backlog)                                                 AS Backlog,
                SUM(is_accel) - SUM(is_backlog)                                 AS NetAcceleration,
                -- Schedule Variance = actual_completed - clean_target
                SUM(is_done) - (
                    COUNT(*) - SUM(peg_excl) - SUM(scr_excl)
                    - SUM(CASE WHEN pdo_issue=1 AND peg_excl=0 AND scr_excl=0
                               THEN 1 ELSE 0 END))                              AS ScheduleVariance,
                -- Overall Completion %
                CAST(ROUND(SUM(is_done) * 100.0 / NULLIF(
                    COUNT(*) - SUM(peg_excl) - SUM(scr_excl)
                    - SUM(CASE WHEN pdo_issue=1 AND peg_excl=0 AND scr_excl=0
                               THEN 1 ELSE 0 END), 0), 1) AS DECIMAL(5,1))     AS OverallPct,
                -- ATNM % (same denominator; differs from Overall only when PDO Issues > 0)
                CAST(ROUND(SUM(is_done) * 100.0 / NULLIF(
                    COUNT(*) - SUM(peg_excl) - SUM(scr_excl)
                    - SUM(CASE WHEN pdo_issue=1 AND peg_excl=0 AND scr_excl=0
                               THEN 1 ELSE 0 END), 0), 1) AS DECIMAL(5,1))     AS AtnmPct
            FROM flags;
            """;

        var connStr = db.Database.GetConnectionString()!;
        await using var conn = new SqlConnection(connStr);
        await OpenWithRetryAsync(conn, ct);

        await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 120 };
        cmd.Parameters.AddWithValue("@yearParam", year);
        cmd.Parameters.AddWithValue("@clusterParam",
            cluster != null ? char.ToUpper(cluster[0]) + cluster[1..].ToLower() : (object)DBNull.Value);
        if (!string.IsNullOrEmpty(wellType))
            cmd.Parameters.AddWithValue("@wellType", wellType);
        if (!string.IsNullOrEmpty(project))
            cmd.Parameters.AddWithValue("@project", project);
        if (fromDate.HasValue)
            cmd.Parameters.AddWithValue("@fromDate", fromDate.Value.ToDateTime(TimeOnly.MinValue));
        if (toDate.HasValue)
            cmd.Parameters.AddWithValue("@toDate", toDate.Value.ToDateTime(TimeOnly.MinValue));

        await using var rdr = await cmd.ExecuteReaderAsync(ct);
        await rdr.ReadAsync(ct);

        var kpi = new BufferLocationProgressKpiDto(
            RigSequencePlan:    rdr.IsDBNull(0)  ? 0    : rdr.GetInt32(0),
            AfterPeggingScr:    rdr.IsDBNull(1)  ? 0    : rdr.GetInt32(1),
            PeggingScrExcluded: rdr.IsDBNull(2)  ? 0    : rdr.GetInt32(2),
            CleanTarget:        rdr.IsDBNull(3)  ? 0    : rdr.GetInt32(3),
            DueWellsCompleted:  rdr.IsDBNull(4)  ? 0    : rdr.GetInt32(4),
            ActualCompleted:    rdr.IsDBNull(5)  ? 0    : rdr.GetInt32(5),
            Accelerated:        rdr.IsDBNull(6)  ? 0    : rdr.GetInt32(6),
            Backlog:            rdr.IsDBNull(7)  ? 0    : rdr.GetInt32(7),
            NetAcceleration:    rdr.IsDBNull(8)  ? 0    : rdr.GetInt32(8),
            ScheduleVariance:   rdr.IsDBNull(9)  ? 0    : rdr.GetInt32(9),
            OverallPct:         rdr.IsDBNull(10) ? 0m   : rdr.GetDecimal(10),
            AtnmPct:            rdr.IsDBNull(11) ? 0m   : rdr.GetDecimal(11));

        var result = new BufferLocationProgressResponse(
            AsOfDate: asOf.ToString("yyyy-MM-dd"),
            PlanYear: year,
            Kpi: kpi);

        cache.Set(cacheKey, result, CacheDuration);
        return result;
    }

    // ActivityTaskPlan enrichment cache — loaded once in background, persists for the process lifetime.
    private static volatile Dictionary<string, (string? Code, string? Text, string? CrewUid, string? CrewType)>? _actEnrichCache;
    private static volatile bool _actEnrichLoading;

    private static async Task LoadActEnrichmentAsync(string connStr)
    {
        try
        {
            await using var conn = new SqlConnection(connStr);
            await conn.OpenAsync();
            await using var cmd = conn.CreateCommand();
            // ROW_NUMBER: rank 1 = most recently STARTED activity that is currently active
            // (start_date <= today AND end_date is null or >= today).
            // If no currently-active row exists for a well, the most recently started
            // row (any date) is used as fallback (CASE gives it sort key 1 vs 0).
            cmd.CommandText = """
                WITH ranked AS (
                    SELECT
                        Well_ID,
                        code,
                        [text],
                        NULLIF(LTRIM(RTRIM(crew_uid)),  '') AS atp_crew_uid,
                        NULLIF(LTRIM(RTRIM(crew_type)), '') AS atp_crew_type,
                        ROW_NUMBER() OVER (
                            PARTITION BY Well_ID
                            ORDER BY
                                -- currently-active rows first (0), then past/future (1)
                                CASE
                                    WHEN TRY_CAST(start_date AS DATE) <= CAST(GETDATE() AS DATE)
                                         AND (end_date IS NULL
                                              OR TRY_CAST(end_date AS DATE) >= CAST(GETDATE() AS DATE))
                                    THEN 0 ELSE 1
                                END,
                                start_date DESC   -- among ties, latest start wins
                        ) AS rn
                    FROM [dbo].[ActivityTaskPlan] WITH (NOLOCK)
                    WHERE Well_ID IN (
                        SELECT DISTINCT pdo_well_id FROM [dbo].[WMR] WITH (NOLOCK)
                        WHERE pdo_well_id IS NOT NULL AND pdo_well_id <> ''
                    )
                )
                SELECT Well_ID, code, [text], atp_crew_uid, atp_crew_type
                FROM ranked
                WHERE rn = 1
                """;
            cmd.CommandTimeout = 300; // 5 minutes â€” acceptable for a one-time background load
            static string? Sv(object v) => v == DBNull.Value ? null : v?.ToString();
            await using var rdr = await cmd.ExecuteReaderAsync();
            var map = new Dictionary<string, (string? Code, string? Text, string? CrewUid, string? CrewType)>(StringComparer.OrdinalIgnoreCase);
            while (await rdr.ReadAsync())
            {
                var wid = Sv(rdr["Well_ID"]);
                if (string.IsNullOrWhiteSpace(wid)) continue;
                map[wid] = (
                    Code:     Sv(rdr["code"]),
                    Text:     Sv(rdr["text"]),
                    CrewUid:  Sv(rdr["atp_crew_uid"]),
                    CrewType: Sv(rdr["atp_crew_type"]));
            }
            _actEnrichCache = map;
        }
        catch { /* silent â€” retried on next well-progress cache miss */ }
        finally { _actEnrichLoading = false; }
    }

    // Cluster â†’ project-ID mapping for activities filtering
    private static readonly Dictionary<string, HashSet<string>> ClusterProjects = new(StringComparer.OrdinalIgnoreCase)
    {
        ["nimr"]   = new(StringComparer.OrdinalIgnoreCase) { "278c5587-bba7-46ea-9c6a-d79aa8bd2a69", "8c9c6b42-7a12-4eb3-935b-fc0437e7f33f" },
        ["alburj"] = new(StringComparer.OrdinalIgnoreCase) { "25482266-1cfe-469a-be26-3f0d69bf61c4", "6d07e3a5-d89b-47ac-9163-8a71e8ade03d" },
        ["amin"]   = new(StringComparer.OrdinalIgnoreCase) { "0b69907b-25e5-4165-8414-41ac56586d61", "ab623768-6e41-4a27-bea0-d509f828d32a" },
        ["tuqaa"]  = new(StringComparer.OrdinalIgnoreCase) { "7d73c8fe-b31b-4f9b-b616-855cc7388837", "fd0fd562-f8d1-4883-b61e-9cebc1943479" },
        ["rakid"]  = new(StringComparer.OrdinalIgnoreCase) { "b45b8a2e-c688-4ed1-a8be-a1223540ff1f", "91f79608-f510-459e-a13a-871006530a03" }
    };

    public Task<ActivitiesProgressDto> GetActivitiesProgressAsync(
        string odc,
        string? cluster,
        string? projectId,
        string? scheduleId,
        string? wellId,
        DateTime? startDate,
        DateTime? endDate,
        CancellationToken ct = default)
    {
        var cache = ActivitiesCache.Instance;
        if (!cache.IsReady)
            return Task.FromResult(new ActivitiesProgressDto(0, 0, 0, 0, 0));

        var rows = cache.Rows;
        var odcLower = odc.ToLowerInvariant();

        // Determine which projects to include
        HashSet<string>? allowedProjects = null;
        bool filterMarmulOnly = false;
        bool excludeHiddenClusters = false;
        if (!string.IsNullOrWhiteSpace(projectId))
        {
            allowedProjects = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { projectId };
        }
        else if (!string.IsNullOrWhiteSpace(cluster) && ClusterProjects.TryGetValue(cluster, out var clusterProjectIds))
        {
            allowedProjects = clusterProjectIds;
        }
        else if (!string.IsNullOrWhiteSpace(cluster) && cluster.Equals("marmul", StringComparison.OrdinalIgnoreCase))
        {
            // MARMUL = any project NOT in the known NIMR sub-cluster project sets
            filterMarmulOnly = true;
        }
        else if (string.IsNullOrWhiteSpace(cluster))
        {
            // "All Clusters" â†’ only show NIMR + MARMUL, hide alburj/amin/tuqaa/rakid
            excludeHiddenClusters = true;
        }

        // Well filter
        HashSet<string>? allowedWells = null;
        if (!string.IsNullOrWhiteSpace(wellId))
        {
            allowedWells = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { wellId };
        }

        int total = 0, completed = 0, inProgress = 0, notStarted = 0;
        // All known NIMR sub-cluster project IDs (for MARMUL exclusion filter)
        HashSet<string>? allNimrProjectIds = null;
        if (filterMarmulOnly)
        {
            allNimrProjectIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var pids in ClusterProjects.Values)
                foreach (var pid in pids) allNimrProjectIds.Add(pid);
        }

        foreach (var row in rows)
        {
            if (allowedProjects != null && !allowedProjects.Contains(row.ProjectId))
                continue;

            // MARMUL filter: exclude projects that belong to known NIMR sub-clusters
            if (filterMarmulOnly && allNimrProjectIds!.Contains(row.ProjectId))
                continue;

            // "All Clusters" default: exclude hidden clusters (alburj, amin, tuqaa, rakid)
            if (excludeHiddenClusters && ExcludedDefaultProjects.Contains(row.ProjectId))
                continue;

            if (allowedWells != null && !allowedWells.Contains(row.WellId ?? ""))
                continue;

            // Date filter on target_start (TaskDate)
            if (startDate.HasValue && row.TaskDate < startDate.Value.Date)
                continue;

            if (endDate.HasValue && row.TaskDate > endDate.Value.Date)
                continue;

            total += row.Total;
            completed += row.Completed;
            inProgress += row.InProgress;
            notStarted += row.NotStarted;
        }

        // Fallback: if well filter returned 0 and a cluster is known,
        // fall back to cluster-level data so the KPI card isn't empty.
        if (total == 0 && !string.IsNullOrWhiteSpace(wellId) && !string.IsNullOrWhiteSpace(cluster))
        {
            return GetActivitiesProgressAsync(odc, cluster, projectId, scheduleId, null, startDate, endDate, ct);
        }

        // Progress % = Completed / Total Ã— 100 (per docx spec)
        double progress = total > 0 ? Math.Round((double)completed / total * 100, 1) : 0.0;

        return Task.FromResult(new ActivitiesProgressDto(progress, completed, inProgress, notStarted, total));
    }

    // â”€â”€â”€ Activities List (paginated detail rows) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    // Reverse lookup: project ID â†’ cluster name
    private static readonly Dictionary<string, string> ProjectToCluster;
    // Projects belonging to clusters we hide in the default "All Clusters" view (only NIMR + MARMUL shown)
    private static readonly HashSet<string> ExcludedDefaultProjects;
    static DashboardRepository()
    {
        ProjectToCluster = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var (cluster, projectIds) in ClusterProjects)
            foreach (var pid in projectIds)
                ProjectToCluster[pid] = cluster.ToUpperInvariant() switch
                {
                    "NIMR" => "NIMR",
                    "ALBURJ" => "AL BURJ",
                    "AMIN" => "AMIN",
                    "TUQAA" => "TUQAA",
                    "RAKID" => "RAKID",
                    _ => cluster.ToUpperInvariant()
                };

        // Build set of project IDs to exclude when no cluster is selected
        ExcludedDefaultProjects = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        string[] hiddenClusters = { "alburj", "amin", "tuqaa", "rakid" };
        foreach (var hc in hiddenClusters)
            if (ClusterProjects.TryGetValue(hc, out var pids))
                foreach (var pid in pids) ExcludedDefaultProjects.Add(pid);
    }

    /// <summary>Resolve display cluster name for a project ID. Unknown = MARMUL.</summary>
    private static string GetClusterDisplayName(string? projectId)
        => string.IsNullOrWhiteSpace(projectId) ? "MARMUL" : ProjectToCluster.GetValueOrDefault(projectId, "MARMUL");

    public async Task<ActivitiesListResponse> GetActivitiesListAsync(
        string odc,
        string? cluster,
        string? wellId,
        DateTime? startDate,
        DateTime? endDate,
        int page,
        int pageSize,
        CancellationToken ct = default)
    {
        // 1. Get summary from cache (guaranteed to match KPI card)
        var summary = await GetActivitiesProgressAsync(odc, cluster, null, null, wellId, startDate, endDate, ct);

        // 2. Serve list from in-memory cache (loaded at startup)
        var listCache = ActivitiesListCache.Instance;
        if (listCache.IsReady)
        {
            // Determine which projects to include (same logic as KPI)
            HashSet<string>? allowedProjects = null;
            bool filterMarmulOnly = false;
            bool excludeHiddenClusters = false;
            if (!string.IsNullOrWhiteSpace(cluster) && ClusterProjects.TryGetValue(cluster, out var cps))
            {
                allowedProjects = cps;
            }
            else if (!string.IsNullOrWhiteSpace(cluster) && cluster.Equals("marmul", StringComparison.OrdinalIgnoreCase))
            {
                filterMarmulOnly = true;
            }
            else if (string.IsNullOrWhiteSpace(cluster))
            {
                // "All Clusters" â†’ only show NIMR + MARMUL
                excludeHiddenClusters = true;
            }

            HashSet<string>? allNimrProjectIds = null;
            if (filterMarmulOnly)
            {
                allNimrProjectIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (var pids in ClusterProjects.Values)
                    foreach (var pid in pids) allNimrProjectIds.Add(pid);
            }

            // Filter rows in memory
            var filtered = new List<ActivityListRow>();
            foreach (var row in listCache.Rows)
            {
                if (allowedProjects != null && !allowedProjects.Contains(row.ProjectId))
                    continue;
                if (filterMarmulOnly && allNimrProjectIds!.Contains(row.ProjectId))
                    continue;
                if (excludeHiddenClusters && ExcludedDefaultProjects.Contains(row.ProjectId))
                    continue;
                if (!string.IsNullOrWhiteSpace(wellId) && !row.WellId.Equals(wellId, StringComparison.OrdinalIgnoreCase))
                    continue;
                if (startDate.HasValue && row.TargetStart < startDate.Value.Date)
                    continue;
                if (endDate.HasValue && row.TargetStart > endDate.Value.Date)
                    continue;
                filtered.Add(row);
            }

            var totalRows = filtered.Count;
            var totalPages = totalRows > 0 ? (int)Math.Ceiling((double)totalRows / pageSize) : 0;
            var offset = (page - 1) * pageSize;

            var pageItems = filtered
                .Skip(offset)
                .Take(pageSize)
                .Select(r => new ActivityRowDto(
                    Code: r.Code,
                    Description: r.Description,
                    WellId: r.WellId,
                    Cluster: GetClusterDisplayName(r.ProjectId),
                    Status: r.Status,
                    ProgressPct: r.ProgressPct,
                    StartDate: r.TargetStart.ToString("yyyy-MM-dd"),
                    EndDate: r.TargetEnd?.ToString("yyyy-MM-dd"),
                    Assignee: r.Assignee
                ))
                .ToArray();

            return new ActivitiesListResponse(summary, pageItems, page, pageSize, totalRows, totalPages);
        }

        // 3. Fallback: generate list from aggregate cache (instant, accurate counts)
        return GenerateListFromAggCache(summary, cluster, wellId, startDate, endDate, page, pageSize);
    }

    private ActivitiesListResponse GenerateListFromAggCache(
        ActivitiesProgressDto summary,
        string? cluster,
        string? wellId,
        DateTime? startDate,
        DateTime? endDate,
        int page,
        int pageSize)
    {
        var aggCache = ActivitiesCache.Instance;
        if (!aggCache.IsReady)
            return new ActivitiesListResponse(summary, Array.Empty<ActivityRowDto>(), page, pageSize, 0, 0);

        // Apply same filters as KPI
        HashSet<string>? allowedProjects = null;
        bool filterMarmulOnly = false;
        bool excludeHiddenClusters = false;
        if (!string.IsNullOrWhiteSpace(cluster) && ClusterProjects.TryGetValue(cluster, out var cps2))
            allowedProjects = cps2;
        else if (!string.IsNullOrWhiteSpace(cluster) && cluster.Equals("marmul", StringComparison.OrdinalIgnoreCase))
            filterMarmulOnly = true;
        else if (string.IsNullOrWhiteSpace(cluster))
            excludeHiddenClusters = true;

        HashSet<string>? allNimrProjectIds = null;
        if (filterMarmulOnly)
        {
            allNimrProjectIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var pids in ClusterProjects.Values)
                foreach (var pid in pids) allNimrProjectIds.Add(pid);
        }

        // Expand aggregate rows into individual activity entries (sorted by date DESC)
        var expanded = new List<ActivityRowDto>();
        foreach (var row in aggCache.Rows)
        {
            if (allowedProjects != null && !allowedProjects.Contains(row.ProjectId))
                continue;
            if (filterMarmulOnly && allNimrProjectIds!.Contains(row.ProjectId))
                continue;
            if (excludeHiddenClusters && ExcludedDefaultProjects.Contains(row.ProjectId))
                continue;
            if (!string.IsNullOrWhiteSpace(wellId) && !row.WellId.Equals(wellId, StringComparison.OrdinalIgnoreCase))
                continue;
            if (startDate.HasValue && row.TaskDate < startDate.Value.Date)
                continue;
            if (endDate.HasValue && row.TaskDate > endDate.Value.Date)
                continue;

            var clusterName = GetClusterDisplayName(row.ProjectId);
            var dateStr = row.TaskDate.ToString("yyyy-MM-dd");
            var wellLabel = string.IsNullOrWhiteSpace(row.WellId) ? "GEN" : row.WellId;

            // Expand Completed
            for (int i = 0; i < row.Completed; i++)
                expanded.Add(new ActivityRowDto(
                    Code: $"{wellLabel}-{row.TaskDate:yyyyMMdd}-C{i + 1:D3}",
                    Description: $"Activity Task - {wellLabel}",
                    WellId: row.WellId,
                    Cluster: clusterName,
                    Status: "Completed",
                    ProgressPct: 100,
                    StartDate: dateStr,
                    EndDate: row.EndDate,
                    Assignee: row.Assignee));

            // Expand InProgress
            for (int i = 0; i < row.InProgress; i++)
                expanded.Add(new ActivityRowDto(
                    Code: $"{wellLabel}-{row.TaskDate:yyyyMMdd}-P{i + 1:D3}",
                    Description: $"Activity Task - {wellLabel}",
                    WellId: row.WellId,
                    Cluster: clusterName,
                    Status: "In Progress",
                    ProgressPct: 50,
                    StartDate: dateStr,
                    EndDate: row.EndDate,
                    Assignee: row.Assignee));

            // Expand NotStarted
            for (int i = 0; i < row.NotStarted; i++)
                expanded.Add(new ActivityRowDto(
                    Code: $"{wellLabel}-{row.TaskDate:yyyyMMdd}-N{i + 1:D3}",
                    Description: $"Activity Task - {wellLabel}",
                    WellId: row.WellId,
                    Cluster: clusterName,
                    Status: "Not Started",
                    ProgressPct: 0,
                    StartDate: dateStr,
                    EndDate: row.EndDate,
                    Assignee: row.Assignee));

            // Expand uncategorized (Total - Completed - InProgress - NotStarted) as "In Progress"
            var other = row.Total - row.Completed - row.InProgress - row.NotStarted;
            for (int i = 0; i < other; i++)
                expanded.Add(new ActivityRowDto(
                    Code: $"{wellLabel}-{row.TaskDate:yyyyMMdd}-X{i + 1:D3}",
                    Description: $"Activity Task - {wellLabel}",
                    WellId: row.WellId,
                    Cluster: clusterName,
                    Status: "In Progress",
                    ProgressPct: 50,
                    StartDate: dateStr,
                    EndDate: row.EndDate,
                    Assignee: row.Assignee));
        }

        // Sort by date DESC
        expanded.Sort((a, b) => string.Compare(b.StartDate, a.StartDate, StringComparison.Ordinal));

        var totalRows = expanded.Count;
        var totalPages = totalRows > 0 ? (int)Math.Ceiling((double)totalRows / pageSize) : 0;
        var offset = (page - 1) * pageSize;
        var pageItems = expanded.Skip(offset).Take(pageSize).ToArray();

        return new ActivitiesListResponse(summary, pageItems, page, pageSize, totalRows, totalPages);
    }

    private static SqlParameter CloneParameter(SqlParameter source)
        => new(source.ParameterName, source.Value) { SqlDbType = source.SqlDbType };

    // â”€â”€â”€ Critical Dates Timeline â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    public async Task<CriticalDatesTimelinePageDto> GetCriticalDatesTimelineAsync(
        int page,
        int pageSize,
        string? cluster  = null,
        string? site     = null,
        string? wellId   = null,
        DateOnly? from   = null,
        DateOnly? to     = null,
        string? wellType = null,
        CancellationToken ct = default)
    {
        var cacheKey = $"cdt:c{cluster}:si{site}:w{wellId}:p{page}:s{pageSize}:f{from}:t{to}:wt{wellType}";
        if (cache.TryGetValue(cacheKey, out CriticalDatesTimelinePageDto? cached) && cached is not null)
            return cached;

        // ── Path A: serve from in-memory CritDatesCache (background load, instant) ──
        if (CritDatesCache.Instance.IsReady)
        {
            var result = BuildFromCritDatesCache(page, pageSize, cluster, site, wellId, from, to, wellType);
            cache.Set(cacheKey, result, TimeSpan.FromMinutes(2));
            return result;
        }

        // ── Path B: ActivitiesListCache (471K rows, already in memory from file) ──
        // ActivityTaskPlan has NO indexes on date columns or project_id.
        // Every direct query causes a full 52M-row scan → timeout.
        // ActivitiesListCache is already loaded at startup from activities-list.bin.
        // We augment it with a one-time ProjectIDs lookup (tiny table, <5s).
        if (ActivitiesListCache.Instance.IsReady)
        {
            await EnsureProjectInfoMapAsync(ct);
            var result = BuildFromActivitiesListCache(page, pageSize, cluster, site, wellId, from, to, wellType);
            cache.Set(cacheKey, result, TimeSpan.FromMinutes(5));
            return result;
        }

        // Neither cache ready — return empty rather than timing out
        return new CriticalDatesTimelinePageDto(Array.Empty<CriticalDateTimelineItemDto>(), page, pageSize, false);
    }

    private async Task EnsureProjectInfoMapAsync(CancellationToken ct)
    {
        if (_projectInfoMap != null) return;
        await _projectInfoLock.WaitAsync(ct);
        try
        {
            if (_projectInfoMap != null) return;
            var map = new Dictionary<string, (string cluster, string site, string wellType)>(64);
            var cs = db.Database.GetConnectionString()!;
            await using var conn = new SqlConnection(
                new SqlConnectionStringBuilder(cs) { ConnectTimeout = 10 }.ConnectionString);
            await conn.OpenAsync(ct);
            await using var cmd = conn.CreateCommand();
            cmd.CommandText    = "SELECT ID, LTRIM(RTRIM(CAST([Cluster] AS NVARCHAR(200)))), LTRIM(RTRIM(CAST([Site] AS NVARCHAR(200)))), LTRIM(RTRIM(CAST([Type] AS NVARCHAR(200)))) FROM [dbo].[ProjectIDs] WITH (NOLOCK)";
            cmd.CommandTimeout = 10;
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
            {
                var pid     = rdr.GetInt32(0).ToString();
                var cluster = rdr.IsDBNull(1) ? "" : rdr.GetString(1);
                var site    = rdr.IsDBNull(2) ? "" : rdr.GetString(2);
                var wt      = rdr.IsDBNull(3) ? "" : rdr.GetString(3);
                map[pid] = (cluster, site, wt);
            }
            _projectInfoMap = map;
        }
        catch { /* ignore — map stays null, no cluster/wellType filtering */ }
        finally { _projectInfoLock.Release(); }
    }

    /// <summary>
    /// Small cached lookup project_id → (cluster, site, project, type) from the tiny ProjectIDs table.
    /// Used to scope WMR-derived rows in C# (avoids slow ProjectIDs subqueries against the huge WMR scan).
    /// Returns an empty map on any DB error so scoping simply matches nothing rather than throwing.
    /// </summary>
    private async Task<Dictionary<string, (string cluster, string site, string project, string type)>> GetProjectScopeMapAsync(CancellationToken ct)
    {
        const string key = "project-scope-map";
        if (cache.TryGetValue(key, out Dictionary<string, (string, string, string, string)>? cached) && cached is not null)
            return cached;

        var map = new Dictionary<string, (string, string, string, string)>(256, StringComparer.OrdinalIgnoreCase);
        try
        {
            var cs = db.Database.GetConnectionString()!;
            await using var conn = new SqlConnection(new SqlConnectionStringBuilder(cs) { ConnectTimeout = 10 }.ConnectionString);
            await conn.OpenAsync(ct);
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                SELECT LTRIM(RTRIM(CAST(ID AS NVARCHAR(100)))),
                       LTRIM(RTRIM(CAST([Cluster] AS NVARCHAR(200)))),
                       LTRIM(RTRIM(CAST([Site]    AS NVARCHAR(200)))),
                       LTRIM(RTRIM(CAST([Project] AS NVARCHAR(200)))),
                       LTRIM(RTRIM(CAST([Type]    AS NVARCHAR(200))))
                FROM [dbo].[ProjectIDs] WITH (NOLOCK)
                """;
            cmd.CommandTimeout = 15;
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
            {
                if (rdr.IsDBNull(0)) continue;
                map[rdr.GetString(0)] = (
                    rdr.IsDBNull(1) ? "" : rdr.GetString(1),
                    rdr.IsDBNull(2) ? "" : rdr.GetString(2),
                    rdr.IsDBNull(3) ? "" : rdr.GetString(3),
                    rdr.IsDBNull(4) ? "" : rdr.GetString(4));
            }
        }
        catch { /* return whatever we have (possibly empty) */ }

        cache.Set(key, map, TimeSpan.FromMinutes(30));
        return map;
    }

    private CriticalDatesTimelinePageDto BuildFromActivitiesListCache(
        int page, int pageSize,
        string? cluster, string? site, string? wellId, DateOnly? from, DateOnly? to, string? wellType)
    {
        var map     = _projectInfoMap ?? new();
        var today   = DateTime.UtcNow.Date;
        var fromDt  = from.HasValue ? from.Value.ToDateTime(TimeOnly.MinValue) : (DateTime?)null;
        var toDt    = to.HasValue   ? to.Value.ToDateTime(TimeOnly.MaxValue)   : (DateTime?)null;

        IEnumerable<ActivityListRow> q = ActivitiesListCache.Instance.Rows
            .Where(r => !string.IsNullOrEmpty(r.WellId));

        if (!string.IsNullOrEmpty(wellId))
            q = q.Where(r => r.WellId.Equals(wellId, StringComparison.OrdinalIgnoreCase));
        else if (!string.IsNullOrEmpty(cluster))
            q = q.Where(r => map.TryGetValue(r.ProjectId, out var info)
                && info.cluster.Equals(cluster, StringComparison.OrdinalIgnoreCase));
        if (!string.IsNullOrEmpty(site))
            q = q.Where(r => map.TryGetValue(r.ProjectId, out var info)
                && info.site.Equals(site, StringComparison.OrdinalIgnoreCase));
        if (!string.IsNullOrEmpty(wellType))
            q = q.Where(r => map.TryGetValue(r.ProjectId, out var info)
                && info.wellType.Equals(wellType, StringComparison.OrdinalIgnoreCase));
        if (fromDt.HasValue)
            q = q.Where(r => r.TargetStart >= fromDt.Value);
        if (toDt.HasValue)
            q = q.Where(r => r.TargetStart <= toDt.Value);

        var sorted = q.OrderByDescending(r => r.TargetStart).ToList();

        // If date filter left nothing, widen to all dates (show most recent regardless)
        if (sorted.Count == 0 && (fromDt.HasValue || toDt.HasValue))
        {
            IEnumerable<ActivityListRow> q2 = ActivitiesListCache.Instance.Rows
                .Where(r => !string.IsNullOrEmpty(r.WellId));
            if (!string.IsNullOrEmpty(wellId))
                q2 = q2.Where(r => r.WellId.Equals(wellId, StringComparison.OrdinalIgnoreCase));
            else if (!string.IsNullOrEmpty(cluster))
                q2 = q2.Where(r => map.TryGetValue(r.ProjectId, out var info)
                    && info.cluster.Equals(cluster, StringComparison.OrdinalIgnoreCase));
            if (!string.IsNullOrEmpty(site))
                q2 = q2.Where(r => map.TryGetValue(r.ProjectId, out var info)
                    && info.site.Equals(site, StringComparison.OrdinalIgnoreCase));
            if (!string.IsNullOrEmpty(wellType))
                q2 = q2.Where(r => map.TryGetValue(r.ProjectId, out var info)
                    && info.wellType.Equals(wellType, StringComparison.OrdinalIgnoreCase));
            sorted = q2.OrderByDescending(r => r.TargetStart).ToList();
        }

        var offset  = (page - 1) * pageSize;
        var hasMore = sorted.Count > offset + pageSize;
        var items   = sorted.Skip(offset).Take(pageSize).Select(r =>
        {
            var dispDate    = r.TargetStart;
            var dateLabel   = dispDate.ToString("dd-MMM-yy");
            var progressPct = (double)r.ProgressPct;
            var isComplete  = r.Status == "Completed";
            var isOverdue   = !isComplete && dispDate.Date < today;
            var status      = isComplete ? "Completed" : isOverdue ? "Overdue" : "Upcoming";
            int? variance   = isOverdue ? (int)(today - dispDate.Date).TotalDays : 0;
            return new CriticalDateTimelineItemDto(
                WellId:       r.WellId,
                StageItem:    r.Description,
                Assignee:     r.Assignee,
                DateLabel:    dateLabel,
                DateType:     "Forecast",
                Type:         DeriveType(r.Description),
                Status:       status,
                ProgressPct:  progressPct,
                VarianceDays: variance,
                Blockers:     null,
                Predecessor:  null);
        }).ToList();

        return new CriticalDatesTimelinePageDto(items, page, pageSize, hasMore);
    }

    private CriticalDatesTimelinePageDto BuildFromCritDatesCache(
        int page, int pageSize,
        string? cluster, string? site, string? wellId, DateOnly? from, DateOnly? to, string? wellType)
    {
        var allRows   = CritDatesCache.Instance.Rows;
        var minDate   = new DateTime(1901, 1, 2);
        var todayDate = DateTime.UtcNow.Date;

        static DateTime DispDate(CritDatesRow r, DateTime min)
        {
            if (r.ActualEnd   > min) return r.ActualEnd;
            if (r.ActualStart > min) return r.ActualStart;
            if (r.TargetStart > min) return r.TargetStart;
            return r.TargetEnd;
        }

        IEnumerable<CritDatesRow> filtered = allRows;
        if (!string.IsNullOrWhiteSpace(wellType))
            filtered = filtered.Where(r => string.Equals(r.WellType, wellType, StringComparison.OrdinalIgnoreCase));
        if (!string.IsNullOrWhiteSpace(site))
            filtered = filtered.Where(r => string.Equals(r.Site, site, StringComparison.OrdinalIgnoreCase));
        if (!string.IsNullOrWhiteSpace(wellId))
            filtered = filtered.Where(r => string.Equals(r.WellId, wellId, StringComparison.OrdinalIgnoreCase));
        else if (!string.IsNullOrWhiteSpace(cluster))
            filtered = filtered.Where(r => string.Equals(r.Cluster, cluster, StringComparison.OrdinalIgnoreCase));
        if (from.HasValue)
            filtered = filtered.Where(r => DispDate(r, minDate) >= from.Value.ToDateTime(TimeOnly.MinValue));
        if (to.HasValue)
            filtered = filtered.Where(r => DispDate(r, minDate) <= to.Value.ToDateTime(TimeOnly.MaxValue));

        var sorted  = filtered.OrderByDescending(r => DispDate(r, minDate)).ToList();
        var offset  = (page - 1) * pageSize;
        var hasMore = sorted.Count > offset + pageSize;
        var items   = sorted.Skip(offset).Take(pageSize).Select(r =>
        {
            bool Valid(DateTime d) => d > minDate;
            var isActualEnd   = Valid(r.ActualEnd);
            var isActualStart = Valid(r.ActualStart);
            DateTime? dispDate;
            string    dateType;
            if (isActualEnd)               { dispDate = r.ActualEnd;   dateType = "Actual"; }
            else if (isActualStart)        { dispDate = r.ActualStart; dateType = "Actual"; }
            else if (Valid(r.TargetStart)) { dispDate = r.TargetStart; dateType = "Forecast"; }
            else if (Valid(r.TargetEnd))   { dispDate = r.TargetEnd;   dateType = "Forecast"; }
            else                           { dispDate = null;           dateType = "Forecast"; }
            var dateLabel   = dispDate.HasValue ? dispDate.Value.ToString("dd-MMM-yy") : "-";
            var progressPct = Math.Round((double)r.Progress * 100, 1);
            var isComplete  = isActualEnd || progressPct >= 100.0;
            var isOverdue   = !isComplete && dispDate.HasValue && dispDate.Value.Date < todayDate;
            var status      = isComplete ? "Completed" : isOverdue ? "Overdue" : "Upcoming";
            int? variance   = dispDate.HasValue
                ? (isOverdue ? (int)(todayDate - dispDate.Value.Date).TotalDays : 0)
                : null;
            return new CriticalDateTimelineItemDto(
                WellId: r.WellId, StageItem: r.StageText, Assignee: r.Assignee,
                DateLabel: dateLabel, DateType: dateType, Type: DeriveType(r.StageText),
                Status: status, ProgressPct: progressPct, VarianceDays: variance,
                Blockers: null, Predecessor: null);
        }).ToList();

        return new CriticalDatesTimelinePageDto(items, page, pageSize, hasMore);
    }

        // Derive milestone type from task text keywords
    private static string DeriveType(string text)
    {
        var u = text.ToUpperInvariant();
        if (u.Contains("FLOWLINE"))                             return "Flowline";
        if (u.Contains("RIG-OFF") || u.Contains("RIG OFF"))    return "Rig-Off";
        if (u.Contains("RIG-ON")  || u.Contains("RIG ON"))     return "Rig-On";
        if (u.Contains("CONSTRUCTION"))                         return "Construction";
        if (u.Contains("ENGINEERING"))                          return "Engineering";
        if (u.Contains("COMMISSION"))                           return "Commissioning";
        if (u.Contains("LOCATION"))                             return "Location Prep";
        if (u.Contains("MILESTONE"))                            return "Milestone";
        return "Activity";
    }

    // â”€â”€â”€ Well Detail â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    public async Task<WellDetailDto?> GetWellDetailAsync(string wellId, CancellationToken ct = default)
    {
        var cacheKey = $"well-detail:{wellId}";
        if (cache.TryGetValue(cacheKey, out WellDetailDto? cached))
            return cached;

        // Fetch ALL weekly WMR rows for this well, ordered chronologically.
        // The last row = current / latest snapshot.  All rows = timeline data.
        const string sql = """
            SELECT
              w.pdo_well_id,
              w.well_name_after_spud,
              w.well_type,
              w.rig_no,
              p.[Cluster] AS cluster_id,
              w.well_location,
              w.project_id,
              w.Week_Number,
              w.northing,
              w.easting,
              w.locationdd,
              COALESCE(TRY_CAST(w.over_all_progress_percentages AS FLOAT), 0) AS prog,
              COALESCE(TRY_CAST(w.[overall_loc._preparation_10_100]  AS FLOAT), 0) AS loc_pct,
              COALESCE(TRY_CAST(w.[overall_const._10_100]            AS FLOAT), 0) AS fl_pct,
              COALESCE(TRY_CAST(w.[overall_comm_progress_100]        AS FLOAT), 0) AS comm_pct,
              COALESCE(TRY_CAST(w.ohl_progress                       AS FLOAT), 0) AS ohl_pct,
              w.[location_preparation_status_in_progress_completed]               AS loc_status,
              w.[flow_line_const._status_in_progress_completed]                   AS fl_status,
              w.[flow_line_commi._status_in_progress_completed]                   AS comm_status,
              w.flow_linedl,
              w.station_name_no,
              w.actual_rig_on_date,
              w.actual_rig_off_date,
              w.well_year_white_space,
              w.buffer_status,
              w.reasons_for_year_2018,
              w.digital_wmr_import_remarks,
              sap.sap_well_function,
              sap.sap_well_category,
              sap.sap_pcap_category,
              sap.sap_pdo_well_type,
              sap.sap_planned_start,
              sap.sap_planned_end
            FROM [dbo].[WMR] w WITH (NOLOCK)
            LEFT JOIN [dbo].[ProjectIDs] p WITH (NOLOCK) ON w.project_id = p.ID
            LEFT JOIN (
              SELECT Well_ID,
                     MAX(Well_Function)   AS sap_well_function,
                     MAX(Well_Category)   AS sap_well_category,
                     MAX(PCAP_Category)   AS sap_pcap_category,
                     MAX(PDO_Well_Type)   AS sap_pdo_well_type,
                     CONVERT(varchar(10), MIN(TRY_CAST(Earl_start_date AS DATE)), 23) AS sap_planned_start,
                     CONVERT(varchar(10), MAX(TRY_CAST(EarliestEndDate  AS DATE)), 23) AS sap_planned_end
              FROM [dbo].[SAP_DRILLING_SEQUENCE_History] WITH (NOLOCK)
              GROUP BY Well_ID
            ) sap ON w.pdo_well_id = sap.Well_ID
            WHERE w.pdo_well_id = @wellId
              AND w.pdo_well_id IS NOT NULL
              AND w.pdo_well_id <> ''
            ORDER BY
              COALESCE(
                COALESCE(TRY_CAST(w.Week_Number AS DATE), TRY_CONVERT(DATE, w.Week_Number, 5)),
                CASE WHEN w.Week_Number LIKE '[0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
                     THEN DATEFROMPARTS(
                            2000 + CAST(LEFT(w.Week_Number, 2) AS INT),
                            CAST(SUBSTRING(w.Week_Number, 4, 2) AS INT),
                            CAST(RIGHT(w.Week_Number, 2) AS INT))
                     ELSE DATEADD(WEEK, ISNULL(TRY_CAST(REPLACE(ISNULL(w.Week_Number,'W0'),'W','') AS INT), 0), '2020-01-01')
                END
              ) ASC
            """;

        var conn = db.Database.GetDbConnection();
        await OpenWithRetryAsync(conn, ct);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        cmd.CommandTimeout = 30;
        cmd.Parameters.Add(new SqlParameter("@wellId", wellId));

        static double   SafeD(object v) => v == DBNull.Value ? 0.0 : Convert.ToDouble(v);
        static string?  SafeS(object v) => v == DBNull.Value ? null : v?.ToString()?.Trim();
        static bool     SafeB(object v)
        {
            if (v is DBNull || v is null) return false;
            var s = v.ToString()?.Trim().ToUpperInvariant() ?? "";
            return s is "1" or "YES" or "TRUE" or "Y" or "READY";
        }

        // Normalises a raw Week_Number value (e.g. "2026-02-05", "26-04-06", "W15")
        // into a (sortable DateTime?, display label) pair.
        static (DateTime? dt, string label) NormaliseWeek(string? raw)
        {
            if (string.IsNullOrWhiteSpace(raw)) return (null, raw ?? "");
            var s = raw.Trim();

            // yyyy-MM-dd  (e.g. "2026-02-05")
            if (s.Length == 10 && s[4] == '-' && s[7] == '-' &&
                DateTime.TryParseExact(s, "yyyy-MM-dd",
                    System.Globalization.CultureInfo.InvariantCulture,
                    System.Globalization.DateTimeStyles.None, out var dt1))
                return (dt1, dt1.ToString("dd-MMM-yy"));

            // yy-MM-dd  (e.g. "26-04-06")
            if (s.Length == 8 && s[2] == '-' && s[5] == '-' &&
                int.TryParse(s[..2], out int yy) &&
                int.TryParse(s.Substring(3, 2), out int mm) &&
                int.TryParse(s.Substring(6, 2), out int dd))
            {
                try
                {
                    var dt2 = new DateTime(2000 + yy, mm, dd);
                    return (dt2, dt2.ToString("dd-MMM-yy"));
                }
                catch { /* invalid date parts */ }
            }

            // Generic date fallback
            if (DateTime.TryParse(s, System.Globalization.CultureInfo.InvariantCulture,
                    System.Globalization.DateTimeStyles.None, out var dt3))
                return (dt3, dt3.ToString("dd-MMM-yy"));

            // W-prefix number ("W15") â€” keep as-is, no date
            return (null, s);
        }

        await using var rdr = await cmd.ExecuteReaderAsync(ct);

        // Build timeline and capture the latest (last) row's fields
        var timelineRaw = new List<(DateTime? dt, string label, double pct)>();
        int rowCount = 0;

        // Latest-row scalars (populated / overwritten each iteration; last write wins)
        string? wellName = null;
        string? wellType = null, rigNo = null, clusterId = null, wellLocation = null, projectId = null, weekNum = null;
        string? northing = null, easting = null, locationDd = null;
        string? sapWellFunction = null, sapWellCategory = null, sapPcapCategory = null, sapPdoWellType = null;
        string? sapPlannedStart = null, sapPlannedEnd = null;
        double  prog = 0, locPct = 0, flPct = 0, commPct = 0, ohlPct = 0;
        string? locStatus = null, flStatus = null, commStatus = null;
        string? flowLineDl = null, stationName = null;
        string? rigOn = null, rigOff = null, wellYear = null, bufferStatus = null;
        string? delayReason = null, remarks = null;
        bool    infraReady = false;

        while (await rdr.ReadAsync(ct))
        {
            rowCount++;
            // Static/reference fields: keep the last non-empty value so that
            // newer WMR rows that leave these blank don't erase earlier good data.
            var _wn2 = SafeS(rdr["well_name_after_spud"]); if (!string.IsNullOrEmpty(_wn2)) wellName = _wn2;
            var _wt = SafeS(rdr["well_type"]);        if (!string.IsNullOrEmpty(_wt)) wellType = _wt;
            var _rn = SafeS(rdr["rig_no"]);           if (!string.IsNullOrEmpty(_rn)) rigNo = _rn;
            var _ci = SafeS(rdr["cluster_id"]);       if (!string.IsNullOrEmpty(_ci)) clusterId = _ci;
            var _wl = SafeS(rdr["well_location"]);    if (!string.IsNullOrEmpty(_wl)) wellLocation = _wl;
            var _sn = SafeS(rdr["station_name_no"]);  if (!string.IsNullOrEmpty(_sn)) stationName = _sn;
            var _fl = SafeS(rdr["flow_linedl"]);      if (!string.IsNullOrEmpty(_fl)) flowLineDl = _fl;
            var _nr = SafeS(rdr["northing"]);         if (!string.IsNullOrEmpty(_nr)) northing = _nr;
            var _ea = SafeS(rdr["easting"]);          if (!string.IsNullOrEmpty(_ea)) easting = _ea;
            var _ld = SafeS(rdr["locationdd"]);       if (!string.IsNullOrEmpty(_ld)) locationDd = _ld;
            var _ry = SafeS(rdr["actual_rig_on_date"]); if (!string.IsNullOrEmpty(_ry)) rigOn = _ry;
            var _rf = SafeS(rdr["actual_rig_off_date"]); if (!string.IsNullOrEmpty(_rf)) rigOff = _rf;
            var _wy = SafeS(rdr["well_year_white_space"]); if (!string.IsNullOrEmpty(_wy)) wellYear = _wy;
            var _bs = SafeS(rdr["buffer_status"]);    if (!string.IsNullOrEmpty(_bs)) bufferStatus = _bs;
            // Always-update fields: progress values and status come from the latest row
            projectId   = SafeS(rdr["project_id"]);
            weekNum     = SafeS(rdr["Week_Number"]);
            prog        = SafeD(rdr["prog"]);
            locPct      = SafeD(rdr["loc_pct"]);
            flPct       = SafeD(rdr["fl_pct"]);
            commPct     = SafeD(rdr["comm_pct"]);
            ohlPct      = SafeD(rdr["ohl_pct"]);
            var _ls = SafeS(rdr["loc_status"]);   if (!string.IsNullOrEmpty(_ls)) locStatus = _ls;
            var _fs = SafeS(rdr["fl_status"]);    if (!string.IsNullOrEmpty(_fs)) flStatus = _fs;
            var _cs = SafeS(rdr["comm_status"]);  if (!string.IsNullOrEmpty(_cs)) commStatus = _cs;
            var _dr = SafeS(rdr["reasons_for_year_2018"]); if (!string.IsNullOrEmpty(_dr)) delayReason = _dr;
            var _rm = SafeS(rdr["digital_wmr_import_remarks"]); if (!string.IsNullOrEmpty(_rm)) remarks = _rm;
            // SAP classification fields â€” same value across all WMR rows for this well
            var _wf = SafeS(rdr["sap_well_function"]);  if (!string.IsNullOrEmpty(_wf)) sapWellFunction = _wf;
            var _wc = SafeS(rdr["sap_well_category"]);  if (!string.IsNullOrEmpty(_wc)) sapWellCategory = _wc;
            var _pc = SafeS(rdr["sap_pcap_category"]);  if (!string.IsNullOrEmpty(_pc)) sapPcapCategory = _pc;
            var _pt = SafeS(rdr["sap_pdo_well_type"]);  if (!string.IsNullOrEmpty(_pt)) sapPdoWellType = _pt;
            var _ps = SafeS(rdr["sap_planned_start"]); if (!string.IsNullOrEmpty(_ps)) sapPlannedStart = _ps;
            var _pe = SafeS(rdr["sap_planned_end"]);   if (!string.IsNullOrEmpty(_pe)) sapPlannedEnd   = _pe;
            infraReady  = false; // column not present in WMR table

            if (!string.IsNullOrEmpty(weekNum))
            {
                var (dt, label) = NormaliseWeek(weekNum);
                timelineRaw.Add((dt, label, Math.Round(prog * 100, 1)));
            }
        }

        if (rowCount == 0) return null;

        // Sort by parsed date (SQL ORDER BY handles it; this is a safety net for mixed formats),
        // then deduplicate by label keeping last value per week.
        var timeline = timelineRaw
            .OrderBy(t => t.dt ?? DateTime.MaxValue)
            .ThenBy(t => t.label)
            .GroupBy(t => t.label)
            .Select(g => g.Last())
            .Select(t => new WellProgressSnapshotDto(t.label, t.pct))
            .ToList();

        // Derive status from latest (last) row's data
        var today      = DateOnly.FromDateTime(DateTime.UtcNow);
        var rigOnDate  = TryParseDateOnly(rigOn);
        var rigOffDate = TryParseDateOnly(rigOff);
        string status;
        if (prog >= 0.95)
            status = "completed";
        else if (rigOnDate.HasValue && rigOnDate.Value <= today &&
                 (!rigOffDate.HasValue || rigOffDate.Value >= today))
            status = flStatus == "Completed" ? "early" : "inprogress";
        else if (rigOffDate.HasValue && rigOffDate.Value < today)
            status = "onhold";
        else
            status = "planned";

        // For completed wells, distinguish "Not Due Accelerated" (finished before its SAP
        // planned start — i.e. ahead of the rig sequence) from "Due Completed". Same rule
        // used for ODC status / Wells Readiness elsewhere in the app.
        string? completionCategory = null;
        if (status == "completed")
        {
            var planStart   = TryParseDateOnly(sapPlannedStart);
            var latestWeekDt = NormaliseWeek(weekNum).dt;
            completionCategory = (planStart.HasValue && latestWeekDt.HasValue
                                  && DateOnly.FromDateTime(latestWeekDt.Value) < planStart.Value)
                ? "Not Due Accelerated"
                : "Due Completed";
        }

        // Compute activity-based overall progress from TaskPlanCSVImport
        // = completed_activities / total_activities (bottom-up from actual data)
        // If no TaskPlanCSVImport data exists, progress = 0 (not started)
        double activityBasedProgress = 0; // 0 if no activity data found
        try
        {
            const string actProgSql = """
                SELECT
                    COUNT(DISTINCT CAST(code AS NVARCHAR(100))) AS total,
                    COUNT(DISTINCT CASE
                        WHEN actual_end IS NOT NULL
                             OR TRY_CONVERT(DECIMAL(10,4), progress) >= 1.0
                        THEN CAST(code AS NVARCHAR(100))
                    END) AS completed
                FROM [dbo].[TaskPlanCSVImport] WITH (NOLOCK)
                WHERE CAST(type AS NVARCHAR(10)) = 'A'
                  AND CAST(Well_ID AS NVARCHAR(50)) = @wid
                """;
            await using var actConn = new SqlConnection(db.Database.GetConnectionString()!);
            await OpenWithRetryAsync(actConn, ct);
            await using var actCmd = new SqlCommand(actProgSql, actConn) { CommandTimeout = 10 };
            actCmd.Parameters.Add("@wid", System.Data.SqlDbType.NVarChar, 50).Value = wellId;
            await using var actRdr = await actCmd.ExecuteReaderAsync(ct);
            if (await actRdr.ReadAsync(ct))
            {
                var total = actRdr.GetInt32(0);
                var completed = actRdr.GetInt32(1);
                if (total > 0)
                    activityBasedProgress = (double)completed / total;
            }
        }
        catch { /* fall back to WMR prog */ }

        // ── Compute Variance, Rate/Day, Ask Rate from activity averages ──
        // Norms Rate = qty / (manhours/8), Current Rate = qtyactual / days_completed,
        // Asking Rate = qty_remaining / days_remaining (per activity, then averaged)
        // Variance = avg(Asking Rate) - avg(Norms Rate)
        double? variance = null, ratePerDay = null, askRate = null, normsRateAvg = null, plannedPctVal = null;
        try
        {
            const string ratesSql = """
                SELECT
                    AVG(norms_rate)   AS avg_norms_rate,
                    AVG(current_rate) AS avg_current_rate,
                    AVG(asking_rate)  AS avg_asking_rate
                FROM (
                    SELECT
                        -- Norms Rate = qty / (manhours / 8)
                        TRY_CONVERT(DECIMAL(18,4), act.qty)
                            / NULLIF(TRY_CONVERT(DECIMAL(18,4), act.manhours) / 8.0, 0)
                            AS norms_rate,
                        -- Current Rate = qtyactual / days_completed
                        CASE WHEN act.actual_start IS NOT NULL
                                  AND DATEDIFF(DAY, TRY_CONVERT(DATE, act.actual_start), CAST(GETDATE() AS DATE)) > 0
                             THEN TRY_CONVERT(DECIMAL(18,4), act.qtyactual)
                                  / CAST(DATEDIFF(DAY, TRY_CONVERT(DATE, act.actual_start), CAST(GETDATE() AS DATE)) AS DECIMAL(18,4))
                             ELSE NULL END AS current_rate,
                        -- Asking Rate = qty_remaining / days_remaining
                        CASE WHEN act.actual_start IS NOT NULL
                                  AND act.actual_end IS NULL
                                  AND DATEDIFF(DAY, CAST(GETDATE() AS DATE),
                                      DATEADD(DAY, CEILING(TRY_CONVERT(DECIMAL(18,4), act.manhours) / 8.0),
                                          TRY_CONVERT(DATE, act.actual_start))) > 0
                             THEN (TRY_CONVERT(DECIMAL(18,4), act.qty) - ISNULL(TRY_CONVERT(DECIMAL(18,4), act.qtyactual), 0))
                                  / CAST(DATEDIFF(DAY, CAST(GETDATE() AS DATE),
                                      DATEADD(DAY, CEILING(TRY_CONVERT(DECIMAL(18,4), act.manhours) / 8.0),
                                          TRY_CONVERT(DATE, act.actual_start))) AS DECIMAL(18,4))
                             ELSE NULL END AS asking_rate
                    FROM [dbo].[TaskPlanCSVImport] act WITH (NOLOCK)
                    WHERE CAST(act.type AS NVARCHAR(10)) = 'A'
                      AND CAST(act.Well_ID AS NVARCHAR(50)) = @wid
                      AND act.actual_start IS NOT NULL
                      AND DATEDIFF(DAY, TRY_CONVERT(DATE, act.actual_start), CAST(GETDATE() AS DATE)) > 0
                ) rates
                """;
            await using var ratesConn = new SqlConnection(db.Database.GetConnectionString()!);
            await OpenWithRetryAsync(ratesConn, ct);
            await using var ratesCmd = new SqlCommand(ratesSql, ratesConn) { CommandTimeout = 10 };
            ratesCmd.Parameters.Add("@wid", System.Data.SqlDbType.NVarChar, 50).Value = wellId;
            await using var ratesRdr = await ratesCmd.ExecuteReaderAsync(ct);
            if (await ratesRdr.ReadAsync(ct))
            {
                double? avgNorms   = ratesRdr.IsDBNull(0) ? null : Math.Round(Convert.ToDouble(ratesRdr.GetValue(0)), 2);
                double? avgCurrent = ratesRdr.IsDBNull(1) ? null : Math.Round(Convert.ToDouble(ratesRdr.GetValue(1)), 2);
                double? avgAsking  = ratesRdr.IsDBNull(2) ? null : Math.Round(Convert.ToDouble(ratesRdr.GetValue(2)), 2);

                ratePerDay = avgCurrent;  // Rate/Day = avg current rate
                askRate    = avgAsking;   // Ask Rate = avg asking rate
                normsRateAvg = avgNorms;  // Norms Rate = avg planned rate
                if (avgCurrent.HasValue && avgAsking.HasValue)
                    variance = Math.Round(avgCurrent.Value - avgAsking.Value, 2);  // Variance = current - asking
            }
        }
        catch { /* rates unavailable if no TaskPlanCSVImport data */ }

        // Planned % from SAP schedule (for the progress card target)
        var sapStart = TryParseDateOnly(sapPlannedStart);
        var sapEnd   = TryParseDateOnly(sapPlannedEnd);
        if (sapStart.HasValue && sapEnd.HasValue)
        {
            int totalDays = sapEnd.Value.DayNumber - sapStart.Value.DayNumber;
            if (totalDays > 0)
            {
                int elapsedDays = today.DayNumber - sapStart.Value.DayNumber;
                double plannedFraction = Math.Clamp((double)elapsedDays / totalDays, 0.0, 1.0);
                plannedPctVal = Math.Round(plannedFraction * 100, 2);
            }
        }

        var dto = new WellDetailDto(
            WellId:               wellId,
            WellName:             wellName,
            PdoWellId:            wellId,
            WellType:             wellType,
            RigNo:                rigNo,
            ClusterId:            clusterId,
            WellFunction:         sapWellFunction,
            WellCategory:         sapWellCategory,
            PcapCategory:         sapPcapCategory,
            PdoWellType:          sapPdoWellType,
            SapPlannedStart:      sapPlannedStart,
            SapPlannedEnd:        sapPlannedEnd,
            WellLocation:         wellLocation,
            ProjectId:            projectId,
            WeekNumber:           weekNum,
            Northing:             northing,
            Easting:              easting,
            LocationDd:           locationDd,
            OverallProgressPct:   Math.Round(activityBasedProgress * 100, 1),
            LocPrepPct:           Math.Round(locPct  * 100, 1),
            ConstructionPct:      Math.Round(flPct   * 100, 1),
            CommissioningPct:     Math.Round(commPct * 100, 1),
            OhlPct:               Math.Round(ohlPct  * 100, 1),
            LocPrepStatus:        locStatus,
            FlConstructionStatus: flStatus,
            FlCommissioningStatus:commStatus,
            FlowLineDl:           flowLineDl,
            StationName:          stationName,
            RigOnDate:            rigOn,
            RigOffDate:           rigOff,
            WellYear:             wellYear,
            BufferStatus:         bufferStatus,
            IsDelayed:            !string.IsNullOrWhiteSpace(delayReason),
            DelayReason:          delayReason,
            InfraReadyFlag:       infraReady,
            Remarks:              remarks,
            Status:               status,
            Timeline:             timeline,
            Variance:             variance,
            RatePerDay:           ratePerDay,
            AskRate:              askRate,
            NormsRate:            normsRateAvg,
            PlannedPct:           plannedPctVal,
            CompletionCategory:   completionCategory
        );

        cache.Set(cacheKey, dto, TimeSpan.FromMinutes(3));
        return dto;
    }

    private static DateOnly? TryParseDateOnly(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return null;
        if (DateOnly.TryParse(s, out var d) && d.Year > 1900 && d.Year < 2100) return d;
        if (DateTime.TryParse(s, out var dt) && dt.Year > 1900 && dt.Year < 2100)
            return DateOnly.FromDateTime(dt);
        return null;
    }

    // Well Planner 

    public async Task<WellPlannerResponseDto> GetWellPlannerAsync(
        string? cluster,
        string? wellId,
        DateOnly? from,
        DateOnly? to,
        CancellationToken ct = default)
    {
        var today  = DateTime.UtcNow.Date;
        var fromDt = (from ?? DateOnly.FromDateTime(today.AddDays(-14))).ToDateTime(TimeOnly.MinValue);
        var toDt   = (to   ?? DateOnly.FromDateTime(today.AddDays(14))).ToDateTime(TimeOnly.MaxValue);

        var cacheKey = $"well-planner:{cluster}:{wellId}:{fromDt:yyyyMMdd}:{toDt:yyyyMMdd}";
        if (cache.TryGetValue(cacheKey, out WellPlannerResponseDto? cached) && cached is not null)
            return cached;

        var extraWhere = "";
        if (!string.IsNullOrWhiteSpace(wellId))  extraWhere += " AND w.pdo_well_id = @wellId";
        if (!string.IsNullOrWhiteSpace(cluster)) extraWhere += " AND w.station_name_no LIKE @cluster";

        // â”€â”€ Step 1: get active wells in window (cap at 50 to keep SAP batch fast) â”€â”€
        var wellsSql = $"""
            SELECT TOP 50
                   w.pdo_well_id,
                   w.station_name_no,
                   CONVERT(varchar(10), TRY_CAST(w.actual_rig_on_date  AS DATE), 23) AS rig_on,
                   CONVERT(varchar(10), TRY_CAST(w.actual_rig_off_date AS DATE), 23) AS rig_off
            FROM [dbo].[WMR] w WITH (NOLOCK)
            INNER JOIN (
                SELECT pdo_well_id, MAX(Week_Number) AS max_wk
                FROM [dbo].[WMR] WITH (NOLOCK)
                WHERE pdo_well_id IS NOT NULL AND pdo_well_id <> ''
                GROUP BY pdo_well_id
            ) lts ON w.pdo_well_id = lts.pdo_well_id AND w.Week_Number = lts.max_wk
            WHERE w.pdo_well_id IS NOT NULL AND w.pdo_well_id <> ''
              AND TRY_CAST(w.actual_rig_on_date AS DATE) <= @toDate
              AND (w.actual_rig_off_date IS NULL
                   OR TRY_CAST(w.actual_rig_off_date AS DATE) >= @fromDate)
              {extraWhere}
            ORDER BY TRY_CAST(w.actual_rig_on_date AS DATE) DESC;
            """;

        var connStr = db.Database.GetConnectionString()!;
        await using var conn = new SqlConnection(connStr);
        await OpenWithRetryAsync(conn, ct);

        var wellMetas = new List<(string Id, string? Project, string? RigOn, string? RigOff)>();
        await using (var cmd = new SqlCommand(wellsSql, conn))
        {
            cmd.CommandTimeout = 30;
            cmd.Parameters.AddWithValue("@fromDate", fromDt);
            cmd.Parameters.AddWithValue("@toDate",   toDt);
            if (!string.IsNullOrWhiteSpace(wellId))  cmd.Parameters.AddWithValue("@wellId",  wellId);
            if (!string.IsNullOrWhiteSpace(cluster)) cmd.Parameters.AddWithValue("@cluster", $"%{cluster}%");

            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
                wellMetas.Add((rdr.GetString(0),
                               rdr.IsDBNull(1) ? null : rdr.GetString(1),
                               rdr.IsDBNull(2) ? null : rdr.GetString(2),
                               rdr.IsDBNull(3) ? null : rdr.GetString(3)));
        }

        if (wellMetas.Count == 0)
        {
            var empty = new WellPlannerResponseDto(Array.Empty<WellPlannerWellDto>());
            cache.Set(cacheKey, empty, TimeSpan.FromMinutes(2));
            return empty;
        }

        // â”€â”€ Step 2: SAP activities for those wells (SAP has Well_ID index) â”€â”€
        // Build IN list from server-validated IDs â€” not user input.
        var idList = string.Join(",", wellMetas.Select(w => $"'{w.Id.Replace("'", "''")}'"));

        var sapByWell = new Dictionary<string, List<(string Activity, string? SStart, string? SEnd,
            string? WorkCenter, string? SysStatus)>>(StringComparer.OrdinalIgnoreCase);

        try
        {
            var sapSql = $"""
                SELECT s.Well_ID,
                       s.Activity,
                       CONVERT(varchar(10), TRY_CAST(s.Earl_start_date AS DATE), 23) AS s_start,
                       CONVERT(varchar(10), TRY_CAST(s.EarliestEndDate  AS DATE), 23) AS s_end,
                       s.Work_Center,
                       s.Opr_System_status
                FROM [dbo].[SAP_DRILLING_SEQUENCE_History] s WITH (NOLOCK)
                WHERE s.Well_ID IN ({idList})
                  AND s.Activity IS NOT NULL AND s.Activity <> ''
                  AND s.Well_Function NOT IN ('Unspecified','RIG MOVE','RIG MAINTENANCE')
                ORDER BY s.Well_ID, s.Earl_start_date;
                """;

            await using var cmd = new SqlCommand(sapSql, conn);
            cmd.CommandTimeout = 30;
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
            {
                var wid = rdr.GetString(0);
                if (!sapByWell.TryGetValue(wid, out var list))
                {
                    list = new List<(string, string?, string?, string?, string?)>();
                    sapByWell[wid] = list;
                }
                list.Add((rdr.IsDBNull(1) ? "" : rdr.GetString(1),
                          rdr.IsDBNull(2) ? null : rdr.GetString(2),
                          rdr.IsDBNull(3) ? null : rdr.GetString(3),
                          rdr.IsDBNull(4) ? null : rdr.GetString(4),
                          rdr.IsDBNull(5) ? null : rdr.GetString(5)));
            }
        }
        catch (SqlException) { /* SAP unavailable â€” wells still returned without activities */ }

        // â”€â”€ Step 3: build output â”€â”€
        var wells = new List<WellPlannerWellDto>(wellMetas.Count);
        foreach (var (wid, project, rigOn, rigOff) in wellMetas)
        {
            var wellStatus = DeriveWellStatus(rigOn, rigOff, today);
            var milestones = sapByWell.TryGetValue(wid, out var sapRows) && sapRows.Count > 0
                ? BuildMilestonesFromSap(sapRows, today)
                : new List<WellPlannerMilestoneDto>();

            wells.Add(new WellPlannerWellDto(wid, project, rigOn, rigOff, wellStatus, milestones));
        }

        var result = new WellPlannerResponseDto(wells);
        cache.Set(cacheKey, result, TimeSpan.FromMinutes(3));
        return result;
    }

    // â”€â”€ Well Planner helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    private static string DeriveWellStatus(string? rigOn, string? rigOff, DateTime today)
    {
        if (!DateTime.TryParse(rigOn, out var on) || on.Year < 1990) return "planned";
        if (on > today) return "planned";
        if (rigOff is not null && DateTime.TryParse(rigOff, out var off) && off < today) return "completed";
        return "inprogress";
    }

    private static string DerivePhase(string? text)
    {
        var u = (text ?? "").ToUpperInvariant().Trim();
        if (u.Contains("HANDOVER")) return "handover";
        if (u.Contains("HOOK UP") || u.Contains("HOOKUP") || u.Contains("COMMISSION")) return "hookup";
        if (u.Contains("FLOWLINE") || u.Contains("FLOW LINE"))
        {
            var isFinish = u.Contains("FINISH") || u.Contains("COMPLETE") || u.Contains("END")
                        || u.Contains("FINAL") || u.Contains("CLOSE");
            return isFinish ? "flowline-finish" : "flowline-start";
        }
        if (u.Contains("WELDING") || u.Contains("WELD")) return "flowline-start";
        if (u.Contains("CIVIL")   || u.Contains("EXCAVAT") || u.Contains("PAD")
            || u.Contains("LOCATION") || u.Contains("CONSTRUCTION") || u.Contains("LAYING")) return "flowline-start";
        if (u.Contains("RIGGING") || u.Contains("LIFTING")) return "hookup";
        return "other";
    }

    private static string DeriveCat(string? crewType, string? text)
    {
        var ct = (crewType ?? "").ToUpperInvariant();
        var at = (text ?? "").ToUpperInvariant();
        if (ct.StartsWith("WLD") || ct.StartsWith("FWP") || at.Contains("WELD")) return "welding";
        if (ct.StartsWith("CIV") || ct.StartsWith("FCV") || ct.StartsWith("FCP")
            || at.Contains("CIVIL") || at.Contains("EXCAVAT") || at.Contains("PAD")
            || at.Contains("LAYING") || at.Contains("SLEEPER")) return "civil";
        if (ct.StartsWith("RIG") || ct.StartsWith("FRL") || ct.StartsWith("YWS")
            || at.Contains("RIGGING") || at.Contains("LIFTING") || at.Contains("RIG UP")) return "rigging";
        return "other";
    }

    private static string DeriveActivityStatus(double prog, string? aStart, string? aEnd,
        string? crew, string? tStart, DateTime today)
    {
        var isComplete = prog >= 0.99
            || (aEnd is not null && DateTime.TryParse(aEnd, out var ae) && ae.Year > 2000);
        if (isComplete) return "completed";

        var hasActualStart = aStart is not null && DateTime.TryParse(aStart, out var as2) && as2.Year > 2000;
        if (hasActualStart || prog > 0) return "inprogress";

        if (string.IsNullOrWhiteSpace(crew)) return "unassigned";
        return "planned";
    }

    private static List<WellPlannerMilestoneDto> BuildMilestonesFromAtp(
        List<(int RowId, string Text, string? TStart, string? TEnd,
              string? AStart, string? AEnd, double Prog, string? CrewType, string? Parent)> rows,
        DateTime today)
    {
        // Group by Parent column if populated; otherwise derive phase from text.
        // Rows where parent IS NULL / blank may themselves be milestone headers (type = Milestone).
        var milestoneDict = new Dictionary<string, List<(string Text, string? TStart, string? TEnd,
            string? AStart, string? AEnd, double Prog, string? CrewType)>>(StringComparer.OrdinalIgnoreCase);

        // Phase-header candidates: rows whose derived phase â‰  "other" AND have no parent.
        // Activity candidates: everything else.
        string currentMs = "Activities"; // fallback bucket
        foreach (var row in rows.OrderBy(r => r.RowId))
        {
            var parentKey = !string.IsNullOrWhiteSpace(row.Parent) ? row.Parent.Trim() : null;

            if (parentKey is not null)
            {
                // Child activity â€” use parent as the milestone key
                if (!milestoneDict.ContainsKey(parentKey))
                    milestoneDict[parentKey] = new();
                milestoneDict[parentKey].Add((row.Text, row.TStart, row.TEnd, row.AStart, row.AEnd, row.Prog, row.CrewType));
            }
            else
            {
                // No parent â€” check if this is a milestone header or an activity
                var phase = DerivePhase(row.Text);
                if (phase != "other" || row.Text.ToUpperInvariant().Contains("MILESTONE"))
                {
                    currentMs = row.Text.Trim();
                    if (!milestoneDict.ContainsKey(currentMs))
                        milestoneDict[currentMs] = new();
                }
                else
                {
                    // Treat as activity under current milestone
                    if (!milestoneDict.ContainsKey(currentMs))
                        milestoneDict[currentMs] = new();
                    milestoneDict[currentMs].Add((row.Text, row.TStart, row.TEnd, row.AStart, row.AEnd, row.Prog, row.CrewType));
                }
            }
        }

        var result = new List<WellPlannerMilestoneDto>();
        foreach (var (msName, acts) in milestoneDict)
        {
            var phase = DerivePhase(msName);
            var activities = acts.Select(a => new WellPlannerActivityDto(
                Name:   a.Text,
                Cat:    DeriveCat(a.CrewType, a.Text),
                From:   a.TStart,
                To:     a.TEnd,
                Crew:   string.IsNullOrWhiteSpace(a.CrewType) ? null : a.CrewType.Trim(),
                Status: DeriveActivityStatus(a.Prog, a.AStart, a.AEnd, a.CrewType, a.TStart, today)
            )).ToList();

            // Milestone date = span of its activities
            var from = activities.Select(a => a.From).Where(d => d is not null)
                           .OrderBy(d => d).FirstOrDefault();
            var toMs = activities.Select(a => a.To).Where(d => d is not null)
                           .OrderByDescending(d => d).FirstOrDefault();

            result.Add(new WellPlannerMilestoneDto(msName, phase, from, toMs, activities));
        }

        // Reorder milestones by their start date
        return result.OrderBy(m => m.From ?? "9999").ToList();
    }

    private static List<WellPlannerMilestoneDto> BuildMilestonesFromSap(
        List<(string Activity, string? SStart, string? SEnd, string? WorkCenter, string? SysStatus)> rows,
        DateTime today)
    {
        var msDict = new Dictionary<string, List<(string Activity, string? SStart, string? SEnd,
            string? WorkCenter, string? SysStatus)>>(StringComparer.OrdinalIgnoreCase);

        foreach (var row in rows)
        {
            var phase = DerivePhase(row.Activity);
            var msKey = phase switch
            {
                "flowline-start"  => "Flowline Start",
                "flowline-finish" => "Flowline Finish",
                "hookup"          => "Hook Up",
                "handover"        => "Handover",
                _                 => "Activities"
            };
            if (!msDict.ContainsKey(msKey)) msDict[msKey] = new();
            msDict[msKey].Add(row);
        }

        var result = new List<WellPlannerMilestoneDto>();
        foreach (var (msName, acts) in msDict)
        {
            var phase = DerivePhase(msName);
            var activities = acts.Select(a =>
            {
                var status = a.SysStatus?.ToUpperInvariant() switch
                {
                    var s when s is not null && (s.Contains("TECO") || s.Contains("CLSD")) => "completed",
                    var s when s is not null && s.Contains("REL") => "inprogress",
                    _ => string.IsNullOrWhiteSpace(a.WorkCenter) ? "unassigned" : "planned"
                };
                return new WellPlannerActivityDto(
                    Name:   a.Activity,
                    Cat:    DeriveCat(a.WorkCenter, a.Activity),
                    From:   a.SStart,
                    To:     a.SEnd,
                    Crew:   string.IsNullOrWhiteSpace(a.WorkCenter) ? null : a.WorkCenter.Trim(),
                    Status: status
                );
            }).ToList();

            var from = activities.Select(a => a.From).Where(d => d is not null).OrderBy(d => d).FirstOrDefault();
            var toMs = activities.Select(a => a.To).Where(d => d is not null).OrderByDescending(d => d).FirstOrDefault();
            result.Add(new WellPlannerMilestoneDto(msName, phase, from, toMs, activities));
        }

        return result.OrderBy(m => m.From ?? "9999").ToList();
    }

    // Workload Analysis 

    public async Task<WorkloadAnalysisResponse> GetWorkloadAnalysisAsync(
        DateOnly from,
        DateOnly to,
        string? cluster = null,
        string? wellId = null,
        string? project = null,
        CancellationToken ct = default)
    {
        var cacheKey = $"workload-analysis:{from}:{to}:{cluster}:{wellId}:{project}";
        if (cache.TryGetValue(cacheKey, out WorkloadAnalysisResponse? cached) && cached is not null)
            return cached;

        var fromDt = from.ToDateTime(TimeOnly.MinValue);
        var toDt = to.ToDateTime(TimeOnly.MinValue);
        var rangeDays = (toDt - fromDt).Days;

        // forecastCutoff = data logic (which wells to count as actual vs planned)
        var forecastCutoff = new DateTime(DateTime.UtcNow.Year, DateTime.UtcNow.Month, 1);
        // displayCutoff = visual only (solid vs dashed); no dashing for purely historical ranges
        var displayCutoff = toDt <= DateTime.UtcNow.Date
            ? new DateTime(9999, 1, 1)
            : forecastCutoff;

        // Auto-detect granularity: day-level for short ranges (<=14 days), month-level otherwise
        string sql;
        if (rangeDays <= 14)
        {
            sql = """
            WITH Buckets AS (
                SELECT
                    DATEADD(DAY, n, @fromDate) AS StartDt,
                    DATEADD(DAY, n + 1, @fromDate) AS EndDt,
                    FORMAT(DATEADD(DAY, n, @fromDate), 'dd MMM') AS ReportMonth,
                    n AS BucketKey
                FROM (
                    SELECT TOP (DATEDIFF(DAY, @fromDate, @toDate) + 1)
                        ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) - 1 AS n
                    FROM sys.objects
                ) nums
            ),
            ClusterLookup AS (
                SELECT
                    ID AS ProjectId,
                    UPPER(LTRIM(RTRIM([Cluster]))) AS ClusterName
                FROM [dbo].[ProjectIDs]
                WHERE [Cluster] IS NOT NULL AND LTRIM(RTRIM([Cluster])) <> ''
                  AND (@project IS NULL OR LTRIM(RTRIM([Project])) = @project)
            ),
            Clusters AS (
                SELECT 'MARMUL' AS ClusterName
                UNION ALL
                SELECT 'NIMR'
            ),
            BucketCluster AS (
                SELECT b.BucketKey, b.ReportMonth, b.StartDt, b.EndDt, c.ClusterName
                FROM Buckets b
                CROSS JOIN Clusters c
            ),
            SapWells AS (
                SELECT
                    sap.[Well_ID],
                    cl.ClusterName,
                    MIN(sap.[EarliestEndDate]) AS EarliestEndDate,
                    DATEDIFF(DAY, @fromDate, CAST(MIN(sap.[EarliestEndDate]) AS DATE)) AS BucketKey
                FROM [dbo].[SAP_DRILLING_SEQUENCE_History] sap WITH (NOLOCK)
                INNER JOIN [dbo].[WMR] w WITH (NOLOCK)
                    ON w.pdo_well_id = sap.[Well_ID]
                INNER JOIN ClusterLookup cl
                    ON cl.ProjectId = w.project_id
                WHERE sap.[Well_Category] = 'Development'
                  AND sap.[Well_Name] NOT LIKE 'RIG M%'
                  AND sap.[Well_Name] NOT LIKE 'RAMADAN%'
                  AND sap.[EarliestEndDate] >= @fromDate
                  AND sap.[EarliestEndDate] <= @toDate
                  AND cl.ClusterName IN ('NIMR', 'MARMUL')
                  AND (@cluster IS NULL OR cl.ClusterName = UPPER(@cluster))
                  AND (@wellId IS NULL OR sap.[Well_ID] = @wellId)
                GROUP BY sap.[Well_ID], cl.ClusterName
            ),
            WmrProgress AS (
                SELECT w.pdo_well_id,
                       MAX(COALESCE(TRY_CAST(w.over_all_progress_percentages AS FLOAT), 0)) AS Progress
                FROM [dbo].[WMR] w WITH (NOLOCK)
                INNER JOIN (SELECT DISTINCT [Well_ID] FROM SapWells) sw ON w.pdo_well_id = sw.[Well_ID]
                WHERE w.pdo_well_id IS NOT NULL AND w.pdo_well_id <> ''
                GROUP BY w.pdo_well_id
            ),
            WellStatus AS (
                SELECT
                    sw.ClusterName,
                    CASE
                        WHEN sw.[EarliestEndDate] < @forecastCutoff
                             AND COALESCE(wp.Progress, 0) >= 1
                        THEN sw.BucketKey
                        WHEN sw.[EarliestEndDate] >= @forecastCutoff
                             AND COALESCE(wp.Progress, 0) < 1
                        THEN sw.BucketKey
                        ELSE NULL
                    END AS BucketKey
                FROM SapWells sw
                LEFT JOIN WmrProgress wp ON wp.pdo_well_id = sw.[Well_ID]
            ),
            CompletedAgg AS (
                SELECT ClusterName, BucketKey, COUNT(*) AS CompletedCount
                FROM WellStatus
                WHERE BucketKey IS NOT NULL
                GROUP BY ClusterName, BucketKey
            ),
            DrilledAgg AS (
                SELECT BucketKey, COUNT(*) AS DrilledCount
                FROM WellStatus
                WHERE BucketKey IS NOT NULL
                GROUP BY BucketKey
            )
            SELECT
                bc.ReportMonth,
                bc.ClusterName,
                ISNULL(ca.CompletedCount, 0) AS CompletedCount,
                ISNULL(da.DrilledCount, 0) AS TotalDrilled,
                CASE WHEN bc.StartDt >= @displayCutoff THEN 1 ELSE 0 END AS IsForecast,
                bc.BucketKey AS MonthNum,
                bc.StartDt AS PeriodStart,
                CASE WHEN DATEADD(DAY, -1, bc.EndDt) > @toDate THEN @toDate ELSE DATEADD(DAY, -1, bc.EndDt) END AS PeriodEnd
            FROM BucketCluster bc
            LEFT JOIN CompletedAgg ca ON ca.ClusterName = bc.ClusterName AND ca.BucketKey = bc.BucketKey
            LEFT JOIN DrilledAgg da ON da.BucketKey = bc.BucketKey
            ORDER BY bc.BucketKey, bc.ClusterName
            """;
        }
        else
        {
            sql = """
            WITH Months AS (
                SELECT
                    DATEADD(MONTH, n, @fromDate) AS StartDt,
                    DATEADD(MONTH, n + 1, @fromDate) AS EndDt,
                    LEFT(DATENAME(MONTH, DATEADD(MONTH, n, @fromDate)), 3)
                        + '''' + RIGHT(CAST(YEAR(DATEADD(MONTH, n, @fromDate)) AS VARCHAR(4)), 2) AS ReportMonth,
                    MONTH(DATEADD(MONTH, n, @fromDate)) AS MonthNum
                FROM (
                    SELECT TOP (DATEDIFF(MONTH, @fromDate, @toDate) + 1)
                        ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) - 1 AS n
                    FROM sys.objects
                ) nums
            ),
            ClusterLookup AS (
                SELECT
                    ID AS ProjectId,
                    UPPER(LTRIM(RTRIM([Cluster]))) AS ClusterName
                FROM [dbo].[ProjectIDs]
                WHERE [Cluster] IS NOT NULL AND LTRIM(RTRIM([Cluster])) <> ''
                  AND (@project IS NULL OR LTRIM(RTRIM([Project])) = @project)
            ),
            Clusters AS (
                SELECT 'MARMUL' AS ClusterName
                UNION ALL
                SELECT 'NIMR'
            ),
            MonthCluster AS (
                SELECT m.MonthNum, m.ReportMonth, m.StartDt, m.EndDt, c.ClusterName
                FROM Months m
                CROSS JOIN Clusters c
            ),
            SapWells AS (
                SELECT
                    sap.[Well_ID],
                    cl.ClusterName,
                    MIN(sap.[EarliestEndDate]) AS EarliestEndDate,
                    MONTH(MIN(sap.[EarliestEndDate])) AS MonthNum
                FROM [dbo].[SAP_DRILLING_SEQUENCE_History] sap WITH (NOLOCK)
                INNER JOIN [dbo].[WMR] w WITH (NOLOCK)
                    ON w.pdo_well_id = sap.[Well_ID]
                INNER JOIN ClusterLookup cl
                    ON cl.ProjectId = w.project_id
                WHERE sap.[Well_Category] = 'Development'
                  AND sap.[Well_Name] NOT LIKE 'RIG M%'
                  AND sap.[Well_Name] NOT LIKE 'RAMADAN%'
                  AND sap.[EarliestEndDate] >= @fromDate
                  AND sap.[EarliestEndDate] <= @toDate
                  AND cl.ClusterName IN ('NIMR', 'MARMUL')
                  AND (@cluster IS NULL OR cl.ClusterName = UPPER(@cluster))
                  AND (@wellId IS NULL OR sap.[Well_ID] = @wellId)
                GROUP BY sap.[Well_ID], cl.ClusterName
            ),
            WmrProgress AS (
                SELECT w.pdo_well_id,
                       MAX(COALESCE(TRY_CAST(w.over_all_progress_percentages AS FLOAT), 0)) AS Progress
                FROM [dbo].[WMR] w WITH (NOLOCK)
                INNER JOIN (SELECT DISTINCT [Well_ID] FROM SapWells) sw ON w.pdo_well_id = sw.[Well_ID]
                WHERE w.pdo_well_id IS NOT NULL AND w.pdo_well_id <> ''
                GROUP BY w.pdo_well_id
            ),
            WellStatus AS (
                SELECT
                    sw.ClusterName,
                    CASE
                        WHEN sw.[EarliestEndDate] < @forecastCutoff
                             AND COALESCE(wp.Progress, 0) >= 1
                        THEN sw.MonthNum
                        WHEN sw.[EarliestEndDate] >= @forecastCutoff
                             AND COALESCE(wp.Progress, 0) < 1
                        THEN sw.MonthNum
                        ELSE NULL
                    END AS MonthNum
                FROM SapWells sw
                LEFT JOIN WmrProgress wp ON wp.pdo_well_id = sw.[Well_ID]
            ),
            CompletedAgg AS (
                SELECT ClusterName, MonthNum, COUNT(*) AS CompletedCount
                FROM WellStatus
                WHERE MonthNum IS NOT NULL
                GROUP BY ClusterName, MonthNum
            ),
            DrilledAgg AS (
                SELECT MonthNum, COUNT(*) AS DrilledCount
                FROM WellStatus
                WHERE MonthNum IS NOT NULL
                GROUP BY MonthNum
            )
            SELECT
                mc.ReportMonth,
                mc.ClusterName,
                ISNULL(ca.CompletedCount, 0) AS CompletedCount,
                ISNULL(da.DrilledCount, 0) AS TotalDrilled,
                CASE WHEN mc.StartDt >= @displayCutoff THEN 1 ELSE 0 END AS IsForecast,
                mc.MonthNum,
                mc.StartDt AS PeriodStart,
                CASE WHEN DATEADD(DAY, -1, mc.EndDt) > @toDate THEN @toDate ELSE DATEADD(DAY, -1, mc.EndDt) END AS PeriodEnd
            FROM MonthCluster mc
            LEFT JOIN CompletedAgg ca ON ca.ClusterName = mc.ClusterName AND ca.MonthNum = mc.MonthNum
            LEFT JOIN DrilledAgg da ON da.MonthNum = mc.MonthNum
            ORDER BY mc.MonthNum, mc.ClusterName
            """;
        }

        var connStr = db.Database.GetConnectionString()!;
        await using var conn = new SqlConnection(connStr);
        try { await conn.OpenAsync(ct); }
        catch (SqlException) { SqlConnection.ClearAllPools(); await conn.OpenAsync(ct); }

        await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 120 };
        cmd.Parameters.AddWithValue("@fromDate", fromDt);
        cmd.Parameters.AddWithValue("@toDate", toDt);
        cmd.Parameters.AddWithValue("@forecastCutoff", forecastCutoff);
        cmd.Parameters.AddWithValue("@displayCutoff", displayCutoff);
        cmd.Parameters.AddWithValue("@cluster", (object?)cluster ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@wellId", (object?)wellId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@project", (object?)project ?? DBNull.Value);

        var rawRows = new List<(string Month, string Cluster, int Completed, int TotalDrilled, bool IsForecast, DateTime PeriodStart, DateTime PeriodEnd)>();

        await using var rdr = await cmd.ExecuteReaderAsync(ct);
        while (await rdr.ReadAsync(ct))
        {
            var reportMonth = rdr.IsDBNull(0) ? "" : rdr.GetString(0);
            var clusterName = rdr.IsDBNull(1) ? "" : rdr.GetString(1);
            var completed = rdr.IsDBNull(2) ? 0 : rdr.GetInt32(2);
            var totalDrilled = rdr.IsDBNull(3) ? 0 : rdr.GetInt32(3);
            var isForecast = !rdr.IsDBNull(4) && rdr.GetInt32(4) == 1;

            var periodStart = rdr.IsDBNull(6) ? fromDt : rdr.GetDateTime(6);
            var periodEnd = rdr.IsDBNull(7) ? toDt : rdr.GetDateTime(7);
            // Clamp periodStart to fromDate for partial first bucket
            if (periodStart < fromDt) periodStart = fromDt;
            rawRows.Add((reportMonth, clusterName, completed, totalDrilled, isForecast, periodStart, periodEnd));
        }

        // Group by month
        var months = new List<WorkloadMonthDto>();
        var assetTotals = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        int drilledSum = 0;
        int monthCount = 0;

        foreach (var monthGroup in rawRows.GroupBy(r => r.Month))
        {
            monthCount++;
            var first = monthGroup.First();
            var assets = new List<WorkloadAssetDto>();

            foreach (var row in monthGroup)
            {
                assets.Add(new WorkloadAssetDto(row.Cluster, row.Completed));

                if (!assetTotals.ContainsKey(row.Cluster))
                    assetTotals[row.Cluster] = 0;
                assetTotals[row.Cluster] += row.Completed;
            }

            var monthDrilled = first.TotalDrilled;
            drilledSum += monthDrilled;

            // Compute correct calendar-aligned period dates
            string pStart, pEnd;
            if (rangeDays <= 14)
            {
                // Day-level: period is the single day itself
                pStart = first.PeriodStart.ToString("dd MMM yyyy");
                pEnd = pStart;
            }
            else
            {
                // Month-level: clamp to fromDt/toDt at month boundaries
                var bucketMonth = first.PeriodStart.Month;
                var bucketYear = first.PeriodStart.Year;
                var calStart = new DateTime(bucketYear, bucketMonth, 1);
                var calEnd = calStart.AddMonths(1).AddDays(-1);
                if (calStart < fromDt) calStart = fromDt;
                if (calEnd > toDt) calEnd = toDt;
                pStart = calStart.ToString("dd MMM yyyy");
                pEnd = calEnd.ToString("dd MMM yyyy");
            }

            months.Add(new WorkloadMonthDto(
                Label: first.Month,
                IsForecast: first.IsForecast,
                Assets: assets,
                TotalDrilled: monthDrilled,
                PeriodStart: pStart,
                PeriodEnd: pEnd
            ));
        }

        // Compute averages
        var avgPerAsset = new Dictionary<string, int>();
        foreach (var kvp in assetTotals)
            avgPerAsset[kvp.Key] = monthCount > 0 ? (int)Math.Round((double)kvp.Value / monthCount) : 0;

        var avgDrilled = monthCount > 0 ? (int)Math.Round((double)drilledSum / monthCount) : 0;

        var metadata = new WorkloadMetadataDto(
            From: from,
            To: to,
            GeneratedAt: DateTime.UtcNow,
            TotalMonths: monthCount,
            Assets: assetTotals.Keys.OrderBy(k => k).ToList());

        var summary = new WorkloadSummaryDto(avgPerAsset, avgDrilled, drilledSum);

        var result = new WorkloadAnalysisResponse(metadata, months, summary);
        cache.Set(cacheKey, result, CacheDuration);
        return result;
    }

    /// <summary>
    /// Target Finish Timeline: one row per well whose rig-off falls in the window (defaults to the
    /// last 90 days), with its target-finish date from the latest Job_Progress_PlanSnapshot
    /// Latest_Target_End, bucketed by how close/overdue that date is. Progress is the latest
    /// Revenue act_percent (normalized 0–100), Category from Dashboarding_Job_Progress.
    /// cluster / site / well-type / well-id are resolved to a set of well IDs via the cluster-wells
    /// cache (the same ProjectIDs taxonomy the page's filter dropdowns are built from) and applied
    /// in memory, so "WELL TYPE = Location/Flowline" matches even though w.well_type holds a
    /// different code (PCP/WI/…). The SQL itself only windows on rig-off date — fast, since the
    /// joined tables are small snapshots (a direct ActivityTaskPlan scan would time out).
    /// </summary>
    public async Task<TargetFinishTimelineDto> GetTargetFinishTimelineAsync(
        string? cluster = null, string? site = null, string? wellType = null, string? wellId = null,
        DateOnly? from = null, DateOnly? to = null, int take = 50, CancellationToken ct = default)
    {
        // Default the date window to the last 90 days (matches the page's global default).
        var toDate   = (to   ?? DateOnly.FromDateTime(DateTime.Today));
        var fromDate = (from ?? toDate.AddDays(-90));
        take = Math.Clamp(take, 1, 200);

        var cacheKey = $"target-finish-timeline:{cluster}:{site}:{wellType}:{wellId}:{fromDate}:{toDate}:{take}";
        if (cache.TryGetValue(cacheKey, out TargetFinishTimelineDto? cached) && cached is not null)
            return cached;

        // Resolve cluster / site / well-type / well-id → a set of pdo_well_id values, using the
        // cluster-wells cache (built from ProjectIDs — same source as the filter dropdowns). This
        // is the taxonomy the dropdowns use, so WELL TYPE / SITE match here even though they don't
        // line up with WMR.well_type / WMR columns. Null = no narrowing.
        static bool Has(string? s) => !string.IsNullOrWhiteSpace(s);
        static bool Eq(string? a, string? b) => string.Equals(a?.Trim(), b?.Trim(), StringComparison.OrdinalIgnoreCase);
        HashSet<string>? scope = null;
        var hasFilter = Has(cluster) || Has(site) || Has(wellType) || Has(wellId);
        if (Has(cluster) || Has(site) || Has(wellType))
        {
            var clusters = await GetClusterWellsAsync(ct);
            var ids = new List<string>();
            foreach (var c in clusters)
            {
                if (Has(cluster) && !Eq(c.Cluster, cluster)) continue;
                foreach (var w in c.Wells)
                {
                    if (string.IsNullOrWhiteSpace(w.Id)) continue;
                    if (Has(site)     && !Eq(w.Site,     site))     continue;
                    if (Has(wellType) && !Eq(w.WellType, wellType)) continue;
                    ids.Add(w.Id);
                }
            }
            scope = new HashSet<string>(ids, StringComparer.OrdinalIgnoreCase);
        }
        if (Has(wellId))
        {
            if (scope is null) scope = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { wellId!.Trim() };
            else scope.IntersectWith(new[] { wellId!.Trim() });
        }
        // A filter was set but it matches no wells → return an empty timeline (not "everything").
        if (hasFilter && scope is { Count: 0 })
            return new TargetFinishTimelineDto(Array.Empty<TargetFinishTimelineItemDto>());

        // SQL windows only on rig-off date; cluster/site/well-type/well-id are applied in memory
        // below against `scope`. A safety TOP keeps the result bounded.
        const string sql = """
            SET NOCOUNT ON;
            ;WITH LatestRevenue AS (
                SELECT well_id, act_percent,
                       ROW_NUMBER() OVER (PARTITION BY well_id ORDER BY created_at DESC) AS rn
                FROM [dbo].[Revenue] WITH (NOLOCK)
                WHERE well_id IS NOT NULL
            ),
            LatestCategory AS (
                SELECT [Well ID] AS WellID, MAX(Category) AS Category
                FROM [dbo].[Dashboarding_Job_Progress] WITH (NOLOCK)
                WHERE [Well ID] IS NOT NULL
                GROUP BY [Well ID]
            ),
            LatestTargetEnd AS (
                SELECT Well_ID, MAX(Latest_Target_End) AS TargetFinishDate
                FROM [dbo].[Job_Progress_PlanSnapshot] WITH (NOLOCK)
                WHERE Well_ID IS NOT NULL
                GROUP BY Well_ID
            )
            SELECT TOP (2000)
                CAST(w.pdo_well_id AS NVARCHAR(100))                        AS WellId,
                w.well_name_after_spud                                      AS WellName,
                ISNULL(w.Cluster, 'N/A')                                    AS Cluster,
                ISNULL(w.well_type, 'N/A')                                  AS WellType,
                ISNULL(cat.Category, 'N/A')                                 AS Category,
                ROUND(CASE WHEN TRY_CAST(r.act_percent AS FLOAT) > 1
                           THEN TRY_CAST(r.act_percent AS FLOAT)
                           ELSE ISNULL(TRY_CAST(r.act_percent AS FLOAT), 0) * 100 END, 2) AS Progress_Pct,
                te.TargetFinishDate                                         AS TargetFinishDate,
                DATEDIFF(DAY, CAST(GETDATE() AS DATE), te.TargetFinishDate) AS Days_Remaining,
                CASE
                    WHEN te.TargetFinishDate IS NULL                                       THEN 'No Target Set'
                    WHEN te.TargetFinishDate < CAST(GETDATE() AS DATE)                     THEN 'Overdue'
                    WHEN DATEDIFF(DAY, CAST(GETDATE() AS DATE), te.TargetFinishDate) <= 30 THEN 'Due Within 30 Days'
                    WHEN DATEDIFF(DAY, CAST(GETDATE() AS DATE), te.TargetFinishDate) <= 60 THEN 'Due In 31-60 Days'
                    ELSE 'Due After 60 Days'
                END                                                         AS Timeline_Status,
                CASE
                    WHEN te.TargetFinishDate < CAST(GETDATE() AS DATE)                     THEN 1
                    WHEN DATEDIFF(DAY, CAST(GETDATE() AS DATE), te.TargetFinishDate) <= 30 THEN 2
                    WHEN DATEDIFF(DAY, CAST(GETDATE() AS DATE), te.TargetFinishDate) <= 60 THEN 3
                    WHEN te.TargetFinishDate IS NULL                                       THEN 5
                    ELSE 4
                END                                                         AS Sort_Priority
            FROM [dbo].[WellMonitoringReport_Latest] w WITH (NOLOCK)
            LEFT JOIN LatestRevenue   r   ON r.well_id  = w.pdo_well_id AND r.rn = 1
            LEFT JOIN LatestCategory  cat ON cat.WellID = w.pdo_well_id
            LEFT JOIN LatestTargetEnd te  ON te.Well_ID = w.pdo_well_id
            WHERE w.pdo_well_id IS NOT NULL AND w.pdo_well_id <> ''
              AND w.[exp.rig_off_location_sap_data] BETWEEN @from AND @to
            ORDER BY Sort_Priority, te.TargetFinishDate;
            """;

        var all = new List<TargetFinishTimelineItemDto>();
        try
        {
            var connStr = db.Database.GetConnectionString()!;
            await using var conn = new SqlConnection(connStr);
            await OpenWithRetryAsync(conn, ct);
            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 120 };
            cmd.Parameters.Add("@from", System.Data.SqlDbType.Date).Value = fromDate.ToDateTime(TimeOnly.MinValue);
            cmd.Parameters.Add("@to",   System.Data.SqlDbType.Date).Value = toDate.ToDateTime(TimeOnly.MinValue);

            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
            {
                var date = rdr.IsDBNull(6) ? (DateTime?)null : rdr.GetDateTime(6);
                all.Add(new TargetFinishTimelineItemDto(
                    WellId:           rdr.IsDBNull(0) ? "" : rdr.GetString(0),
                    WellName:         rdr.IsDBNull(1) ? null : rdr.GetString(1),
                    Cluster:          rdr.IsDBNull(2) ? "N/A" : rdr.GetString(2),
                    WellType:         rdr.IsDBNull(3) ? "N/A" : rdr.GetString(3),
                    Category:         rdr.IsDBNull(4) ? "N/A" : rdr.GetString(4),
                    ProgressPct:      rdr.IsDBNull(5) ? 0d : Convert.ToDouble(rdr.GetValue(5)),
                    TargetFinishDate: date?.ToString("yyyy-MM-dd"),
                    DaysRemaining:    rdr.IsDBNull(7) ? (int?)null : Convert.ToInt32(rdr.GetValue(7)),
                    TimelineStatus:   rdr.IsDBNull(8) ? "" : rdr.GetString(8)));
            }
        }
        catch (Exception ex)
        {
            // Query failed → return empty; the frontend keeps its current rows. Logged for diagnosis.
            Console.Error.WriteLine($"[target-finish-timeline] query failed: {ex.Message}");
            return new TargetFinishTimelineDto(all);
        }

        // Apply the resolved scope (cluster/site/well-type/well-id) in memory, then cap to `take`.
        // SQL already ordered by Sort_Priority, so the first `take` after filtering are the most urgent.
        IEnumerable<TargetFinishTimelineItemDto> filtered = all;
        if (scope is not null)
            filtered = filtered.Where(i => scope.Contains(i.WellId));
        var items = filtered.Take(take).ToList();

        var result = new TargetFinishTimelineDto(items);
        cache.Set(cacheKey, result, CacheDuration);
        return result;
    }

    public async Task<IReadOnlyList<ClusterWellsDto>> GetClusterWellsAsync(CancellationToken ct = default)
    {
        const string cacheKey = "cluster-wells";
        if (cache.TryGetValue(cacheKey, out IReadOnlyList<ClusterWellsDto>? cached) && cached is not null)
            return cached;

        const string sql = """
            SELECT
                LTRIM(RTRIM(p.[Cluster]))                      AS ClusterName,
                LTRIM(RTRIM(p.[Site]))                         AS Site,
                LTRIM(RTRIM(p.[Type]))                         AS WellType,
                CAST(w.pdo_well_id AS NVARCHAR(100))           AS WellId,
                w.well_name_after_spud                         AS WellName,
                CAST(p.ID AS NVARCHAR(100))                    AS ProjectId,
                LTRIM(RTRIM(p.[Project]))                      AS Project
            FROM [dbo].[ProjectIDs] p WITH (NOLOCK)
            LEFT JOIN [dbo].[WMR] w WITH (NOLOCK)
                ON w.project_id = CAST(p.ID AS NVARCHAR(100))
               AND w.pdo_well_id IS NOT NULL AND w.pdo_well_id <> ''
            WHERE p.[Cluster] IS NOT NULL AND p.[Cluster] <> ''
            GROUP BY
                LTRIM(RTRIM(p.[Cluster])),
                LTRIM(RTRIM(p.[Site])),
                LTRIM(RTRIM(p.[Type])),
                CAST(w.pdo_well_id AS NVARCHAR(100)),
                w.well_name_after_spud,
                CAST(p.ID AS NVARCHAR(100)),
                LTRIM(RTRIM(p.[Project]))
            ORDER BY ClusterName, Site, WellType, Project, WellId
            """;

        var connStr = db.Database.GetConnectionString()!;
        await using var conn = new SqlConnection(connStr);
        await OpenWithRetryAsync(conn, ct);
        await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 300 };

        var groups             = new Dictionary<string, List<ClusterWellItemDto>>(StringComparer.OrdinalIgnoreCase);
        var sitesByCluster     = new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase);
        var wellTypesByCluster = new Dictionary<string, Dictionary<string, HashSet<string>>>(StringComparer.OrdinalIgnoreCase);
        // cluster → wellType → Set<projectName>  (tracks project names per well type)
        var projectsByCluster  = new Dictionary<string, Dictionary<string, HashSet<string>>>(StringComparer.OrdinalIgnoreCase);
        await using var rdr = await cmd.ExecuteReaderAsync(ct);
        while (await rdr.ReadAsync(ct))
        {
            var cluster   = rdr.IsDBNull(0) ? "Unknown" : rdr.GetString(0);
            var site      = rdr.IsDBNull(1) ? null      : rdr.GetString(1);
            var wellType  = rdr.IsDBNull(2) ? null      : rdr.GetString(2);
            var wellId    = rdr.IsDBNull(3) ? ""        : rdr.GetString(3);
            var wellName  = rdr.IsDBNull(4) ? null      : rdr.GetString(4);
            var projectId = rdr.IsDBNull(5) ? ""        : rdr.GetString(5);
            var project   = rdr.IsDBNull(6) ? null      : rdr.GetString(6);
            if (!groups.ContainsKey(cluster))
            {
                groups[cluster]             = new List<ClusterWellItemDto>();
                sitesByCluster[cluster]     = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                wellTypesByCluster[cluster] = new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase);
                projectsByCluster[cluster]  = new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase);
            }
            // Always register site, wellType and project (they come from ProjectIDs, exist even with no WMR wells)
            if (!string.IsNullOrWhiteSpace(site))
                sitesByCluster[cluster].Add(site);
            if (!string.IsNullOrWhiteSpace(wellType))
            {
                if (!wellTypesByCluster[cluster].TryGetValue(wellType, out var projectIds))
                {
                    projectIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                    wellTypesByCluster[cluster][wellType] = projectIds;
                }
                if (!string.IsNullOrWhiteSpace(projectId))
                    projectIds.Add(projectId);
            }
            if (!string.IsNullOrWhiteSpace(project))
            {
                var wtKey = wellType ?? "";
                if (!projectsByCluster[cluster].TryGetValue(wtKey, out var projSet))
                {
                    projSet = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                    projectsByCluster[cluster][wtKey] = projSet;
                }
                projSet.Add(project);
            }
            // Only add a well entry when there is an actual WMR well (LEFT JOIN may yield NULL wellId)
            if (!string.IsNullOrWhiteSpace(wellId))
                groups[cluster].Add(new ClusterWellItemDto(wellId, wellName, wellType, site, project));
        }

        var result = groups
            .OrderBy(g => g.Key, StringComparer.OrdinalIgnoreCase)
            .Select(g => new ClusterWellsDto(
                g.Key,
                (IReadOnlyList<ClusterSiteDto>)sitesByCluster[g.Key]
                    .OrderBy(s => s, StringComparer.OrdinalIgnoreCase)
                    .Select(s => new ClusterSiteDto(s))
                    .ToList(),
                (IReadOnlyList<ClusterWellTypeDto>)wellTypesByCluster[g.Key]
                    .OrderBy(kvp => kvp.Key, StringComparer.OrdinalIgnoreCase)
                    .Select(kvp => new ClusterWellTypeDto(kvp.Key, kvp.Value.OrderBy(id => id).ToList()))
                    .ToList(),
                (IReadOnlyList<ClusterProjectDto>)projectsByCluster[g.Key]
                    .SelectMany(kvp => kvp.Value
                        .OrderBy(p => p, StringComparer.OrdinalIgnoreCase)
                        .Select(p => new ClusterProjectDto(p, kvp.Key)))
                    .OrderBy(p => p.WellType, StringComparer.OrdinalIgnoreCase)
                    .ThenBy(p => p.Project, StringComparer.OrdinalIgnoreCase)
                    .ToList(),
                g.Value))
            .ToList();

        cache.Set(cacheKey, (IReadOnlyList<ClusterWellsDto>)result, TimeSpan.FromMinutes(30));
        return result;
    }

    public async Task<ClusterHealthDto> GetClusterHealthAsync(DateOnly? from = null, DateOnly? to = null, string? wellType = null, string? cluster = null, string? site = null, string? project = null, CancellationToken ct = default)
    {
        var cacheKey = "cluster-health:" + (from?.ToString("yyyy-MM-dd") ?? "") + ":" + (to?.ToString("yyyy-MM-dd") ?? "") + ":" + (wellType ?? "") + ":" + (cluster ?? "") + ":" + (site ?? "") + ":" + (project ?? "");
        if (cache.TryGetValue(cacheKey, out ClusterHealthDto? cached) && cached is not null)
            return cached;

        // Pre-cast IDs once per project row so the join can hash-match
        // instead of casting on every ActivityTaskPlan row.
        // Classification is date-based only (no per-row TRY_CAST on progress).
        const string sql = """
            SET NOCOUNT ON;
            WITH Clusters AS (
                SELECT
                    CAST(ID AS NVARCHAR(100))      AS pid,
                    LTRIM(RTRIM([Cluster]))         AS ClusterName,
                    LTRIM(RTRIM([Site]))            AS SiteName,
                    LTRIM(RTRIM([Type]))            AS LocationType,
                    LTRIM(RTRIM([Project]))         AS ProjectName
                FROM [dbo].[ProjectIDs] WITH (NOLOCK)
                WHERE [Cluster] IS NOT NULL AND LTRIM(RTRIM([Cluster])) <> ''
            ),
            -- Collapse WMR to ONE row per distinct well â€” use MAX to get the highest
            -- progress value recorded (avoids multi-row duplication from weekly snapshots)
            WellPct AS (
                SELECT
                    c.ClusterName,
                    w.pdo_well_id,
                    MAX(
                        CASE
                            WHEN w.over_all_progress_percentages IS NULL
                              OR LTRIM(RTRIM(w.over_all_progress_percentages)) = '' THEN NULL
                            WHEN TRY_CAST(REPLACE(LTRIM(RTRIM(w.over_all_progress_percentages)),'%','') AS FLOAT) IS NULL THEN NULL
                            WHEN TRY_CAST(REPLACE(LTRIM(RTRIM(w.over_all_progress_percentages)),'%','') AS FLOAT) <= 1.0
                                THEN TRY_CAST(REPLACE(LTRIM(RTRIM(w.over_all_progress_percentages)),'%','') AS FLOAT) * 100.0
                            ELSE TRY_CAST(REPLACE(LTRIM(RTRIM(w.over_all_progress_percentages)),'%','') AS FLOAT)
                        END
                    ) AS LatestPct,
                    -- Planned %: time elapsed / total planned duration (capped 0-100)
                    MAX(CASE
                        WHEN TRY_CAST(w.actual_rig_on_date AS DATE) IS NOT NULL
                         AND TRY_CAST(w.[exp.rig_off_location_sap_data] AS DATE) IS NOT NULL
                         AND DATEDIFF(DAY, TRY_CAST(w.actual_rig_on_date AS DATE), TRY_CAST(w.[exp.rig_off_location_sap_data] AS DATE)) > 0
                        THEN CAST(DATEDIFF(DAY, TRY_CAST(w.actual_rig_on_date AS DATE), ISNULL(CAST(@to AS DATE), CAST(GETDATE() AS DATE))) AS FLOAT)
                             / DATEDIFF(DAY, TRY_CAST(w.actual_rig_on_date AS DATE), TRY_CAST(w.[exp.rig_off_location_sap_data] AS DATE)) * 100.0
                        ELSE NULL
                    END) AS PlannedPct_raw
                FROM Clusters c
                INNER JOIN [dbo].[WMR] w WITH (NOLOCK)
                    ON w.project_id = c.pid
                WHERE c.ClusterName IS NOT NULL AND c.ClusterName <> ''
                  AND w.pdo_well_id  IS NOT NULL AND LTRIM(RTRIM(w.pdo_well_id)) <> ''
              AND (@from IS NULL OR TRY_CAST(w.[exp.rig_off_location_sap_data] AS DATE) IS NULL OR TRY_CAST(w.[exp.rig_off_location_sap_data] AS DATE) >= @from)
              AND (@to   IS NULL OR TRY_CAST(w.actual_rig_on_date AS DATE) IS NULL OR TRY_CAST(w.actual_rig_on_date AS DATE) <= @to)
              AND (@wellType IS NULL OR NULLIF(LTRIM(RTRIM(c.LocationType)), '') = @wellType)
              AND (@cluster  IS NULL OR LTRIM(RTRIM(c.ClusterName)) = @cluster)
              AND (@site     IS NULL OR NULLIF(LTRIM(RTRIM(c.SiteName)), '') = @site)
              AND (@project  IS NULL OR NULLIF(LTRIM(RTRIM(c.ProjectName)), '') = @project)
                GROUP BY c.ClusterName, w.pdo_well_id   -- one row per well
            )
            SELECT
                ClusterName,
                COUNT(pdo_well_id)                                                              AS WellCount,
                ISNULL(AVG(CASE WHEN LatestPct IS NOT NULL THEN LatestPct END), 0)            AS AvgProgress,
                SUM(CASE WHEN LatestPct IS NOT NULL AND LatestPct >= 30
                              AND LatestPct < 70                          THEN 1 ELSE 0 END)  AS AtRisk,
                SUM(CASE WHEN LatestPct IS NULL     OR  LatestPct < 30   THEN 1 ELSE 0 END)  AS Critical,
                ROUND(ISNULL(AVG(CASE WHEN LatestPct IS NOT NULL THEN LatestPct END), 0), 1) AS ActualPct,
                ROUND(ISNULL(AVG(CASE WHEN PlannedPct_raw IS NOT NULL THEN CASE WHEN PlannedPct_raw > 100.0 THEN 100.0 ELSE PlannedPct_raw END END), 0), 1) AS PlannedPct
            FROM WellPct
            GROUP BY ClusterName
            ORDER BY ClusterName;
            """;

        var connStr = db.Database.GetConnectionString()!;
        await using var conn = new SqlConnection(connStr);
        await OpenWithRetryAsync(conn, ct);
        await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 120 };
        cmd.Parameters.Add("@from", System.Data.SqlDbType.Date).Value = from.HasValue ? (object)from.Value.ToDateTime(TimeOnly.MinValue) : DBNull.Value;
        cmd.Parameters.Add("@to",   System.Data.SqlDbType.Date).Value = to.HasValue   ? (object)to.Value.ToDateTime(TimeOnly.MinValue)   : DBNull.Value;
        cmd.Parameters.Add("@wellType", System.Data.SqlDbType.NVarChar, 100).Value = wellType is not null ? (object)wellType : DBNull.Value;
        cmd.Parameters.Add("@cluster",  System.Data.SqlDbType.NVarChar, 200).Value = cluster  is not null ? (object)cluster  : DBNull.Value;
        cmd.Parameters.Add("@site",     System.Data.SqlDbType.NVarChar, 200).Value = site     is not null ? (object)site     : DBNull.Value;
        cmd.Parameters.Add("@project",  System.Data.SqlDbType.NVarChar, 200).Value = project  is not null ? (object)project  : DBNull.Value;

        var items = new List<ClusterHealthItemDto>();
        await using var rdr = await cmd.ExecuteReaderAsync(ct);
        while (await rdr.ReadAsync(ct))
        {
            var clName      = rdr.IsDBNull(0) ? "Unknown" : rdr.GetString(0);
            var wellCount   = rdr.IsDBNull(1) ? 0 : rdr.GetInt32(1);
            var healthPct   = rdr.IsDBNull(2) ? 0d : Math.Round(rdr.GetDouble(2), 1);
            var atRisk      = rdr.IsDBNull(3) ? 0 : rdr.GetInt32(3);
            var critical    = rdr.IsDBNull(4) ? 0 : rdr.GetInt32(4);
            var status      = critical > 0 ? "Critical" : atRisk > 0 ? "AtRisk" : "OnTrack";
            var actualPct  = rdr.IsDBNull(5) ? 0d : Math.Round(Convert.ToDouble(rdr.GetValue(5)), 1);
            var plannedPct = rdr.IsDBNull(6) ? 0d : Math.Round(Convert.ToDouble(rdr.GetValue(6)), 1);
            items.Add(new ClusterHealthItemDto(clName, wellCount, healthPct, atRisk, critical, status, plannedPct, actualPct));
        }

        var totalAtRisk   = items.Count(i => i.Status == "AtRisk");
        var totalCritical = items.Count(i => i.Status == "Critical");

        var result = new ClusterHealthDto(items.Count, totalAtRisk, totalCritical, items);
        cache.Set(cacheKey, result, TimeSpan.FromMinutes(5));
        return result;
    }

    public async Task<IReadOnlyList<ClusterWellsProgressDto>> GetClusterWellsProgressAsync(DateOnly? from = null, DateOnly? to = null, string? wellType = null, string? project = null, CancellationToken ct = default)
    {
        var cacheKey = "cluster-wells-progress:" + (from?.ToString("yyyy-MM-dd") ?? "") + ":" + (to?.ToString("yyyy-MM-dd") ?? "") + ":" + (wellType ?? "") + ":" + (project ?? "");
        if (cache.TryGetValue(cacheKey, out IReadOnlyList<ClusterWellsProgressDto>? cached) && cached is not null)
            return cached;

        // One row per distinct well â€” use MAX progress across all weekly WMR snapshots
        const string sql = """
            SET NOCOUNT ON;
            WITH Clusters AS (
                SELECT
                    CAST(ID AS NVARCHAR(100))      AS pid,
                    LTRIM(RTRIM([Cluster]))         AS ClusterName,
                    LTRIM(RTRIM([Type]))            AS LocationType,
                    LTRIM(RTRIM([Project]))         AS ProjectName
                FROM [dbo].[ProjectIDs] WITH (NOLOCK)
                WHERE [Cluster] IS NOT NULL AND LTRIM(RTRIM([Cluster])) <> ''
            )
            SELECT
                c.ClusterName,
                w.pdo_well_id                         AS WellId,
                MAX(w.well_name_after_spud)            AS WellName,
                ISNULL(MAX(
                    CASE
                        WHEN w.over_all_progress_percentages IS NULL
                          OR LTRIM(RTRIM(w.over_all_progress_percentages)) = '' THEN NULL
                        WHEN TRY_CAST(REPLACE(LTRIM(RTRIM(w.over_all_progress_percentages)),'%','') AS FLOAT) IS NULL THEN NULL
                        WHEN TRY_CAST(REPLACE(LTRIM(RTRIM(w.over_all_progress_percentages)),'%','') AS FLOAT) <= 1.0
                            THEN TRY_CAST(REPLACE(LTRIM(RTRIM(w.over_all_progress_percentages)),'%','') AS FLOAT) * 100.0
                        ELSE TRY_CAST(REPLACE(LTRIM(RTRIM(w.over_all_progress_percentages)),'%','') AS FLOAT)
                    END
                ), 0)                                  AS Progress,
                MAX(NULLIF(LTRIM(RTRIM(c.LocationType)), ''))  AS WellType
            FROM Clusters c
            INNER JOIN [dbo].[WMR] w WITH (NOLOCK) ON w.project_id = c.pid
            WHERE c.ClusterName IS NOT NULL AND c.ClusterName <> ''
              AND w.pdo_well_id  IS NOT NULL AND LTRIM(RTRIM(w.pdo_well_id)) <> ''
              AND (@from IS NULL OR TRY_CAST(w.[exp.rig_off_location_sap_data] AS DATE) IS NULL OR TRY_CAST(w.[exp.rig_off_location_sap_data] AS DATE) >= @from)
              AND (@to   IS NULL OR TRY_CAST(w.actual_rig_on_date AS DATE) IS NULL OR TRY_CAST(w.actual_rig_on_date AS DATE) <= @to)
              AND (@wellType IS NULL OR NULLIF(LTRIM(RTRIM(c.LocationType)), '') = @wellType)
              AND (@project  IS NULL OR NULLIF(LTRIM(RTRIM(c.ProjectName)), '') = @project)
            GROUP BY c.ClusterName, w.pdo_well_id
            ORDER BY c.ClusterName, Progress DESC;
            """;

        var connStr = db.Database.GetConnectionString()!;
        await using var conn = new SqlConnection(connStr);
        await OpenWithRetryAsync(conn, ct);
        await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 120 };
        cmd.Parameters.Add("@from", System.Data.SqlDbType.Date).Value = from.HasValue ? (object)from.Value.ToDateTime(TimeOnly.MinValue) : DBNull.Value;
        cmd.Parameters.Add("@to",   System.Data.SqlDbType.Date).Value = to.HasValue   ? (object)to.Value.ToDateTime(TimeOnly.MinValue)   : DBNull.Value;
        cmd.Parameters.Add("@wellType", System.Data.SqlDbType.NVarChar, 100).Value = wellType is not null ? (object)wellType : DBNull.Value;
        cmd.Parameters.Add("@project",  System.Data.SqlDbType.NVarChar, 200).Value = project  is not null ? (object)project  : DBNull.Value;

        var clusterMap = new Dictionary<string, List<ClusterWellProgressItemDto>>(StringComparer.OrdinalIgnoreCase);
        await using var rdr = await cmd.ExecuteReaderAsync(ct);
        while (await rdr.ReadAsync(ct))
        {
            var cluster  = rdr.IsDBNull(0) ? "Unknown" : rdr.GetString(0);
            var wellId   = rdr.IsDBNull(1) ? ""        : rdr.GetString(1);
            var wellName = rdr.IsDBNull(2) ? null      : rdr.GetString(2);
            var progress = rdr.IsDBNull(3) ? 0d        : Math.Round(rdr.GetDouble(3), 1);
            var wt       = rdr.IsDBNull(4) ? null      : rdr.GetString(4);
            if (!clusterMap.ContainsKey(cluster)) clusterMap[cluster] = new();
            clusterMap[cluster].Add(new ClusterWellProgressItemDto(wellId, wellName, progress, wt));
        }

        var list = clusterMap
            .Select(kv => new ClusterWellsProgressDto(kv.Key, kv.Value))
            .OrderBy(x => x.Cluster)
            .ToList();

        cache.Set(cacheKey, (IReadOnlyList<ClusterWellsProgressDto>)list, TimeSpan.FromMinutes(5));
        return list;
    }

    public async Task<WellStagesDto> GetWellStagesAsync(string wellId, DateOnly? from = null, DateOnly? to = null, CancellationToken ct = default)
    {
        var cacheKey = "well-stages:" + wellId + ":" + (from?.ToString("yyyy-MM-dd") ?? "") + ":" + (to?.ToString("yyyy-MM-dd") ?? "");
        if (cache.TryGetValue(cacheKey, out WellStagesDto? cached) && cached is not null)
            return cached;

        // Fast path: in-memory WellStagesCache (no SQL, instant, no timeout risk)
        var stagesCache = WellStagesCache.Instance;
        if (stagesCache.IsReady)
        {
            var cacheRows = stagesCache.GetForWell(wellId);
            var stages = cacheRows
                .Where(r =>
                {
                    if (from.HasValue && r.EndDate != null
                        && DateOnly.TryParse(r.EndDate, out var ed) && ed < from.Value) return false;
                    if (to.HasValue && r.StartDate != null
                        && DateOnly.TryParse(r.StartDate, out var sd) && sd > to.Value) return false;
                    return true;
                })
                .Select(r => new WellStageItemDto(
                    r.Name, r.Progress, r.Type,
                    TargetStart: r.StartDate,
                    TargetEnd:   r.EndDate,
                    ActualStart: null,   // not stored in cache
                    ActualEnd:   null,
                    Code:        null))  // not stored in cache (falls back to SQL path for code-based ordering)
                .ToList();

            var result = new WellStagesDto(wellId, stages);
            if (stages.Count > 0) cache.Set(cacheKey, result, TimeSpan.FromMinutes(5));
            return result;
        }

        // Fallback SQL (only if cache not yet warmed up after startup)
        // Simple equality on Well_ID — no CHARINDEX, no full-table-scan tricks.
        // Includes target/actual date columns + raw code so the Activity Gantt can render
        // bars + dates AND sort rows in project order (LCMS… milestones, LCPC… activities).
        using var cts = new System.Threading.CancellationTokenSource(TimeSpan.FromSeconds(30));
        const string sql = """
            SET NOCOUNT ON;
            SELECT TOP 500
                COALESCE(NULLIF(LTRIM(RTRIM(CAST([text] AS NVARCHAR(500)))), ''),
                         CAST([code] AS NVARCHAR(500)))               AS [text],
                CAST([progress] AS NVARCHAR(50))                      AS [progress],
                CAST([type]     AS NVARCHAR(100))                     AS [type],
                target_start,
                target_end,
                actual_start,
                actual_end,
                CAST([code]     AS NVARCHAR(100))                     AS [code]
            FROM [dbo].[ActivityTaskPlan] WITH (NOLOCK)
            WHERE [type] != 'T'
              AND CAST([Well_ID] AS NVARCHAR(50)) = @wellId;
            """;

        var stages2 = new List<WellStageItemDto>();
        try
        {
            var connStr = db.Database.GetConnectionString()!;
            await using var conn = new SqlConnection(connStr);
            await OpenWithRetryAsync(conn, cts.Token);
            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
            cmd.Parameters.Add("@wellId", System.Data.SqlDbType.NVarChar, 50).Value = wellId;

            var sentinel = new DateTime(1901, 1, 1);
            static string? Iso(DateTime? d, DateTime sentinel)
                => (d.HasValue && d.Value > sentinel) ? d.Value.ToString("yyyy-MM-dd") : null;

            await using var rdr = await cmd.ExecuteReaderAsync(cts.Token);
            while (await rdr.ReadAsync(cts.Token))
            {
                var name = rdr.IsDBNull(0) ? "" : rdr.GetString(0).Trim();
                if (string.IsNullOrEmpty(name)) continue;

                double progress = 0d;
                if (!rdr.IsDBNull(1))
                {
                    var raw = rdr.GetString(1).Replace("%", "").Trim();
                    if (double.TryParse(raw, System.Globalization.NumberStyles.Any,
                        System.Globalization.CultureInfo.InvariantCulture, out var pv))
                        progress = Math.Round(pv <= 1.0 ? pv * 100.0 : pv, 1);
                }
                var type = rdr.IsDBNull(2) ? "" : rdr.GetString(2).Trim();

                var targetStart = rdr.IsDBNull(3) ? (DateTime?)null : rdr.GetDateTime(3);
                var targetEnd   = rdr.IsDBNull(4) ? (DateTime?)null : rdr.GetDateTime(4);
                var actualStart = rdr.IsDBNull(5) ? (DateTime?)null : rdr.GetDateTime(5);
                var actualEnd   = rdr.IsDBNull(6) ? (DateTime?)null : rdr.GetDateTime(6);
                var code        = rdr.IsDBNull(7) ? null : rdr.GetString(7).Trim();

                stages2.Add(new WellStageItemDto(
                    name, progress, type,
                    TargetStart: Iso(targetStart, sentinel),
                    TargetEnd:   Iso(targetEnd,   sentinel),
                    ActualStart: Iso(actualStart, sentinel),
                    ActualEnd:   Iso(actualEnd,   sentinel),
                    Code:        code));
            }
        }
        catch (Exception)
        {
            return new WellStagesDto(wellId, []);
        }

        var result2 = new WellStagesDto(wellId, stages2);
        if (stages2.Count > 0) cache.Set(cacheKey, result2, TimeSpan.FromMinutes(5));
        return result2;
    }

    public async Task<WellWorkgroupsDto> GetWellWorkgroupsAsync(string wellId, CancellationToken ct = default, string? projectId = null)
    {
        var cacheKey = "well-workgroups:" + wellId + (projectId != null ? ":" + projectId : "");
        if (cache.TryGetValue(cacheKey, out WellWorkgroupsDto? cached) && cached is not null)
            return cached;

        // Self-join WMR_TaskPlan_csv_imported: workgroups (type 'W') LEFT JOINed to their
        // activities (type 'A') via act.parent_WBS = wg.text. One row per (workgroup, activity);
        // workgroups with no activities yield a single row with NULL activity columns. We then
        // group in C# so each workgroup is distinct and its progress is the average of its
        // activities' progress.
        using var cts = new System.Threading.CancellationTokenSource(TimeSpan.FromSeconds(30));
        // All computed columns (norm, days required, status, rates) are calculated in SQL.
        // Activity status uses norm-based logic: Late/Early/On Time/Completed/Due/At Risk/Accelerated/On Track.
        const string sql = """
            SET NOCOUNT ON;
            SELECT
                COALESCE(CAST(wg.code AS NVARCHAR(100)), '')               AS wg_code,
                COALESCE(CAST(wg.text AS NVARCHAR(500)), CAST(act.parent_WBS AS NVARCHAR(500))) AS workgroup_name,
                CONVERT(NVARCHAR(10), TRY_CONVERT(DATE, wg.target_start), 23)  AS wg_target_start,
                CONVERT(NVARCHAR(10), TRY_CONVERT(DATE, wg.target_end),   23)  AS wg_target_end,
                CAST(wg.weightage AS NVARCHAR(50))                         AS wg_weightage,
                CAST(act.code AS NVARCHAR(100))                            AS act_code,
                CAST(act.text AS NVARCHAR(500))                           AS activity_name,
                CAST(act.progress AS NVARCHAR(50))                        AS activity_progress,
                CAST(act.weightage AS NVARCHAR(50))                       AS act_weightage,
                CONVERT(NVARCHAR(10), TRY_CONVERT(DATE, act.target_start), 23) AS act_target_start,
                CONVERT(NVARCHAR(10), TRY_CONVERT(DATE, act.target_end),   23) AS act_target_end,
                CONVERT(NVARCHAR(10), TRY_CONVERT(DATE, act.actual_start), 23) AS act_actual_start,
                CONVERT(NVARCHAR(10), TRY_CONVERT(DATE, act.actual_end),   23) AS act_actual_end,
                CONVERT(NVARCHAR(10), TRY_CONVERT(DATE, act.start_date), 23) AS act_start_date,
                CONVERT(NVARCHAR(10), TRY_CONVERT(DATE, act.end_date),   23) AS act_end_date,
                CAST(act.qty AS NVARCHAR(50))                             AS act_qty,
                CAST(act.qtyactual AS NVARCHAR(50))                       AS act_qty_completed,
                CAST(act.manhours AS NVARCHAR(50))                        AS act_manhours_planned,

                -- Norm = qty / manhours
                CAST(TRY_CONVERT(DECIMAL(18,4), act.qty)
                    / NULLIF(TRY_CONVERT(DECIMAL(18,4), act.manhours), 0)
                    AS NVARCHAR(50)) AS act_norm,

                -- Duration = qty / (norms_per_day) where norms_per_day = (qty/manhours)*8
                CAST(TRY_CONVERT(DECIMAL(18,4), act.qty)
                    / NULLIF(
                        (TRY_CONVERT(DECIMAL(18,4), act.qty)
                        / NULLIF(TRY_CONVERT(DECIMAL(18,4), act.manhours), 0)) * 8,
                    0) AS NVARCHAR(50))                                    AS act_duration,

                -- Days Required = manhours / 8
                CAST(TRY_CONVERT(DECIMAL(18,4), act.manhours) / 8.0
                    AS NVARCHAR(50))                                       AS act_days_required,

                -- Norms Rate = qty / days_required
                CAST(TRY_CONVERT(DECIMAL(18,4), act.qty)
                    / NULLIF(TRY_CONVERT(DECIMAL(18,4), act.manhours) / 8.0, 0)
                    AS NVARCHAR(50))                                       AS act_norms_rate,

                -- AsPerNormEndDate = actual_start + CEILING(manhours/8)
                CONVERT(NVARCHAR(10),
                    CASE WHEN act.actual_start IS NOT NULL
                    THEN DATEADD(DAY,
                        CEILING(TRY_CONVERT(DECIMAL(18,4), act.manhours) / 8.0),
                        TRY_CONVERT(DATE, act.actual_start))
                    ELSE NULL END, 23)                                     AS act_asper_norm_end,

                -- Days Completed = today - actual_start (always from today, matching SSMS)
                CAST(CASE
                    WHEN act.actual_start IS NOT NULL
                    THEN DATEDIFF(DAY, TRY_CONVERT(DATE, act.actual_start), CAST(GETDATE() AS DATE))
                    ELSE NULL END AS NVARCHAR(20))                        AS act_days_completed,

                -- Current Progress = qtyactual / qty
                CAST(TRY_CONVERT(DECIMAL(18,4), act.qtyactual)
                    / NULLIF(TRY_CONVERT(DECIMAL(18,4), act.qty), 0)
                    AS NVARCHAR(50))                                       AS act_current_progress,

                -- Qty Remaining = qty - qtyactual
                CAST(TRY_CONVERT(DECIMAL(18,4), act.qty)
                    - ISNULL(TRY_CONVERT(DECIMAL(18,4), act.qtyactual), 0)
                    AS NVARCHAR(50))                                       AS act_qty_remaining,

                -- Days Remaining = asper_norm_end - actual_end (if completed), else asper_norm_end - today
                CAST(CASE
                    WHEN act.actual_start IS NOT NULL AND act.actual_end IS NOT NULL
                    THEN DATEDIFF(DAY, TRY_CONVERT(DATE, act.actual_end),
                        DATEADD(DAY,
                            CEILING(TRY_CONVERT(DECIMAL(18,4), act.manhours) / 8.0),
                            TRY_CONVERT(DATE, act.actual_start)))
                    WHEN act.actual_start IS NOT NULL
                    THEN DATEDIFF(DAY, CAST(GETDATE() AS DATE),
                        DATEADD(DAY,
                            CEILING(TRY_CONVERT(DECIMAL(18,4), act.manhours) / 8.0),
                            TRY_CONVERT(DATE, act.actual_start)))
                    ELSE NULL END AS NVARCHAR(20))                        AS act_days_remaining,

                -- Current Rate = qtyactual / days_completed (always from today)
                CAST(TRY_CONVERT(DECIMAL(18,4), act.qtyactual)
                    / NULLIF(
                        DATEDIFF(DAY, TRY_CONVERT(DATE, act.actual_start), CAST(GETDATE() AS DATE)),
                    0)
                    AS NVARCHAR(50))                                       AS act_current_rate,

                -- Asking Rate = qty_remaining / days_remaining
                CAST(CASE
                    WHEN act.actual_start IS NOT NULL
                    THEN (TRY_CONVERT(DECIMAL(18,4), act.qty) - ISNULL(TRY_CONVERT(DECIMAL(18,4), act.qtyactual), 0))
                         / NULLIF(CAST(DATEDIFF(DAY, CAST(GETDATE() AS DATE),
                             DATEADD(DAY, CEILING(TRY_CONVERT(DECIMAL(18,4), act.manhours) / 8.0),
                                 TRY_CONVERT(DATE, act.actual_start))) AS DECIMAL(18,4)), 0)
                    ELSE NULL END AS NVARCHAR(50))                        AS act_asking_rate_qty,

                -- Target Days Remaining
                CAST(CASE
                    WHEN act.actual_end IS NULL
                    THEN DATEDIFF(DAY, CAST(GETDATE() AS DATE), TRY_CONVERT(DATE, act.target_end))
                    ELSE NULL END AS NVARCHAR(20))                        AS act_target_days_remaining,

                -- Activity Status (norm-based)
                CASE
                    -- Completed sub-statuses: compare actual_end vs AsPerNormEndDate
                    WHEN act.actual_end IS NOT NULL AND TRY_CONVERT(DECIMAL(10,4), act.progress) = 1.0
                         AND TRY_CONVERT(DATE, act.actual_end) >
                             DATEADD(DAY, CEILING(TRY_CONVERT(DECIMAL(18,4), act.manhours) / 8.0),
                                 TRY_CONVERT(DATE, act.actual_start))
                        THEN 'Completed (Late)'
                    WHEN act.actual_end IS NOT NULL AND TRY_CONVERT(DECIMAL(10,4), act.progress) = 1.0
                         AND TRY_CONVERT(DATE, act.actual_end) <
                             DATEADD(DAY, CEILING(TRY_CONVERT(DECIMAL(18,4), act.manhours) / 8.0),
                                 TRY_CONVERT(DATE, act.actual_start))
                        THEN 'Completed (Early)'
                    WHEN act.actual_end IS NOT NULL AND TRY_CONVERT(DECIMAL(10,4), act.progress) = 1.0
                         AND TRY_CONVERT(DATE, act.actual_end) =
                             DATEADD(DAY, CEILING(TRY_CONVERT(DECIMAL(18,4), act.manhours) / 8.0),
                                 TRY_CONVERT(DATE, act.actual_start))
                        THEN 'Completed (On Time)'
                    WHEN act.actual_end IS NOT NULL AND TRY_CONVERT(DECIMAL(10,4), act.progress) = 1.0
                        THEN 'Completed'
                    -- Due: AsPerNormEndDate = today
                    WHEN act.actual_end IS NULL
                         AND (TRY_CONVERT(DECIMAL(10,4), act.progress) IS NULL OR TRY_CONVERT(DECIMAL(10,4), act.progress) < 1.0)
                         AND act.actual_start IS NOT NULL
                         AND DATEADD(DAY, CEILING(TRY_CONVERT(DECIMAL(18,4), act.manhours) / 8.0),
                             TRY_CONVERT(DATE, act.actual_start)) = CAST(GETDATE() AS DATE)
                        THEN 'Due'
                    -- At Risk: asking_rate > current_rate (can't keep up)
                    WHEN act.actual_end IS NULL
                         AND (TRY_CONVERT(DECIMAL(10,4), act.progress) IS NULL OR TRY_CONVERT(DECIMAL(10,4), act.progress) < 1.0)
                         AND act.actual_start IS NOT NULL
                         AND DATEDIFF(DAY, TRY_CONVERT(DATE, act.actual_start), CAST(GETDATE() AS DATE)) > 0
                         AND DATEDIFF(DAY, CAST(GETDATE() AS DATE),
                             DATEADD(DAY, CEILING(TRY_CONVERT(DECIMAL(18,4), act.manhours) / 8.0),
                                 TRY_CONVERT(DATE, act.actual_start))) <> 0
                         AND (TRY_CONVERT(DECIMAL(18,4), act.qty) - ISNULL(TRY_CONVERT(DECIMAL(18,4), act.qtyactual), 0))
                             / NULLIF(CAST(DATEDIFF(DAY, CAST(GETDATE() AS DATE),
                                 DATEADD(DAY, CEILING(TRY_CONVERT(DECIMAL(18,4), act.manhours) / 8.0),
                                     TRY_CONVERT(DATE, act.actual_start))) AS DECIMAL(18,4)), 0)
                             > TRY_CONVERT(DECIMAL(18,4), act.qtyactual)
                               / CAST(DATEDIFF(DAY, TRY_CONVERT(DATE, act.actual_start), CAST(GETDATE() AS DATE)) AS DECIMAL(18,4))
                        THEN 'At Risk (Delayed)'
                    -- Accelerated: actual_end < rig_on_date
                    WHEN act.actual_end IS NOT NULL
                         AND TRY_CONVERT(DECIMAL(10,4), act.progress) = 1.0
                         AND rig.rig_on IS NOT NULL
                         AND TRY_CONVERT(DATE, act.actual_end) < rig.rig_on
                        THEN 'Accelerated'
                    -- On Track: asking_rate = current_rate (balanced pace)
                    WHEN act.actual_end IS NULL
                         AND (TRY_CONVERT(DECIMAL(10,4), act.progress) IS NULL OR TRY_CONVERT(DECIMAL(10,4), act.progress) < 1.0)
                         AND act.actual_start IS NOT NULL
                         AND DATEDIFF(DAY, TRY_CONVERT(DATE, act.actual_start), CAST(GETDATE() AS DATE)) > 0
                         AND DATEDIFF(DAY, CAST(GETDATE() AS DATE),
                             DATEADD(DAY, CEILING(TRY_CONVERT(DECIMAL(18,4), act.manhours) / 8.0),
                                 TRY_CONVERT(DATE, act.actual_start))) <> 0
                         AND (TRY_CONVERT(DECIMAL(18,4), act.qty) - ISNULL(TRY_CONVERT(DECIMAL(18,4), act.qtyactual), 0))
                             / NULLIF(CAST(DATEDIFF(DAY, CAST(GETDATE() AS DATE),
                                 DATEADD(DAY, CEILING(TRY_CONVERT(DECIMAL(18,4), act.manhours) / 8.0),
                                     TRY_CONVERT(DATE, act.actual_start))) AS DECIMAL(18,4)), 0)
                             = TRY_CONVERT(DECIMAL(18,4), act.qtyactual)
                               / CAST(DATEDIFF(DAY, TRY_CONVERT(DATE, act.actual_start), CAST(GETDATE() AS DATE)) AS DECIMAL(18,4))
                        THEN 'On Track'
                    -- Due: not started OR rates can't be compared
                    ELSE 'Due'
                END                                                        AS act_status

            FROM [dbo].[WMR_TaskPlan_csv_imported] act WITH (NOLOCK)
            LEFT JOIN (
                SELECT code, text, target_start, target_end, weightage, New_Well_ID,
                       ROW_NUMBER() OVER (PARTITION BY CAST(text AS NVARCHAR(4000)), CAST(New_Well_ID AS NVARCHAR(50)) ORDER BY code) AS rn
                FROM [dbo].[WMR_TaskPlan_csv_imported] WITH (NOLOCK)
                WHERE CAST(New_Well_ID AS NVARCHAR(50)) = @wellId
                  AND CAST(type AS NVARCHAR(10)) = 'W'
            ) wg ON CAST(wg.text AS NVARCHAR(4000)) = CAST(act.parent_WBS AS NVARCHAR(4000))
                AND CAST(wg.New_Well_ID AS NVARCHAR(50)) = CAST(act.New_Well_ID AS NVARCHAR(50))
                AND wg.rn = 1
            OUTER APPLY (
                SELECT TOP 1 TRY_CAST(w.actual_rig_on_date AS DATE) AS rig_on
                FROM [dbo].[WMR] w WITH (NOLOCK)
                WHERE w.pdo_well_id = CAST(act.New_Well_ID AS NVARCHAR(50))
                  AND w.actual_rig_on_date IS NOT NULL AND w.actual_rig_on_date <> ''
                  AND TRY_CAST(w.actual_rig_on_date AS DATE) IS NOT NULL
                ORDER BY TRY_CAST(w.actual_rig_on_date AS DATE) DESC
            ) rig
            WHERE CAST(act.New_Well_ID AS NVARCHAR(50)) = @wellId
              AND CAST(act.type AS NVARCHAR(10)) = 'A'
            """;

        // Append optional project_id filter
        var finalSql = sql;
        if (!string.IsNullOrEmpty(projectId))
            finalSql += "\n              AND CAST(act.project_id AS NVARCHAR(200)) = @projectId";
        finalSql += "\n            ORDER BY wg.code, act.code;";

        // Preserve first-seen workgroup order (matches the ORDER BY wg.code).
        var order = new List<string>();
        var groups = new Dictionary<string, WgAccum>(StringComparer.OrdinalIgnoreCase);

        try
        {
            var connStr = db.Database.GetConnectionString()!;
            await using var conn = new SqlConnection(connStr);
            await OpenWithRetryAsync(conn, cts.Token);
            await using var cmd = new SqlCommand(finalSql, conn) { CommandTimeout = 30 };
            cmd.Parameters.Add("@wellId", System.Data.SqlDbType.NVarChar, 50).Value = wellId;
            if (!string.IsNullOrEmpty(projectId))
                cmd.Parameters.Add("@projectId", System.Data.SqlDbType.NVarChar, 200).Value = projectId;

            // Columns are CSV-imported NVARCHAR (incl. numerics cast to NVARCHAR in SQL); parse defensively.
            string? Str(System.Data.Common.DbDataReader r, int i)
            {
                if (r.IsDBNull(i)) return null;
                var s = r.GetString(i).Trim();
                return s.Length == 0 ? null : s;
            }
            double? Dbl(System.Data.Common.DbDataReader r, int i)
            {
                var s = Str(r, i)?.Replace("%", "").Trim();
                return double.TryParse(s, System.Globalization.NumberStyles.Any,
                    System.Globalization.CultureInfo.InvariantCulture, out var v) ? v : (double?)null;
            }
            int? Int(System.Data.Common.DbDataReader r, int i)
            {
                var d = Dbl(r, i);
                return d.HasValue ? (int)Math.Round(d.Value) : (int?)null;
            }

            await using var rdr = await cmd.ExecuteReaderAsync(cts.Token);
            while (await rdr.ReadAsync(cts.Token))
            {
                var wgCode = rdr.IsDBNull(0) ? "" : rdr.GetString(0).Trim();
                var wgName = rdr.IsDBNull(1) ? "" : rdr.GetString(1).Trim();
                if (string.IsNullOrEmpty(wgName)) wgName = wgCode;
                if (string.IsNullOrEmpty(wgName)) continue;

                var wgKey = (wgCode) + "|" + wgName.ToLowerInvariant();
                if (!groups.TryGetValue(wgKey, out var acc))
                {
                    acc = new WgAccum
                    {
                        Code        = string.IsNullOrEmpty(wgCode) ? null : wgCode,
                        Name        = wgName,
                        TargetStart = Str(rdr, 2),
                        TargetEnd   = Str(rdr, 3),
                        Weightage   = Dbl(rdr, 4),
                    };
                    groups[wgKey] = acc;
                    order.Add(wgKey);
                }

                // Activity columns
                var actCode = Str(rdr, 5);
                var actName = rdr.IsDBNull(6) ? "" : rdr.GetString(6).Trim();
                if (string.IsNullOrEmpty(actName) && string.IsNullOrEmpty(actCode))
                    continue;

                // Dedupe
                var actKey = (actCode ?? "") + "|" + actName.ToLowerInvariant();
                if (!acc.SeenActivities.Add(actKey)) continue;

                var pv = Dbl(rdr, 7) ?? 0d;
                var progress = Math.Round(pv <= 1.0 ? pv * 100.0 : pv, 1);

                var weightage       = Dbl(rdr, 8);
                var actTargetStart  = Str(rdr, 9);
                var actTargetEnd    = Str(rdr, 10);
                var actActualStart  = Str(rdr, 11);
                var actActualEnd    = Str(rdr, 12);
                var startDate       = Str(rdr, 13);
                var endDate         = Str(rdr, 14);
                var qty             = Dbl(rdr, 15);
                var qtyCompleted    = Dbl(rdr, 16);
                var manhoursPlanned = Dbl(rdr, 17);
                var norm            = Dbl(rdr, 18);
                var duration        = Dbl(rdr, 19);
                var daysRequired    = Dbl(rdr, 20);
                var normsRate       = Dbl(rdr, 21);
                var asperNormEnd    = Str(rdr, 22);
                var daysCompleted   = Int(rdr, 23);
                var currentProgressFrac = Dbl(rdr, 24);
                var qtyRemaining    = Dbl(rdr, 25);
                var daysRemaining   = Int(rdr, 26);
                var currentRate     = Dbl(rdr, 27);
                var askingRateQty   = Dbl(rdr, 28);
                var targetDaysRemaining = Int(rdr, 29);
                var status          = Str(rdr, 30) ?? "On Track";

                // Current Progress: from SQL as fraction (0-1), convert to percentage
                double? currentProgressPct = currentProgressFrac.HasValue
                    ? Math.Round(currentProgressFrac.Value * 100, 1) : null;

                // Can Complete With Actual Rate
                string? canComplete = null;
                if (currentRate.HasValue && askingRateQty.HasValue && askingRateQty.Value > 0)
                    canComplete = currentRate.Value >= askingRateQty.Value ? "Yes" : "No";

                // Days Can Be Saved
                double? daysSaved = null;
                if (currentRate.HasValue && currentRate.Value > 0 && qtyRemaining.HasValue && daysRemaining.HasValue && daysRemaining.Value > 0)
                {
                    var daysNeeded = qtyRemaining.Value / currentRate.Value;
                    daysSaved = Math.Round(daysRemaining.Value - daysNeeded, 1);
                }

                // Rollup flags
                var completed = actActualEnd is not null || progress >= 100d;
                var started   = progress > 0d || actActualStart is not null;

                acc.Activities.Add(new WellWorkgroupActivityDto(
                    actCode,
                    string.IsNullOrEmpty(actName) ? (actCode ?? "") : actName,
                    progress, status,
                    actTargetStart, actTargetEnd, actActualStart, actActualEnd,
                    null, // assignee (not in TaskPlanCSVImport)
                    null, // activityCode (not in TaskPlanCSVImport)
                    weightage, null, null, // manhoursActual, manhourForecast not available
                    daysRemaining, null, null, null, null,
                    qty, qtyCompleted, manhoursPlanned, duration,
                    startDate, endDate, norm, daysRequired, normsRate,
                    asperNormEnd, daysCompleted, currentProgressPct, qtyRemaining,
                    currentRate, askingRateQty, canComplete, daysSaved));
                var actWt = weightage ?? 0d;
                acc.WeightedProgressSum += progress * actWt;
                acc.ActWeightageSum += actWt;
                if (completed) acc.CompletedCount++;
                if (started)   acc.StartedCount++;
            }
        }
        catch (Exception)
        {
            return new WellWorkgroupsDto(wellId, []);
        }

        var workgroups = new List<WellWorkgroupDto>(order.Count);
        foreach (var key in order)
        {
            var acc = groups[key];
            var count = acc.Activities.Count;
            var avgProgress = acc.ActWeightageSum > 0
                ? Math.Round(acc.WeightedProgressSum / acc.ActWeightageSum, 1)
                : 0d;
            // Workgroup status uses norm-based logic matching the activity statuses:
            // Completed = all activities completed
            // At Risk = any activity is "At Risk (Delayed)"
            // Accelerated = any activity has actual_end < rig_on
            // On Track = default
            string status;
            if (count == 0)
                status = "Not Started";
            else if (acc.CompletedCount == count)
                status = "Completed";
            else if (acc.Activities.Any(a => a.Status == "At Risk (Delayed)"))
                status = "At Risk";
            else if (acc.Activities.Any(a => a.Status == "Accelerated"))
                status = "Accelerated";
            else if (acc.StartedCount > 0 || avgProgress > 0d)
                status = "In Progress";
            else
                status = "Not Started";
            workgroups.Add(new WellWorkgroupDto(
                acc.Code, acc.Name, avgProgress, status,
                count, acc.CompletedCount,
                acc.TargetStart, acc.TargetEnd,
                acc.Activities, acc.Weightage));
        }

        // ── Well Status: fetch Rig On Date from WMR, compute status ──
        string? wellStatus = null;
        string? rigOnDateStr = null;
        string? forecastEndStr = null;
        string? wellEndDateStr = null;

        try
        {
            // 1. Get Rig On Date from WMR (tiny 1-row query)
            const string rigSql = """
                SELECT TOP 1 TRY_CONVERT(DATE, actual_rig_on_date)
                FROM [dbo].[WMR] WITH (NOLOCK)
                WHERE pdo_well_id = @wellId
                  AND actual_rig_on_date IS NOT NULL
                  AND TRY_CONVERT(DATE, actual_rig_on_date) IS NOT NULL
                ORDER BY TRY_CAST(Week_Number AS DATE) DESC
                """;

            var connStr2 = db.Database.GetConnectionString()!;
            await using var conn2 = new SqlConnection(connStr2);
            await OpenWithRetryAsync(conn2, ct);
            await using var rigCmd = new SqlCommand(rigSql, conn2) { CommandTimeout = 10 };
            rigCmd.Parameters.Add("@wellId", System.Data.SqlDbType.NVarChar, 50).Value = wellId;
            var rigObj = await rigCmd.ExecuteScalarAsync(ct);
            DateTime? rigOnDate = rigObj is DateTime dt ? dt : null;
            rigOnDateStr = rigOnDate?.ToString("yyyy-MM-dd");

            // 2. Compute Well Status using WORKGROUP-level logic (business rule):
            //    - "All Work groups Completed" = every workgroup has Progress >= 100
            //    - "Latest Work group forecast end" = MAX(TargetEnd) from NON-completed workgroups
            //    - "Well End Date" = MAX(ActualEnd) from completed activities
            //    - Tolerance is symmetric (±3 days)

            DateTime? forecastEnd = null;   // Latest target end from non-completed workgroups
            DateTime? wellEndDate = null;   // MAX(ActualEnd) across all activities (= Well End Date)
            bool allWorkgroupsCompleted = workgroups.Count > 0 && workgroups.All(wg => wg.Progress >= 100.0);

            foreach (var wg in workgroups)
            {
                if (wg.Progress >= 100.0)
                {
                    // Completed workgroup: track latest actual end for Well End Date
                    foreach (var act in wg.Activities)
                    {
                        if (act.ActualEnd is not null && DateTime.TryParse(act.ActualEnd, out var actEnd))
                        {
                            if (wellEndDate is null || actEnd > wellEndDate)
                                wellEndDate = actEnd;
                        }
                    }
                }
                else
                {
                    // Non-completed workgroup: use TargetEnd as the forecast end
                    if (wg.TargetEnd is not null && DateTime.TryParse(wg.TargetEnd, out var wgTargetEnd))
                    {
                        if (forecastEnd is null || wgTargetEnd > forecastEnd)
                            forecastEnd = wgTargetEnd;
                    }
                    // Also track actual ends for Well End Date
                    foreach (var act in wg.Activities)
                    {
                        if (act.ActualEnd is not null && DateTime.TryParse(act.ActualEnd, out var actEnd2))
                        {
                            if (wellEndDate is null || actEnd2 > wellEndDate)
                                wellEndDate = actEnd2;
                        }
                    }
                }
            }

            forecastEndStr = forecastEnd?.ToString("yyyy-MM-dd");
            wellEndDateStr = wellEndDate?.ToString("yyyy-MM-dd");

            // 3. Apply Well Status logic per business rule (first match wins):
            //    1. Completed: All Work groups Completed → sub-classify vs Rig On Date
            //    2. Due: Rig On Date has passed AND well is not ready
            //    3. Delayed (At Risk): Latest Work group forecast end > Rig On Date
            //    4. On Time: Latest Work group forecast end ≈ Rig On Date (within tolerance)
            //    5. Accelerated: Latest Work group forecast end < Rig On Date
            //    6. Not Started: no workgroups OR all workgroups have 0 progress
            const int toleranceDays = 3;

            // Check if well has not started (all workgroup progress = 0)
            bool noneStarted = workgroups.Count == 0 || workgroups.All(wg => wg.Progress <= 0);

            if (noneStarted)
            {
                wellStatus = "Not Started";
            }
            else if (allWorkgroupsCompleted)
            {
                // Completed: ALL activities in ALL workgroups are done → well is completed
                // Sub-classify by Well End Date vs Rig On Date
                if (rigOnDate.HasValue && wellEndDate.HasValue)
                {
                    if (wellEndDate.Value > rigOnDate.Value)
                        wellStatus = "Completed (Late)";
                    else if (wellEndDate.Value == rigOnDate.Value)
                        wellStatus = "Completed (On Time)";
                    else
                        wellStatus = "Completed (Early)";
                }
                else
                    wellStatus = "Completed";
            }
            else if (rigOnDate.HasValue && rigOnDate.Value < DateTime.Today && !allWorkgroupsCompleted)
            {
                // Due: Rig On Date has passed AND well is not ready
                wellStatus = "Due";
            }
            else if (rigOnDate.HasValue && forecastEnd.HasValue
                     && forecastEnd.Value > rigOnDate.Value
                     && (forecastEnd.Value - rigOnDate.Value).TotalDays > toleranceDays)
            {
                // Delayed (At Risk): forecast end > Rig On Date (beyond tolerance)
                wellStatus = "Delayed (At Risk)";
            }
            else if (rigOnDate.HasValue && forecastEnd.HasValue
                     && Math.Abs((forecastEnd.Value - rigOnDate.Value).TotalDays) <= toleranceDays)
            {
                // On Time: forecast end ≈ Rig On Date (within symmetric tolerance)
                wellStatus = "On Time";
            }
            else if (rigOnDate.HasValue && wellEndDate.HasValue && wellEndDate.Value < rigOnDate.Value)
            {
                // Accelerated: actual end date < Rig On Date
                wellStatus = "Accelerated";
            }
            else
            {
                // No rig-on date available — default to On Time
                wellStatus = "On Time";
            }
        }
        catch
        {
            // If WMR query fails, leave wellStatus as null
        }

        var result = new WellWorkgroupsDto(wellId, workgroups, wellStatus, rigOnDateStr, forecastEndStr, wellEndDateStr);
        if (workgroups.Count > 0) cache.Set(cacheKey, result, TimeSpan.FromMinutes(5));
        return result;
    }

    public async Task<IReadOnlyList<WellProjectDto>> GetWellProjectsAsync(string wellId, CancellationToken ct = default)
    {
        const string sql = """
            SET NOCOUNT ON;
            SELECT t.project_id, p.[Project], p.Code, p.Type,
                   COUNT(CASE WHEN CAST(t.type AS NVARCHAR(10)) = 'A' THEN 1 END) AS act_count
            FROM [dbo].[WMR_TaskPlan_csv_imported] t WITH (NOLOCK)
            LEFT JOIN [dbo].[ProjectIDs] p WITH (NOLOCK) ON t.project_id = p.ID
            WHERE CAST(t.New_Well_ID AS NVARCHAR(50)) = @wellId
            GROUP BY t.project_id, p.[Project], p.Code, p.Type
            HAVING COUNT(CASE WHEN CAST(t.type AS NVARCHAR(10)) = 'A' THEN 1 END) > 0
            ORDER BY COUNT(*) DESC;
            """;

        var results = new List<WellProjectDto>();
        try
        {
            var connStr = db.Database.GetConnectionString()!;
            await using var conn = new SqlConnection(connStr);
            await OpenWithRetryAsync(conn, ct);
            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 10 };
            cmd.Parameters.Add("@wellId", System.Data.SqlDbType.NVarChar, 50).Value = wellId;
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
            {
                var pid = rdr.IsDBNull(0) ? "" : rdr.GetString(0).Trim();
                var pName = rdr.IsDBNull(1) ? pid : rdr.GetString(1).Trim();
                var pCode = rdr.IsDBNull(2) ? null : rdr.GetString(2).Trim();
                var pType = rdr.IsDBNull(3) ? null : rdr.GetString(3).Trim();
                var actCount = rdr.GetInt32(4);
                if (!string.IsNullOrEmpty(pid))
                    results.Add(new WellProjectDto(pid, pName, pCode, pType, actCount));
            }
        }
        catch { /* graceful fallback */ }
        return results;
    }

    /// <summary>Mutable accumulator used while grouping workgroup rows in GetWellWorkgroupsAsync.</summary>
    private sealed class WgAccum
    {
        public string? Code;
        public string  Name = "";
        public string? TargetStart;
        public string? TargetEnd;
        public double? Weightage;
        public double  WeightedProgressSum;
        public double  ActWeightageSum;
        public int     CompletedCount;
        public int     StartedCount;
        public readonly List<WellWorkgroupActivityDto> Activities = new();
        public readonly HashSet<string> SeenActivities = new(StringComparer.OrdinalIgnoreCase);
    }

    public async Task<IReadOnlyList<ActivityGanttRowDto>> GetActivityGanttAsync(CancellationToken ct = default)
    {
        const string cacheKey = "activity-gantt:A_M";
        if (cache.TryGetValue(cacheKey, out IReadOnlyList<ActivityGanttRowDto>? cached) && cached is not null)
            return cached;

        // Fast path: in-memory WellStagesCache (filled by the startup loader).
        var stagesCache = WellStagesCache.Instance;
        if (stagesCache.IsReady)
        {
            var fast = new List<ActivityGanttRowDto>(2048);
            foreach (var wellId in stagesCache.GetAllWellIds())
            {
                foreach (var s in stagesCache.GetForWell(wellId))
                {
                    if (!IsActivityOrMilestone(s.Type)) continue;
                    var pct = s.Progress > 1.0 ? Math.Min(s.Progress / 100d, 1d) : Math.Max(s.Progress, 0d);
                    fast.Add(new ActivityGanttRowDto(
                        wellId, s.Name, s.Name, s.Type,
                        s.StartDate, s.EndDate,
                        null, null,                     // actual dates not stored in this cache
                        Math.Round(pct, 3)));
                }
            }
            IReadOnlyList<ActivityGanttRowDto> fastList = fast;
            cache.Set(cacheKey, fastList, TimeSpan.FromMinutes(5));
            return fastList;
        }

        // Cold path: cache not yet warm. Direct cross-well queries against ActivityTaskPlan
        // time out (no [type] index + slow remote DB). The frontend therefore lazy-loads
        // per-well via /dashboard/well-stages/{wellId}, which is selective on Well_ID and fast.
        // Returning [] here is a signal to the frontend that bulk data isn't available yet.
        await Task.Yield();
        return Array.Empty<ActivityGanttRowDto>();

        static bool IsActivityOrMilestone(string? t)
            => !string.IsNullOrEmpty(t) && (t.Equals("A", StringComparison.OrdinalIgnoreCase)
                                         || t.Equals("M", StringComparison.OrdinalIgnoreCase));
    }

    // Wells Readiness Overall Status 

    public async Task<WellsReadinessDto> GetWellsReadinessAsync(
        int? planYear = null,
        DateOnly? asOfDate = null,
        string? cluster = null,
        DateOnly? fromDate = null,
        DateOnly? toDate = null,
        string? wellType = null,
        string? project = null,
        CancellationToken ct = default)
    {
        // Only use the date range from query params — no year-based logic.
        if (fromDate is null || toDate is null)
            throw new ArgumentException("fromDate and toDate query parameters are required.");

        var asOf = asOfDate ?? toDate.Value;
        var year = fromDate.Value.Year; // for display in response only
        var cacheKey = $"wells-readiness:{fromDate:yyyy-MM-dd}:{toDate:yyyy-MM-dd}:{asOf:yyyy-MM-dd}:{cluster ?? "all"}:{wellType ?? "all"}:{project ?? "all"}";
        if (cache.TryGetValue(cacheKey, out WellsReadinessDto? cached) && cached is not null)
            return cached;

        // ── FAST PATH: Use in-memory WMR snapshot when available ──
        // This avoids the expensive full-table scan of WMR (heap, 128 nvarchar columns, no indexes)
        // by computing the funnel from the pre-loaded snapshot. Falls back to DB query if snapshot not ready.
        WellsReadinessDto dto;
        if (WmrSnapshotCache.Instance.IsReady)
        {
            dto = ComputeWellsReadinessFromSnapshot(fromDate.Value, toDate.Value, asOf, cluster, wellType, project);
        }
        else
        {
            // Fallback: original DB query (slow but works before cache is warm)
            var allWells = await GetWmrWellsByFunnelLogicAsync(fromDate.Value, toDate.Value, asOfDate, null, null, cluster, null, wellType, null, ct);

            var originalPlan    = allWells.Count;
            var flafScrExcluded = allWells.Count(w => w.FlafScr);
            var afterFlafScr    = originalPlan - flafScrExcluded;
            var actualCompleted = allWells.Count(w => w.Status == "completed");
            var notDueAccel     = 0;
            var dueCompleted    = actualCompleted;

            var pdoIssueWellSet = WmrSnapshotCache.Instance.PdoIssueWells;
            var pdoExcluded = allWells.Count(w =>
                !w.FlafScr
                && w.Status != "completed"
                && pdoIssueWellSet.Contains(w.WellId));
            var cleanTarget         = afterFlafScr - pdoExcluded;
            var wellsAccelerated    = notDueAccel;
            var remaining           = Math.Max(0, cleanTarget - actualCompleted);
            var atnmPerformance     = cleanTarget > 0
                ? Math.Round(actualCompleted * 100.0 / cleanTarget, 1) : 0;
            var overallCompletion   = afterFlafScr > 0
                ? Math.Round(actualCompleted * 100.0 / afterFlafScr, 1) : 0;

            dto = new WellsReadinessDto(
                AsOfDate:            asOf.ToString("yyyy-MM-dd"),
                PlanYear:            year,
                OriginalPlan:        originalPlan,
                FlafScrExcluded:     flafScrExcluded,
                AfterFlafScr:        afterFlafScr,
                PdoIssuesExcluded:   pdoExcluded,
                CleanTarget:         cleanTarget,
                DueCompleted:        dueCompleted,
                NotDueAccelerated:   notDueAccel,
                ActualCompleted:     actualCompleted,
                WellsAccelerated:    wellsAccelerated,
                Remaining:           remaining,
                AtnmPerformancePct:  atnmPerformance,
                OverallCompletionPct:overallCompletion,
                OhlCompleted:        0
            );
        }
        cache.Set(cacheKey, dto, TimeSpan.FromMinutes(10));
        return dto;
    }

    /// <summary>
    /// Computes WellsReadiness funnel entirely from in-memory WmrSnapshotCache.
    /// Replicates the same CTE logic (SapPlan → WmrLatest → Tracked) but in LINQ
    /// over the pre-loaded snapshot — no DB hit, executes in &lt; 5ms.
    /// </summary>
    private static WellsReadinessDto ComputeWellsReadinessFromSnapshot(
        DateOnly fromDate, DateOnly toDate, DateOnly asOf, string? cluster, string? wellType, string? project)
    {
        var snap = WmrSnapshotCache.Instance;
        var planStart = fromDate;
        var planEnd = toDate;

        // Step 1: SAP-planned wells in date range (same as SapPlan CTE).
        // Filter individual SAP entries to date range FIRST, then group by Well_ID
        // taking MIN(PlanStart) — exactly replicating the SQL CTE behavior.
        var sapInRange = snap.SapRows
            .Where(s => s.PlanStart >= planStart && s.PlanStart <= planEnd)
            .GroupBy(s => s.WellId, StringComparer.OrdinalIgnoreCase)
            .Select(g => new { WellId = g.Key, PlanStart = g.Min(x => x.PlanStart) })
            .ToList();

        // Step 2: Build tracked wells (same logic as Tracked CTE in SQL)
        var tracked = new List<(string WellId, double Progress, DateOnly? WeekDate, string DerivedStatus)>();

        foreach (var sap in sapInRange)
        {
            snap.WmrByWell.TryGetValue(sap.WellId, out var wmr);
            if (wmr == null) continue; // Only count wells present in both SAP and WMR
            var progress = wmr?.Progress ?? 0;
            var weekDate = wmr?.WeekDate;
            var flafDate = wmr?.FlafDate;

            string derivedStatus;
            if (progress >= 1.0 && weekDate.HasValue && weekDate.Value < sap.PlanStart)
                derivedStatus = "Not Due Accelerated";
            else if (progress >= 1.0)
                derivedStatus = "Due Completed";
            else if (flafDate.HasValue && flafDate.Value <= asOf)
                derivedStatus = "FLAF/SCR & Other";
            else
                derivedStatus = "Backlog";

            tracked.Add((sap.WellId, progress, weekDate, derivedStatus));
        }

        // Removed: WMR-only wells not in SAP are no longer included.
        // Only wells present in BOTH SAP and WMR are counted.

        // Step 3: Apply cluster filter
        if (!string.IsNullOrWhiteSpace(cluster))
        {
            tracked = tracked.Where(t =>
            {
                snap.WmrByWell.TryGetValue(t.WellId, out var wmr);
                if (wmr?.ProjectId is null) return false;
                var projCluster = snap.GetCluster(wmr.ProjectId);
                return string.Equals(projCluster, cluster, StringComparison.OrdinalIgnoreCase);
            }).ToList();
        }

        // Step 4: Apply well type filter
        if (!string.IsNullOrWhiteSpace(wellType))
        {
            tracked = tracked.Where(t =>
            {
                snap.WmrByWell.TryGetValue(t.WellId, out var wmr);
                if (wmr?.ProjectId is null) return false;
                var projType = snap.GetWellType(wmr.ProjectId);
                return string.Equals(projType?.Trim(), wellType.Trim(), StringComparison.OrdinalIgnoreCase);
            }).ToList();
        }

        // Step 4b: Apply project filter
        if (!string.IsNullOrWhiteSpace(project))
        {
            tracked = tracked.Where(t =>
            {
                snap.WmrByWell.TryGetValue(t.WellId, out var wmr);
                if (wmr?.ProjectId is null) return false;
                var projName = snap.GetProject(wmr.ProjectId);
                return string.Equals(projName?.Trim(), project.Trim(), StringComparison.OrdinalIgnoreCase);
            }).ToList();
        }

        // Step 5: Compute funnel counts
        var originalPlan    = tracked.Count;
        var flafScrExcluded = tracked.Count(t => t.DerivedStatus == "FLAF/SCR & Other");
        var afterFlafScr    = originalPlan - flafScrExcluded;
        var actualCompleted = tracked.Count(t => t.DerivedStatus == "Due Completed" || t.DerivedStatus == "Not Due Accelerated");
        var notDueAccel     = tracked.Count(t => t.DerivedStatus == "Not Due Accelerated");
        var dueCompleted    = actualCompleted;

        var pdoIssueSet = snap.PdoIssueWells;
        var pdoExcluded = tracked.Count(t =>
            t.DerivedStatus == "Backlog"
            && pdoIssueSet.Contains(t.WellId));
        var cleanTarget         = afterFlafScr - pdoExcluded;
        var remaining           = Math.Max(0, cleanTarget - actualCompleted);
        var atnmPerformance     = cleanTarget > 0
            ? Math.Round(actualCompleted * 100.0 / cleanTarget, 1) : 0;
        var overallCompletion   = afterFlafScr > 0
            ? Math.Round(actualCompleted * 100.0 / afterFlafScr, 1) : 0;

        return new WellsReadinessDto(
            AsOfDate:            asOf.ToString("yyyy-MM-dd"),
            PlanYear:            fromDate.Year,
            OriginalPlan:        originalPlan,
            FlafScrExcluded:     flafScrExcluded,
            AfterFlafScr:        afterFlafScr,
            PdoIssuesExcluded:   pdoExcluded,
            CleanTarget:         cleanTarget,
            DueCompleted:        dueCompleted,
            NotDueAccelerated:   notDueAccel,
            ActualCompleted:     actualCompleted,
            WellsAccelerated:    notDueAccel,
            Remaining:           remaining,
            AtnmPerformancePct:  atnmPerformance,
            OverallCompletionPct:overallCompletion,
            OhlCompleted:        0
        );
    }

    /// <summary>
    /// Returns wells readiness for ALL well types in a single call using the in-memory snapshot.
    /// Eliminates N+1 per-type queries from the frontend.
    /// </summary>
    public Task<WellsReadinessByTypeDto> GetWellsReadinessByTypeAsync(
        DateOnly fromDate, DateOnly toDate, DateOnly? asOfDate = null, string? cluster = null, string? project = null, CancellationToken ct = default)
    {
        var asOf = asOfDate ?? toDate;
        var cacheKey = $"wells-readiness-by-type:{fromDate:yyyy-MM-dd}:{toDate:yyyy-MM-dd}:{asOf:yyyy-MM-dd}:{cluster ?? "all"}:{project ?? "all"}";
        if (cache.TryGetValue(cacheKey, out WellsReadinessByTypeDto? cached) && cached is not null)
            return Task.FromResult(cached);

        // Compute overall (no well type filter)
        var overall = ComputeWellsReadinessFromSnapshot(fromDate, toDate, asOf, cluster, null, project);

        // Get all distinct well types from the project info
        var snap = WmrSnapshotCache.Instance;
        var allTypes = snap.ProjectInfo.Values
            .Select(v => v.WellType)
            .Where(t => !string.IsNullOrWhiteSpace(t))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(t => t)
            .ToList();

        // Compute per-type breakdown using the same in-memory logic
        var byType = new List<WellsReadinessTypeBreakdownDto>(allTypes.Count);
        foreach (var wt in allTypes)
        {
            var typeDto = ComputeWellsReadinessFromSnapshot(fromDate, toDate, asOf, cluster, wt, project);
            if (typeDto.OriginalPlan == 0) continue; // Skip types with no wells in this scope
            byType.Add(new WellsReadinessTypeBreakdownDto(
                WellType: wt,
                OriginalPlan: typeDto.OriginalPlan,
                FlafScrExcluded: typeDto.FlafScrExcluded,
                AfterFlafScr: typeDto.AfterFlafScr,
                CleanTarget: typeDto.CleanTarget,
                ActualCompleted: typeDto.ActualCompleted,
                Remaining: typeDto.Remaining,
                AtnmPerformancePct: typeDto.AtnmPerformancePct));
        }

        var result = new WellsReadinessByTypeDto(overall, byType);
        cache.Set(cacheKey, result, TimeSpan.FromMinutes(10));
        return Task.FromResult(result);
    }

    /// <summary>
    /// Returns PIDs from AppMasterDB.dbo.ProjectIDs where the named column matches value.
    /// Results are cached for 30 minutes — same table/columns used by Cluster Health and DWC.
    /// Column must be one of: Cluster, Site, Type.
    /// </summary>
    private async Task<HashSet<string>> GetAppMasterPidsByColumnAsync(string column, string value, CancellationToken ct)
    {
        var cacheKey = $"appmaster-pids:{column}:{value}";
        if (cache.TryGetValue(cacheKey, out HashSet<string>? cached) && cached is not null)
            return cached;

        // column is internal-only ("Cluster" | "Site" | "Type") — not user input
        var sql = $"SELECT CAST(ID AS NVARCHAR(100)) FROM [dbo].[ProjectIDs] WITH (NOLOCK) WHERE NULLIF(LTRIM(RTRIM([{column}])), '') = @value";
        var conn = db.Database.GetDbConnection();
        await OpenWithRetryAsync(conn, ct);
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        var p = cmd.CreateParameter();
        p.ParameterName = "@value";
        p.Value = value;
        cmd.Parameters.Add(p);

        var pids = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        await using var rdr = await cmd.ExecuteReaderAsync(ct);
        while (await rdr.ReadAsync(ct))
            if (!rdr.IsDBNull(0)) pids.Add(rdr.GetString(0));

        cache.Set(cacheKey, pids, TimeSpan.FromMinutes(30));
        return pids;
    }

    public async Task<IReadOnlyList<CrewPRatingDistributionDto>> GetCrewPRatingDistributionAsync(
        string? cluster = null,
        string? wellType = null,
        string? site = null,
        string? project = null,
        DateOnly? from = null,
        DateOnly? to = null,
        CancellationToken ct = default)
    {
        CrewCache.Instance.RecordHit();

        // Do not serve base-load data (all PRating = null → 42 Unrated) before enrichment
        // has completed. Return empty so the frontend retry loop waits for real P-rating data.
        if (!CrewCache.Instance.IsEnriched)
            return Array.Empty<CrewPRatingDistributionDto>();

        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var startDate = from ?? today.AddDays(-90);
        var endDate   = to   ?? today;

        var crewGroupCodes = CrewCache.Instance.CrewGroupCodes;
        var rows = CrewCache.Instance.Rows;
        var crewPids = CrewCache.Instance.CrewProjectIds;

        // Filter by date range — same logic as CrewRepository.GetCrewListAsync
        IEnumerable<CrewCacheRow> filtered = rows.Where(c =>
        {
            var d = DateOnly.FromDateTime(c.LastActionOn);
            return d >= startDate && d <= endDate;
        });

        // Cluster filter — AppMasterDB.dbo.ProjectIDs [Cluster] (same as Cluster Health & DWC)
        if (!string.IsNullOrWhiteSpace(cluster))
        {
            var pids = await GetAppMasterPidsByColumnAsync("Cluster", cluster, ct);
            filtered = filtered.Where(c =>
                crewPids.TryGetValue(c.CrewCode, out var pidSet) && pidSet.Overlaps(pids));
        }

        // Site filter — AppMasterDB.dbo.ProjectIDs [Site] (same as Cluster Health & DWC)
        if (!string.IsNullOrWhiteSpace(site))
        {
            var pids = await GetAppMasterPidsByColumnAsync("Site", site, ct);
            filtered = filtered.Where(c =>
                crewPids.TryGetValue(c.CrewCode, out var pidSet) && pidSet.Overlaps(pids));
        }

        // WellType filter — AppMasterDB.dbo.ProjectIDs [Type] (same as Cluster Health & DWC)
        if (!string.IsNullOrWhiteSpace(wellType))
        {
            var pids = await GetAppMasterPidsByColumnAsync("Type", wellType, ct);
            filtered = filtered.Where(c =>
                crewPids.TryGetValue(c.CrewCode, out var pidSet) && pidSet.Overlaps(pids));
        }

        // Project filter — AppMasterDB.dbo.ProjectIDs [Project]
        if (!string.IsNullOrWhiteSpace(project))
        {
            var pids = await GetAppMasterPidsByColumnAsync("Project", project, ct);
            filtered = filtered.Where(c =>
                crewPids.TryGetValue(c.CrewCode, out var pidSet) && pidSet.Overlaps(pids));
        }

        // Deduplicate per crew group code, take the most recent row per group
        var deduped = filtered
            .Select(c => (Row: c, GroupCode: crewGroupCodes.FirstOrDefault(g => c.CrewCode.Contains(g, StringComparison.OrdinalIgnoreCase))))
            .Where(x => x.GroupCode is not null)
            .GroupBy(x => x.GroupCode!, StringComparer.OrdinalIgnoreCase)
            .Select(g => g.OrderByDescending(x => x.Row.LastActionOn).First().Row)
            .ToList();

        // Count by P-Rating; null/empty → tracked separately as "Unrated"
        var countByRating = deduped
            .Where(r => !string.IsNullOrWhiteSpace(r.PRating))
            .GroupBy(r => r.PRating!.Trim(), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.Count(), StringComparer.OrdinalIgnoreCase);

        var unratedCount = deduped.Count(r => string.IsNullOrWhiteSpace(r.PRating));

        var dist = new List<CrewPRatingDistributionDto>(10);
        for (var i = 0; i <= 8; i++)
        {
            var key = "P" + i;
            dist.Add(new CrewPRatingDistributionDto(key, countByRating.GetValueOrDefault(key, 0)));
        }
        dist.Add(new CrewPRatingDistributionDto("Unrated", unratedCount));

        return dist.AsReadOnly();
    }

    // â”€â”€â”€ PDO Commissioning Status â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    public async Task<CommissioningStatusDto> GetCommissioningStatusAsync(
        string? cluster = null,
        string? wellId = null,
        DateOnly? startDate = null,
        DateOnly? endDate = null,
        string? wellType = null,
        string? project = null,
        CancellationToken ct = default)
    {
        var cacheKey = $"commissioning-status:{cluster ?? "all"}:{wellId ?? "all"}:{startDate?.ToString("yyyy-MM-dd") ?? "all"}:{endDate?.ToString("yyyy-MM-dd") ?? "all"}:{wellType ?? "all"}:{project ?? "all"}";
        if (cache.TryGetValue(cacheKey, out CommissioningStatusDto? cached) && cached is not null)
            return cached;

        var filterParts = new List<string>();
        filterParts.Add("[pdo_well_id] IS NOT NULL AND [pdo_well_id] <> ''");
        if (!string.IsNullOrEmpty(cluster)) filterParts.Add("[Cluster] = @cluster");
        if (!string.IsNullOrEmpty(wellId))  filterParts.Add("[pdo_well_id] = @wellId");
        if (startDate.HasValue) filterParts.Add("TRY_CAST([actual_rig_off_date] AS DATE) >= @startDate");
        if (endDate.HasValue)   filterParts.Add("TRY_CAST([actual_rig_off_date] AS DATE) <= @endDate");
        if (!string.IsNullOrEmpty(wellType)) filterParts.Add(WellTypeFilter(""));
        if (!string.IsNullOrEmpty(project)) filterParts.Add(ProjectFilter(""));

        var where = string.Join(" AND ", filterParts);

        var sql = $"""
            SELECT
                COUNT(*) AS TotalReady,
                COUNT(CASE WHEN [actual_comm._finish_date_with_in_2_days_from_actual_engg._completion_date] IS NOT NULL THEN 1 END) AS Commissioned,
                COUNT(CASE WHEN [actual_comm._finish_date_with_in_2_days_from_actual_engg._completion_date] IS NULL THEN 1 END) AS NotCommissioned,
                SUM(CASE WHEN [actual_comm._finish_date_with_in_2_days_from_actual_engg._completion_date] IS NULL
                         AND ISNULL([buffer_status], '') = '' THEN 1 ELSE 0 END) AS BacklogInCommissioning,
                SUM(CASE WHEN [actual_comm._finish_date_with_in_2_days_from_actual_engg._completion_date] IS NULL
                         AND ISNULL([buffer_status], '') = ''
                         AND TRY_CAST([actual_rig_off_date] AS DATE) IS NOT NULL
                         AND DATEDIFF(DAY, TRY_CAST([actual_rig_off_date] AS DATE), GETDATE()) > 5 THEN 1 ELSE 0 END) AS AtRisk,
                SUM(CASE WHEN [actual_comm._finish_date_with_in_2_days_from_actual_engg._completion_date] IS NULL
                         AND ISNULL([buffer_status], '') = ''
                         AND TRY_CAST([actual_rig_off_date] AS DATE) IS NOT NULL
                         AND DATEDIFF(DAY, TRY_CAST([actual_rig_off_date] AS DATE), GETDATE()) <= 5 THEN 1 ELSE 0 END) AS Due,
                SUM(CASE WHEN ISNULL([buffer_status], '') <> '' THEN 1 ELSE 0 END) AS SuspendedWells,
                CAST(ROUND(
                    COUNT(CASE WHEN [actual_comm._finish_date_with_in_2_days_from_actual_engg._completion_date] IS NOT NULL THEN 1 END) * 1.0
                    / NULLIF(COUNT(*), 0) * 100, 1
                ) AS DECIMAL(5,1)) AS ReadinessPct
            FROM [dbo].[WellMonitoringReportOptimized] WITH (NOLOCK)
            WHERE {where};
            """;
        var connStr = db.Database.GetConnectionString()!;
        await using var conn = new SqlConnection(connStr);
        await OpenWithRetryAsync(conn, ct);

        await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 120 };
        if (!string.IsNullOrEmpty(cluster)) cmd.Parameters.AddWithValue("@cluster", cluster);
        if (!string.IsNullOrEmpty(wellId))  cmd.Parameters.AddWithValue("@wellId", wellId);
        if (startDate.HasValue) cmd.Parameters.AddWithValue("@startDate", startDate.Value.ToDateTime(TimeOnly.MinValue));
        if (endDate.HasValue)   cmd.Parameters.AddWithValue("@endDate", endDate.Value.ToDateTime(TimeOnly.MinValue));
        if (!string.IsNullOrEmpty(wellType)) cmd.Parameters.AddWithValue("@wellType", wellType);
        if (!string.IsNullOrEmpty(project)) cmd.Parameters.AddWithValue("@project", project);

        await using var rdr = await cmd.ExecuteReaderAsync(ct);
        await rdr.ReadAsync(ct);

        var totalReady             = rdr.IsDBNull(0) ? 0 : rdr.GetInt32(0);
        var commissioned           = rdr.IsDBNull(1) ? 0 : rdr.GetInt32(1);
        var notCommissioned        = rdr.IsDBNull(2) ? 0 : rdr.GetInt32(2);
        var backlogInCommissioning = rdr.IsDBNull(3) ? 0 : rdr.GetInt32(3);
        var atRisk                 = rdr.IsDBNull(4) ? 0 : rdr.GetInt32(4);
        var due                    = rdr.IsDBNull(5) ? 0 : rdr.GetInt32(5);
        var suspendedWells         = rdr.IsDBNull(6) ? 0 : rdr.GetInt32(6);
        var readinessPct           = rdr.IsDBNull(7) ? 0.0 : (double)rdr.GetDecimal(7);

        var status = readinessPct >= 90 ? "On Track" : readinessPct >= 70 ? "At Risk" : "Behind";

        var result = new CommissioningStatusDto(
            TotalReady:             totalReady,
            Commissioned:           commissioned,
            NotCommissioned:        notCommissioned,
            BacklogInCommissioning: backlogInCommissioning,
            AtRisk:                 atRisk,
            Due:                    due,
            SuspendedWells:         suspendedWells,
            ReadinessPct:           readinessPct,
            LastYearPct:            null,
            Status:                 status,
            AsOfDate:               DateTime.UtcNow.ToString("yyyy-MM-dd")
        );

        cache.Set(cacheKey, result, CacheDuration);
        return result;
    }

    // ─── Commissioning Progress ───────────────────────────────────────────────

    public async Task<CommissioningProgressResponse> GetCommissioningProgressAsync(
        int? fiscalYear = null,
        DateOnly? asOfDate = null,
        CancellationToken ct = default)
    {
        // PDO fiscal year runs Oct–Sep.  FY2026 means Oct 2025 – Sep 2026.
        var today     = DateOnly.FromDateTime(DateTime.UtcNow);
        var asOf      = asOfDate ?? today;

        // Derive fiscal year from asOf if not provided.
        // If the current month is Oct–Dec, fiscal year = current year + 1; else = current year.
        var fy = fiscalYear ?? (asOf.Month >= 10 ? asOf.Year + 1 : asOf.Year);

        var cacheKey = $"commissioning-progress:{fy}:{asOf:yyyy-MM-dd}";
        if (cache.TryGetValue(cacheKey, out CommissioningProgressResponse? cached) && cached is not null)
            return cached;

        // Fiscal year boundaries: Oct (fy-1) – Sep (fy)
        var fyStart = new DateTime(fy - 1, 10, 1);
        var fyEnd   = new DateTime(fy,     9, 30);
        var asOfDt  = asOf.ToDateTime(TimeOnly.MinValue);

        // Month ordinals 1–12 mapped to fiscal sequence 1 (Oct) … 12 (Sep)
        // so that ORDER BY fiscal month works correctly.
        const string sql = """
            SET NOCOUNT ON;

            -- ── Parameters provided externally ──────────────────────────────────
            -- @fyStart  : first day of fiscal year (Oct yyyy-1)
            -- @fyEnd    : last  day of fiscal year (Sep yyyy)
            -- @asOfDate : cut-off date
            -- @currentFiscalMonth : 1-based fiscal month index of @asOfDate

            ;WITH
            -- All wells that became ready (handover-2) within the fiscal year
            PlannedWells AS (
                SELECT
                    [pdo_well_id],
                    TRY_CAST([wellpad_handover-2_from_hoist_fbu_rsr_off_date] AS DATE) AS ReadyDate,
                    TRY_CAST([actual_comm._finish_date_with_in_2_days_from_actual_engg._completion_date] AS DATE) AS CommDate
                FROM [dbo].[WellMonitoringReportOptimized] WITH (NOLOCK)
                WHERE TRY_CAST([wellpad_handover-2_from_hoist_fbu_rsr_off_date] AS DATE)
                          BETWEEN @fyStart AND @fyEnd
                  AND [pdo_well_id] IS NOT NULL
                  AND [pdo_well_id] <> ''
            ),
            TotalPlanned AS (
                SELECT COUNT(*) AS TotalCount FROM PlannedWells
            ),
            -- Fiscal months table: fiscal month 1 = Oct, 12 = Sep
            FiscalMonths AS (
                SELECT fm, cal_month, label
                FROM (VALUES
                    (1,  10, 'Oct'), (2,  11, 'Nov'), (3,  12, 'Dec'),
                    (4,   1, 'Jan'), (5,   2, 'Feb'), (6,   3, 'Mar'),
                    (7,   4, 'Apr'), (8,   5, 'May'), (9,   6, 'Jun'),
                    (10,  7, 'Jul'), (11,  8, 'Aug'), (12,  9, 'Sep')
                ) v(fm, cal_month, label)
            ),
            -- Count commissioned wells per fiscal month (by CommDate)
            MonthlyCommissioned AS (
                SELECT
                    CASE
                        WHEN MONTH(CommDate) >= 10 THEN MONTH(CommDate) - 9
                        ELSE MONTH(CommDate) + 3
                    END AS FiscalMonth,
                    COUNT(*) AS CommCount
                FROM PlannedWells
                WHERE CommDate IS NOT NULL
                  AND CommDate <= @asOfDate
                GROUP BY
                    CASE
                        WHEN MONTH(CommDate) >= 10 THEN MONTH(CommDate) - 9
                        ELSE MONTH(CommDate) + 3
                    END
            ),
            -- Cumulative count per fiscal month up to asOf
            Cumulative AS (
                SELECT
                    fm.fm,
                    fm.cal_month,
                    fm.label,
                    SUM(ISNULL(mc.CommCount, 0)) OVER (ORDER BY fm.fm) AS CumulativeCommissioned,
                    tp.TotalCount
                FROM FiscalMonths fm
                CROSS JOIN TotalPlanned tp
                LEFT JOIN MonthlyCommissioned mc ON fm.fm = mc.FiscalMonth
            )
            SELECT
                label                  AS MonthLabel,
                fm                     AS FiscalMonth,
                CASE WHEN fm > @currentFiscalMonth THEN 1 ELSE 0 END AS IsForecast,
                CAST(ROUND(
                    CAST(CumulativeCommissioned AS FLOAT)
                    / NULLIF(TotalCount, 0) * 100.0, 1
                ) AS DECIMAL(5,1))     AS ActualCompletionPct,
                100.0                  AS PlanTargetPct,
                -- KPI scalars repeated on every row for simplicity
                TotalCount             AS TotalPlanned,
                (SELECT COUNT(*) FROM PlannedWells WHERE CommDate IS NOT NULL AND CommDate <= @asOfDate)
                                       AS TotalCommissioned
            FROM Cumulative
            ORDER BY fm;
            """;

        // Derive the current fiscal month index (1=Oct … 12=Sep)
        var currentFiscalMonth = asOf.Month >= 10 ? asOf.Month - 9 : asOf.Month + 3;

        var connStr = db.Database.GetConnectionString()!;
        await using var conn = new SqlConnection(connStr);
        await OpenWithRetryAsync(conn, ct);

        await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 60 };
        cmd.Parameters.AddWithValue("@fyStart",            fyStart);
        cmd.Parameters.AddWithValue("@fyEnd",              fyEnd);
        cmd.Parameters.AddWithValue("@asOfDate",           asOfDt);
        cmd.Parameters.AddWithValue("@currentFiscalMonth", currentFiscalMonth);

        await using var rdr = await cmd.ExecuteReaderAsync(ct);

        var months      = new List<CommissioningProgressMonthDto>();
        int totalPlanned      = 0;
        int totalCommissioned = 0;

        while (await rdr.ReadAsync(ct))
        {
            var actualPct = rdr.IsDBNull(3) ? 0.0 : (double)rdr.GetDecimal(3);
            var planPct   = (double)rdr.GetDecimal(4);
            totalPlanned      = rdr.IsDBNull(5) ? 0 : rdr.GetInt32(5);
            totalCommissioned = rdr.IsDBNull(6) ? 0 : rdr.GetInt32(6);

            months.Add(new CommissioningProgressMonthDto(
                MonthLabel:          rdr.GetString(0),
                MonthNum:            rdr.GetInt32(1),
                IsForecast:          rdr.GetInt32(2) == 1,
                ActualCompletionPct: actualPct,
                PlanTargetPct:       planPct));
        }

        var overallPct = totalPlanned > 0
            ? Math.Round(totalCommissioned / (double)totalPlanned * 100.0, 1)
            : 0.0;

        var kpi = new CommissioningProgressKpiDto(
            TotalPlanned:      totalPlanned,
            TotalCommissioned: totalCommissioned,
            CompletionPct:     overallPct,
            PlanTargetPct:     100.0);

        var result = new CommissioningProgressResponse(
            AsOfDate:   asOf.ToString("yyyy-MM-dd"),
            FiscalYear: fy,
            Kpi:        kpi,
            MonthlyTrend: months);

        cache.Set(cacheKey, result, TimeSpan.FromMinutes(15));
        return result;
    }


    // â”€â”€â”€ Buffer Flowlines Ready â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    public async Task<BufferFlowlinesReadyDto> GetBufferFlowlinesReadyAsync(
        string? cluster = null,
        string? wellId = null,
        DateOnly? startDate = null,
        DateOnly? endDate = null,
        string? wellType = null,
        string? project = null,
        CancellationToken ct = default)
    {
        var cacheKey = $"buffer-flowlines-ready:{cluster ?? "all"}:{wellId ?? "all"}:{startDate?.ToString("yyyy-MM-dd") ?? "all"}:{endDate?.ToString("yyyy-MM-dd") ?? "all"}:{wellType ?? "all"}:{project ?? "all"}";
        if (cache.TryGetValue(cacheKey, out BufferFlowlinesReadyDto? cached) && cached is not null)
            return cached;

        var year = DateTime.UtcNow.Year;
        var asOf = DateOnly.FromDateTime(DateTime.UtcNow);

        // Build optional filter clauses — applied AFTER dedup to avoid changing which row wins
        var postWhere = "";
        if (!string.IsNullOrEmpty(cluster)) postWhere += " AND " + ClusterFilter(cluster, "wl.[pdo_well_id]").Replace("wl.project_id", "wl.project_id");
        if (!string.IsNullOrEmpty(wellId))  postWhere += " AND wl.[pdo_well_id] = @wellId";
        if (!string.IsNullOrEmpty(wellType)) postWhere += " AND " + WellTypeFilter("wl");
        if (!string.IsNullOrEmpty(project)) postWhere += " AND " + ProjectFilter("wl");

        // Use the same logic as Flowline Readiness (SAP plan + WMR fl_done flag)
        // but group by cluster (via ProjectIDs) to show Marmul / Nimr breakdown.
        var sql = $"""
            SET NOCOUNT ON;
            DECLARE @Year INT = @yearParam;
            DECLARE @AsOfDate DATE = @asOfParam;
            DECLARE @YearStart DATE = COALESCE(@startDateParam, DATEFROMPARTS(@Year, 1, 1));
            DECLARE @YearEnd   DATE = COALESCE(@endDateParam, DATEFROMPARTS(@Year + 1, 1, 1));

            ;WITH sap_planned AS (
                SELECT DISTINCT s.Well_ID
                FROM dbo.SAP_DRILLING_SEQUENCE_History s WITH (NOLOCK)
                WHERE s.Well_ID IS NOT NULL AND s.Well_ID <> ''
                  AND s.Well_Function NOT IN ('Unspecified', 'RIG MOVE', 'RIG MAINTENANCE')
                  AND TRY_CAST(s.Earl_start_date AS DATE) >= @YearStart
                  AND TRY_CAST(s.Earl_start_date AS DATE) <  @YearEnd
            ),
            WmrLatest AS (
                SELECT pdo_well_id,
                       project_id,
                       CASE WHEN TRY_CAST([overall_const._10_100] AS FLOAT) = 100
                              OR [flow_line_const._status_in_progress_completed] = 'Completed'
                              OR ([const._complete_date_including_f_l_final_hydro_test_1_day_before_rig_on_date] IS NOT NULL
                                  AND LTRIM(RTRIM([const._complete_date_including_f_l_final_hydro_test_1_day_before_rig_on_date])) != '')
                            THEN 1 ELSE 0 END AS fl_done
                FROM (
                    SELECT w.*,
                           ROW_NUMBER() OVER (
                               PARTITION BY w.pdo_well_id
                               ORDER BY w.actual_rig_off_date DESC,
                                        w.flaf_issue_date DESC,
                                        w.over_all_progress_percentages DESC, w.project_id
                           ) AS rn
                    FROM dbo.WMR w WITH (NOLOCK)
                    INNER JOIN (
                        SELECT pdo_well_id, MAX(Week_Number) AS max_wk
                        FROM dbo.WMR WITH (NOLOCK)
                        WHERE pdo_well_id IS NOT NULL AND pdo_well_id <> ''
                          AND COALESCE(TRY_CAST(Week_Number AS DATE), TRY_CONVERT(DATE, Week_Number, 5)) <= @AsOfDate
                        GROUP BY pdo_well_id
                    ) lts ON w.pdo_well_id = lts.pdo_well_id AND w.Week_Number = lts.max_wk
                    WHERE w.pdo_well_id IS NOT NULL AND w.pdo_well_id <> ''
                ) deduped
                WHERE rn = 1
            ),
            Completed AS (
                SELECT wl.pdo_well_id, wl.project_id
                FROM sap_planned sp
                INNER JOIN WmrLatest wl ON sp.Well_ID = wl.pdo_well_id
                WHERE wl.fl_done = 1
                {postWhere}
            )
            SELECT
                ISNULL(p.[Cluster], 'OTHER') AS Area,
                COUNT(*) AS Cnt
            FROM Completed c
            LEFT JOIN (
                SELECT CAST(ID AS NVARCHAR(100)) AS ID, MIN(UPPER(LTRIM(RTRIM([Cluster])))) AS [Cluster]
                FROM [dbo].[ProjectIDs] WITH (NOLOCK)
                GROUP BY ID
            ) p ON c.project_id = p.ID
            GROUP BY ISNULL(p.[Cluster], 'OTHER')
            ORDER BY Cnt DESC;
            """;

        var connStr = db.Database.GetConnectionString()!;
        await using var conn = new SqlConnection(connStr);
        await OpenWithRetryAsync(conn, ct);

        await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 120 };
        cmd.Parameters.AddWithValue("@yearParam", year);
        cmd.Parameters.AddWithValue("@asOfParam", asOf.ToDateTime(TimeOnly.MinValue));
        cmd.Parameters.AddWithValue("@startDateParam", startDate.HasValue ? (object)startDate.Value.ToDateTime(TimeOnly.MinValue) : DBNull.Value);
        cmd.Parameters.AddWithValue("@endDateParam", endDate.HasValue ? (object)endDate.Value.ToDateTime(TimeOnly.MinValue) : DBNull.Value);
        if (!string.IsNullOrEmpty(cluster)) cmd.Parameters.AddWithValue("@cluster", cluster);
        if (!string.IsNullOrEmpty(wellId))  cmd.Parameters.AddWithValue("@wellId", wellId);
        if (!string.IsNullOrEmpty(wellType)) cmd.Parameters.AddWithValue("@wellType", wellType);
        if (!string.IsNullOrEmpty(project)) cmd.Parameters.AddWithValue("@project", project);

        await using var rdr = await cmd.ExecuteReaderAsync(ct);

        var areas = new List<BufferFlowlineAreaDto>();
        var total = 0;
        while (await rdr.ReadAsync(ct))
        {
            var area = rdr.GetString(0);
            // Normalize cluster name to title case for display
            area = area.Length > 0
                ? char.ToUpper(area[0]) + area[1..].ToLower()
                : area;
            var cnt  = rdr.GetInt32(1);
            areas.Add(new BufferFlowlineAreaDto(area, cnt, 0));
            total += cnt;
        }

        // Recalculate percentages
        var areasWithPct = areas.Select(a => a with { Pct = total > 0 ? Math.Round(a.Count * 100.0 / total, 1) : 0 }).ToList();

        // Ensure known areas are present (even if zero)
        var knownAreas = new[] { "Marmul", "Nimr" };
        foreach (var ka in knownAreas)
        {
            if (!areasWithPct.Any(a => string.Equals(a.Area, ka, StringComparison.OrdinalIgnoreCase)))
                areasWithPct.Add(new BufferFlowlineAreaDto(ka, 0, 0));
        }

        // Sort: Marmul first, Nimr second, others last
        areasWithPct = areasWithPct
            .OrderBy(a => string.Equals(a.Area, "Marmul", StringComparison.OrdinalIgnoreCase) ? 0
                       : string.Equals(a.Area, "Nimr", StringComparison.OrdinalIgnoreCase) ? 1 : 2)
            .ToList();

        var readinessStatus = total >= 30 ? "Good" : total >= 15 ? "Moderate" : "Low";

        var result = new BufferFlowlinesReadyDto(
            TotalReady: total,
            Status:     readinessStatus,
            AsOfDate:   DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm"),
            Areas:      areasWithPct
        );

        cache.Set(cacheKey, result, TimeSpan.FromMinutes(10));
        return result;
    }

    // â”€â”€â”€ Construction Well Delivery Flowline & OHL Progress â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    public async Task<ConstructionProgressResponse> GetConstructionProgressAsync(
        int? planYear = null,
        DateOnly? asOfDate = null,
        string? cluster = null,
        string? wellId = null,
        DateOnly? fromDate = null,
        DateOnly? toDate = null,
        string? wellType = null,
        string? site = null,
        string? project = null,
        CancellationToken ct = default)
    {
        var year = planYear ?? DateTime.UtcNow.Year;
        var asOf = asOfDate ?? DateOnly.FromDateTime(DateTime.UtcNow);
        var cacheKey = $"construction-progress:{year}:{asOf:yyyy-MM-dd}:{cluster ?? "all"}:{wellId ?? "all"}:{wellType ?? "all"}:{site ?? "all"}:{project ?? "all"}:{fromDate?.ToString("yyyy-MM-dd") ?? "x"}:{toDate?.ToString("yyyy-MM-dd") ?? "x"}";
        if (cache.TryGetValue(cacheKey, out ConstructionProgressResponse? cached) && cached is not null)
            return cached;

        var currentMonth = Math.Min(asOf.Year == year ? asOf.Month : 12, toDate.HasValue ? toDate.Value.Month : 12);

        // Effective date range — honour fromDate/toDate when provided
        var effFrom = fromDate ?? new DateOnly(year, 1, 1);
        var effTo   = toDate   ?? new DateOnly(year, 12, 31);
        var startMonth = effFrom.Month;
        var endMonth   = effTo.Month;
        // If from/to span across years, cap to 12
        if (effTo.Year > effFrom.Year) endMonth = 12;

        var rangeDays = (effTo.ToDateTime(TimeOnly.MinValue) - effFrom.ToDateTime(TimeOnly.MinValue)).Days;
        var isDayLevel = rangeDays <= 14;
        // Build optional filter clauses.
        // extraWhere    : inside the unaliased WMR inner subquery (no 'w.' prefix).
        // postDedupWhere: after rn=1 dedup where outer alias is 'w'.
        // sapWhere      : inside SapPlan / SapPlan2 (SAP_DRILLING_SEQUENCE_History),
        //                 which has no project_id — so we filter by Well_ID via WMR.
        var extraWhere     = "";
        var postDedupWhere = "";
        var sapWhere       = "";
        if (!string.IsNullOrEmpty(cluster))
        {
            // Use well-membership filter (pdo_well_id IN ...) instead of row-level project_id filter.
            // This ensures ALL rows for cluster wells participate in the ROW_NUMBER dedup,
            // so the true latest WMR snapshot is selected — prevents TotalCompleted being lower
            // in "All Clusters" view than the sum of individual cluster views.
            var clusterWellSubq = "SELECT DISTINCT pdo_well_id FROM dbo.WMR WITH (NOLOCK) WHERE pdo_well_id IS NOT NULL AND project_id IN (SELECT CAST(ID AS NVARCHAR(100)) FROM [dbo].[ProjectIDs] WITH (NOLOCK) WHERE LTRIM(RTRIM(CAST([Cluster] AS NVARCHAR(200)))) = @cluster)";
            extraWhere += $" AND pdo_well_id IN ({clusterWellSubq})";
            sapWhere   += $" AND Well_ID IN ({clusterWellSubq})";
        }
        if (!string.IsNullOrEmpty(wellId))
        {
            extraWhere += " AND pdo_well_id = @wellId";
            sapWhere   += " AND Well_ID = @wellId";
        }
        if (!string.IsNullOrEmpty(wellType))
        {
            extraWhere += " AND " + WellTypeFilter("");
            sapWhere   += " AND Well_ID IN (SELECT DISTINCT pdo_well_id FROM dbo.WMR WITH (NOLOCK) WHERE pdo_well_id IS NOT NULL AND " + WellTypeFilter("") + ")";
        }
        if (!string.IsNullOrEmpty(site))
        {
            extraWhere += " AND " + SiteFilter("");
            sapWhere   += " AND Well_ID IN (SELECT DISTINCT pdo_well_id FROM dbo.WMR WITH (NOLOCK) WHERE pdo_well_id IS NOT NULL AND " + SiteFilter("") + ")";
        }
        if (!string.IsNullOrEmpty(project))
        {
            // Primary-project filter: only wells whose MOST RECENT WMR row is in this project.
            // This ensures each well is counted in exactly one project so individual project
            // Plan counts sum to the "All Projects" total (no double-counting).
            var primaryProjectSubq =
                "SELECT lp.pdo_well_id " +
                "FROM (" +
                "    SELECT pdo_well_id, project_id," +
                "           ROW_NUMBER() OVER (" +
                "               PARTITION BY pdo_well_id" +
                "               ORDER BY COALESCE(TRY_CAST(Week_Number AS DATE), TRY_CONVERT(DATE, Week_Number, 5)) DESC" +
                "           ) AS rn " +
                "    FROM dbo.WMR WITH (NOLOCK)" +
                "    WHERE pdo_well_id IS NOT NULL AND pdo_well_id <> ''" +
                ") lp " +
                "WHERE lp.rn = 1 AND lp." + ProjectFilter("");
            extraWhere += $" AND pdo_well_id IN ({primaryProjectSubq})";
            sapWhere   += $" AND Well_ID IN ({primaryProjectSubq})";
        }

        // "All Clusters" consistency: require WMR tracking so Plan(All) = Plan(NIMR) + Plan(MARMUL).
        // Without this, 326 untracked SAP wells (no WMR rows) inflate the All Clusters count.
        if (string.IsNullOrEmpty(cluster))
        {
            sapWhere += " AND Well_ID IN (SELECT DISTINCT pdo_well_id FROM dbo.WMR WITH (NOLOCK) WHERE pdo_well_id IS NOT NULL AND pdo_well_id <> '')";
        }

        // Always use full year (Jan 1 to Dec 31) — same approach as wells-readiness
        // ── Build trend SQL (Result Set 2) — day-level for ≤14 day ranges, month-level otherwise ──
        string trendSql;
        if (isDayLevel)
        {
            trendSql = $"""
            -- ═══════════════════════════════════════════════════════════════
            -- Result Set 2: Daily Cumulative Trend (short range ≤ 14 days)
            -- ═══════════════════════════════════════════════════════════════
            ;WITH SapPlan2 AS (
                SELECT Well_ID,
                       MIN(TRY_CAST(Earl_start_date AS DATE)) AS PlanStart,
                       CAST(MIN(TRY_CAST(Earl_start_date AS DATE)) AS DATE) AS PlanDay
                FROM dbo.SAP_DRILLING_SEQUENCE_History WITH (NOLOCK)
                WHERE Well_ID IS NOT NULL AND Well_ID <> ''
                  AND Well_Function NOT IN ('Unspecified', 'RIG MOVE', 'RIG MAINTENANCE')
                  AND TRY_CAST(Earl_start_date AS DATE) >= @YearStart
                  AND TRY_CAST(Earl_start_date AS DATE) <  @YearEnd
                  {sapWhere}
                GROUP BY Well_ID
            ),
            WmrLatest2 AS (
                SELECT w.pdo_well_id,
                       w.flaf_issue_date,
                       w.scr_no,
                       TRY_CAST(w.scr_date AS DATE) AS scr_dt,
                       w._fl  AS fl_done,
                       w._ohl AS ohl_done
                FROM (
                    SELECT b.*,
                           ROW_NUMBER() OVER (
                               PARTITION BY b.pdo_well_id
                               ORDER BY b.wk_date DESC, b._fl DESC, b._ohl DESC
                           ) AS rn
                    FROM (
                        SELECT *,
                               COALESCE(TRY_CAST(Week_Number AS DATE), TRY_CONVERT(DATE, Week_Number, 5)) AS wk_date,
                               CASE WHEN TRY_CAST([overall_const._10_100] AS FLOAT) = 100
                                      OR [flow_line_const._status_in_progress_completed] = 'Completed'
                                      OR ([const._complete_date_including_f_l_final_hydro_test_1_day_before_rig_on_date] IS NOT NULL
                                          AND LTRIM(RTRIM([const._complete_date_including_f_l_final_hydro_test_1_day_before_rig_on_date])) != '')
                                    THEN 1 ELSE 0 END AS _fl,
                               CASE WHEN TRY_CAST([overall_ohl_progr_100] AS FLOAT) = 100
                                      OR (ohl_completion_date IS NOT NULL
                                          AND LTRIM(RTRIM(ohl_completion_date)) != '')
                                    THEN 1 ELSE 0 END AS _ohl
                        FROM dbo.WMR WITH (NOLOCK)
                        WHERE pdo_well_id IS NOT NULL AND pdo_well_id <> ''
                          AND COALESCE(TRY_CAST(Week_Number AS DATE), TRY_CONVERT(DATE, Week_Number, 5)) <= @AsOfDate
                          {extraWhere}
                    ) b
                ) w
                WHERE w.rn = 1
                {postDedupWhere}
            ),
            days AS (
                SELECT CAST(@fromParam AS DATE) AS d
                UNION ALL
                SELECT DATEADD(DAY, 1, d) FROM days WHERE d < @toParam
            ),
            plan_by_day AS (
                SELECT sp.PlanDay AS dt,
                       COUNT(*) AS plan_count,
                       SUM(CASE WHEN wl.flaf_issue_date IS NOT NULL
                                 AND LTRIM(RTRIM(wl.flaf_issue_date)) != ''
                                 AND DATEDIFF(DAY, TRY_CAST(wl.flaf_issue_date AS DATE), sp.PlanStart) >= @FlafDays
                                 AND (wl.scr_no IS NULL OR wl.scr_dt IS NULL OR DATEDIFF(DAY, wl.scr_dt, sp.PlanStart) > @ScrDays)
                            THEN 1 ELSE 0 END) AS modified_count
                FROM SapPlan2 sp
                LEFT JOIN WmrLatest2 wl ON sp.Well_ID = wl.pdo_well_id
                GROUP BY sp.PlanDay
            ),
            actual_by_day AS (
                SELECT sp.PlanDay AS dt,
                       SUM(CASE WHEN wl.fl_done = 1 AND wl.ohl_done = 1 AND sp.PlanStart < GETDATE() THEN 1 ELSE 0 END) AS actual_due,
                       SUM(CASE WHEN wl.fl_done = 1 AND wl.ohl_done = 1 AND sp.PlanStart >= GETDATE() THEN 1 ELSE 0 END) AS accelerated,
                       SUM(CASE WHEN wl.fl_done = 1 AND wl.ohl_done = 1
                                 AND wl.flaf_issue_date IS NOT NULL AND LTRIM(RTRIM(wl.flaf_issue_date)) != ''
                                 AND DATEDIFF(DAY, TRY_CAST(wl.flaf_issue_date AS DATE), sp.PlanStart) >= @FlafDays
                                 AND (wl.scr_no IS NULL OR wl.scr_dt IS NULL OR DATEDIFF(DAY, wl.scr_dt, sp.PlanStart) > @ScrDays)
                            THEN 1 ELSE 0 END) AS clean_actual
                FROM SapPlan2 sp
                INNER JOIN WmrLatest2 wl ON sp.Well_ID = wl.pdo_well_id
                GROUP BY sp.PlanDay
            )
            SELECT
                FORMAT(dy.d, 'MMM dd') AS MonthLabel,
                CAST(ROW_NUMBER() OVER (ORDER BY dy.d) AS INT) AS MonthNum,
                CASE WHEN dy.d <= CAST(GETDATE() AS DATE) THEN 0 ELSE 1 END AS IsForecast,
                SUM(ISNULL(p.plan_count, 0)) OVER (ORDER BY dy.d ROWS UNBOUNDED PRECEDING) AS Plan_PdoRigSequence_Cumulative,
                SUM(ISNULL(p.modified_count, 0)) OVER (ORDER BY dy.d ROWS UNBOUNDED PRECEDING) AS Plan_FlafScrAdjusted_Cumulative,
                SUM(ISNULL(p.modified_count, 0)) OVER (ORDER BY dy.d ROWS UNBOUNDED PRECEDING) AS Plan_PdoIssuesRemoved_Cumulative,
                SUM(ISNULL(a.actual_due, 0)) OVER (ORDER BY dy.d ROWS UNBOUNDED PRECEDING) AS Actual_DueCompleted_Cumulative,
                SUM(ISNULL(a.accelerated, 0)) OVER (ORDER BY dy.d ROWS UNBOUNDED PRECEDING) AS Actual_NotDueAccelerated_Cumulative,
                (SUM(ISNULL(a.clean_actual, 0)) OVER (ORDER BY dy.d ROWS UNBOUNDED PRECEDING))
                - (SUM(ISNULL(p.modified_count, 0)) OVER (ORDER BY dy.d ROWS UNBOUNDED PRECEDING)) AS Backlog
            FROM days dy
            LEFT JOIN plan_by_day   p ON dy.d = p.dt
            LEFT JOIN actual_by_day a ON dy.d = a.dt
            ORDER BY dy.d
            OPTION (MAXRECURSION 31);
            """;
        }
        else
        {
            trendSql = $"""
            -- ═══════════════════════════════════════════════════════════════
            -- Result Set 2: Monthly Cumulative Trend (Chart Lines)
            -- ═══════════════════════════════════════════════════════════════
            ;WITH SapPlan2 AS (
                SELECT Well_ID,
                       MIN(TRY_CAST(Earl_start_date AS DATE)) AS PlanStart,
                       MONTH(MIN(TRY_CAST(Earl_start_date AS DATE))) AS PlanMonth
                FROM dbo.SAP_DRILLING_SEQUENCE_History WITH (NOLOCK)
                WHERE Well_ID IS NOT NULL AND Well_ID <> ''
                  AND Well_Function NOT IN ('Unspecified', 'RIG MOVE', 'RIG MAINTENANCE')
                  AND TRY_CAST(Earl_start_date AS DATE) >= @YearStart
                  AND TRY_CAST(Earl_start_date AS DATE) <  @YearEnd
                  {sapWhere}
                GROUP BY Well_ID
            ),
            WmrLatest2 AS (
                SELECT w.pdo_well_id,
                       w.flaf_issue_date,
                       w.scr_no,
                       TRY_CAST(w.scr_date AS DATE) AS scr_dt,
                       w._fl  AS fl_done,
                       w._ohl AS ohl_done
                FROM (
                    SELECT b.*,
                           ROW_NUMBER() OVER (
                               PARTITION BY b.pdo_well_id
                               ORDER BY b.wk_date DESC, b._fl DESC, b._ohl DESC
                           ) AS rn
                    FROM (
                        SELECT *,
                               COALESCE(TRY_CAST(Week_Number AS DATE), TRY_CONVERT(DATE, Week_Number, 5)) AS wk_date,
                               CASE WHEN TRY_CAST([overall_const._10_100] AS FLOAT) = 100
                                      OR [flow_line_const._status_in_progress_completed] = 'Completed'
                                      OR ([const._complete_date_including_f_l_final_hydro_test_1_day_before_rig_on_date] IS NOT NULL
                                          AND LTRIM(RTRIM([const._complete_date_including_f_l_final_hydro_test_1_day_before_rig_on_date])) != '')
                                    THEN 1 ELSE 0 END AS _fl,
                               CASE WHEN TRY_CAST([overall_ohl_progr_100] AS FLOAT) = 100
                                      OR (ohl_completion_date IS NOT NULL
                                          AND LTRIM(RTRIM(ohl_completion_date)) != '')
                                    THEN 1 ELSE 0 END AS _ohl
                        FROM dbo.WMR WITH (NOLOCK)
                        WHERE pdo_well_id IS NOT NULL AND pdo_well_id <> ''
                          AND COALESCE(TRY_CAST(Week_Number AS DATE), TRY_CONVERT(DATE, Week_Number, 5)) <= @AsOfDate
                          {extraWhere}
                    ) b
                ) w
                WHERE w.rn = 1
                {postDedupWhere}
            ),
            months AS (
                SELECT n AS m FROM (VALUES(1),(2),(3),(4),(5),(6),(7),(8),(9),(10),(11),(12)) v(n) WHERE n >= @startMonthParam AND n <= @endMonthParam
            ),
            plan_by_month AS (
                SELECT
                    sp.PlanMonth AS mth,
                    COUNT(*) AS plan_count,
                    SUM(CASE WHEN wl.flaf_issue_date IS NOT NULL
                              AND LTRIM(RTRIM(wl.flaf_issue_date)) != ''
                              AND DATEDIFF(DAY, TRY_CAST(wl.flaf_issue_date AS DATE), sp.PlanStart) >= @FlafDays
                              AND (wl.scr_no IS NULL OR wl.scr_dt IS NULL OR DATEDIFF(DAY, wl.scr_dt, sp.PlanStart) > @ScrDays)
                         THEN 1 ELSE 0 END) AS modified_count
                FROM SapPlan2 sp
                LEFT JOIN WmrLatest2 wl ON sp.Well_ID = wl.pdo_well_id
                GROUP BY sp.PlanMonth
            ),
            actual_by_month AS (
                SELECT
                    sp.PlanMonth AS mth,
                    SUM(CASE WHEN wl.fl_done = 1 AND wl.ohl_done = 1 AND sp.PlanStart < GETDATE() THEN 1 ELSE 0 END) AS actual_due,
                    SUM(CASE WHEN wl.fl_done = 1 AND wl.ohl_done = 1 AND sp.PlanStart >= GETDATE() THEN 1 ELSE 0 END) AS accelerated,
                    SUM(CASE WHEN wl.fl_done = 1 AND wl.ohl_done = 1
                              AND wl.flaf_issue_date IS NOT NULL AND LTRIM(RTRIM(wl.flaf_issue_date)) != ''
                              AND DATEDIFF(DAY, TRY_CAST(wl.flaf_issue_date AS DATE), sp.PlanStart) >= @FlafDays
                              AND (wl.scr_no IS NULL OR wl.scr_dt IS NULL OR DATEDIFF(DAY, wl.scr_dt, sp.PlanStart) > @ScrDays)
                         THEN 1 ELSE 0 END) AS clean_actual
                FROM SapPlan2 sp
                INNER JOIN WmrLatest2 wl ON sp.Well_ID = wl.pdo_well_id
                GROUP BY sp.PlanMonth
            )
            SELECT
                CHOOSE(m.m,'Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec') AS MonthLabel,
                m.m AS MonthNum,
                CASE WHEN DATEFROMPARTS(YEAR(@fromParam), m.m, 1) <= CAST(GETDATE() AS DATE) THEN 0 ELSE 1 END AS IsForecast,
                SUM(ISNULL(p.plan_count, 0)) OVER (ORDER BY m.m ROWS UNBOUNDED PRECEDING) AS Plan_PdoRigSequence_Cumulative,
                SUM(ISNULL(p.modified_count, 0)) OVER (ORDER BY m.m ROWS UNBOUNDED PRECEDING) AS Plan_FlafScrAdjusted_Cumulative,
                SUM(ISNULL(p.modified_count, 0)) OVER (ORDER BY m.m ROWS UNBOUNDED PRECEDING) AS Plan_PdoIssuesRemoved_Cumulative,
                SUM(ISNULL(a.actual_due, 0)) OVER (ORDER BY m.m ROWS UNBOUNDED PRECEDING) AS Actual_DueCompleted_Cumulative,
                SUM(ISNULL(a.accelerated, 0)) OVER (ORDER BY m.m ROWS UNBOUNDED PRECEDING) AS Actual_NotDueAccelerated_Cumulative,
                (SUM(ISNULL(a.clean_actual, 0)) OVER (ORDER BY m.m ROWS UNBOUNDED PRECEDING))
                - (SUM(ISNULL(p.modified_count, 0)) OVER (ORDER BY m.m ROWS UNBOUNDED PRECEDING)) AS Backlog
            FROM months m
            LEFT JOIN plan_by_month   p ON m.m = p.mth
            LEFT JOIN actual_by_month a ON m.m = a.mth
            ORDER BY m.m;
            """;
        }

        var sql = $"""
            SET NOCOUNT ON;

            DECLARE @Year INT = @yearParam;
            DECLARE @FlafDays INT = 90;
            DECLARE @ScrDays  INT = 90;
            DECLARE @CurrentMonth INT = @currentMonthParam;
            DECLARE @YearStart DATE = @fromParam;
            DECLARE @YearEnd   DATE = DATEADD(DAY, 1, @toParam);
            DECLARE @AsOfDate  DATE = @asOfParam;

            -- ═══════════════════════════════════════════════════════════════
            -- Use SAP_DRILLING_SEQUENCE_History for plan (same as wells-readiness)
            -- ═══════════════════════════════════════════════════════════════
            ;WITH SapPlan AS (
                SELECT Well_ID,
                       MIN(TRY_CAST(Earl_start_date AS DATE)) AS PlanStart,
                       MONTH(MIN(TRY_CAST(Earl_start_date AS DATE))) AS PlanMonth
                FROM dbo.SAP_DRILLING_SEQUENCE_History WITH (NOLOCK)
                WHERE Well_ID IS NOT NULL AND Well_ID <> ''
                  AND Well_Function NOT IN ('Unspecified', 'RIG MOVE', 'RIG MAINTENANCE')
                  AND TRY_CAST(Earl_start_date AS DATE) >= @YearStart
                  AND TRY_CAST(Earl_start_date AS DATE) <  @YearEnd
                  {sapWhere}
                GROUP BY Well_ID
            ),
            -- Latest WMR snapshot per well (merged FL + OHL status)
            -- Secondary sort (_fl DESC, _ohl DESC) ensures the completed row wins when multiple
            -- projects share the same Week_Number for a well (deterministic tie-break).
            WmrLatest AS (
                SELECT w.pdo_well_id,
                       TRY_CAST(w.[latest_exp.rig_on_location_sap_data] AS DATE) AS RigOnDate,
                       w.flaf_issue_date,
                       w.scr_no,
                       TRY_CAST(w.scr_date AS DATE) AS scr_dt,
                       w.ssfd_wells,
                       w.ipm,
                       w.moc_raised,
                       w.moc_approved,
                       w._fl  AS fl_done,
                       w._ohl AS ohl_done
                FROM (
                    SELECT b.*,
                           ROW_NUMBER() OVER (
                               PARTITION BY b.pdo_well_id
                               ORDER BY b.wk_date DESC, b._fl DESC, b._ohl DESC
                           ) AS rn
                    FROM (
                        SELECT *,
                               COALESCE(TRY_CAST(Week_Number AS DATE), TRY_CONVERT(DATE, Week_Number, 5)) AS wk_date,
                               CASE WHEN TRY_CAST([overall_const._10_100] AS FLOAT) = 100
                                      OR [flow_line_const._status_in_progress_completed] = 'Completed'
                                      OR ([const._complete_date_including_f_l_final_hydro_test_1_day_before_rig_on_date] IS NOT NULL
                                          AND LTRIM(RTRIM([const._complete_date_including_f_l_final_hydro_test_1_day_before_rig_on_date])) != '')
                                    THEN 1 ELSE 0 END AS _fl,
                               CASE WHEN TRY_CAST([overall_ohl_progr_100] AS FLOAT) = 100
                                      OR (ohl_completion_date IS NOT NULL
                                          AND LTRIM(RTRIM(ohl_completion_date)) != '')
                                    THEN 1 ELSE 0 END AS _ohl
                        FROM dbo.WMR WITH (NOLOCK)
                        WHERE pdo_well_id IS NOT NULL AND pdo_well_id <> ''
                          AND COALESCE(TRY_CAST(Week_Number AS DATE), TRY_CONVERT(DATE, Week_Number, 5)) <= @AsOfDate
                          {extraWhere}
                    ) b
                ) w
                WHERE w.rn = 1
                {postDedupWhere}
            ),
            -- Join SAP plan with WMR actuals — merged FL + OHL
            combined AS (
                SELECT
                    sp.Well_ID,
                    sp.PlanStart,
                    sp.PlanMonth,
                    ISNULL(wl.fl_done, 0) AS fl_done,
                    ISNULL(wl.ohl_done, 0) AS ohl_done,
                    -- Construction complete = BOTH flowline AND OHL done (merged)
                    CASE WHEN ISNULL(wl.fl_done, 0) = 1 AND ISNULL(wl.ohl_done, 0) = 1 THEN 1 ELSE 0 END AS construction_done,
                    wl.flaf_issue_date,
                    wl.scr_no,
                    wl.scr_dt,
                    wl.ssfd_wells,
                    wl.ipm,
                    wl.moc_raised,
                    wl.moc_approved,
                    wl.RigOnDate
                FROM SapPlan sp
                LEFT JOIN WmrLatest wl ON sp.Well_ID = wl.pdo_well_id
            ),
            flags AS (
                SELECT *,
                    -- FLAF excluded: no FLAF or insufficient lead time (< 90 days before plan start)
                    CASE WHEN flaf_issue_date IS NULL
                              OR LTRIM(RTRIM(flaf_issue_date)) = ''
                         THEN 1
                         WHEN DATEDIFF(DAY, TRY_CAST(flaf_issue_date AS DATE), PlanStart) < @FlafDays
                         THEN 1 ELSE 0
                    END AS flaf_excl,
                    -- SCR excluded: SCR raised within 90 days of plan start
                    CASE WHEN scr_no IS NOT NULL
                          AND scr_dt IS NOT NULL
                          AND DATEDIFF(DAY, scr_dt, PlanStart) <= @ScrDays
                         THEN 1 ELSE 0
                    END AS scr_excl,
                    -- PDO issue: blocked by SSFD/IPM/MOC-pending
                    CASE WHEN (ssfd_wells IS NOT NULL
                               OR ipm IS NOT NULL
                               OR (moc_raised IS NOT NULL
                                   AND (moc_approved IS NULL OR LTRIM(RTRIM(moc_approved)) = '')))
                          AND flaf_issue_date IS NOT NULL
                          AND LTRIM(RTRIM(flaf_issue_date)) != ''
                          AND scr_no IS NULL
                         THEN 1 ELSE 0
                    END AS pdo_issue,
                    -- Due completed (plan date passed & construction done)
                    CASE WHEN construction_done = 1
                          AND PlanStart < GETDATE()
                         THEN 1 ELSE 0 END AS is_due_done,
                    -- Accelerated (construction done before plan date)
                    CASE WHEN construction_done = 1
                          AND PlanStart >= GETDATE()
                         THEN 1 ELSE 0 END AS is_accel
                FROM combined
            )

            -- ═══════════════════════════════════════════════════════════════
            -- Result Set 1: KPI Tiles (YTD — only wells planned up to current month)
            -- ═══════════════════════════════════════════════════════════════
            SELECT
                COUNT(*) AS PlanPdoRigSequence,
                SUM(CASE WHEN flaf_excl = 0 AND scr_excl = 0 THEN 1 ELSE 0 END) AS PlanFlafScrAdjusted,
                SUM(CASE WHEN flaf_excl = 0 AND scr_excl = 0
                          AND pdo_issue = 0 THEN 1 ELSE 0 END) AS PlanPdoIssuesRemoved,
                SUM(is_due_done) AS ActualDueWellsCompleted,
                SUM(is_accel) AS ActualAcceleratedWells,
                -SUM(CASE WHEN (is_due_done = 0 AND is_accel = 0)
                          AND flaf_excl = 0 AND scr_excl = 0
                          AND pdo_issue = 0 THEN 1 ELSE 0 END) AS BacklogsAgainstPlan,
                SUM(is_due_done) + SUM(is_accel) AS TotalCompleted
            FROM flags
            WHERE PlanMonth >= @startMonthParam AND PlanMonth <= @CurrentMonth;

            {trendSql}
            """;

        var connStr = db.Database.GetConnectionString()!;
        await using var conn = new SqlConnection(connStr);
        await OpenWithRetryAsync(conn, ct);

        await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 120 };
        cmd.Parameters.AddWithValue("@yearParam", year);
        cmd.Parameters.AddWithValue("@currentMonthParam", currentMonth);
        cmd.Parameters.AddWithValue("@asOfParam", asOf.ToDateTime(TimeOnly.MinValue));
        cmd.Parameters.AddWithValue("@fromParam", effFrom.ToDateTime(TimeOnly.MinValue));
        cmd.Parameters.AddWithValue("@toParam", effTo.ToDateTime(TimeOnly.MinValue));
        cmd.Parameters.AddWithValue("@startMonthParam", startMonth);
        cmd.Parameters.AddWithValue("@endMonthParam", endMonth);
        if (!string.IsNullOrEmpty(cluster))  cmd.Parameters.AddWithValue("@cluster", cluster.Trim());
        if (!string.IsNullOrEmpty(wellId))   cmd.Parameters.AddWithValue("@wellId", wellId);
        if (!string.IsNullOrEmpty(wellType)) cmd.Parameters.AddWithValue("@wellType", wellType.Trim());
        if (!string.IsNullOrEmpty(site))     cmd.Parameters.AddWithValue("@site", site.Trim());
        if (!string.IsNullOrEmpty(project))  cmd.Parameters.AddWithValue("@project", project.Trim());

        await using var rdr = await cmd.ExecuteReaderAsync(ct);

        // Result Set 1: KPI (YTD values)
        await rdr.ReadAsync(ct);
        var kpiPlanTotal     = rdr.IsDBNull(0) ? 0 : rdr.GetInt32(0);
        var kpiFlafScr       = rdr.IsDBNull(1) ? 0 : rdr.GetInt32(1);
        var kpiPdoRemoved    = rdr.IsDBNull(2) ? 0 : rdr.GetInt32(2);
        var kpiActualDue     = rdr.IsDBNull(3) ? 0 : rdr.GetInt32(3);
        var kpiAccelerated   = rdr.IsDBNull(4) ? 0 : rdr.GetInt32(4);
        var kpiBacklog       = rdr.IsDBNull(5) ? 0 : rdr.GetInt32(5);
        var kpiTotalComplete = rdr.IsDBNull(6) ? 0 : rdr.GetInt32(6);

        // Result Set 2: Monthly Trend
        await rdr.NextResultAsync(ct);
        var months = new List<ConstructionProgressMonthDto>();
        while (await rdr.ReadAsync(ct))
        {
            months.Add(new ConstructionProgressMonthDto(
                MonthLabel:                       rdr.GetString(0),
                MonthNum:                         rdr.GetInt32(1),
                IsForecast:                       rdr.GetInt32(2) == 1,
                PlanPdoRigSequenceCumulative:     rdr.IsDBNull(3) ? 0 : rdr.GetInt32(3),
                PlanFlafScrAdjustedCumulative:    rdr.IsDBNull(4) ? 0 : rdr.GetInt32(4),
                PlanPdoIssuesRemovedCumulative:   rdr.IsDBNull(5) ? 0 : rdr.GetInt32(5),
                ActualDueCompletedCumulative:     rdr.IsDBNull(6) ? 0 : rdr.GetInt32(6),
                ActualNotDueAcceleratedCumulative:rdr.IsDBNull(7) ? 0 : rdr.GetInt32(7),
                Backlog:                          rdr.IsDBNull(8) ? 0 : rdr.GetInt32(8)
            ));
        }

        // Project forecast for future months — backlog remains constant at YTD value
        if (!isDayLevel && currentMonth > 0 && currentMonth < 12)
        {
            var ytdMonth = months.FirstOrDefault(m => m.MonthNum == currentMonth);
            var ytdActualDue = ytdMonth?.ActualDueCompletedCumulative ?? 0;
            var ytdAccelerated = ytdMonth?.ActualNotDueAcceleratedCumulative ?? 0;
            var ytdBacklog = ytdMonth?.Backlog ?? 0;
            var avgMonthlyDue = currentMonth > 0 ? (double)ytdActualDue / currentMonth : 0;
            var avgMonthlyAccel = currentMonth > 0 ? (double)ytdAccelerated / currentMonth : 0;

            for (int i = 0; i < months.Count; i++)
            {
                var m = months[i];
                if (m.IsForecast)
                {
                    var monthsAhead = m.MonthNum - currentMonth;
                    var projectedDue = ytdActualDue + (int)Math.Round(avgMonthlyDue * monthsAhead);
                    var projectedAccel = ytdAccelerated + (int)Math.Round(avgMonthlyAccel * monthsAhead);

                    months[i] = new ConstructionProgressMonthDto(
                        MonthLabel: m.MonthLabel,
                        MonthNum: m.MonthNum,
                        IsForecast: true,
                        PlanPdoRigSequenceCumulative: m.PlanPdoRigSequenceCumulative,
                        PlanFlafScrAdjustedCumulative: m.PlanFlafScrAdjustedCumulative,
                        PlanPdoIssuesRemovedCumulative: m.PlanPdoIssuesRemovedCumulative,
                        ActualDueCompletedCumulative: projectedDue,
                        ActualNotDueAcceleratedCumulative: projectedAccel,
                        Backlog: ytdBacklog
                    );
                }
            }
        }

        // KPI uses full-year plan totals and YTD actuals from the SQL result
        var kpi = new ConstructionProgressKpiDto(
            PlanPdoRigSequence:      kpiPlanTotal,
            PlanFlafScrAdjusted:     kpiFlafScr,
            PlanPdoIssuesRemoved:    kpiPdoRemoved,
            ActualDueWellsCompleted: kpiActualDue,
            ActualAcceleratedWells:  kpiAccelerated,
            BacklogsAgainstPlan:     kpiBacklog,
            TotalCompleted:          kpiTotalComplete
        );

        var result = new ConstructionProgressResponse(
            AsOfDate: asOf.ToString("yyyy-MM-dd"),
            PlanYear: year,
            Kpi: kpi,
            MonthlyTrend: months
        );

        cache.Set(cacheKey, result, CacheDuration);
        return result;
    }

    // --- Construction Progress Wells Drilldown ---
    public async Task<IReadOnlyList<WmrWellDto>> GetConstructionProgressWellsAsync(
        string filter,
        int? planYear = null,
        DateOnly? asOfDate = null,
        string? cluster = null,
        string? wellId = null,
        DateOnly? fromDate = null,
        DateOnly? toDate = null,
        string? wellType = null,
        string? project = null,
        CancellationToken ct = default)
    {
        var year = planYear ?? DateTime.UtcNow.Year;
        var asOf = asOfDate ?? DateOnly.FromDateTime(DateTime.UtcNow);
        var effFrom = fromDate ?? new DateOnly(year, 1, 1);
        var effTo   = toDate   ?? new DateOnly(year, 12, 31);
        var startMonth = effFrom.Month;
        var endMonth   = effTo.Year > effFrom.Year ? 12 : effTo.Month;
        var currentMonth = Math.Min(asOf.Year == year ? asOf.Month : 12, endMonth);
        var cacheKey = $"cprog-wells:{year}:{asOf:yyyy-MM-dd}:{filter}:{cluster ?? "all"}:{wellId ?? "all"}:{wellType ?? "all"}:{project ?? "all"}:{effFrom:yyyy-MM-dd}:{effTo:yyyy-MM-dd}";
        if (cache.TryGetValue(cacheKey, out IReadOnlyList<WmrWellDto>? cached) && cached is not null)
            return cached;

        // Build filters using same well-membership approach as GetConstructionProgressAsync
        var extraWhere = "";
        var sapWhere   = "";
        if (!string.IsNullOrEmpty(cluster))
        {
            var clusterWellSubq = "SELECT DISTINCT pdo_well_id FROM dbo.WMR WITH (NOLOCK) WHERE pdo_well_id IS NOT NULL AND project_id IN (SELECT CAST(ID AS NVARCHAR(100)) FROM [dbo].[ProjectIDs] WITH (NOLOCK) WHERE LTRIM(RTRIM(CAST([Cluster] AS NVARCHAR(200)))) = @cluster)";
            extraWhere += $" AND pdo_well_id IN ({clusterWellSubq})";
            sapWhere   += $" AND Well_ID IN ({clusterWellSubq})";
        }
        if (!string.IsNullOrEmpty(wellId))
        {
            extraWhere += " AND pdo_well_id = @wellId";
            sapWhere   += " AND Well_ID = @wellId";
        }
        if (!string.IsNullOrEmpty(wellType))
        {
            extraWhere += " AND " + WellTypeFilter("");
            sapWhere   += " AND Well_ID IN (SELECT DISTINCT pdo_well_id FROM dbo.WMR WITH (NOLOCK) WHERE pdo_well_id IS NOT NULL AND " + WellTypeFilter("") + ")";
        }
        if (!string.IsNullOrEmpty(project))
        {
            var primaryProjectSubq =
                "SELECT lp.pdo_well_id " +
                "FROM (" +
                "    SELECT pdo_well_id, project_id," +
                "           ROW_NUMBER() OVER (" +
                "               PARTITION BY pdo_well_id" +
                "               ORDER BY COALESCE(TRY_CAST(Week_Number AS DATE), TRY_CONVERT(DATE, Week_Number, 5)) DESC" +
                "           ) AS rn " +
                "    FROM dbo.WMR WITH (NOLOCK)" +
                "    WHERE pdo_well_id IS NOT NULL AND pdo_well_id <> ''" +
                ") lp " +
                "WHERE lp.rn = 1 AND lp." + ProjectFilter("");
            extraWhere += $" AND pdo_well_id IN ({primaryProjectSubq})";
            sapWhere   += $" AND Well_ID IN ({primaryProjectSubq})";
        }
        if (string.IsNullOrEmpty(cluster))
        {
            sapWhere += " AND Well_ID IN (SELECT DISTINCT pdo_well_id FROM dbo.WMR WITH (NOLOCK) WHERE pdo_well_id IS NOT NULL AND pdo_well_id <> '')";
        }

        // Determine the WHERE clause for the filter category
        var filterClause = filter?.ToLowerInvariant() switch
        {
            "flafscr" => "WHERE flaf_excl = 0 AND scr_excl = 0",
            "clean"   => "WHERE flaf_excl = 0 AND scr_excl = 0 AND pdo_issue = 0",
            "backlog" => "WHERE (is_due_done = 0 AND is_accel = 0) AND flaf_excl = 0 AND scr_excl = 0 AND pdo_issue = 0",
            "completed" => "WHERE (is_due_done = 1 OR is_accel = 1)",
            _         => "" // plan: all wells
        };

        var sql = $"""
            SET NOCOUNT ON;

            DECLARE @Year INT = @yearParam;
            DECLARE @FlafDays INT = 90;
            DECLARE @ScrDays  INT = 90;
            DECLARE @CurrentMonth INT = @currentMonthParam;
            DECLARE @YearStart DATE = @fromParam;
            DECLARE @YearEnd   DATE = DATEADD(DAY, 1, @toParam);
            DECLARE @AsOfDate  DATE = @asOfParam;

            ;WITH SapPlan AS (
                SELECT Well_ID,
                       MIN(TRY_CAST(Earl_start_date AS DATE)) AS PlanStart,
                       MONTH(MIN(TRY_CAST(Earl_start_date AS DATE))) AS PlanMonth
                FROM dbo.SAP_DRILLING_SEQUENCE_History WITH (NOLOCK)
                WHERE Well_ID IS NOT NULL AND Well_ID <> ''
                  AND Well_Function NOT IN ('Unspecified', 'RIG MOVE', 'RIG MAINTENANCE')
                  AND TRY_CAST(Earl_start_date AS DATE) >= @YearStart
                  AND TRY_CAST(Earl_start_date AS DATE) <  @YearEnd
                  {sapWhere}
                GROUP BY Well_ID
            ),
            WmrLatest AS (
                SELECT w.pdo_well_id,
                       TRY_CAST(w.[latest_exp.rig_on_location_sap_data] AS DATE) AS RigOnDate,
                       TRY_CAST(w.actual_rig_off_date AS DATE) AS RigOffDate,
                       w.flaf_issue_date,
                       w.scr_no,
                       TRY_CAST(w.scr_date AS DATE) AS scr_dt,
                       w.ssfd_wells,
                       w.ipm,
                       w.moc_raised,
                       w.moc_approved,
                       w.rig_no,
                       w.well_location,
                       w.well_type,
                       LEFT(w.pdo_well_id, CHARINDEX('-', w.pdo_well_id + '-') - 1) AS field_name,
                       COALESCE(TRY_CAST(w.over_all_progress_percentages AS FLOAT), 0) AS Progress,
                       w.[location_preparation_status_in_progress_completed] AS loc_status,
                       w.[flow_line_const._status_in_progress_completed] AS fl_status,
                       w.[flow_line_commi._status_in_progress_completed] AS comm_status,
                       COALESCE(TRY_CAST(w.[overall_loc._preparation_10_100] AS FLOAT), 0) AS loc_pct,
                       COALESCE(TRY_CAST(w.[overall_const._10_100] AS FLOAT), 0) AS fl_pct,
                       COALESCE(TRY_CAST(w.[overall_comm_progress_100] AS FLOAT), 0) AS comm_pct,
                       COALESCE(TRY_CAST(w.ohl_progress AS FLOAT), 0) AS ohl_pct,
                       CASE WHEN TRY_CAST(w.[overall_const._10_100] AS FLOAT) = 100
                              OR w.[flow_line_const._status_in_progress_completed] = 'Completed'
                              OR (w.[const._complete_date_including_f_l_final_hydro_test_1_day_before_rig_on_date] IS NOT NULL
                                  AND LTRIM(RTRIM(w.[const._complete_date_including_f_l_final_hydro_test_1_day_before_rig_on_date])) != '')
                            THEN 1 ELSE 0 END AS fl_done,
                       CASE WHEN TRY_CAST(w.[overall_ohl_progr_100] AS FLOAT) = 100
                              OR (w.ohl_completion_date IS NOT NULL
                                  AND LTRIM(RTRIM(w.ohl_completion_date)) != '')
                            THEN 1 ELSE 0 END AS ohl_done
                FROM (
                    SELECT *,
                        ROW_NUMBER() OVER (
                            PARTITION BY pdo_well_id
                            ORDER BY COALESCE(TRY_CAST(Week_Number AS DATE), TRY_CONVERT(DATE, Week_Number, 5)) DESC
                        ) AS rn
                    FROM dbo.WMR WITH (NOLOCK)
                    WHERE pdo_well_id IS NOT NULL AND pdo_well_id <> ''
                      AND COALESCE(TRY_CAST(Week_Number AS DATE), TRY_CONVERT(DATE, Week_Number, 5)) <= @AsOfDate
                      {extraWhere}
                ) w
                WHERE w.rn = 1
            ),
            combined AS (
                SELECT
                    sp.Well_ID,
                    sp.PlanStart,
                    sp.PlanMonth,
                    ISNULL(wl.fl_done, 0) AS fl_done,
                    ISNULL(wl.ohl_done, 0) AS ohl_done,
                    CASE WHEN ISNULL(wl.fl_done, 0) = 1 AND ISNULL(wl.ohl_done, 0) = 1 THEN 1 ELSE 0 END AS construction_done,
                    wl.flaf_issue_date,
                    wl.scr_no,
                    wl.scr_dt,
                    wl.ssfd_wells,
                    wl.ipm,
                    wl.moc_raised,
                    wl.moc_approved,
                    wl.RigOnDate,
                    wl.RigOffDate,
                    wl.rig_no,
                    wl.well_location,
                    wl.well_type,
                    wl.field_name,
                    wl.Progress,
                    wl.loc_status,
                    wl.fl_status,
                    wl.comm_status,
                    wl.loc_pct,
                    wl.fl_pct,
                    wl.comm_pct,
                    wl.ohl_pct
                FROM SapPlan sp
                LEFT JOIN WmrLatest wl ON sp.Well_ID = wl.pdo_well_id
            ),
            flags AS (
                SELECT *,
                    CASE WHEN flaf_issue_date IS NULL
                              OR LTRIM(RTRIM(flaf_issue_date)) = ''
                         THEN 1
                         WHEN DATEDIFF(DAY, TRY_CAST(flaf_issue_date AS DATE), PlanStart) < @FlafDays
                         THEN 1 ELSE 0
                    END AS flaf_excl,
                    CASE WHEN scr_no IS NOT NULL
                          AND scr_dt IS NOT NULL
                          AND DATEDIFF(DAY, scr_dt, PlanStart) <= @ScrDays
                         THEN 1 ELSE 0
                    END AS scr_excl,
                    CASE WHEN (ssfd_wells IS NOT NULL
                               OR ipm IS NOT NULL
                               OR (moc_raised IS NOT NULL
                                   AND (moc_approved IS NULL OR LTRIM(RTRIM(moc_approved)) = '')))
                          AND flaf_issue_date IS NOT NULL
                          AND LTRIM(RTRIM(flaf_issue_date)) != ''
                          AND scr_no IS NULL
                         THEN 1 ELSE 0
                    END AS pdo_issue,
                    CASE WHEN construction_done = 1
                          AND PlanStart < GETDATE()
                         THEN 1 ELSE 0 END AS is_due_done,
                    CASE WHEN construction_done = 1
                          AND PlanStart >= GETDATE()
                         THEN 1 ELSE 0 END AS is_accel
                FROM combined
                WHERE PlanMonth >= @startMonthParam AND PlanMonth <= @CurrentMonth
            )
            SELECT
                Well_ID,
                rig_no,
                field_name,
                well_location,
                well_type,
                Progress,
                loc_status,
                fl_status,
                comm_status,
                loc_pct,
                fl_pct,
                comm_pct,
                ohl_pct,
                RigOnDate,
                RigOffDate,
                CASE WHEN is_due_done = 1 OR is_accel = 1 THEN 'completed'
                     WHEN Progress > 0 THEN 'inprogress'
                     ELSE 'planned' END AS status,
                flaf_excl,
                pdo_issue
            FROM flags
            {filterClause}
            ORDER BY Well_ID;
            """;

        var connStr = db.Database.GetConnectionString()!;
        await using var conn = new SqlConnection(connStr);
        await OpenWithRetryAsync(conn, ct);

        await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 120 };
        cmd.Parameters.AddWithValue("@yearParam", year);
        cmd.Parameters.AddWithValue("@currentMonthParam", currentMonth);
        cmd.Parameters.AddWithValue("@startMonthParam", startMonth);
        cmd.Parameters.AddWithValue("@asOfParam", asOf.ToDateTime(TimeOnly.MinValue));
        cmd.Parameters.AddWithValue("@fromParam", effFrom.ToDateTime(TimeOnly.MinValue));
        cmd.Parameters.AddWithValue("@toParam", effTo.ToDateTime(TimeOnly.MinValue));
        if (!string.IsNullOrEmpty(cluster))  cmd.Parameters.AddWithValue("@cluster", cluster.Trim());
        if (!string.IsNullOrEmpty(wellId))   cmd.Parameters.AddWithValue("@wellId", wellId);
        if (!string.IsNullOrEmpty(wellType)) cmd.Parameters.AddWithValue("@wellType", wellType.Trim());
        if (!string.IsNullOrEmpty(project))  cmd.Parameters.AddWithValue("@project", project.Trim());

        var wells = new List<WmrWellDto>();
        await using var rdr = await cmd.ExecuteReaderAsync(ct);
        while (await rdr.ReadAsync(ct))
        {
            wells.Add(new WmrWellDto(
                WellId:             rdr.IsDBNull(0) ? "" : rdr.GetString(0),
                Rig:                rdr.IsDBNull(1) ? null : rdr.GetString(1),
                Field:              rdr.IsDBNull(2) ? null : rdr.GetString(2),
                Location:           rdr.IsDBNull(3) ? null : rdr.GetString(3),
                WellType:           rdr.IsDBNull(4) ? null : rdr.GetString(4),
                ProgressPct:        rdr.IsDBNull(5) ? 0 : rdr.GetDouble(5),
                Status:             rdr.IsDBNull(15) ? "planned" : rdr.GetString(15),
                LocPrepStatus:      rdr.IsDBNull(6) ? null : rdr.GetString(6),
                FlStatus:           rdr.IsDBNull(7) ? null : rdr.GetString(7),
                CommStatus:         rdr.IsDBNull(8) ? null : rdr.GetString(8),
                LocPrepPct:         rdr.IsDBNull(9) ? null : rdr.GetDouble(9),
                FlConstructionPct:  rdr.IsDBNull(10) ? null : rdr.GetDouble(10),
                CommPct:            rdr.IsDBNull(11) ? null : rdr.GetDouble(11),
                OhlPct:             rdr.IsDBNull(12) ? null : rdr.GetDouble(12),
                RigOnDate:          rdr.IsDBNull(13) ? null : rdr.GetDateTime(13).ToString("yyyy-MM-dd"),
                RigOffDate:         rdr.IsDBNull(14) ? null : rdr.GetDateTime(14).ToString("yyyy-MM-dd"),
                FlafScr:            !rdr.IsDBNull(16) && rdr.GetInt32(16) == 0,
                PdoIssue:           !rdr.IsDBNull(17) && rdr.GetInt32(17) == 1
            ));
        }

        cache.Set(cacheKey, (IReadOnlyList<WmrWellDto>)wells, CacheDuration);
        return wells;
    }

    // --- Flowline Readiness (Funnel Widget) ---
    public async Task<FlowlineReadinessResponse> GetFlowlineReadinessAsync(
        int? planYear = null,
        DateOnly? asOfDate = null,
        string? cluster = null,
        string? wellId = null,
        DateOnly? fromDate = null,
        DateOnly? toDate = null,
        string? wellType = null,
        string? project = null,
        CancellationToken ct = default)
    {
        var year = planYear ?? DateTime.UtcNow.Year;
        var asOf = asOfDate ?? DateOnly.FromDateTime(DateTime.UtcNow);
        var useDateRange = fromDate.HasValue || toDate.HasValue;
        var cacheKey = $"flowline-readiness:{year}:{asOf:yyyy-MM-dd}:{cluster ?? "all"}:{wellId ?? "all"}:{fromDate?.ToString("yyyy-MM-dd") ?? "all"}:{toDate?.ToString("yyyy-MM-dd") ?? "all"}:{wellType ?? "all"}:{project ?? "all"}";
        if (cache.TryGetValue(cacheKey, out FlowlineReadinessResponse? cached2) && cached2 is not null)
            return cached2;
        var extraWhere = "";
        if (!string.IsNullOrEmpty(cluster)) extraWhere += " AND " + ClusterFilter(cluster, "w.[pdo_well_id]");
        if (!string.IsNullOrEmpty(wellId))  extraWhere += " AND w.[pdo_well_id] = @wellId";

        // Project/wellType applied AFTER dedup using deduplicated ProjectIDs (GROUP BY ID)
        // so each well maps to exactly ONE project — sum of individual projects = All Projects.
        var postDedupWhere = "";
        {
            var pidConds = new List<string>();
            if (!string.IsNullOrEmpty(wellType)) pidConds.Add("LTRIM(RTRIM(dp.[Type])) = @wellType");
            if (!string.IsNullOrEmpty(project)) pidConds.Add("LTRIM(RTRIM(dp.[Project])) = @project");
            if (pidConds.Count > 0)
                postDedupWhere = $" AND project_id IN (SELECT CAST(dp.ID AS NVARCHAR(100)) FROM (SELECT ID, MIN(LTRIM(RTRIM([Type]))) AS [Type], MIN(LTRIM(RTRIM([Project]))) AS [Project] FROM [dbo].[ProjectIDs] WITH (NOLOCK) GROUP BY ID) dp WHERE {string.Join(" AND ", pidConds)})";
        }

        // Use SAP_DRILLING_SEQUENCE_History to determine planned wells (consistent with wells-readiness)
        var sapDateFilter = useDateRange
            ? "TRY_CAST(s.Earl_start_date AS DATE) >= @fromDate AND TRY_CAST(s.Earl_start_date AS DATE) <= @toDate"
            : "TRY_CAST(s.Earl_start_date AS DATE) >= DATEFROMPARTS(@Year, 1, 1) AND TRY_CAST(s.Earl_start_date AS DATE) < DATEFROMPARTS(@Year + 1, 1, 1)";

        var sql = $"""
            SET NOCOUNT ON;
            DECLARE @Year INT = @yearParam;
            ;WITH sap_planned AS (
                SELECT DISTINCT s.Well_ID
                FROM dbo.SAP_DRILLING_SEQUENCE_History s WITH (NOLOCK)
                WHERE s.Well_ID IS NOT NULL AND s.Well_ID <> ''
                  AND s.Well_Function NOT IN ('Unspecified', 'RIG MOVE', 'RIG MAINTENANCE')
                  AND {sapDateFilter}
            ),
            WmrLatest AS (
                SELECT pdo_well_id, project_id,
                       TRY_CAST(flaf_issue_date AS DATE) AS FlafDate,
                       TRY_CAST(actual_rig_off_date AS DATE) AS RigOff,
                       CASE WHEN TRY_CAST([overall_const._10_100] AS FLOAT) = 100
                              OR [flow_line_const._status_in_progress_completed] = 'Completed'
                              OR ([const._complete_date_including_f_l_final_hydro_test_1_day_before_rig_on_date] IS NOT NULL
                                  AND LTRIM(RTRIM([const._complete_date_including_f_l_final_hydro_test_1_day_before_rig_on_date])) != '')
                            THEN 1 ELSE 0 END AS fl_done
                FROM (
                    SELECT w.*,
                           ROW_NUMBER() OVER (
                               PARTITION BY w.pdo_well_id
                               ORDER BY w.actual_rig_off_date DESC,
                                        w.flaf_issue_date DESC,
                                        w.over_all_progress_percentages DESC, w.project_id
                           ) AS rn
                    FROM dbo.WMR w WITH (NOLOCK)
                    INNER JOIN (
                        SELECT pdo_well_id, MAX(Week_Number) AS max_wk
                        FROM dbo.WMR WITH (NOLOCK)
                        WHERE pdo_well_id IS NOT NULL AND pdo_well_id <> ''
                          AND COALESCE(TRY_CAST(Week_Number AS DATE), TRY_CONVERT(DATE, Week_Number, 5)) <= @asOfDate
                        GROUP BY pdo_well_id
                    ) lts ON w.pdo_well_id = lts.pdo_well_id AND w.Week_Number = lts.max_wk
                    WHERE w.pdo_well_id IS NOT NULL AND w.pdo_well_id <> ''
                    {extraWhere}
                ) deduped
                WHERE rn = 1
                {postDedupWhere}
            ),
            Tracked AS (
                SELECT sp.Well_ID AS WellId, wl.FlafDate, wl.RigOff, wl.fl_done
                FROM sap_planned sp
                INNER JOIN WmrLatest wl ON sp.Well_ID = wl.pdo_well_id
                UNION
                SELECT wl.pdo_well_id, wl.FlafDate, wl.RigOff, wl.fl_done
                FROM WmrLatest wl
                WHERE NOT EXISTS (SELECT 1 FROM sap_planned sp WHERE sp.Well_ID = wl.pdo_well_id)
            )
            SELECT
                COUNT(*) AS TotalWells,
                COUNT(*) AS OriginalPlan,
                SUM(CASE WHEN fl_done = 0 AND (RigOff IS NULL OR RigOff > @asOfDate) AND FlafDate IS NOT NULL AND FlafDate <= @asOfDate THEN 1 ELSE 0 END) AS FlafScrExcluded,
                COUNT(*) - SUM(CASE WHEN fl_done = 0 AND (RigOff IS NULL OR RigOff > @asOfDate) AND FlafDate IS NOT NULL AND FlafDate <= @asOfDate THEN 1 ELSE 0 END) AS AfterFlafScr,
                0 AS PdoIssuesExcluded,
                COUNT(*) - SUM(CASE WHEN fl_done = 0 AND (RigOff IS NULL OR RigOff > @asOfDate) AND FlafDate IS NOT NULL AND FlafDate <= @asOfDate THEN 1 ELSE 0 END) AS AfterPdoIssues,
                SUM(fl_done) AS ActualCompleted,
                COUNT(*) - SUM(CASE WHEN fl_done = 0 AND (RigOff IS NULL OR RigOff > @asOfDate) AND FlafDate IS NOT NULL AND FlafDate <= @asOfDate THEN 1 ELSE 0 END) - SUM(fl_done) AS Backlog
            FROM Tracked;
            """;
        var connStr = db.Database.GetConnectionString()!;
        await using var conn = new SqlConnection(connStr);
        await OpenWithRetryAsync(conn, ct);
        await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 120 };
        cmd.Parameters.AddWithValue("@yearParam", year);
        cmd.Parameters.AddWithValue("@asOfDate", asOf.ToDateTime(TimeOnly.MinValue));
        if (!string.IsNullOrEmpty(cluster))
            cmd.Parameters.AddWithValue("@cluster", cluster);
        if (!string.IsNullOrEmpty(wellType))
            cmd.Parameters.AddWithValue("@wellType", wellType);
        if (!string.IsNullOrEmpty(project))
            cmd.Parameters.AddWithValue("@project", project);
        if (!string.IsNullOrEmpty(wellId)) cmd.Parameters.AddWithValue("@wellId", wellId);
        if (fromDate.HasValue) cmd.Parameters.AddWithValue("@fromDate", fromDate.Value.ToDateTime(TimeOnly.MinValue));
        if (toDate.HasValue)   cmd.Parameters.AddWithValue("@toDate", toDate.Value.ToDateTime(TimeOnly.MinValue));
        await using var rdr = await cmd.ExecuteReaderAsync(ct);
        await rdr.ReadAsync(ct);
        var flResponse = new FlowlineReadinessResponse(
            AsOfDate:           asOf.ToString("yyyy-MM-dd"),
            PlanYear:           year,
            TotalWells:         rdr.IsDBNull(0) ? 0 : rdr.GetInt32(0),
            OriginalPlan:       rdr.IsDBNull(1) ? 0 : rdr.GetInt32(1),
            FlafScrExcluded:    rdr.IsDBNull(2) ? 0 : rdr.GetInt32(2),
            AfterFlafScr:       rdr.IsDBNull(3) ? 0 : rdr.GetInt32(3),
            PdoIssuesExcluded:  rdr.IsDBNull(4) ? 0 : rdr.GetInt32(4),
            AfterPdoIssues:     rdr.IsDBNull(5) ? 0 : rdr.GetInt32(5),
            ActualCompleted:    rdr.IsDBNull(6) ? 0 : rdr.GetInt32(6),
            Backlog:            rdr.IsDBNull(7) ? 0 : rdr.GetInt32(7)
        );
        cache.Set(cacheKey, flResponse, CacheDuration);
        return flResponse;
    }
    // â”€â”€â”€ Daily Output Rate Trend â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    public async Task<DailyOutputRateDto> GetDailyOutputRateAsync(
        string? cluster,
        string? site,
        string? wellId,
        string? location,
        string? project,
        DateOnly? from,
        DateOnly? to,
        CancellationToken ct = default)
    {
        var fromDate = from ?? DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-30));
        var toDate   = to   ?? DateOnly.FromDateTime(DateTime.UtcNow);

        var cacheKey = $"daily-output-rate:{cluster}:{site}:{wellId}:{location}:{project}:{fromDate}:{toDate}";
        if (cache.TryGetValue(cacheKey, out DailyOutputRateDto? cached) && cached is not null)
            return cached;

        // Build WHERE fragments — all filters use IN subqueries against [Cluster]/[Site]/[Type]
        // columns in ProjectIDs, handling multiple project IDs sharing the same name correctly.
        var filters = new System.Collections.Generic.List<string>
        {
            "td.ActionOn BETWEEN @from AND @to",
            "td.data_hours IS NOT NULL",
            "td.data_hours > 0"
        };

        if (!string.IsNullOrWhiteSpace(wellId))
        {
            // Direct well filter takes priority over cluster/site/type
            filters.Add("td.well_id = @wellId");
        }
        else
        {
            // Cluster filter: [Cluster] column from ProjectIDs
            if (!string.IsNullOrWhiteSpace(cluster))
            {
                filters.Add(@"td.well_id IN (
                    SELECT DISTINCT w.pdo_well_id
                    FROM [dbo].[WMR] w WITH (NOLOCK)
                    INNER JOIN [dbo].[ProjectIDs] p WITH (NOLOCK)
                        ON w.project_id = CAST(p.ID AS NVARCHAR(100))
                    WHERE LTRIM(RTRIM(p.[Cluster])) = @cluster
                      AND w.pdo_well_id IS NOT NULL AND w.pdo_well_id <> '')");
            }

            // Site filter: [Site] column from ProjectIDs
            if (!string.IsNullOrWhiteSpace(site))
            {
                filters.Add(@"td.well_id IN (
                    SELECT DISTINCT w.pdo_well_id
                    FROM [dbo].[WMR] w WITH (NOLOCK)
                    INNER JOIN [dbo].[ProjectIDs] p WITH (NOLOCK)
                        ON w.project_id = CAST(p.ID AS NVARCHAR(100))
                    WHERE LTRIM(RTRIM(p.[Site])) = @site
                      AND w.pdo_well_id IS NOT NULL AND w.pdo_well_id <> '')");
            }

            // Well type filter: [Type] column from ProjectIDs (multiple IDs per type handled by DISTINCT)
            if (!string.IsNullOrWhiteSpace(location))
            {
                filters.Add(@"td.well_id IN (
                    SELECT DISTINCT w.pdo_well_id
                    FROM [dbo].[WMR] w WITH (NOLOCK)
                    INNER JOIN [dbo].[ProjectIDs] p WITH (NOLOCK)
                        ON w.project_id = CAST(p.ID AS NVARCHAR(100))
                    WHERE LTRIM(RTRIM(p.[Type])) = @location
                      AND w.pdo_well_id IS NOT NULL AND w.pdo_well_id <> '')");
            }

            // Project filter: [Project] column from ProjectIDs
            if (!string.IsNullOrWhiteSpace(project))
            {
                filters.Add(@"td.well_id IN (
                    SELECT DISTINCT w.pdo_well_id
                    FROM [dbo].[WMR] w WITH (NOLOCK)
                    INNER JOIN [AppMasterDB].[dbo].[ProjectIDs] p WITH (NOLOCK)
                        ON w.project_id = CAST(p.ID AS NVARCHAR(100))
                    WHERE LTRIM(RTRIM(p.[Project])) = @project
                      AND w.pdo_well_id IS NOT NULL AND w.pdo_well_id <> '')");
            }
        }

        var where = string.Join(" AND ", filters);

        var sql = $@"
SELECT
    CONVERT(VARCHAR(10), CAST(td.ActionOn AS DATE), 120) AS [Date],
    ROUND(AVG(CAST(td.data_hours AS FLOAT)), 2)          AS ActualRate,
    ROUND(AVG(CAST(td.required   AS FLOAT)), 2)          AS AskingRate
FROM dbo.task_daily td WITH (NOLOCK)
WHERE {where}
GROUP BY CAST(td.ActionOn AS DATE)
ORDER BY CAST(td.ActionOn AS DATE)";

        var connStr = db.Database.GetConnectionString()!;
        await using var conn = new SqlConnection(connStr);
        await OpenWithRetryAsync(conn, ct);

        await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 60 };
        cmd.Parameters.AddWithValue("@from", fromDate.ToDateTime(TimeOnly.MinValue));
        cmd.Parameters.AddWithValue("@to",   toDate.ToDateTime(TimeOnly.MaxValue));
        if (!string.IsNullOrWhiteSpace(wellId))
            cmd.Parameters.AddWithValue("@wellId", wellId.Trim());
        if (!string.IsNullOrWhiteSpace(cluster))
            cmd.Parameters.AddWithValue("@cluster", cluster.Trim());
        if (!string.IsNullOrWhiteSpace(site))
            cmd.Parameters.AddWithValue("@site", site.Trim());
        if (!string.IsNullOrWhiteSpace(location))
            cmd.Parameters.AddWithValue("@location", location.Trim());
        if (!string.IsNullOrWhiteSpace(project))
            cmd.Parameters.AddWithValue("@project", project.Trim());

        var points = new System.Collections.Generic.List<DailyOutputRatePointDto>();
        await using var rdr = await cmd.ExecuteReaderAsync(ct);
        while (await rdr.ReadAsync(ct))
        {
            points.Add(new DailyOutputRatePointDto(
                Date:       rdr.GetString(0),
                ActualRate: rdr.IsDBNull(1) ? 0 : rdr.GetDouble(1),
                AskingRate: rdr.IsDBNull(2) ? 0 : rdr.GetDouble(2)
            ));
        }

        var days     = toDate.DayNumber - fromDate.DayNumber + 1;
        var scope    = !string.IsNullOrWhiteSpace(wellId)  ? $"Well {wellId}"
                     : !string.IsNullOrWhiteSpace(project) ? $"{project} project"
                     : !string.IsNullOrWhiteSpace(cluster) ? $"{cluster} cluster"
                     : "All Wells";
        var subtitle = $"Actual vs Asking Rate \u00b7 {days} days \u00b7 {scope}";

        var dto = new DailyOutputRateDto(points.AsReadOnly(), subtitle);
        cache.Set(cacheKey, dto, TimeSpan.FromMinutes(10));
        return dto;
    }

    // ─── Pegging Status (Construction Well Delivery) ─────────────────────────
    public async Task<PeggingStatusResponse> GetPeggingStatusAsync(
        int? planYear = null,
        DateOnly? asOfDate = null,
        string? cluster = null,
        string? site = null,
        string? project = null,
        string? wellType = null,
        string? wellId = null,
        CancellationToken ct = default)
    {
        var year = planYear ?? DateTime.UtcNow.Year;
        var asOf = asOfDate ?? DateOnly.FromDateTime(DateTime.UtcNow);
        var cacheKey = $"pegging-status:{year}:{asOf:yyyy-MM-dd}:{cluster ?? "all"}:{site ?? "all"}:{project ?? "all"}:{wellType ?? "all"}:{wellId ?? "all"}";
        if (cache.TryGetValue(cacheKey, out PeggingStatusResponse? cached) && cached is not null)
            return cached;

        var currentMonth = asOf.Year == year ? asOf.Month : 12;

        // Build optional filter clauses.
        // extraWhere: applied inside ROW_NUMBER CTE (stable per-well attributes only).
        // postDedupWhere: applied AFTER rn=1 dedup to avoid double-counting wells
        //   that appear in WMR with multiple project_id values across history.
        var extraWhere = "";
        var postDedupWhere = "";
        if (!string.IsNullOrEmpty(cluster))       extraWhere     += " AND " + ClusterFilter(cluster, "w.[pdo_well_id]");
        if (!string.IsNullOrWhiteSpace(site))     extraWhere     += " AND w.project_id IN (SELECT CAST(ID AS NVARCHAR(100)) FROM [dbo].[ProjectIDs] WITH (NOLOCK) WHERE NULLIF(LTRIM(RTRIM([Site])), '') = @site)";
        if (!string.IsNullOrWhiteSpace(wellType)) extraWhere     += " AND " + WellTypeFilter("w");
        if (!string.IsNullOrEmpty(wellId))        extraWhere     += " AND w.[pdo_well_id] = @wellId";
        // Project filter post-dedup: a well may have rows for multiple projects in WMR history.
        // Filtering inside the CTE makes the "latest row" point to the latest row within that
        // project subset — causing the same well to be counted under multiple individual projects,
        // breaking the invariant: All-Projects count == sum of individual project counts.
        if (!string.IsNullOrWhiteSpace(project))  postDedupWhere += " AND " + ProjectFilter("w");

        var sql = $"""
            SET NOCOUNT ON;

            DECLARE @Year INT = @yearParam;
            DECLARE @CurrentMonth INT = @currentMonthParam;
            DECLARE @Today DATE = CAST(GETDATE() AS DATE);
            DECLARE @FourMonths DATE = DATEADD(MONTH, 4, CAST(GETDATE() AS DATE));

            -- ═══════════════════════════════════════════════════════════════
            -- Result Set 1: KPI Tiles + Backlog + Risk
            -- ═══════════════════════════════════════════════════════════════
            ;WITH latest_wmr AS (
                SELECT *,
                    ROW_NUMBER() OVER (
                        PARTITION BY pdo_well_id
                        ORDER BY COALESCE(COALESCE(TRY_CAST(Week_Number AS DATE), TRY_CONVERT(DATE, Week_Number, 5)),
                                          COALESCE(TRY_CAST(Week_Number AS DATE), TRY_CONVERT(DATE, Week_Number, 5))) DESC
                    ) AS rn
                FROM dbo.WMR w WITH (NOLOCK)
                WHERE w.pdo_well_id IS NOT NULL
                  AND (w.well_year_white_space = CAST(@Year AS NVARCHAR)
                       OR YEAR(TRY_CAST(w.[latest_exp.rig_on_location_sap_data] AS DATE)) = @Year)
                  AND w.well_type NOT LIKE '%Buffer%'
                  {extraWhere}
            ),
            pegging_base AS (
                SELECT
                    w.pdo_well_id,
                    TRY_CAST(w.[latest_exp.rig_on_location_sap_data] AS DATE) AS kpi_dl,
                    w.actual_pegged_date,
                    w.date_of_site_survey_report_issuance,
                    w.flaf_issue_date,
                    w.scr_no,
                    w.moc_raised,
                    w.moc_approved,
                    w.ssfd_wells,
                    w.ipm
                FROM latest_wmr w
                WHERE w.rn = 1
                  {postDedupWhere}
            ),
            flags AS (
                SELECT *,
                    CASE WHEN (actual_pegged_date IS NOT NULL
                              AND LTRIM(RTRIM(actual_pegged_date)) != '')
                           OR (date_of_site_survey_report_issuance IS NOT NULL
                               AND LTRIM(RTRIM(date_of_site_survey_report_issuance)) != '')
                         THEN 1 ELSE 0 END AS is_pegged,
                    CASE WHEN kpi_dl BETWEEN @Today AND @FourMonths
                         THEN 1 ELSE 0 END AS is_4m_critical,
                    CASE WHEN kpi_dl < @Today
                          AND (actual_pegged_date IS NULL
                               OR LTRIM(RTRIM(actual_pegged_date)) = '')
                          AND (date_of_site_survey_report_issuance IS NULL
                               OR LTRIM(RTRIM(date_of_site_survey_report_issuance)) = '')
                         THEN 1 ELSE 0 END AS is_backlog,
                    CASE WHEN kpi_dl < @Today
                          AND (actual_pegged_date IS NULL
                               OR LTRIM(RTRIM(actual_pegged_date)) = '')
                          AND (date_of_site_survey_report_issuance IS NULL
                               OR LTRIM(RTRIM(date_of_site_survey_report_issuance)) = '')
                         THEN
                             CASE WHEN (flaf_issue_date IS NULL
                                        OR LTRIM(RTRIM(flaf_issue_date)) = '')
                                  THEN 'PDO'
                                  WHEN scr_no IS NOT NULL
                                   AND LTRIM(RTRIM(scr_no)) != ''
                                  THEN 'PDO'
                                  WHEN moc_raised IS NOT NULL
                                   AND LTRIM(RTRIM(moc_raised)) != ''
                                   AND (moc_approved IS NULL
                                        OR LTRIM(RTRIM(moc_approved)) = '')
                                  THEN 'PDO'
                                  WHEN (ssfd_wells IS NOT NULL AND LTRIM(RTRIM(ssfd_wells)) != '')
                                    OR (ipm IS NOT NULL AND LTRIM(RTRIM(ipm)) != '')
                                  THEN 'PDO'
                                  ELSE 'ATNM'
                             END
                         ELSE NULL
                    END AS responsibility
                FROM pegging_base
            )
            SELECT
                COUNT(*)                          AS plan_rig_sequence,
                SUM(is_pegged)                    AS actual_issued,
                CAST(ROUND(SUM(is_pegged) * 100.0
                     / NULLIF(COUNT(*), 0), 1)
                     AS DECIMAL(5,1))             AS pegging_performance_pct,
                CAST(ROUND(
                    SUM(CASE WHEN is_4m_critical = 1 AND is_pegged = 1
                             THEN 1 ELSE 0 END) * 100.0
                    / NULLIF(SUM(is_4m_critical), 0), 1)
                    AS DECIMAL(5,1))              AS pegging_readiness_4m_pct,
                CAST(ROUND(
                    (SUM(is_pegged) * 1.0
                     / NULLIF(COUNT(*), 0)) - 1, 3) * 100
                    AS DECIMAL(5,1))              AS trend_vs_plan_pct,
                SUM(is_backlog)                   AS total_backlog,
                SUM(CASE WHEN responsibility = 'ATNM'
                         THEN 1 ELSE 0 END)       AS atnm_backlog,
                SUM(CASE WHEN responsibility = 'PDO'
                         THEN 1 ELSE 0 END)       AS pdo_backlog,
                SUM(is_4m_critical)               AS plan_4m,
                SUM(CASE WHEN is_4m_critical = 1 AND is_pegged = 1
                         THEN 1 ELSE 0 END)       AS actual_4m
            FROM flags;

            -- ═══════════════════════════════════════════════════════════════
            -- Result Set 2: Monthly Cumulative Chart (Stacked Area)
            -- ═══════════════════════════════════════════════════════════════
            ;WITH latest_wmr2 AS (
                SELECT *,
                    ROW_NUMBER() OVER (
                        PARTITION BY pdo_well_id
                        ORDER BY COALESCE(COALESCE(TRY_CAST(Week_Number AS DATE), TRY_CONVERT(DATE, Week_Number, 5)),
                                          COALESCE(TRY_CAST(Week_Number AS DATE), TRY_CONVERT(DATE, Week_Number, 5))) DESC
                    ) AS rn
                FROM dbo.WMR w WITH (NOLOCK)
                WHERE w.pdo_well_id IS NOT NULL
                  AND (w.well_year_white_space = CAST(@Year AS NVARCHAR)
                       OR YEAR(TRY_CAST(w.[latest_exp.rig_on_location_sap_data] AS DATE)) = @Year)
                  AND w.well_type NOT LIKE '%Buffer%'
                  {extraWhere}
            ),
            months AS (
                SELECT n AS m
                FROM (VALUES(1),(2),(3),(4),(5),(6),(7),(8),(9),(10),(11),(12)) v(n)
                WHERE n <= @CurrentMonth + 4
            ),
            plan_by_month AS (
                SELECT
                    CASE
                        WHEN YEAR(TRY_CAST(w.[latest_exp.rig_on_location_sap_data] AS DATE)) = @Year
                         AND MONTH(TRY_CAST(w.[latest_exp.rig_on_location_sap_data] AS DATE)) <= @CurrentMonth + 4
                        THEN MONTH(TRY_CAST(w.[latest_exp.rig_on_location_sap_data] AS DATE))
                        ELSE @CurrentMonth
                    END AS mth,
                    COUNT(DISTINCT w.pdo_well_id) AS plan_count
                FROM latest_wmr2 w
                WHERE w.rn = 1
                  {postDedupWhere}
                GROUP BY
                    CASE
                        WHEN YEAR(TRY_CAST(w.[latest_exp.rig_on_location_sap_data] AS DATE)) = @Year
                         AND MONTH(TRY_CAST(w.[latest_exp.rig_on_location_sap_data] AS DATE)) <= @CurrentMonth + 4
                        THEN MONTH(TRY_CAST(w.[latest_exp.rig_on_location_sap_data] AS DATE))
                        ELSE @CurrentMonth
                    END
            ),
            actual_by_month AS (
                SELECT
                    CASE
                        WHEN YEAR(COALESCE(
                            TRY_CAST(w.actual_pegged_date AS DATE),
                            TRY_CAST(w.date_of_site_survey_report_issuance AS DATE)
                        )) = @Year
                         AND MONTH(COALESCE(
                            TRY_CAST(w.actual_pegged_date AS DATE),
                            TRY_CAST(w.date_of_site_survey_report_issuance AS DATE)
                        )) <= @CurrentMonth + 4
                        THEN MONTH(COALESCE(
                            TRY_CAST(w.actual_pegged_date AS DATE),
                            TRY_CAST(w.date_of_site_survey_report_issuance AS DATE)
                        ))
                        WHEN YEAR(TRY_CAST(w.[latest_exp.rig_on_location_sap_data] AS DATE)) = @Year
                         AND MONTH(TRY_CAST(w.[latest_exp.rig_on_location_sap_data] AS DATE)) <= @CurrentMonth + 4
                        THEN MONTH(TRY_CAST(w.[latest_exp.rig_on_location_sap_data] AS DATE))
                        ELSE @CurrentMonth
                    END AS mth,
                    COUNT(DISTINCT w.pdo_well_id) AS actual_count
                FROM latest_wmr2 w
                WHERE w.rn = 1
                  {postDedupWhere}
                  AND (
                       (w.actual_pegged_date IS NOT NULL AND LTRIM(RTRIM(w.actual_pegged_date)) != '')
                    OR (w.date_of_site_survey_report_issuance IS NOT NULL AND LTRIM(RTRIM(w.date_of_site_survey_report_issuance)) != '')
                  )
                GROUP BY
                    CASE
                        WHEN YEAR(COALESCE(
                            TRY_CAST(w.actual_pegged_date AS DATE),
                            TRY_CAST(w.date_of_site_survey_report_issuance AS DATE)
                        )) = @Year
                         AND MONTH(COALESCE(
                            TRY_CAST(w.actual_pegged_date AS DATE),
                            TRY_CAST(w.date_of_site_survey_report_issuance AS DATE)
                        )) <= @CurrentMonth + 4
                        THEN MONTH(COALESCE(
                            TRY_CAST(w.actual_pegged_date AS DATE),
                            TRY_CAST(w.date_of_site_survey_report_issuance AS DATE)
                        ))
                        WHEN YEAR(TRY_CAST(w.[latest_exp.rig_on_location_sap_data] AS DATE)) = @Year
                         AND MONTH(TRY_CAST(w.[latest_exp.rig_on_location_sap_data] AS DATE)) <= @CurrentMonth + 4
                        THEN MONTH(TRY_CAST(w.[latest_exp.rig_on_location_sap_data] AS DATE))
                        ELSE @CurrentMonth
                    END
            )
            SELECT
                CHOOSE(m.m,'Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec') AS MonthLabel,
                m.m AS MonthNum,
                CASE WHEN m.m <= @CurrentMonth THEN 0 ELSE 1 END AS IsForecast,
                SUM(ISNULL(p.plan_count, 0))
                    OVER (ORDER BY m.m ROWS UNBOUNDED PRECEDING) AS PlanCumulative,
                SUM(ISNULL(a.actual_count, 0))
                    OVER (ORDER BY m.m ROWS UNBOUNDED PRECEDING) AS ActualCumulative,
                SUM(ISNULL(a.actual_count, 0))
                    OVER (ORDER BY m.m ROWS UNBOUNDED PRECEDING)
                - SUM(ISNULL(p.plan_count, 0))
                    OVER (ORDER BY m.m ROWS UNBOUNDED PRECEDING) AS BacklogCumulative
            FROM months m
            LEFT JOIN plan_by_month   p ON m.m = p.mth
            LEFT JOIN actual_by_month a ON m.m = a.mth
            ORDER BY m.m;
            """;

        var connStr = db.Database.GetConnectionString()!;
        await using var conn = new SqlConnection(connStr);
        await OpenWithRetryAsync(conn, ct);

        await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 120 };
        cmd.Parameters.AddWithValue("@yearParam", year);
        cmd.Parameters.AddWithValue("@currentMonthParam", currentMonth);
        if (!string.IsNullOrEmpty(cluster))       cmd.Parameters.AddWithValue("@cluster",  cluster.Trim());
        if (!string.IsNullOrWhiteSpace(site))     cmd.Parameters.AddWithValue("@site",     site.Trim());
        if (!string.IsNullOrWhiteSpace(project))  cmd.Parameters.AddWithValue("@project",  project.Trim());
        if (!string.IsNullOrWhiteSpace(wellType)) cmd.Parameters.AddWithValue("@wellType", wellType.Trim());
        if (!string.IsNullOrEmpty(wellId)) cmd.Parameters.AddWithValue("@wellId", wellId);

        await using var rdr = await cmd.ExecuteReaderAsync(ct);

        // Result Set 1: KPI + Backlog + Risk
        await rdr.ReadAsync(ct);
        var planRigSequence       = rdr.IsDBNull(0) ? 0 : rdr.GetInt32(0);
        var actualIssued          = rdr.IsDBNull(1) ? 0 : rdr.GetInt32(1);
        var perfPct               = rdr.IsDBNull(2) ? 0.0 : (double)rdr.GetDecimal(2);
        var readinessPct          = rdr.IsDBNull(3) ? 0.0 : (double)rdr.GetDecimal(3);
        var trendPct              = rdr.IsDBNull(4) ? 0.0 : (double)rdr.GetDecimal(4);
        var totalBacklog          = rdr.IsDBNull(5) ? 0 : rdr.GetInt32(5);
        var atnmBacklog           = rdr.IsDBNull(6) ? 0 : rdr.GetInt32(6);
        var pdoBacklog            = rdr.IsDBNull(7) ? 0 : rdr.GetInt32(7);
        var plan4m                = rdr.IsDBNull(8) ? 0 : rdr.GetInt32(8);
        var actual4m              = rdr.IsDBNull(9) ? 0 : rdr.GetInt32(9);

        var projectedGap = Math.Abs(actual4m - plan4m);
        var gaugeMax = 100;
        var riskLevel = projectedGap <= 33 ? "On Track" : projectedGap <= 66 ? "Watch" : "High Risk";

        var kpi = new PeggingStatusKpiDto(planRigSequence, actualIssued, perfPct, readinessPct, trendPct);
        var backlog = new PeggingBacklogDto(
            totalBacklog,
            atnmBacklog,
            totalBacklog > 0 ? Math.Round(atnmBacklog * 100.0 / totalBacklog, 1) : 0,
            pdoBacklog,
            totalBacklog > 0 ? Math.Round(pdoBacklog * 100.0 / totalBacklog, 1) : 0);
        var risk = new PeggingRiskDto(projectedGap, riskLevel, gaugeMax);

        // Result Set 2: Monthly Trend
        await rdr.NextResultAsync(ct);
        var months = new List<PeggingMonthDto>();
        while (await rdr.ReadAsync(ct))
        {
            months.Add(new PeggingMonthDto(
                MonthLabel:        rdr.GetString(0),
                MonthNum:          rdr.GetInt32(1),
                IsForecast:        rdr.GetInt32(2) == 1,
                PlanCumulative:    rdr.IsDBNull(3) ? 0 : rdr.GetInt32(3),
                ActualCumulative:  rdr.IsDBNull(4) ? 0 : rdr.GetInt32(4),
                BacklogCumulative: rdr.IsDBNull(5) ? 0 : rdr.GetInt32(5)
            ));
        }

        var result = new PeggingStatusResponse(
            AsOfDate: asOf.ToString("yyyy-MM-dd"),
            PlanYear: year,
            Kpi: kpi,
            Backlog: backlog,
            Risk: risk,
            MonthlyTrend: months
        );

        cache.Set(cacheKey, result, CacheDuration);
        return result;
    }

    // ─── Overall Pegging Status (pie: pegging completed <90d / >90d before rig-on) ──
    public async Task<OverallPeggingStatusResponse> GetOverallPeggingStatusAsync(
        string? cluster = null,
        string? site = null,
        string? project = null,
        string? wellType = null,
        string? wellId = null,
        CancellationToken ct = default)
    {
        var cacheKey = $"overall-pegging-status:{cluster ?? "all"}:{site ?? "all"}:{project ?? "all"}:{wellType ?? "all"}:{wellId ?? "all"}";
        if (cache.TryGetValue(cacheKey, out OverallPeggingStatusResponse? cached) && cached is not null)
            return cached;

        // Optional cluster / site / project / wellType / well filters — applied on the latest WMR snapshot per well.
        var extraWhere = "";
        if (!string.IsNullOrEmpty(cluster))       extraWhere += " AND " + ClusterFilter(cluster, "w.[pdo_well_id]");
        if (!string.IsNullOrWhiteSpace(site))     extraWhere += " AND w.project_id IN (SELECT CAST(ID AS NVARCHAR(100)) FROM [dbo].[ProjectIDs] WITH (NOLOCK) WHERE NULLIF(LTRIM(RTRIM([Site])), '') = @site)";
        if (!string.IsNullOrWhiteSpace(project))  extraWhere += " AND " + ProjectFilter("w");
        if (!string.IsNullOrWhiteSpace(wellType)) extraWhere += " AND " + WellTypeFilter("w");
        if (!string.IsNullOrEmpty(wellId))        extraWhere += " AND w.[pdo_well_id] = @wellId";

        // Classify each well whose pegging is complete (both actual_pegged_date and
        // actual_rig_on_date are present) by the gap between pegging and rig arrival:
        //   • ≤ 90 days before rig-on  → pegging completed < 90 days
        //   • > 90 days before rig-on  → pegging completed > 90 days
        // Also compute two FLAF metrics:
        //   • FlafPendingWithin90    → FLAF not yet issued, scheduled rig-on is within 0-90 days from today
        //   • FlafIssuedLateWithin90 → FLAF was issued but < 90 days before the scheduled rig-on (breach)
        // Dates are NVARCHAR in WMR, so TRY_CAST is used throughout.
        var sql = $"""
            SET NOCOUNT ON;

            DECLARE @Today DATE = CAST(GETDATE() AS DATE);

            ;WITH latest_wmr AS (
                SELECT *,
                    ROW_NUMBER() OVER (
                        PARTITION BY pdo_well_id
                        ORDER BY COALESCE(TRY_CAST(Week_Number AS DATE), TRY_CONVERT(DATE, Week_Number, 5)) DESC
                    ) AS rn
                FROM dbo.WMR w WITH (NOLOCK)
                WHERE w.pdo_well_id IS NOT NULL
                  {extraWhere}
            ),
            base AS (
                SELECT
                    TRY_CAST(w.actual_pegged_date AS DATE)                     AS pegged_dt,
                    TRY_CAST(w.actual_rig_on_date AS DATE)                     AS rig_on_dt,
                    TRY_CAST(w.flaf_issue_date AS DATE)                        AS flaf_dt,
                    TRY_CAST(w.[latest_exp.rig_on_location_sap_data] AS DATE)  AS sched_rig_dt
                FROM latest_wmr w
                WHERE w.rn = 1
            )
            SELECT
                -- existing pegging buckets
                SUM(CASE WHEN pegged_dt IS NOT NULL AND rig_on_dt IS NOT NULL
                          AND DATEDIFF(DAY, pegged_dt, rig_on_dt) <= 90 THEN 1 ELSE 0 END) AS Within90,
                SUM(CASE WHEN pegged_dt IS NOT NULL AND rig_on_dt IS NOT NULL
                          AND DATEDIFF(DAY, pegged_dt, rig_on_dt) >  90 THEN 1 ELSE 0 END) AS After90,
                -- Item 1: Pegging still pending, scheduled rig-on is within 0–90 days (at risk)
                SUM(CASE WHEN pegged_dt IS NULL
                          AND sched_rig_dt IS NOT NULL
                          AND DATEDIFF(DAY, @Today, sched_rig_dt) BETWEEN 0 AND 89
                         THEN 1 ELSE 0 END) AS NotPeggedWithin90,
                -- Item 3: FLAF pending, scheduled rig-on < 90 days away
                SUM(CASE WHEN flaf_dt IS NULL
                          AND sched_rig_dt IS NOT NULL
                          AND DATEDIFF(DAY, @Today, sched_rig_dt) BETWEEN 0 AND 89
                         THEN 1 ELSE 0 END) AS FlafPendingWithin90,
                -- Item 4: FLAF issued but < 90 days before scheduled rig-on (breach)
                SUM(CASE WHEN flaf_dt IS NOT NULL
                          AND sched_rig_dt IS NOT NULL
                          AND DATEDIFF(DAY, flaf_dt, sched_rig_dt) < 90
                         THEN 1 ELSE 0 END) AS FlafIssuedLateWithin90
            FROM base;
            """;

        var connStr = db.Database.GetConnectionString()!;
        await using var conn = new SqlConnection(connStr);
        await OpenWithRetryAsync(conn, ct);

        await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 120 };
        if (!string.IsNullOrEmpty(cluster))       cmd.Parameters.AddWithValue("@cluster",  cluster);
        if (!string.IsNullOrWhiteSpace(site))     cmd.Parameters.AddWithValue("@site",     site.Trim());
        if (!string.IsNullOrWhiteSpace(project))  cmd.Parameters.AddWithValue("@project",  project.Trim());
        if (!string.IsNullOrWhiteSpace(wellType)) cmd.Parameters.AddWithValue("@wellType", wellType.Trim());
        if (!string.IsNullOrEmpty(wellId))        cmd.Parameters.AddWithValue("@wellId",   wellId);

        await using var rdr = await cmd.ExecuteReaderAsync(ct);
        await rdr.ReadAsync(ct);

        var within90           = rdr.IsDBNull(0) ? 0 : rdr.GetInt32(0);
        var after90            = rdr.IsDBNull(1) ? 0 : rdr.GetInt32(1);
        var notPegged          = rdr.IsDBNull(2) ? 0 : rdr.GetInt32(2);
        var flafPending        = rdr.IsDBNull(3) ? 0 : rdr.GetInt32(3);
        var flafIssuedLate     = rdr.IsDBNull(4) ? 0 : rdr.GetInt32(4);

        var result = new OverallPeggingStatusResponse(
            CompletedWithin90Days:      within90,
            CompletedAfter90Days:       after90,
            Total:                      within90 + after90,
            NotPeggedWithin90Days:      notPegged,
            FlafPendingWithin90Days:    flafPending,
            FlafIssuedLateWithin90Days: flafIssuedLate);

        cache.Set(cacheKey, result, CacheDuration);
        return result;
    }

    // ─── Well Delivery Cycle Time ─────────────────────────────────────────────────
    public async Task<WellDeliveryCycleTimeResponse> GetWellDeliveryCycleTimeAsync(
        string? cluster = null,
        CancellationToken ct = default,
        string? site = null, string? project = null, string? wellType = null,
        DateOnly? from = null, DateOnly? to = null)
    {
        var cacheKey = $"well-delivery-cycle-time:{cluster ?? "all"}:{site ?? "all"}:{project ?? "all"}:{wellType ?? "all"}:{from?.ToString("yyyy-MM-dd") ?? "all"}:{to?.ToString("yyyy-MM-dd") ?? "all"}";
        if (cache.TryGetValue(cacheKey, out WellDeliveryCycleTimeResponse? cached) && cached is not null)
            return cached;

        // cluster/site/project/wellType scope WHICH wells are included, and the date range scopes
        // BY delivery date — both applied in C# below. Filtering the huge dbo.WMR table in SQL by a
        // ProjectIDs subquery is slow/unreliable, so we keep the fast unfiltered scan and scope the
        // resulting rows in memory via a small cached ProjectIDs lookup.
        var scopeMap = (cluster ?? site ?? project ?? wellType) is null
            ? null
            : await GetProjectScopeMapAsync(ct);

        // One row per well (latest WMR snapshot) with the actual lifecycle dates. A well counts
        // as "delivered" when it has a rig-on date and a delivery date (commissioning finish,
        // else engineering completion). All aggregation is done in C# for clarity/testability.
        const string sql = """
            SET NOCOUNT ON;
            ;WITH latest AS (
                SELECT *,
                    ROW_NUMBER() OVER (
                        PARTITION BY pdo_well_id
                        ORDER BY COALESCE(TRY_CAST(Week_Number AS DATE), TRY_CONVERT(DATE, Week_Number, 5)) DESC
                    ) AS rn
                FROM dbo.WMR w WITH (NOLOCK)
                WHERE pdo_well_id IS NOT NULL AND pdo_well_id <> ''
            )
            SELECT
                pdo_well_id                                     AS WellId,
                TRY_CAST(actual_rig_on_date AS DATE)            AS RigOn,
                TRY_CAST(actual_rig_off_date AS DATE)           AS RigOff,
                TRY_CAST([actual_eng._completion_date] AS DATE) AS EngDone,
                TRY_CAST(actual_finish_date AS DATE)            AS Finish,
                LTRIM(RTRIM(CAST(project_id AS NVARCHAR(100)))) AS ProjectId
            FROM latest
            WHERE rn = 1
              AND TRY_CAST(actual_rig_on_date AS DATE) IS NOT NULL
              AND COALESCE(TRY_CAST(actual_finish_date AS DATE),
                           TRY_CAST([actual_eng._completion_date] AS DATE)) IS NOT NULL;
            """;

        var connStr = db.Database.GetConnectionString()!;
        await using var conn = new SqlConnection(connStr);
        await OpenWithRetryAsync(conn, ct);
        await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 60 };

        var rows = new List<(string Well, DateTime RigOn, DateTime? RigOff, DateTime? EngDone, DateTime? Finish, DateTime Delivery, int Cycle)>();
        await using (var rdr = await cmd.ExecuteReaderAsync(ct))
        {
            while (await rdr.ReadAsync(ct))
            {
                if (rdr.IsDBNull(1)) continue;
                // In-memory scope filter (cluster/site/project/wellType) via the cached ProjectIDs lookup.
                if (scopeMap is not null)
                {
                    var pid = rdr.IsDBNull(5) ? null : rdr.GetString(5);
                    if (pid is null || !scopeMap.TryGetValue(pid, out var info)) continue;
                    if (cluster  is not null && !string.Equals(info.cluster, cluster,  StringComparison.OrdinalIgnoreCase)) continue;
                    if (site     is not null && !string.Equals(info.site,    site,     StringComparison.OrdinalIgnoreCase)) continue;
                    if (project  is not null && !string.Equals(info.project, project,  StringComparison.OrdinalIgnoreCase)) continue;
                    if (wellType is not null && !string.Equals(info.type,    wellType, StringComparison.OrdinalIgnoreCase)) continue;
                }
                var well    = rdr.IsDBNull(0) ? "" : rdr.GetValue(0).ToString()!;
                var rigOn   = rdr.GetDateTime(1);
                DateTime? rigOff  = rdr.IsDBNull(2) ? null : rdr.GetDateTime(2);
                DateTime? engDone = rdr.IsDBNull(3) ? null : rdr.GetDateTime(3);
                DateTime? finish  = rdr.IsDBNull(4) ? null : rdr.GetDateTime(4);
                var delivery = finish ?? engDone;
                if (delivery is null) continue;
                var cycle = (delivery.Value - rigOn).Days;
                if (cycle < 0) continue;
                rows.Add((well, rigOn, rigOff, engDone, finish, delivery.Value, cycle));
            }
        }

        static double Median(IReadOnlyList<int> xs)
        {
            if (xs.Count == 0) return 0;
            var s = xs.OrderBy(v => v).ToList();
            int m = s.Count / 2;
            return s.Count % 2 == 1 ? s[m] : (s[m - 1] + s[m]) / 2.0;
        }

        // Scope rows to the global date range (by delivery date) when one is set; else use all wells.
        var hasRange = from.HasValue || to.HasValue;
        var winStart = from?.ToDateTime(TimeOnly.MinValue) ?? DateTime.MinValue;
        var winEnd   = to?.ToDateTime(TimeOnly.MaxValue)   ?? DateTime.MaxValue;
        var statRows = hasRange
            ? rows.Where(r => r.Delivery >= winStart && r.Delivery <= winEnd).ToList()
            : rows;

        if (statRows.Count == 0)
        {
            var empty = new WellDeliveryCycleTimeResponse(0, 0, 0, 0, 0, 0, 0, null, 0, null, 0, 0,
                Array.Empty<CycleTimeTrendPointDto>(), Array.Empty<CycleTimePhaseDto>());
            cache.Set(cacheKey, empty, CacheDuration);
            return empty;
        }

        var cycles  = statRows.Select(r => r.Cycle).ToList();
        var avg     = Math.Round(cycles.Average(), 1);
        var median  = Math.Round(Median(cycles), 1);
        var minRow  = statRows.OrderBy(r => r.Cycle).First();
        var maxRow  = statRows.OrderByDescending(r => r.Cycle).First();

        // Deltas: the selected window vs the equal-length window immediately before it.
        // With no range, fall back to the rolling current-6-months vs prior-6-months comparison.
        var today = DateTime.Today;
        DateTime curStart, curEnd, prevStart, prevEnd;
        if (hasRange)
        {
            curStart  = winStart == DateTime.MinValue ? rows.Min(r => r.Delivery) : winStart;
            curEnd    = winEnd   == DateTime.MaxValue ? today : winEnd;
            var span  = curEnd - curStart;
            prevEnd   = curStart;
            prevStart = curStart - span;
        }
        else
        {
            curEnd = today; curStart = today.AddMonths(-6);
            prevEnd = curStart; prevStart = today.AddMonths(-12);
        }
        var curRows   = rows.Where(r => r.Delivery > curStart  && r.Delivery <= curEnd).ToList();
        var prevRows  = rows.Where(r => r.Delivery > prevStart && r.Delivery <= prevEnd).ToList();
        double curAvg  = curRows.Count  > 0 ? curRows.Average(r => r.Cycle)  : 0;
        double prevAvg = prevRows.Count > 0 ? prevRows.Average(r => r.Cycle) : 0;
        double curMed  = Median(curRows.Select(r => r.Cycle).ToList());
        double prevMed = Median(prevRows.Select(r => r.Cycle).ToList());

        // Monthly trend — months spanning the selected range (capped at 24), else the last 6 months.
        var trend = new List<CycleTimeTrendPointDto>();
        DateTime trendStart, trendEnd;
        if (hasRange)
        {
            var lo = winStart == DateTime.MinValue ? statRows.Min(r => r.Delivery) : winStart;
            var hi = winEnd   == DateTime.MaxValue ? today : winEnd;
            trendStart = new DateTime(lo.Year, lo.Month, 1);
            trendEnd   = new DateTime(hi.Year, hi.Month, 1);
        }
        else
        {
            trendEnd   = new DateTime(today.Year, today.Month, 1);
            trendStart = trendEnd.AddMonths(-5);
        }
        for (var m = trendStart; m <= trendEnd && trend.Count < 24; m = m.AddMonths(1))
        {
            var mEnd = m.AddMonths(1);
            var monthCycles = statRows.Where(r => r.Delivery >= m && r.Delivery < mEnd).Select(r => r.Cycle).ToList();
            trend.Add(new CycleTimeTrendPointDto(
                m.ToString("MMM yyyy"),
                monthCycles.Count > 0 ? Math.Round(monthCycles.Average(), 1) : 0,
                monthCycles.Count > 0 ? Math.Round(Median(monthCycles), 1)   : 0));
        }

        // Phase split: Drilling (rig-on→rig-off) → Construction (rig-off→eng-done) → Commissioning (eng-done→finish).
        var drilling      = statRows.Where(r => r.RigOff.HasValue && r.RigOff.Value >= r.RigOn)
                                 .Select(r => (r.RigOff!.Value - r.RigOn).Days).ToList();
        var construction  = statRows.Where(r => r.EngDone.HasValue && r.RigOff.HasValue && r.EngDone.Value >= r.RigOff.Value)
                                 .Select(r => (r.EngDone!.Value - r.RigOff!.Value).Days).ToList();
        var commissioning = statRows.Where(r => r.Finish.HasValue && r.EngDone.HasValue && r.Finish.Value >= r.EngDone.Value)
                                 .Select(r => (r.Finish!.Value - r.EngDone!.Value).Days).ToList();
        double dAvg = drilling.Count      > 0 ? drilling.Average()      : 0;
        double cAvg = construction.Count  > 0 ? construction.Average()  : 0;
        double kAvg = commissioning.Count > 0 ? commissioning.Average() : 0;
        var phaseTotal = dAvg + cAvg + kAvg;
        double Pct(double v) => phaseTotal > 0 ? Math.Round(v / phaseTotal * 100, 0) : 0;
        var phases = new List<CycleTimePhaseDto>
        {
            new("Drilling",      Math.Round(dAvg, 1), Pct(dAvg)),
            new("Construction",  Math.Round(cAvg, 1), Pct(cAvg)),
            new("Commissioning", Math.Round(kAvg, 1), Pct(kAvg)),
        };

        var result = new WellDeliveryCycleTimeResponse(
            AvgDays:        avg,
            AvgDelta:       Math.Round(prevAvg - curAvg, 1),
            AvgDeltaPct:    prevAvg > 0 ? Math.Round((prevAvg - curAvg) / prevAvg * 100, 1) : 0,
            MedianDays:     median,
            MedianDelta:    Math.Round(prevMed - curMed, 1),
            MedianDeltaPct: prevMed > 0 ? Math.Round((prevMed - curMed) / prevMed * 100, 1) : 0,
            MinDays:        minRow.Cycle,
            MinWell:        minRow.Well,
            MaxDays:        maxRow.Cycle,
            MaxWell:        maxRow.Well,
            WellsCompleted: statRows.Count,
            WellsDelta:     curRows.Count - prevRows.Count,
            Trend:          trend,
            Phases:         phases);

        cache.Set(cacheKey, result, CacheDuration);
        return result;
    }

    // ─── FLAF Status (Construction Well Delivery) ─────────────────────────────────
    public async Task<FlafStatusResponse> GetFlafStatusAsync(
        int? planYear = null,
        DateOnly? asOfDate = null,
        string? cluster = null,
        string? site = null,
        string? project = null,
        string? wellType = null,
        string? wellId = null,
        CancellationToken ct = default)
    {
        var year = planYear ?? DateTime.UtcNow.Year;
        var asOf = asOfDate ?? DateOnly.FromDateTime(DateTime.UtcNow);
        var cacheKey = $"flaf-status:{year}:{asOf:yyyy-MM-dd}:{cluster ?? "all"}:{site ?? "all"}:{project ?? "all"}:{wellType ?? "all"}:{wellId ?? "all"}";
        if (cache.TryGetValue(cacheKey, out FlafStatusResponse? cached) && cached is not null)
            return cached;

        var currentMonth = asOf.Year == year ? asOf.Month : 12;

        // Build optional filter clauses (same post-dedup split as GetPeggingStatusAsync).
        var extraWhere = "";
        var postDedupWhere = "";
        if (!string.IsNullOrEmpty(cluster))       extraWhere     += " AND " + ClusterFilter(cluster, "w.[pdo_well_id]");
        if (!string.IsNullOrWhiteSpace(site))     extraWhere     += " AND w.project_id IN (SELECT CAST(ID AS NVARCHAR(100)) FROM [dbo].[ProjectIDs] WITH (NOLOCK) WHERE NULLIF(LTRIM(RTRIM([Site])), '') = @site)";
        if (!string.IsNullOrWhiteSpace(wellType)) extraWhere     += " AND " + WellTypeFilter("w");
        if (!string.IsNullOrEmpty(wellId))        extraWhere     += " AND w.[pdo_well_id] = @wellId";
        if (!string.IsNullOrWhiteSpace(project))  postDedupWhere += " AND " + ProjectFilter("w");

        var sql = $"""
            SET NOCOUNT ON;

            DECLARE @Year INT = @yearParam;
            DECLARE @CurrentMonth INT = @currentMonthParam;
            DECLARE @Today DATE = CAST(GETDATE() AS DATE);
            DECLARE @FourMonths DATE = DATEADD(MONTH, 4, CAST(GETDATE() AS DATE));

            -- ═══════════════════════════════════════════════════════════════
            -- Result Set 1: FLAF KPI Tiles + Backlog + Risk
            -- ═══════════════════════════════════════════════════════════════
            ;WITH latest_wmr AS (
                SELECT *,
                    ROW_NUMBER() OVER (
                        PARTITION BY pdo_well_id
                        ORDER BY COALESCE(TRY_CAST(Week_Number AS DATE), TRY_CONVERT(DATE, Week_Number, 5)) DESC
                    ) AS rn
                FROM dbo.WMR w WITH (NOLOCK)
                WHERE w.pdo_well_id IS NOT NULL
                  AND (w.well_year_white_space = CAST(@Year AS NVARCHAR)
                       OR YEAR(TRY_CAST(w.[latest_exp.rig_on_location_sap_data] AS DATE)) = @Year)
                  AND w.well_type NOT LIKE '%Buffer%'
                  {extraWhere}
            ),
            flaf_base AS (
                SELECT
                    w.pdo_well_id,
                    TRY_CAST(w.[latest_exp.rig_on_location_sap_data] AS DATE) AS kpi_dl,
                    TRY_CAST(w.flaf_issue_date AS DATE) AS flaf_date,
                    TRY_CAST(w.actual_pegged_date AS DATE) AS pegged_date,
                    TRY_CAST(w.date_of_site_survey_report_issuance AS DATE) AS survey_date,
                    w.scr_no,
                    w.moc_raised,
                    w.moc_approved,
                    w.ssfd_wells,
                    w.ipm
                FROM latest_wmr w
                WHERE w.rn = 1
                  {postDedupWhere}
            ),
            flags AS (
                SELECT *,
                    -- FLAF submitted: flaf_issue_date is populated
                    CASE WHEN flaf_date IS NOT NULL THEN 1 ELSE 0 END AS is_submitted,
                    -- FLAF approved: FLAF submitted AND subsequently pegged/surveyed (downstream step completed)
                    CASE WHEN flaf_date IS NOT NULL
                              AND (pegged_date IS NOT NULL OR survey_date IS NOT NULL)
                         THEN 1 ELSE 0 END AS is_approved,
                    -- Cycle time: days from FLAF submission to next milestone (pegging/survey)
                    CASE WHEN flaf_date IS NOT NULL
                              AND COALESCE(pegged_date, survey_date) IS NOT NULL
                         THEN DATEDIFF(DAY, flaf_date, COALESCE(pegged_date, survey_date))
                         ELSE NULL END AS cycle_days,
                    -- Is in the next 4 month window
                    CASE WHEN kpi_dl BETWEEN @Today AND @FourMonths
                         THEN 1 ELSE 0 END AS is_4m_critical,
                    -- Backlog: FLAF not yet submitted but expected date has passed
                    CASE WHEN kpi_dl < @Today AND flaf_date IS NULL
                         THEN 1 ELSE 0 END AS is_backlog,
                    -- Backlog responsibility
                    CASE WHEN kpi_dl < @Today AND flaf_date IS NULL
                         THEN
                             CASE WHEN scr_no IS NOT NULL AND LTRIM(RTRIM(scr_no)) != ''
                                  THEN 'PDO'
                                  WHEN moc_raised IS NOT NULL AND LTRIM(RTRIM(moc_raised)) != ''
                                       AND (moc_approved IS NULL OR LTRIM(RTRIM(moc_approved)) = '')
                                  THEN 'PDO'
                                  WHEN (ssfd_wells IS NOT NULL AND LTRIM(RTRIM(ssfd_wells)) != '')
                                    OR (ipm IS NOT NULL AND LTRIM(RTRIM(ipm)) != '')
                                  THEN 'PDO'
                                  ELSE 'ATNM'
                             END
                         ELSE NULL
                    END AS responsibility
                FROM flaf_base
            )
            SELECT
                COUNT(*)                          AS plan_flaf_submissions,
                SUM(is_submitted)                 AS actual_submitted,
                CAST(ROUND(
                    SUM(is_approved) * 100.0
                    / NULLIF(SUM(is_submitted), 0), 1)
                    AS DECIMAL(5,1))              AS approval_rate_pct,
                CAST(ISNULL(AVG(CAST(cycle_days AS DECIMAL(10,1))), 0)
                    AS DECIMAL(5,1))              AS avg_cycle_time_days,
                SUM(is_backlog)                   AS flaf_backlog,
                SUM(CASE WHEN responsibility = 'ATNM'
                         THEN 1 ELSE 0 END)       AS atnm_backlog,
                SUM(CASE WHEN responsibility = 'PDO'
                         THEN 1 ELSE 0 END)       AS pdo_backlog,
                SUM(is_4m_critical)               AS plan_4m,
                SUM(CASE WHEN is_4m_critical = 1 AND is_submitted = 1
                         THEN 1 ELSE 0 END)       AS actual_4m
            FROM flags;

            -- ═══════════════════════════════════════════════════════════════
            -- Result Set 2: Monthly Cumulative Chart (Stacked Area)
            -- ═══════════════════════════════════════════════════════════════
            ;WITH latest_wmr2 AS (
                SELECT *,
                    ROW_NUMBER() OVER (
                        PARTITION BY pdo_well_id
                        ORDER BY COALESCE(TRY_CAST(Week_Number AS DATE), TRY_CONVERT(DATE, Week_Number, 5)) DESC
                    ) AS rn
                FROM dbo.WMR w WITH (NOLOCK)
                WHERE w.pdo_well_id IS NOT NULL
                  AND (w.well_year_white_space = CAST(@Year AS NVARCHAR)
                       OR YEAR(TRY_CAST(w.[latest_exp.rig_on_location_sap_data] AS DATE)) = @Year)
                  AND w.well_type NOT LIKE '%Buffer%'
                  {extraWhere}
            ),
            months AS (
                SELECT n AS m
                FROM (VALUES(1),(2),(3),(4),(5),(6),(7),(8),(9),(10),(11),(12)) v(n)
                WHERE n <= @CurrentMonth + 4
            ),
            plan_by_month AS (
                SELECT
                    CASE
                        WHEN YEAR(TRY_CAST(w.[latest_exp.rig_on_location_sap_data] AS DATE)) = @Year
                         AND MONTH(TRY_CAST(w.[latest_exp.rig_on_location_sap_data] AS DATE)) <= @CurrentMonth + 4
                        THEN MONTH(TRY_CAST(w.[latest_exp.rig_on_location_sap_data] AS DATE))
                        ELSE @CurrentMonth
                    END AS mth,
                    COUNT(DISTINCT w.pdo_well_id) AS plan_count
                FROM latest_wmr2 w
                WHERE w.rn = 1
                  {postDedupWhere}
                GROUP BY
                    CASE
                        WHEN YEAR(TRY_CAST(w.[latest_exp.rig_on_location_sap_data] AS DATE)) = @Year
                         AND MONTH(TRY_CAST(w.[latest_exp.rig_on_location_sap_data] AS DATE)) <= @CurrentMonth + 4
                        THEN MONTH(TRY_CAST(w.[latest_exp.rig_on_location_sap_data] AS DATE))
                        ELSE @CurrentMonth
                    END
            ),
            actual_by_month AS (
                SELECT
                    CASE
                        WHEN YEAR(TRY_CAST(w.flaf_issue_date AS DATE)) = @Year
                         AND MONTH(TRY_CAST(w.flaf_issue_date AS DATE)) <= @CurrentMonth + 4
                        THEN MONTH(TRY_CAST(w.flaf_issue_date AS DATE))
                        WHEN YEAR(TRY_CAST(w.[latest_exp.rig_on_location_sap_data] AS DATE)) = @Year
                         AND MONTH(TRY_CAST(w.[latest_exp.rig_on_location_sap_data] AS DATE)) <= @CurrentMonth + 4
                        THEN MONTH(TRY_CAST(w.[latest_exp.rig_on_location_sap_data] AS DATE))
                        ELSE @CurrentMonth
                    END AS mth,
                    COUNT(DISTINCT w.pdo_well_id) AS actual_count
                FROM latest_wmr2 w
                WHERE w.rn = 1
                  {postDedupWhere}
                  AND w.flaf_issue_date IS NOT NULL
                  AND LTRIM(RTRIM(w.flaf_issue_date)) != ''
                GROUP BY
                    CASE
                        WHEN YEAR(TRY_CAST(w.flaf_issue_date AS DATE)) = @Year
                         AND MONTH(TRY_CAST(w.flaf_issue_date AS DATE)) <= @CurrentMonth + 4
                        THEN MONTH(TRY_CAST(w.flaf_issue_date AS DATE))
                        WHEN YEAR(TRY_CAST(w.[latest_exp.rig_on_location_sap_data] AS DATE)) = @Year
                         AND MONTH(TRY_CAST(w.[latest_exp.rig_on_location_sap_data] AS DATE)) <= @CurrentMonth + 4
                        THEN MONTH(TRY_CAST(w.[latest_exp.rig_on_location_sap_data] AS DATE))
                        ELSE @CurrentMonth
                    END
            )
            SELECT
                CHOOSE(m.m,'Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec') AS MonthLabel,
                m.m AS MonthNum,
                CASE WHEN m.m <= @CurrentMonth THEN 0 ELSE 1 END AS IsForecast,
                SUM(ISNULL(p.plan_count, 0))
                    OVER (ORDER BY m.m ROWS UNBOUNDED PRECEDING) AS PlanCumulative,
                SUM(ISNULL(a.actual_count, 0))
                    OVER (ORDER BY m.m ROWS UNBOUNDED PRECEDING) AS ActualCumulative,
                SUM(ISNULL(p.plan_count, 0))
                    OVER (ORDER BY m.m ROWS UNBOUNDED PRECEDING)
                - SUM(ISNULL(a.actual_count, 0))
                    OVER (ORDER BY m.m ROWS UNBOUNDED PRECEDING) AS GapCumulative
            FROM months m
            LEFT JOIN plan_by_month   p ON m.m = p.mth
            LEFT JOIN actual_by_month a ON m.m = a.mth
            ORDER BY m.m;
            """;

        var connStr = db.Database.GetConnectionString()!;
        await using var conn = new SqlConnection(connStr);
        await OpenWithRetryAsync(conn, ct);

        await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 120 };
        cmd.Parameters.AddWithValue("@yearParam", year);
        cmd.Parameters.AddWithValue("@currentMonthParam", currentMonth);
        if (!string.IsNullOrEmpty(cluster))       cmd.Parameters.AddWithValue("@cluster",  cluster.Trim());
        if (!string.IsNullOrWhiteSpace(site))     cmd.Parameters.AddWithValue("@site",     site.Trim());
        if (!string.IsNullOrWhiteSpace(project))  cmd.Parameters.AddWithValue("@project",  project.Trim());
        if (!string.IsNullOrWhiteSpace(wellType)) cmd.Parameters.AddWithValue("@wellType", wellType.Trim());
        if (!string.IsNullOrEmpty(wellId)) cmd.Parameters.AddWithValue("@wellId", wellId);

        await using var rdr = await cmd.ExecuteReaderAsync(ct);

        // Result Set 1: KPI + Backlog + Risk
        await rdr.ReadAsync(ct);
        var planSubmissions      = rdr.IsDBNull(0) ? 0 : rdr.GetInt32(0);
        var actualSubmitted      = rdr.IsDBNull(1) ? 0 : rdr.GetInt32(1);
        var approvalRatePct      = rdr.IsDBNull(2) ? 0.0 : (double)rdr.GetDecimal(2);
        var avgCycleTime         = rdr.IsDBNull(3) ? 0.0 : (double)rdr.GetDecimal(3);
        var flafBacklog          = rdr.IsDBNull(4) ? 0 : rdr.GetInt32(4);
        var atnmBacklog          = rdr.IsDBNull(5) ? 0 : rdr.GetInt32(5);
        var pdoBacklog           = rdr.IsDBNull(6) ? 0 : rdr.GetInt32(6);
        var plan4m               = rdr.IsDBNull(7) ? 0 : rdr.GetInt32(7);
        var actual4m             = rdr.IsDBNull(8) ? 0 : rdr.GetInt32(8);

        var totalBacklog = atnmBacklog + pdoBacklog;
        var projectedGap = Math.Abs(plan4m - actual4m);
        var gaugeMax = 100;
        var riskLevel = projectedGap <= 33 ? "On Track" : projectedGap <= 66 ? "Watch" : "High Risk";

        var kpi = new FlafStatusKpiDto(planSubmissions, actualSubmitted, approvalRatePct, avgCycleTime, flafBacklog);
        var backlog = new FlafBacklogDto(
            totalBacklog,
            atnmBacklog,
            totalBacklog > 0 ? Math.Round(atnmBacklog * 100.0 / totalBacklog, 1) : 0,
            pdoBacklog,
            totalBacklog > 0 ? Math.Round(pdoBacklog * 100.0 / totalBacklog, 1) : 0);
        var risk = new FlafRiskDto(projectedGap, riskLevel, gaugeMax);

        // Result Set 2: Monthly Trend
        await rdr.NextResultAsync(ct);
        var months = new List<FlafMonthDto>();
        while (await rdr.ReadAsync(ct))
        {
            months.Add(new FlafMonthDto(
                MonthLabel:       rdr.GetString(0),
                MonthNum:         rdr.GetInt32(1),
                IsForecast:       rdr.GetInt32(2) == 1,
                PlanCumulative:   rdr.IsDBNull(3) ? 0 : rdr.GetInt32(3),
                ActualCumulative: rdr.IsDBNull(4) ? 0 : rdr.GetInt32(4),
                GapCumulative:    rdr.IsDBNull(5) ? 0 : rdr.GetInt32(5)
            ));
        }

        var result = new FlafStatusResponse(
            AsOfDate: asOf.ToString("yyyy-MM-dd"),
            PlanYear: year,
            Kpi: kpi,
            Backlog: backlog,
            Risk: risk,
            MonthlyTrend: months
        );

        cache.Set(cacheKey, result, CacheDuration);
        return result;
    }

    // ─── Well Status List ─────────────────────────────────────────────────────────
    public async Task<IReadOnlyList<WellStatusListDto>> GetWellStatusListAsync(
        string? cluster,
        string? site,
        string? wellType,
        string? project,
        DateOnly? from,
        DateOnly? to,
        string? commStatus = null,
        DateOnly? commFrom = null,
        DateOnly? commTo = null,
        bool bufferReady = false,
        string? peggingBucket = null,
        bool wlaMode = false,
        CancellationToken ct = default)
    {
        var cacheKey = $"well-status-list:{cluster}:{site}:{wellType}:{project}:{from}:{to}:{commStatus}:{commFrom}:{commTo}:{bufferReady}:{peggingBucket}:{wlaMode}";
        if (cache.TryGetValue(cacheKey, out IReadOnlyList<WellStatusListDto>? cached) && cached is not null)
            return cached;

        // When commStatus filter is provided, query WMRO directly for commissioned/not-commissioned wells
        if (!string.IsNullOrWhiteSpace(commStatus))
        {
            var commResults = await GetWellStatusListFromWmroAsync(cluster, wellType, commStatus, commFrom, commTo, ct);
            cache.Set(cacheKey, commResults, CacheDuration);
            return commResults;
        }

        // When bufferReady is requested, query wells with completed flowline construction
        if (bufferReady)
        {
            var bufferResults = await GetBufferFlowlinesReadyWellListAsync(cluster, wellType, project, ct);
            cache.Set(cacheKey, bufferResults, CacheDuration);
            return bufferResults;
        }

        // WLA (Workload Analysis) drill-down: uses the same SAP-based logic as the
        // workload-analysis endpoint (SAP.EarliestEndDate in range + MAX(progress) >= 1)
        // so the drill-down count matches the chart bars exactly.
        if (wlaMode)
        {
            var wlaResults = await GetWellStatusListWlaModeAsync(cluster, wellType, project, from, to, ct);
            cache.Set(cacheKey, wlaResults, CacheDuration);
            return wlaResults;
        }

        // Overall Pegging Status drill-down (from the dashboard donut). The pie classifies
        // every well with a completed pegging by the gap between pegging and rig-on, using the
        // latest WMR snapshot regardless of date — so when this filter is set we widen the
        // snapshot window to "all time" and drop the progress>0 constraint so the resulting
        // list matches the pie's population exactly.
        var isPeggingDrill = peggingBucket is "within90" or "after90";

        var today = DateOnly.FromDateTime(DateTime.Today);
        var defaultLookback = -90;
        var startDate = (isPeggingDrill ? new DateOnly(2000, 1, 1) : (from ?? today.AddDays(defaultLookback))).ToDateTime(TimeOnly.MinValue);
        var endDate = (isPeggingDrill ? today : (to ?? today)).ToDateTime(TimeOnly.MinValue);

        var pidConditions = new System.Text.StringBuilder();
        if (!string.IsNullOrWhiteSpace(cluster))  pidConditions.Append(" AND UPPER(LTRIM(RTRIM(CAST([Cluster] AS NVARCHAR(200))))) = UPPER(@cluster)");
        if (!string.IsNullOrWhiteSpace(site))     pidConditions.Append(" AND LTRIM(RTRIM(CAST([Site] AS NVARCHAR(200)))) = @site");
        if (!string.IsNullOrWhiteSpace(wellType)) pidConditions.Append(" AND LTRIM(RTRIM(CAST([Type] AS NVARCHAR(200)))) = @wellType");
        if (!string.IsNullOrWhiteSpace(project))  pidConditions.Append(" AND LTRIM(RTRIM(CAST([Project] AS NVARCHAR(200)))) = @project");
        var pidFilter = pidConditions.Length > 0
            ? $" AND w.project_id IN (SELECT CAST(ID AS NVARCHAR(100)) FROM [dbo].[ProjectIDs] WITH (NOLOCK) WHERE 1=1{pidConditions})"
            : "";
        // Also apply filter inside LatestPerWell CTE so the latest-per-well row is selected
        // within the correct project/cluster scope — matches GetActiveWellsAsync approach
        // and prevents count mismatches when project filter is active.
        var innerPidFilter = pidConditions.Length > 0
            ? $" AND project_id IN (SELECT CAST(ID AS NVARCHAR(100)) FROM [dbo].[ProjectIDs] WITH (NOLOCK) WHERE 1=1{pidConditions})"
            : "";

        // Pegging-bucket filter: restrict to the exact set of wells the dashboard pie
        // assigns to this bucket. Membership is computed with the SAME latest-snapshot
        // logic as GetOverallPeggingStatusAsync (latest WMR row per well, both dates
        // present, pegged→rig-on gap ≤90 or >90) so the list count matches the pie.
        var peggingFilter = "";
        if (isPeggingDrill)
        {
            var op = peggingBucket == "within90" ? "<=" : ">";
            peggingFilter = $"""
                  AND cs.pdo_well_id IN (
                      SELECT pdo_well_id FROM (
                          SELECT pdo_well_id,
                                 TRY_CAST(actual_pegged_date AS DATE) AS pd,
                                 TRY_CAST(actual_rig_on_date AS DATE) AS rd,
                                 ROW_NUMBER() OVER (
                                     PARTITION BY pdo_well_id
                                     ORDER BY COALESCE(TRY_CAST(Week_Number AS DATE), TRY_CONVERT(DATE, Week_Number, 5)) DESC
                                 ) AS rn
                          FROM [dbo].[WMR] WITH (NOLOCK)
                          WHERE pdo_well_id IS NOT NULL
                      ) pk
                      WHERE pk.rn = 1 AND pk.pd IS NOT NULL AND pk.rd IS NOT NULL
                        AND DATEDIFF(DAY, pk.pd, pk.rd) {op} 90
                  )
                """;
        }

        // The pie counts planned wells too (progress can be 0), so don't gate on progress
        // when drilling in from it.
        var progressFilter = isPeggingDrill ? "1 = 1" : "cs.progress > 0";

        // Always use the same two-pass Week_Number parse as GetActiveWellsKpiAsync:
        // format 23 = YYYY-MM-DD; '20'+col handles the 2-digit-year YY-MM-DD variant.
        // Pegging drill-down additionally falls back to TRY_CONVERT format 5 (DD-MM-YY).
        string Wk(string col) => isPeggingDrill
            ? $"COALESCE(TRY_CONVERT(DATE, {col}, 23), TRY_CONVERT(DATE, '20' + {col}, 23), TRY_CONVERT(DATE, {col}, 5))"
            : $"COALESCE(TRY_CONVERT(DATE, {col}, 23), TRY_CONVERT(DATE, '20' + {col}, 23))";

        var sql = $"""
            ;WITH LatestPerWell AS (
                SELECT
                    pdo_well_id,
                    project_id,
                    over_all_progress_percentages,
                    Week_Number,
                    TRY_CAST([flaf_issue_date] AS DATE)  AS flaf_date,
                    TRY_CAST([scr_date] AS DATE)         AS scr_date,
                    TRY_CAST(actual_rig_off_date AS DATE) AS rig_off_date,
                    TRY_CAST([wellpad_handover-2_from_hoist_fbu_rsr_off_date] AS DATE) AS handover_date,
                    TRY_CAST([actual_comm._finish_date_with_in_2_days_from_actual_engg._completion_date] AS DATE) AS actual_comm_date,
                    ROW_NUMBER() OVER (
                        PARTITION BY pdo_well_id
                        ORDER BY {Wk("Week_Number")} DESC, project_id DESC
                    ) AS rn
                FROM [dbo].[WMR] WITH (NOLOCK)
                WHERE pdo_well_id IS NOT NULL
                  AND pdo_well_id <> ''
                  AND {Wk("Week_Number")} IS NOT NULL
                  AND {Wk("Week_Number")} BETWEEN @startDate AND @endDate
            ),
            CurrentState AS (
                SELECT
                    pdo_well_id,
                    COALESCE(TRY_CAST(over_all_progress_percentages AS FLOAT), 0) AS progress,
                    {Wk("Week_Number")} AS latest_week_date,
                    flaf_date, scr_date, rig_off_date, handover_date, actual_comm_date
                FROM LatestPerWell
                WHERE rn = 1
                  {innerPidFilter}
            ),
            -- Mirrors kpi-tiles DueDateCalc exactly: one row per well, same date sources
            DueDateCalcList AS (
                SELECT
                    pdo_well_id,
                    progress,
                    actual_comm_date,
                    COALESCE(actual_comm_date, CAST(@endDate AS DATE)) AS eff_comm_date,
                    (SELECT MAX(d) FROM (VALUES
                        (DATEADD(DAY, 90, flaf_date)),
                        (DATEADD(DAY, 90, scr_date)),
                        (DATEADD(DAY,  5, rig_off_date)),
                        (DATEADD(DAY,  2, handover_date))
                    ) AS v(d)) AS due_date
                FROM CurrentState
            ),
            LatestTaskPlan AS (
                SELECT
                    t.[New_Well_ID] AS pdo_well_id,
                    t.[Resume_Suspend] AS latest_action,
                    ROW_NUMBER() OVER (
                        PARTITION BY t.[New_Well_ID]
                        ORDER BY TRY_CAST(t.actual_start AS DATE) DESC
                    ) AS rn
                FROM [dbo].[WMR_TaskPlan_csv_imported] t WITH (NOLOCK)
                INNER JOIN CurrentState cs ON cs.pdo_well_id = t.[New_Well_ID]
                WHERE t.[Resume_Suspend] IN ('Suspend', 'Resume')
                  AND TRY_CAST(t.actual_start AS DATE) IS NOT NULL
            ),
            SuspendedWells AS (
                SELECT pdo_well_id FROM LatestTaskPlan WHERE rn = 1 AND latest_action = 'Suspend'
            ),
            -- Matches kpi-tiles: any well with ANY Suspend record (regardless of later Resume)
            SuspendedKpi AS (
                SELECT DISTINCT CAST([New_Well_ID] AS NVARCHAR(200)) AS pdo_well_id
                FROM [dbo].[WMR_TaskPlan_csv_imported] WITH (NOLOCK)
                WHERE CAST([Resume_Suspend] AS NVARCHAR(50)) = 'Suspend'
                  AND CAST([New_Well_ID] AS NVARCHAR(200)) IN (SELECT pdo_well_id FROM CurrentState)
            ),
            SapPlan AS (
                SELECT
                    Well_ID,
                    MIN(TRY_CAST(Earl_start_date AS DATE)) AS plan_start,
                    MAX(TRY_CAST(EarliestEndDate AS DATE)) AS plan_end
                FROM [dbo].[SAP_DRILLING_SEQUENCE_History] WITH (NOLOCK)
                WHERE Well_ID IS NOT NULL AND Well_ID <> ''
                GROUP BY Well_ID
            ),
            -- Rig-on / rig-off / pegged are fixed events that may be blank on the latest
            -- weekly snapshot but present on earlier ones. Take the value across ALL
            -- snapshots (matches the well-detail page, which keeps the last non-empty value).
            RigInfo AS (
                SELECT
                    pdo_well_id,
                    MAX(TRY_CAST(actual_rig_on_date  AS DATE)) AS rig_on,
                    MAX(TRY_CAST(actual_rig_off_date AS DATE)) AS rig_off,
                    MAX(TRY_CAST(actual_pegged_date  AS DATE)) AS pegged
                FROM [dbo].[WMR] WITH (NOLOCK)
                WHERE pdo_well_id IS NOT NULL AND pdo_well_id <> ''
                GROUP BY pdo_well_id
            ),
            -- Bottom-up completion: A well is completed ONLY when ALL its activities
            -- (type='A') in TaskPlanCSVImport have actual_end IS NOT NULL OR progress=1.0
            -- Activity completed → Workgroup completed → Well completed
            WellCompletion AS (
                SELECT
                    CAST(Well_ID AS NVARCHAR(50)) AS pdo_well_id,
                    COUNT(DISTINCT CAST(code AS NVARCHAR(100))) AS total_activities,
                    COUNT(DISTINCT CASE
                        WHEN actual_end IS NOT NULL
                             OR TRY_CONVERT(DECIMAL(10,4), progress) >= 1.0
                        THEN CAST(code AS NVARCHAR(100))
                    END) AS completed_activities,
                    MAX(TRY_CAST(actual_end AS DATE)) AS well_end_date
                FROM [dbo].[TaskPlanCSVImport] WITH (NOLOCK)
                WHERE CAST(type AS NVARCHAR(10)) = 'A'
                  AND Well_ID IS NOT NULL AND Well_ID <> ''
                GROUP BY CAST(Well_ID AS NVARCHAR(50))
            ),
            ActivityRates AS (
                SELECT
                    CAST(act.Well_ID AS NVARCHAR(50)) AS pdo_well_id,
                    AVG(TRY_CONVERT(DECIMAL(18,4), act.qty)
                        / NULLIF(TRY_CONVERT(DECIMAL(18,4), act.manhours) / 8.0, 0))
                        AS avg_norms_rate,
                    AVG(TRY_CONVERT(DECIMAL(18,4), act.qtyactual)
                        / NULLIF(CAST(DATEDIFF(DAY, TRY_CONVERT(DATE, act.actual_start), CAST(GETDATE() AS DATE)) AS DECIMAL(18,4)), 0))
                        AS avg_current_rate,
                    AVG(CASE WHEN act.actual_end IS NULL
                             AND DATEDIFF(DAY, CAST(GETDATE() AS DATE),
                                 DATEADD(DAY, CEILING(TRY_CONVERT(DECIMAL(18,4), act.manhours) / 8.0),
                                     TRY_CONVERT(DATE, act.actual_start))) > 0
                        THEN (TRY_CONVERT(DECIMAL(18,4), act.qty) - ISNULL(TRY_CONVERT(DECIMAL(18,4), act.qtyactual), 0))
                             / CAST(DATEDIFF(DAY, CAST(GETDATE() AS DATE),
                                 DATEADD(DAY, CEILING(TRY_CONVERT(DECIMAL(18,4), act.manhours) / 8.0),
                                     TRY_CONVERT(DATE, act.actual_start))) AS DECIMAL(18,4))
                        ELSE NULL END) AS avg_asking_rate
                FROM [dbo].[TaskPlanCSVImport] act WITH (NOLOCK)
                WHERE CAST(act.type AS NVARCHAR(10)) = 'A'
                  AND act.actual_start IS NOT NULL
                  AND DATEDIFF(DAY, TRY_CONVERT(DATE, act.actual_start), CAST(GETDATE() AS DATE)) > 0
                  AND act.Well_ID IS NOT NULL AND act.Well_ID <> ''
                GROUP BY CAST(act.Well_ID AS NVARCHAR(50))
            )
            SELECT
                cs.pdo_well_id                          AS WellId,
                w.well_location                         AS WellName,
                CASE
                    -- 0a. Completed via WMR progress (aligns with kpi-tiles: progress >= 1.0)
                    WHEN cs.progress >= 1.0
                        THEN 'Completed'
                    -- 0b. Not Started: no activities in TaskPlanCSVImport OR progress is 0
                    WHEN wc.total_activities IS NULL OR wc.total_activities = 0
                        THEN 'Not Started'
                    WHEN cs.progress <= 0
                        THEN 'Not Started'
                    -- 1. Completed: ALL activities in ALL workgroups are done
                    --    (every activity has actual_end or progress=1.0)
                    --    Sub-classified by Well End Date vs Rig On Date
                    WHEN wc.total_activities > 0
                         AND wc.completed_activities = wc.total_activities
                         AND ri.rig_on IS NOT NULL
                         AND wc.well_end_date > ri.rig_on
                        THEN 'Completed (Late)'
                    WHEN wc.total_activities > 0
                         AND wc.completed_activities = wc.total_activities
                         AND ri.rig_on IS NOT NULL
                         AND wc.well_end_date = ri.rig_on
                        THEN 'Completed (On Time)'
                    WHEN wc.total_activities > 0
                         AND wc.completed_activities = wc.total_activities
                         AND ri.rig_on IS NOT NULL
                         AND wc.well_end_date < ri.rig_on
                        THEN 'Completed (Early)'
                    WHEN wc.total_activities > 0
                         AND wc.completed_activities = wc.total_activities
                        THEN 'Completed'
                    -- 2. Due: Rig On Date passed AND well is not ready
                    WHEN ri.rig_on IS NOT NULL
                         AND ri.rig_on < CAST(GETDATE() AS DATE)
                        THEN 'Due'
                    -- 3. Delayed (At Risk): forecast end > Rig On Date (beyond 3 days)
                    WHEN ri.rig_on IS NOT NULL
                         AND sap.plan_end IS NOT NULL
                         AND DATEDIFF(DAY, ri.rig_on, sap.plan_end) > 3
                        THEN 'Delayed (At Risk)'
                    -- 4. On Time: |forecast end - Rig On Date| <= 3 days
                    WHEN ri.rig_on IS NOT NULL
                         AND sap.plan_end IS NOT NULL
                         AND ABS(DATEDIFF(DAY, sap.plan_end, ri.rig_on)) <= 3
                        THEN 'On Time'
                    -- 5. Accelerated: actual end date < Rig On Date
                    WHEN ri.rig_on IS NOT NULL
                         AND wc.well_end_date IS NOT NULL
                         AND wc.well_end_date < ri.rig_on
                        THEN 'Accelerated'
                    -- 6. No rig-on date: default
                    WHEN ri.rig_on IS NULL
                        THEN 'On Time'
                END                                     AS Status,
                p.[Cluster] AS Field,
                w.rig_no                                AS Rig,
                -- Progress: WMR progress >= 1.0 takes priority (matches kpi-tiles);
                -- otherwise activity completion ratio; 0 if no data
                CASE
                    WHEN cs.progress >= 1.0
                        THEN 1.0
                    WHEN wc.total_activities > 0
                        THEN CAST(wc.completed_activities AS FLOAT) / wc.total_activities
                    ELSE 0
                END                                     AS Progress,
                CASE
                    WHEN sap.plan_start IS NOT NULL AND sap.plan_end IS NOT NULL
                         AND DATEDIFF(day, sap.plan_start, sap.plan_end) > 0
                    THEN CASE
                           WHEN CAST(DATEDIFF(day, sap.plan_start, @endDate) AS FLOAT)
                                / DATEDIFF(day, sap.plan_start, sap.plan_end) < 0 THEN 0.0
                           WHEN CAST(DATEDIFF(day, sap.plan_start, @endDate) AS FLOAT)
                                / DATEDIFF(day, sap.plan_start, sap.plan_end) > 1 THEN 1.0
                           ELSE CAST(DATEDIFF(day, sap.plan_start, @endDate) AS FLOAT)
                                / DATEDIFF(day, sap.plan_start, sap.plan_end)
                         END
                    ELSE NULL
                END                                     AS PlannedPct,
                -- Variance = avg(current_rate) - avg(asking_rate) from activities
                CASE
                    WHEN ar.avg_current_rate IS NOT NULL AND ar.avg_asking_rate IS NOT NULL
                    THEN ar.avg_current_rate - ar.avg_asking_rate
                    ELSE NULL
                END                                     AS Variance,
                -- Rate/Day = avg current rate from activities
                ar.avg_current_rate                     AS RatePerDay,
                -- Ask Rate = avg asking rate from activities
                COALESCE(ar.avg_asking_rate, 0)         AS AskRate,
                -- Gap/Day = current_rate - asking_rate
                CASE
                    WHEN ar.avg_current_rate IS NOT NULL AND ar.avg_asking_rate IS NOT NULL
                    THEN ar.avg_current_rate - ar.avg_asking_rate
                    ELSE NULL
                END                                     AS GapPerDay,
                CASE
                    WHEN sap.plan_start IS NOT NULL AND sap.plan_end IS NOT NULL
                         AND DATEDIFF(day, sap.plan_start, sap.plan_end) > 0
                         AND CAST(DATEDIFF(day, sap.plan_start, @endDate) AS FLOAT)
                             / DATEDIFF(day, sap.plan_start, sap.plan_end) > 0
                    THEN ROUND(CASE
                           WHEN cs.progress / (CAST(DATEDIFF(day, sap.plan_start, @endDate) AS FLOAT)
                                / DATEDIFF(day, sap.plan_start, sap.plan_end)) < 0.40 THEN 0.40
                           WHEN cs.progress / (CAST(DATEDIFF(day, sap.plan_start, @endDate) AS FLOAT)
                                / DATEDIFF(day, sap.plan_start, sap.plan_end)) > 1.20 THEN 1.20
                           ELSE cs.progress / (CAST(DATEDIFF(day, sap.plan_start, @endDate) AS FLOAT)
                                / DATEDIFF(day, sap.plan_start, sap.plan_end))
                         END, 2)
                    ELSE NULL
                END                                     AS Spi,
                CASE
                    WHEN sap.plan_start IS NOT NULL AND sap.plan_end IS NOT NULL
                         AND DATEDIFF(day, sap.plan_start, sap.plan_end) > 0
                         AND CAST(DATEDIFF(day, sap.plan_start, @endDate) AS FLOAT)
                             / DATEDIFF(day, sap.plan_start, sap.plan_end) > 0
                    THEN ROUND(CASE
                           WHEN 0.85 + ((cs.progress / (CAST(DATEDIFF(day, sap.plan_start, @endDate) AS FLOAT)
                                / DATEDIFF(day, sap.plan_start, sap.plan_end))) - 0.85) * 0.6 < 0.65 THEN 0.65
                           WHEN 0.85 + ((cs.progress / (CAST(DATEDIFF(day, sap.plan_start, @endDate) AS FLOAT)
                                / DATEDIFF(day, sap.plan_start, sap.plan_end))) - 0.85) * 0.6 > 1.05 THEN 1.05
                           ELSE 0.85 + ((cs.progress / (CAST(DATEDIFF(day, sap.plan_start, @endDate) AS FLOAT)
                                / DATEDIFF(day, sap.plan_start, sap.plan_end))) - 0.85) * 0.6
                         END, 2)
                    ELSE NULL
                END                                     AS Cpi,
                w.well_type                             AS Tags,
                w.well_type                             AS WellType,
                w.[location_preparation_status_in_progress_completed] AS LocPrep,
                COALESCE(TRY_CAST(w.ohl_progress AS FLOAT), 0) AS DrillingPct,
                w.[flow_line_commi._status_in_progress_completed] AS CommStatus,
                w.[flow_line_const._status_in_progress_completed] AS ConstrStatus,
                COALESCE(TRY_CAST(w.[overall_const._10_100] AS FLOAT), 0) AS ConstrPct,
                COALESCE(TRY_CAST(w.[overall_comm_progress_100] AS FLOAT), 0) AS ComplePct,
                CONVERT(varchar(10), ri.rig_on,  23) AS RigBy,
                CONVERT(varchar(10), ri.rig_off, 23) AS RigTo,
                CONVERT(varchar(10), ri.pegged,  23) AS PeggedDate,
                -- KPI-matching flags: Active = WMR progress > 0 & < 1, not suspended (kpi-tiles: any-suspend logic)
                CASE WHEN cs.progress > 0 AND cs.progress < 1.0
                          AND sk.pdo_well_id IS NULL THEN 1 ELSE 0 END AS IsActiveKpi,
                -- Inactive = suspended AND not completed (matches kpi-tiles: sw IS NOT NULL AND progress < 1.0)
                CASE WHEN sk.pdo_well_id IS NOT NULL AND cs.progress < 1.0 THEN 1 ELSE 0 END AS IsInactiveKpi,
                -- Bonus Potential: mirrors kpi-tiles exactly using DueDateCalcList CTE
                CASE WHEN dd.due_date IS NOT NULL
                          AND dd.eff_comm_date < dd.due_date THEN 1 ELSE 0 END AS IsBonusPotential,
                -- Penalty Exposure: mirrors kpi-tiles exactly (actual_comm_date > due_date)
                CASE WHEN dd.due_date IS NOT NULL
                          AND dd.actual_comm_date > dd.due_date THEN 1 ELSE 0 END AS IsPenaltyExposure
            FROM CurrentState cs
            LEFT JOIN DueDateCalcList dd ON dd.pdo_well_id = cs.pdo_well_id
            LEFT JOIN SuspendedWells sw ON sw.pdo_well_id = cs.pdo_well_id
            LEFT JOIN SuspendedKpi sk ON sk.pdo_well_id = cs.pdo_well_id
            LEFT JOIN [dbo].[WMR] w WITH (NOLOCK)
                ON w.pdo_well_id = cs.pdo_well_id
                AND {Wk("w.Week_Number")} = cs.latest_week_date
            LEFT JOIN (
                SELECT ID, MIN([Cluster]) AS [Cluster]
                FROM [dbo].[ProjectIDs] WITH (NOLOCK)
                GROUP BY ID
            ) p ON w.project_id = p.ID
            LEFT JOIN SapPlan sap ON sap.Well_ID = cs.pdo_well_id
            LEFT JOIN RigInfo ri ON ri.pdo_well_id = cs.pdo_well_id
            LEFT JOIN WellCompletion wc ON wc.pdo_well_id = cs.pdo_well_id
            LEFT JOIN ActivityRates ar ON ar.pdo_well_id = cs.pdo_well_id
            WHERE {progressFilter}
              {peggingFilter}
            ORDER BY Status, cs.pdo_well_id;
            """;

        var conn = db.Database.GetDbConnection();
        await OpenWithRetryAsync(conn, ct);
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        cmd.CommandTimeout = 60;
        cmd.Parameters.Add(new SqlParameter("@startDate", System.Data.SqlDbType.Date) { Value = startDate.Date });
        cmd.Parameters.Add(new SqlParameter("@endDate", System.Data.SqlDbType.Date) { Value = endDate.Date });
        if (!string.IsNullOrWhiteSpace(cluster))
            cmd.Parameters.Add(new SqlParameter("@cluster", cluster));
        if (!string.IsNullOrWhiteSpace(site))
            cmd.Parameters.Add(new SqlParameter("@site", site));
        if (!string.IsNullOrWhiteSpace(wellType))
            cmd.Parameters.Add(new SqlParameter("@wellType", wellType));
        if (!string.IsNullOrWhiteSpace(project))
            cmd.Parameters.Add(new SqlParameter("@project", project));

        var results = new List<WellStatusListDto>();
        // Deduplicate by pdo_well_id — the WMR self-join can match multiple rows per well
        // when the same well appears under multiple project_ids with the same Week_Number date.
        // Keep the first occurrence (highest-priority ROW_NUMBER row chosen by the CTE).
        var seenWells = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        await using var rdr = await cmd.ExecuteReaderAsync(ct);
        while (await rdr.ReadAsync(ct))
        {
            var wid = rdr.IsDBNull(0) ? "" : rdr.GetValue(0).ToString()!;
            if (!seenWells.Add(wid)) continue;
            var progress    = rdr.IsDBNull(5) ? 0.0 : Convert.ToDouble(rdr.GetValue(5));
            var plannedRaw  = rdr.IsDBNull(6) ? (double?)null : Convert.ToDouble(rdr.GetValue(6));
            var varianceRaw = rdr.IsDBNull(7) ? (double?)null : Convert.ToDouble(rdr.GetValue(7));
            var ratePerDay  = rdr.IsDBNull(8) ? (double?)null : Convert.ToDouble(rdr.GetValue(8));
            var askRate     = rdr.IsDBNull(9) ? 0.0 : Convert.ToDouble(rdr.GetValue(9));
            var gapPerDay   = rdr.IsDBNull(10) ? (double?)null : Convert.ToDouble(rdr.GetValue(10));
            var spi         = rdr.IsDBNull(11) ? (double?)null : Convert.ToDouble(rdr.GetValue(11));
            var cpi         = rdr.IsDBNull(12) ? (double?)null : Convert.ToDouble(rdr.GetValue(12));

            results.Add(new WellStatusListDto(
                WellId:        rdr.IsDBNull(0) ? "" : rdr.GetValue(0).ToString()!,
                WellName:      rdr.IsDBNull(1) ? null : rdr.GetValue(1).ToString(),
                Status:        rdr.IsDBNull(2) ? "ACTIVE" : rdr.GetValue(2).ToString()!,
                Field:         rdr.IsDBNull(3) ? null : rdr.GetValue(3).ToString(),
                Rig:           rdr.IsDBNull(4) ? null : rdr.GetValue(4).ToString(),
                ProgressPct:   Math.Round(progress * 100.0, 1),
                PlannedPct:    plannedRaw.HasValue ? Math.Round(plannedRaw.Value * 100.0, 1) : null,
                Variance:      varianceRaw.HasValue ? Math.Round(varianceRaw.Value, 2) : null,
                RatePerDay:    ratePerDay.HasValue ? Math.Round(ratePerDay.Value, 2) : null,
                AskRate:       Math.Round(askRate, 2),
                GapPerDay:     gapPerDay.HasValue ? Math.Round(gapPerDay.Value, 2) : null,
                Spi:           spi.HasValue ? Math.Round(spi.Value, 2) : null,
                Cpi:           cpi.HasValue ? Math.Round(cpi.Value, 2) : null,
                Tags:          rdr.IsDBNull(13) ? null : rdr.GetValue(13).ToString(),
                WellType:      rdr.IsDBNull(14) ? null : rdr.GetValue(14).ToString(),
                LocPrepStatus: rdr.IsDBNull(15) ? null : rdr.GetValue(15).ToString(),
                DrillingPct:   rdr.IsDBNull(16) ? null : Convert.ToDouble(rdr.GetValue(16)),
                CommStatus:    rdr.IsDBNull(17) ? null : rdr.GetValue(17).ToString(),
                ConstrStatus:  rdr.IsDBNull(18) ? null : rdr.GetValue(18).ToString(),
                ConstrPct:     rdr.IsDBNull(19) ? null : Convert.ToDouble(rdr.GetValue(19)),
                ComplePct:     rdr.IsDBNull(20) ? null : Convert.ToDouble(rdr.GetValue(20)),
                RigBy:         rdr.IsDBNull(21) ? null : rdr.GetValue(21).ToString(),
                RigTo:         rdr.IsDBNull(22) ? null : rdr.GetValue(22).ToString(),
                PeggedDate:    rdr.IsDBNull(23) ? null : rdr.GetValue(23).ToString(),
                IsActiveKpi:      !rdr.IsDBNull(24) && Convert.ToInt32(rdr.GetValue(24)) == 1,
                IsInactiveKpi:    !rdr.IsDBNull(25) && Convert.ToInt32(rdr.GetValue(25)) == 1,
                IsBonusPotential: !rdr.IsDBNull(26) && Convert.ToInt32(rdr.GetValue(26)) == 1,
                IsPenaltyExposure:!rdr.IsDBNull(27) && Convert.ToInt32(rdr.GetValue(27)) == 1
            ));
        }

        // Note: WMR can have multiple rows for same well + week date.
        // We keep all rows to match the KPI active-wells counts which also include duplicates.

        cache.Set(cacheKey, (IReadOnlyList<WellStatusListDto>)results, CacheDuration);
        return results;
    }

    /// <summary>
    /// WLA-mode well list: uses the same SAP_DRILLING_SEQUENCE_History + WMR logic as
    /// GetWorkloadAnalysisAsync so that drill-down counts match the Workload Analysis chart bars.
    /// Wells are those with EarliestEndDate in [from, to], Development category, and
    /// MAX(progress) across all WMR rows. Status = COMPLETED when MAX(progress) >= 1.
    /// </summary>
    private async Task<IReadOnlyList<WellStatusListDto>> GetWellStatusListWlaModeAsync(
        string? cluster, string? wellType, string? project, DateOnly? from, DateOnly? to, CancellationToken ct)
    {
        var today = DateOnly.FromDateTime(DateTime.Today);
        var fromDt = (from ?? new DateOnly(today.Year, 1, 1)).ToDateTime(TimeOnly.MinValue);
        var toDt = (to ?? today).ToDateTime(TimeOnly.MinValue);
        var forecastCutoff = new DateTime(DateTime.UtcNow.Year, DateTime.UtcNow.Month, 1);

        var clusterFilter = "";
        if (!string.IsNullOrWhiteSpace(cluster))
            clusterFilter = "AND cl.ClusterName = UPPER(@cluster)";

        var projectFilter = "";
        if (!string.IsNullOrWhiteSpace(project))
            projectFilter = "AND LTRIM(RTRIM(pid.[Project])) = @project";

        var wellTypeFilter = "";
        if (!string.IsNullOrWhiteSpace(wellType))
            wellTypeFilter = "AND w_latest.well_type = @wellType";

        var sql = $"""
            SET NOCOUNT ON;
            ;WITH ClusterLookup AS (
                SELECT
                    ID AS ProjectId,
                    UPPER(LTRIM(RTRIM([Cluster]))) AS ClusterName
                FROM [dbo].[ProjectIDs] pid WITH (NOLOCK)
                WHERE [Cluster] IS NOT NULL AND LTRIM(RTRIM([Cluster])) <> ''
                  {projectFilter}
            ),
            SapWells AS (
                SELECT
                    sap.[Well_ID],
                    cl.ClusterName,
                    MIN(sap.[EarliestEndDate]) AS EarliestEndDate
                FROM [dbo].[SAP_DRILLING_SEQUENCE_History] sap WITH (NOLOCK)
                INNER JOIN [dbo].[WMR] w WITH (NOLOCK)
                    ON w.pdo_well_id = sap.[Well_ID]
                INNER JOIN ClusterLookup cl
                    ON cl.ProjectId = w.project_id
                WHERE sap.[Well_Category] = 'Development'
                  AND sap.[Well_Name] NOT LIKE 'RIG M%'
                  AND sap.[Well_Name] NOT LIKE 'RAMADAN%'
                  AND sap.[EarliestEndDate] >= @fromDate
                  AND sap.[EarliestEndDate] <= @toDate
                  AND cl.ClusterName IN ('NIMR', 'MARMUL')
                  {clusterFilter}
                GROUP BY sap.[Well_ID], cl.ClusterName
            ),
            WmrProgress AS (
                SELECT w.pdo_well_id,
                       MAX(COALESCE(TRY_CAST(w.over_all_progress_percentages AS FLOAT), 0)) AS Progress
                FROM [dbo].[WMR] w WITH (NOLOCK)
                INNER JOIN (SELECT DISTINCT [Well_ID] FROM SapWells) sw ON w.pdo_well_id = sw.[Well_ID]
                WHERE w.pdo_well_id IS NOT NULL AND w.pdo_well_id <> ''
                GROUP BY w.pdo_well_id
            ),
            WlaWells AS (
                SELECT sw.Well_ID, sw.ClusterName, sw.EarliestEndDate,
                       COALESCE(wp.Progress, 0) AS Progress
                FROM SapWells sw
                LEFT JOIN WmrProgress wp ON wp.pdo_well_id = sw.[Well_ID]
                WHERE (
                    -- Actual: completed before forecast cutoff
                    (sw.EarliestEndDate < @forecastCutoff AND COALESCE(wp.Progress, 0) >= 1)
                    OR
                    -- Forecast: planned but not yet completed
                    (sw.EarliestEndDate >= @forecastCutoff AND COALESCE(wp.Progress, 0) < 1)
                )
            ),
            WmrLatest AS (
                SELECT w.pdo_well_id, w.well_location, w.rig_no, w.well_type, w.project_id,
                       w.[flow_line_const._status_in_progress_completed],
                       w.[flow_line_commi._status_in_progress_completed],
                       w.[location_preparation_status_in_progress_completed],
                       COALESCE(TRY_CAST(w.[overall_const._10_100] AS FLOAT), 0) AS constr_pct,
                       COALESCE(TRY_CAST(w.[overall_comm_progress_100] AS FLOAT), 0) AS comm_pct,
                       COALESCE(TRY_CAST(w.ohl_progress AS FLOAT), 0) AS ohl_pct,
                       w.actual_rig_on_date, w.actual_rig_off_date,
                       ROW_NUMBER() OVER (PARTITION BY w.pdo_well_id ORDER BY TRY_CAST(w.Week_Number AS DATE) DESC) AS rn
                FROM [dbo].[WMR] w WITH (NOLOCK)
                WHERE w.pdo_well_id IN (SELECT Well_ID FROM WlaWells)
                  AND TRY_CAST(w.Week_Number AS DATE) IS NOT NULL
            )
            SELECT
                ww.Well_ID              AS WellId,
                wl.well_location        AS WellName,
                CASE
                    WHEN ww.Progress >= 1.0 THEN 'COMPLETED'
                    WHEN ww.Progress > 0    THEN 'ACTIVE'
                    ELSE 'PLANNED'
                END                     AS Status,
                ww.ClusterName          AS Field,
                wl.rig_no               AS Rig,
                ww.Progress             AS ProgressPct,
                wl.well_type            AS WellType,
                wl.[location_preparation_status_in_progress_completed] AS LocPrep,
                wl.ohl_pct              AS DrillingPct,
                wl.[flow_line_commi._status_in_progress_completed] AS CommStatus,
                wl.[flow_line_const._status_in_progress_completed] AS ConstrStatus,
                wl.constr_pct           AS ConstrPct,
                wl.comm_pct             AS ComplePct,
                wl.actual_rig_on_date   AS RigBy,
                wl.actual_rig_off_date  AS RigTo
            FROM WlaWells ww
            LEFT JOIN WmrLatest wl ON wl.pdo_well_id = ww.Well_ID AND wl.rn = 1
            WHERE 1=1
            {wellTypeFilter}
            ORDER BY ww.Progress DESC, ww.Well_ID;
            """;

        var connStr = db.Database.GetConnectionString()!;
        await using var conn = new SqlConnection(connStr);
        await OpenWithRetryAsync(conn, ct);

        await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 120 };
        cmd.Parameters.Add(new SqlParameter("@fromDate", System.Data.SqlDbType.DateTime) { Value = fromDt });
        cmd.Parameters.Add(new SqlParameter("@toDate", System.Data.SqlDbType.DateTime) { Value = toDt });
        cmd.Parameters.Add(new SqlParameter("@forecastCutoff", System.Data.SqlDbType.DateTime) { Value = forecastCutoff });
        if (!string.IsNullOrWhiteSpace(cluster))
            cmd.Parameters.Add(new SqlParameter("@cluster", cluster));
        if (!string.IsNullOrWhiteSpace(project))
            cmd.Parameters.Add(new SqlParameter("@project", project));
        if (!string.IsNullOrWhiteSpace(wellType))
            cmd.Parameters.Add(new SqlParameter("@wellType", wellType));

        var results = new List<WellStatusListDto>();
        await using var rdr = await cmd.ExecuteReaderAsync(ct);
        while (await rdr.ReadAsync(ct))
        {
            var progress = rdr.IsDBNull(5) ? 0.0 : Convert.ToDouble(rdr.GetValue(5));

            results.Add(new WellStatusListDto(
                WellId:        rdr.IsDBNull(0) ? "" : rdr.GetValue(0).ToString()!,
                WellName:      rdr.IsDBNull(1) ? null : rdr.GetValue(1).ToString(),
                Status:        rdr.IsDBNull(2) ? "PLANNED" : rdr.GetValue(2).ToString()!,
                Field:         rdr.IsDBNull(3) ? null : rdr.GetValue(3).ToString(),
                Rig:           rdr.IsDBNull(4) ? null : rdr.GetValue(4).ToString(),
                ProgressPct:   Math.Round(progress * 100.0, 1),
                PlannedPct:    null,
                Variance:      null,
                RatePerDay:    null,
                AskRate:       0,
                GapPerDay:     null,
                Spi:           null,
                Cpi:           null,
                Tags:          null,
                WellType:      rdr.IsDBNull(6) ? null : rdr.GetValue(6).ToString(),
                LocPrepStatus: rdr.IsDBNull(7) ? null : rdr.GetValue(7).ToString(),
                DrillingPct:   rdr.IsDBNull(8) ? null : Convert.ToDouble(rdr.GetValue(8)),
                CommStatus:    rdr.IsDBNull(9) ? null : rdr.GetValue(9).ToString(),
                ConstrStatus:  rdr.IsDBNull(10) ? null : rdr.GetValue(10).ToString(),
                ConstrPct:     rdr.IsDBNull(11) ? null : Convert.ToDouble(rdr.GetValue(11)),
                ComplePct:     rdr.IsDBNull(12) ? null : Convert.ToDouble(rdr.GetValue(12)),
                RigBy:         rdr.IsDBNull(13) ? null : rdr.GetValue(13).ToString(),
                RigTo:         rdr.IsDBNull(14) ? null : rdr.GetValue(14).ToString()
            ));
        }

        return results;
    }

    /// <summary>
    /// Returns well details directly from WMRO for the commissioning table list.
    /// Used when commStatus filter is provided (clicking from the commissioning widget).
    /// </summary>
    private async Task<IReadOnlyList<WellStatusListDto>> GetWellStatusListFromWmroAsync(
        string? cluster, string? wellType, string commStatus, DateOnly? commFrom, DateOnly? commTo, CancellationToken ct)
    {
        var filterParts = new List<string>();
        filterParts.Add("[pdo_well_id] IS NOT NULL AND [pdo_well_id] <> ''");
        if (!string.IsNullOrEmpty(cluster)) filterParts.Add("[Cluster] = @cluster");
        if (!string.IsNullOrEmpty(wellType)) filterParts.Add("[well_type] = @wellType");

        if (string.Equals(commStatus, "commissioned", StringComparison.OrdinalIgnoreCase))
        {
            filterParts.Add("[actual_comm._finish_date_with_in_2_days_from_actual_engg._completion_date] IS NOT NULL");
            if (commFrom.HasValue) filterParts.Add("TRY_CAST([actual_rig_off_date] AS DATE) >= @commFrom");
            if (commTo.HasValue)   filterParts.Add("TRY_CAST([actual_rig_off_date] AS DATE) <= @commTo");
        }
        else if (string.Equals(commStatus, "notCommissioned", StringComparison.OrdinalIgnoreCase))
        {
            filterParts.Add("[actual_comm._finish_date_with_in_2_days_from_actual_engg._completion_date] IS NULL");
            if (commFrom.HasValue) filterParts.Add("TRY_CAST([actual_rig_off_date] AS DATE) >= @commFrom");
            if (commTo.HasValue)   filterParts.Add("TRY_CAST([actual_rig_off_date] AS DATE) <= @commTo");
        }

        var where = string.Join(" AND ", filterParts);

        var sql = $"""
            SELECT
                sl_no,
                rig_no,
                well_location,
                pdo_well_id,
                well_type,
                Cluster,
                actual_rig_off_date,
                [actual_comm._start_date],
                [actual_comm._finish_date_with_in_2_days_from_actual_engg._completion_date] AS comm_finish_date,
                [actual_eng._completion_date],
                completion_type_rig_fbu_or_rsr_hoist,
                CASE
                    WHEN [actual_comm._finish_date_with_in_2_days_from_actual_engg._completion_date] IS NOT NULL THEN 'Commissioned'
                    ELSE 'Not Commissioned'
                END AS commission_status,
                COALESCE(TRY_CAST([overall_comm_progress_100] AS FLOAT), 0) AS comm_progress_pct
            FROM [dbo].[WellMonitoringReportOptimized] WITH (NOLOCK)
            WHERE {where}
            ORDER BY [actual_comm._finish_date_with_in_2_days_from_actual_engg._completion_date] DESC;
            """;

        var connStr = db.Database.GetConnectionString()!;
        await using var conn = new SqlConnection(connStr);
        await OpenWithRetryAsync(conn, ct);

        await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 120 };
        if (!string.IsNullOrEmpty(cluster)) cmd.Parameters.AddWithValue("@cluster", cluster);
        if (!string.IsNullOrEmpty(wellType)) cmd.Parameters.AddWithValue("@wellType", wellType);
        if (commFrom.HasValue) cmd.Parameters.Add(new SqlParameter("@commFrom", System.Data.SqlDbType.DateTime) { Value = commFrom.Value.ToDateTime(TimeOnly.MinValue) });
        if (commTo.HasValue) cmd.Parameters.Add(new SqlParameter("@commTo", System.Data.SqlDbType.DateTime) { Value = commTo.Value.ToDateTime(TimeOnly.MinValue) });

        var results = new List<WellStatusListDto>();
        await using var rdr = await cmd.ExecuteReaderAsync(ct);
        while (await rdr.ReadAsync(ct))
        {
            var wellId = rdr.IsDBNull(3) ? "" : rdr.GetValue(3).ToString()!;
            var wellName = rdr.IsDBNull(2) ? null : rdr.GetValue(2).ToString();
            var rig = rdr.IsDBNull(1) ? null : rdr.GetValue(1).ToString();
            var field = rdr.IsDBNull(5) ? null : rdr.GetValue(5).ToString();
            var wellTypeVal = rdr.IsDBNull(4) ? null : rdr.GetValue(4).ToString();
            var commStatusVal = rdr.IsDBNull(11) ? null : rdr.GetValue(11).ToString();
            var rigOff = rdr.IsDBNull(6) ? null : rdr.GetValue(6).ToString();
            var commStart = rdr.IsDBNull(7) ? null : rdr.GetValue(7).ToString();
            var commFinish = rdr.IsDBNull(8) ? null : rdr.GetValue(8).ToString();
            var engCompletion = rdr.IsDBNull(9) ? null : rdr.GetValue(9).ToString();
            var completionType = rdr.IsDBNull(10) ? null : rdr.GetValue(10).ToString();
            var commProgressPct = rdr.IsDBNull(12) ? 0.0 : Convert.ToDouble(rdr.GetValue(12));

            results.Add(new WellStatusListDto(
                WellId:        wellId,
                WellName:      wellName,
                Status:        commStatusVal ?? "Not Commissioned",
                Field:         field,
                Rig:           rig,
                ProgressPct:   0,
                PlannedPct:    null,
                Variance:      null,
                RatePerDay:    null,
                AskRate:       0,
                GapPerDay:     null,
                Spi:           null,
                Cpi:           null,
                Tags:          completionType,
                WellType:      wellTypeVal,
                LocPrepStatus: null,
                DrillingPct:   null,
                CommStatus:    commStatusVal,
                ConstrStatus:  null,
                ConstrPct:     null,
                ComplePct:     null,
                RigBy:         commStart,
                RigTo:         rigOff,
                CommStartDate:     commStart,
                CommFinishDate:    commFinish,
                CommProgressPct:   Math.Round(commProgressPct * 100.0, 1),
                EngCompletionDate: engCompletion,
                CompletionType:    completionType
            ));
        }

        return results;
    }

    // ─── Buffer Flowlines Ready — Well List ────────────────────────────────────────
    /// <summary>
    /// Returns wells with completed flowline construction (same criteria as Buffer Flowlines Ready widget).
    /// </summary>
    private async Task<IReadOnlyList<WellStatusListDto>> GetBufferFlowlinesReadyWellListAsync(
        string? cluster, string? wellType, string? project, CancellationToken ct)
    {
        var year = DateTime.UtcNow.Year;
        var asOf = DateOnly.FromDateTime(DateTime.UtcNow);

        // Apply filters AFTER dedup to avoid changing which row wins the ROW_NUMBER
        var postWhere = "";
        if (!string.IsNullOrEmpty(cluster)) postWhere += " AND " + ClusterFilter(cluster, "wl.[pdo_well_id]").Replace("wl.project_id", "wl.project_id");
        if (!string.IsNullOrEmpty(wellType)) postWhere += " AND wl.[well_type] = @wellType";
        if (!string.IsNullOrEmpty(project)) postWhere += " AND " + ProjectFilter("wl");

        var sql = $"""
            SET NOCOUNT ON;
            DECLARE @Year INT = @yearParam;
            DECLARE @AsOfDate DATE = @asOfParam;
            DECLARE @YearStart DATE = DATEFROMPARTS(@Year, 1, 1);
            DECLARE @YearEnd   DATE = DATEFROMPARTS(@Year + 1, 1, 1);

            ;WITH sap_planned AS (
                SELECT DISTINCT s.Well_ID
                FROM dbo.SAP_DRILLING_SEQUENCE_History s WITH (NOLOCK)
                WHERE s.Well_ID IS NOT NULL AND s.Well_ID <> ''
                  AND s.Well_Function NOT IN ('Unspecified', 'RIG MOVE', 'RIG MAINTENANCE')
                  AND TRY_CAST(s.Earl_start_date AS DATE) >= @YearStart
                  AND TRY_CAST(s.Earl_start_date AS DATE) <  @YearEnd
            ),
            WmrLatest AS (
                SELECT w.pdo_well_id,
                       w.project_id,
                       w.well_location,
                       w.rig_no,
                       w.well_type,
                       w.[flow_line_const._status_in_progress_completed] AS fl_const_status,
                       COALESCE(TRY_CAST(w.[overall_const._10_100] AS FLOAT), 0) AS constr_pct,
                       w.[const._complete_date_including_f_l_final_hydro_test_1_day_before_rig_on_date] AS constr_complete_date,
                       w.[flow_line_commi._status_in_progress_completed] AS fl_comm_status,
                       COALESCE(TRY_CAST(w.[overall_comm_progress_100] AS FLOAT), 0) AS comm_progress,
                       w.[actual_comm._start_date] AS comm_start,
                       w.[actual_comm._finish_date_with_in_2_days_from_actual_engg._completion_date] AS comm_finish,
                       w.actual_rig_on_date,
                       w.actual_rig_off_date,
                       w.buffer_status,
                       CASE WHEN TRY_CAST(w.[overall_const._10_100] AS FLOAT) = 100
                              OR w.[flow_line_const._status_in_progress_completed] = 'Completed'
                              OR (w.[const._complete_date_including_f_l_final_hydro_test_1_day_before_rig_on_date] IS NOT NULL
                                  AND LTRIM(RTRIM(w.[const._complete_date_including_f_l_final_hydro_test_1_day_before_rig_on_date])) != '')
                            THEN 1 ELSE 0 END AS fl_done
                FROM (
                    SELECT w2.*,
                           ROW_NUMBER() OVER (
                               PARTITION BY w2.pdo_well_id
                               ORDER BY w2.actual_rig_off_date DESC,
                                        w2.flaf_issue_date DESC,
                                        w2.over_all_progress_percentages DESC, w2.project_id
                           ) AS rn
                    FROM dbo.WMR w2 WITH (NOLOCK)
                    INNER JOIN (
                        SELECT pdo_well_id, MAX(Week_Number) AS max_wk
                        FROM dbo.WMR WITH (NOLOCK)
                        WHERE pdo_well_id IS NOT NULL AND pdo_well_id <> ''
                          AND COALESCE(TRY_CAST(Week_Number AS DATE), TRY_CONVERT(DATE, Week_Number, 5)) <= @AsOfDate
                        GROUP BY pdo_well_id
                    ) lts ON w2.pdo_well_id = lts.pdo_well_id AND w2.Week_Number = lts.max_wk
                    WHERE w2.pdo_well_id IS NOT NULL AND w2.pdo_well_id <> ''
                ) w
                WHERE w.rn = 1
            )
            SELECT
                wl.pdo_well_id,
                wl.well_location,
                wl.rig_no,
                wl.well_type,
                ISNULL(UPPER(LTRIM(RTRIM(p.[Cluster]))), 'Other') AS Area,
                wl.fl_const_status,
                wl.constr_pct,
                wl.constr_complete_date,
                wl.fl_comm_status,
                wl.comm_progress,
                wl.comm_start,
                wl.comm_finish,
                wl.actual_rig_on_date,
                wl.actual_rig_off_date,
                wl.buffer_status
            FROM sap_planned sp
            INNER JOIN WmrLatest wl ON sp.Well_ID = wl.pdo_well_id
            LEFT JOIN (
                SELECT CAST(ID AS NVARCHAR(100)) AS ID, MIN(UPPER(LTRIM(RTRIM([Cluster])))) AS [Cluster]
                FROM [dbo].[ProjectIDs] WITH (NOLOCK)
                GROUP BY ID
            ) p ON wl.project_id = p.ID
            WHERE wl.fl_done = 1
            {postWhere}
            ORDER BY Area, wl.pdo_well_id;
            """;

        var connStr = db.Database.GetConnectionString()!;
        await using var conn = new SqlConnection(connStr);
        await OpenWithRetryAsync(conn, ct);

        await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 120 };
        cmd.Parameters.AddWithValue("@yearParam", year);
        cmd.Parameters.AddWithValue("@asOfParam", asOf.ToDateTime(TimeOnly.MinValue));
        if (!string.IsNullOrEmpty(cluster)) cmd.Parameters.AddWithValue("@cluster", cluster);
        if (!string.IsNullOrEmpty(wellType)) cmd.Parameters.AddWithValue("@wellType", wellType);
        if (!string.IsNullOrEmpty(project)) cmd.Parameters.AddWithValue("@project", project);

        var results = new List<WellStatusListDto>();
        await using var rdr = await cmd.ExecuteReaderAsync(ct);
        while (await rdr.ReadAsync(ct))
        {
            var wellId = rdr.IsDBNull(0) ? "" : rdr.GetValue(0).ToString()!;
            var wellName = rdr.IsDBNull(1) ? null : rdr.GetValue(1).ToString();
            var rig = rdr.IsDBNull(2) ? null : rdr.GetValue(2).ToString();
            var wellTypeVal = rdr.IsDBNull(3) ? null : rdr.GetValue(3).ToString();
            var area = rdr.IsDBNull(4) ? null : rdr.GetValue(4).ToString();
            var flConstStatus = rdr.IsDBNull(5) ? null : rdr.GetValue(5).ToString();
            var constrPct = rdr.IsDBNull(6) ? 0.0 : Convert.ToDouble(rdr.GetValue(6));
            var constrCompleteDate = rdr.IsDBNull(7) ? null : rdr.GetValue(7).ToString();
            var flCommStatus = rdr.IsDBNull(8) ? null : rdr.GetValue(8).ToString();
            var commProgress = rdr.IsDBNull(9) ? 0.0 : Convert.ToDouble(rdr.GetValue(9));
            var commStart = rdr.IsDBNull(10) ? null : rdr.GetValue(10).ToString();
            var commFinish = rdr.IsDBNull(11) ? null : rdr.GetValue(11).ToString();
            var rigOn = rdr.IsDBNull(12) ? null : rdr.GetValue(12).ToString();
            var rigOff = rdr.IsDBNull(13) ? null : rdr.GetValue(13).ToString();
            var bufferStatus = rdr.IsDBNull(14) ? null : rdr.GetValue(14).ToString();

            // Determine a meaningful status for the grid
            var status = commFinish != null ? "Commissioned" : commStart != null ? "Comm. In Progress" : "FL Ready";

            results.Add(new WellStatusListDto(
                WellId:        wellId,
                WellName:      wellName,
                Status:        status,
                Field:         area,
                Rig:           rig,
                ProgressPct:   Math.Round(constrPct * 100.0, 1),
                PlannedPct:    null,
                Variance:      null,
                RatePerDay:    null,
                AskRate:       0,
                GapPerDay:     null,
                Spi:           null,
                Cpi:           null,
                Tags:          bufferStatus,
                WellType:      wellTypeVal,
                LocPrepStatus: "Completed",
                DrillingPct:   null,
                CommStatus:    flCommStatus,
                ConstrStatus:  flConstStatus ?? "Completed",
                ConstrPct:     Math.Round(constrPct * 100.0, 1),
                ComplePct:     Math.Round(commProgress * 100.0, 1),
                RigBy:         rigOn,
                RigTo:         rigOff,
                CommStartDate:     commStart,
                CommFinishDate:    commFinish,
                CommProgressPct:   Math.Round(commProgress * 100.0, 1),
                EngCompletionDate: constrCompleteDate,
                CompletionType:    null
            ));
        }

        return results;
    }

    // ─── OHL Readiness (Funnel Widget) ────────────────────────────────────────────
    public async Task<OhlReadinessResponse> GetOhlReadinessAsync(
        int? planYear = null,
        DateOnly? asOfDate = null,
        string? cluster = null,
        string? wellId = null,
        DateOnly? fromDate = null,
        DateOnly? toDate = null,
        string? wellType = null,
        string? project = null,
        CancellationToken ct = default)
    {
        var year = planYear ?? DateTime.UtcNow.Year;
        var asOf = asOfDate ?? DateOnly.FromDateTime(DateTime.UtcNow);
        var useDateRange = fromDate.HasValue || toDate.HasValue;
        var cacheKey = $"ohl-readiness:{year}:{asOf:yyyy-MM-dd}:{cluster ?? "all"}:{wellId ?? "all"}:{fromDate?.ToString("yyyy-MM-dd") ?? "all"}:{toDate?.ToString("yyyy-MM-dd") ?? "all"}:{wellType ?? "all"}:{project ?? "all"}";
        if (cache.TryGetValue(cacheKey, out OhlReadinessResponse? cached2) && cached2 is not null)
            return cached2;

        var extraWhere = "";
        if (!string.IsNullOrEmpty(cluster)) extraWhere += " AND " + ClusterFilter(cluster, "w.[pdo_well_id]");
        if (!string.IsNullOrEmpty(wellId))  extraWhere += " AND w.[pdo_well_id] = @wellId";

        // Project/wellType applied AFTER dedup using deduplicated ProjectIDs (GROUP BY ID)
        // so each well maps to exactly ONE project — sum of individual projects = All Projects.
        var postDedupWhere = "";
        {
            var pidConds = new List<string>();
            if (!string.IsNullOrEmpty(wellType)) pidConds.Add("LTRIM(RTRIM(dp.[Type])) = @wellType");
            if (!string.IsNullOrEmpty(project)) pidConds.Add("LTRIM(RTRIM(dp.[Project])) = @project");
            if (pidConds.Count > 0)
                postDedupWhere = $" AND project_id IN (SELECT CAST(dp.ID AS NVARCHAR(100)) FROM (SELECT ID, MIN(LTRIM(RTRIM([Type]))) AS [Type], MIN(LTRIM(RTRIM([Project]))) AS [Project] FROM [dbo].[ProjectIDs] WITH (NOLOCK) GROUP BY ID) dp WHERE {string.Join(" AND ", pidConds)})";
        }

        // Use SAP_DRILLING_SEQUENCE_History to determine planned wells (consistent with wells-readiness)
        var sapDateFilter = useDateRange
            ? "TRY_CAST(s.Earl_start_date AS DATE) >= @fromDate AND TRY_CAST(s.Earl_start_date AS DATE) <= @toDate"
            : "TRY_CAST(s.Earl_start_date AS DATE) >= DATEFROMPARTS(@Year, 1, 1) AND TRY_CAST(s.Earl_start_date AS DATE) < DATEFROMPARTS(@Year + 1, 1, 1)";

        var sql = $"""
            SET NOCOUNT ON;
            DECLARE @Year INT = @yearParam;
            ;WITH sap_planned AS (
                SELECT DISTINCT s.Well_ID
                FROM dbo.SAP_DRILLING_SEQUENCE_History s WITH (NOLOCK)
                WHERE s.Well_ID IS NOT NULL AND s.Well_ID <> ''
                  AND s.Well_Function NOT IN ('Unspecified', 'RIG MOVE', 'RIG MAINTENANCE')
                  AND {sapDateFilter}
            ),
            WmrLatest AS (
                SELECT pdo_well_id, project_id,
                       TRY_CAST(flaf_issue_date AS DATE) AS FlafDate,
                       TRY_CAST(actual_rig_off_date AS DATE) AS RigOff,
                       CASE WHEN TRY_CAST(ohl_progress AS FLOAT) >= 100
                              OR (ohl_completion_date IS NOT NULL AND LTRIM(RTRIM(ohl_completion_date)) != '')
                            THEN 1 ELSE 0 END AS ohl_done
                FROM (
                    SELECT w.*,
                           ROW_NUMBER() OVER (
                               PARTITION BY w.pdo_well_id
                               ORDER BY w.actual_rig_off_date DESC,
                                        w.flaf_issue_date DESC,
                                        w.over_all_progress_percentages DESC, w.project_id
                           ) AS rn
                    FROM dbo.WMR w WITH (NOLOCK)
                    INNER JOIN (
                        SELECT pdo_well_id, MAX(Week_Number) AS max_wk
                        FROM dbo.WMR WITH (NOLOCK)
                        WHERE pdo_well_id IS NOT NULL AND pdo_well_id <> ''
                          AND COALESCE(TRY_CAST(Week_Number AS DATE), TRY_CONVERT(DATE, Week_Number, 5)) <= @asOfDate
                        GROUP BY pdo_well_id
                    ) lts ON w.pdo_well_id = lts.pdo_well_id AND w.Week_Number = lts.max_wk
                    WHERE w.pdo_well_id IS NOT NULL AND w.pdo_well_id <> ''
                    {extraWhere}
                ) deduped
                WHERE rn = 1
                {postDedupWhere}
            ),
            Tracked AS (
                SELECT sp.Well_ID AS WellId, wl.FlafDate, wl.RigOff, wl.ohl_done
                FROM sap_planned sp
                INNER JOIN WmrLatest wl ON sp.Well_ID = wl.pdo_well_id
                UNION
                SELECT wl.pdo_well_id, wl.FlafDate, wl.RigOff, wl.ohl_done
                FROM WmrLatest wl
                WHERE NOT EXISTS (SELECT 1 FROM sap_planned sp WHERE sp.Well_ID = wl.pdo_well_id)
            )
            SELECT
                COUNT(*) AS TotalWells,
                COUNT(*) AS OriginalPlan,
                SUM(CASE WHEN ohl_done = 0 AND (RigOff IS NULL OR RigOff > @asOfDate) AND FlafDate IS NOT NULL AND FlafDate <= @asOfDate THEN 1 ELSE 0 END) AS FlafScrExcluded,
                COUNT(*) - SUM(CASE WHEN ohl_done = 0 AND (RigOff IS NULL OR RigOff > @asOfDate) AND FlafDate IS NOT NULL AND FlafDate <= @asOfDate THEN 1 ELSE 0 END) AS AfterFlafScr,
                0 AS PdoIssuesExcluded,
                COUNT(*) - SUM(CASE WHEN ohl_done = 0 AND (RigOff IS NULL OR RigOff > @asOfDate) AND FlafDate IS NOT NULL AND FlafDate <= @asOfDate THEN 1 ELSE 0 END) AS AfterPdoIssues,
                SUM(ohl_done) AS ActualCompleted,
                COUNT(*) - SUM(CASE WHEN ohl_done = 0 AND (RigOff IS NULL OR RigOff > @asOfDate) AND FlafDate IS NOT NULL AND FlafDate <= @asOfDate THEN 1 ELSE 0 END) - SUM(ohl_done) AS Backlog
            FROM Tracked;
            """;

        var connStr = db.Database.GetConnectionString()!;
        await using var conn = new SqlConnection(connStr);
        await OpenWithRetryAsync(conn, ct);
        await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 120 };
        cmd.Parameters.AddWithValue("@yearParam", year);
        cmd.Parameters.AddWithValue("@asOfDate", asOf.ToDateTime(TimeOnly.MinValue));
        if (!string.IsNullOrEmpty(cluster))
            cmd.Parameters.AddWithValue("@cluster", cluster);
        if (!string.IsNullOrEmpty(wellType))
            cmd.Parameters.AddWithValue("@wellType", wellType);
        if (!string.IsNullOrEmpty(project))
            cmd.Parameters.AddWithValue("@project", project);
        if (!string.IsNullOrEmpty(wellId)) cmd.Parameters.AddWithValue("@wellId", wellId);
        if (fromDate.HasValue) cmd.Parameters.AddWithValue("@fromDate", fromDate.Value.ToDateTime(TimeOnly.MinValue));
        if (toDate.HasValue)   cmd.Parameters.AddWithValue("@toDate", toDate.Value.ToDateTime(TimeOnly.MinValue));

        await using var rdr = await cmd.ExecuteReaderAsync(ct);
        await rdr.ReadAsync(ct);
        var ohlResponse = new OhlReadinessResponse(
            AsOfDate:           asOf.ToString("yyyy-MM-dd"),
            PlanYear:           year,
            TotalWells:         rdr.IsDBNull(0) ? 0 : rdr.GetInt32(0),
            OriginalPlan:       rdr.IsDBNull(1) ? 0 : rdr.GetInt32(1),
            FlafScrExcluded:    rdr.IsDBNull(2) ? 0 : rdr.GetInt32(2),
            AfterFlafScr:       rdr.IsDBNull(3) ? 0 : rdr.GetInt32(3),
            PdoIssuesExcluded:  rdr.IsDBNull(4) ? 0 : rdr.GetInt32(4),
            AfterPdoIssues:     rdr.IsDBNull(5) ? 0 : rdr.GetInt32(5),
            ActualCompleted:    rdr.IsDBNull(6) ? 0 : rdr.GetInt32(6),
            Backlog:            rdr.IsDBNull(7) ? 0 : rdr.GetInt32(7)
        );
        cache.Set(cacheKey, ohlResponse, CacheDuration);
        return ohlResponse;
    }

    // ─── Well Execution KPI ───────────────────────────────────────────────────────
    public async Task<WellExecKpiDto> GetWellExecKpiAsync(
        string?   cluster   = null,
        string?   wellType  = null,
        string    period    = "week",
        DateOnly? from      = null,
        DateOnly? to        = null,
        string?   wellId    = null,
        bool      chartOnly = false,
        CancellationToken ct = default)
    {
        // Default chart window: last 90 days from today.
        var chartTo   = to   ?? DateOnly.FromDateTime(DateTime.Today);
        var chartFrom = from ?? chartTo.AddDays(-90);

        var cacheKey = $"well-exec-kpi:{cluster}:{wellType}:{period}:{chartFrom:yyyy-MM-dd}:{chartTo:yyyy-MM-dd}:{wellId}:{(chartOnly ? "c" : "f")}";
        if (cache.TryGetValue(cacheKey, out WellExecKpiDto? cached3) && cached3 is not null)
            return cached3;

        // Chart-only fast path: skip the slow KPI-card SQL (the date-filtered aggregate
        // on WellMonitoringReport_Latest can take 60-120s on this remote DB). The frontend
        // calls this when only the chart needs to refresh — e.g. Day/Week/Month toggles or
        // the well-detail overlay (which has its own card source).
        if (chartOnly)
        {
            var chartOnlySeries = await BuildWellExecChartSeriesAsync(cluster, wellType, wellId, chartFrom, chartTo, period, ct);
            var chartOnlyDto = new WellExecKpiDto(
                JobCounts:          new WellExecJobCountsDto(0, 0, 0, 0),
                Progress:           new WellExecProgressDto(0, 0, 0),
                Delayed:            new WellExecDelayedDto(0, 0),
                Revenue:            new WellExecRevenueDto(0, 0, 0),
                UpcomingTargetEnds: 0,
                ChartSeries:        chartOnlySeries,
                Milestones:         Array.Empty<WellExecMilestoneDto>()
            );
            cache.Set(cacheKey, chartOnlyDto, CacheDuration);
            return chartOnlyDto;
        }

        // ── Load the per-well snapshot for this date range (cached) ────────────────
        // The DB has no useful indexes on WMR.Cluster / WMR.well_type / WMR date column,
        // so any SQL-side filter triggers a full table scan + bad join plan and times out
        // on large clusters (e.g. MARMUL = 557 wells). Strategy: run ONE unfiltered SQL
        // that returns per-well rows for the date range, cache it for 30 min, and apply
        // cluster / wellType / wellId filters in C# memory. After the first hit every
        // filter combination is instant.
        _ = period;
        var snapshot = await LoadWellExecSnapshotAsync(chartFrom, chartTo, ct);

        // Resolve cluster / wellType filter → list of wellIds via the cluster-wells cache.
        List<string>? scopedWellIds = await ResolveScopedWellIdsAsync(cluster, wellType, wellId, ct);
        // If a cluster/wellType filter was set but matches zero wells, return all-zero counts
        // (otherwise we'd fall through to "no filter" and show everything).
        if (scopedWellIds is { Count: 0 })
        {
            var emptyDto = new WellExecKpiDto(
                JobCounts:          new WellExecJobCountsDto(0, 0, 0, 0),
                Progress:           new WellExecProgressDto(0, 0, 0),
                Delayed:            new WellExecDelayedDto(0, 0),
                Revenue:            new WellExecRevenueDto(0, 0, 0),
                UpcomingTargetEnds: 0,
                ChartSeries:        await BuildWellExecChartSeriesAsync(cluster, wellType, wellId, chartFrom, chartTo, period, ct),
                Milestones:         Array.Empty<WellExecMilestoneDto>());
            cache.Set(cacheKey, emptyDto, CacheDuration);
            return emptyDto;
        }
        var scopeSet = scopedWellIds is { Count: > 0 }
            ? new HashSet<string>(scopedWellIds, StringComparer.OrdinalIgnoreCase)
            : null;
        var singleWell = !string.IsNullOrWhiteSpace(wellId) ? wellId.Trim() : null;

        IEnumerable<WellExecSnapshotRow> filtered = snapshot;
        // Date filter is applied in-memory (the snapshot loads ALL rows once; the SQL date
        // predicate would force a full WMR scan + timeout on the un-indexed date column).
        filtered = filtered.Where(r => r.RigOffDate.HasValue
                                       && r.RigOffDate.Value >= chartFrom
                                       && r.RigOffDate.Value <= chartTo);
        if (scopeSet is not null)
            filtered = filtered.Where(r => scopeSet.Contains(r.WellId));
        if (singleWell is not null)
            filtered = filtered.Where(r => string.Equals(r.WellId, singleWell, StringComparison.OrdinalIgnoreCase));
        var rows = filtered.ToList();

        int total      = rows.Count;
        int completed  = rows.Count(r => r.ActPctAvg.HasValue && r.ActPctAvg.Value >= 100);
        int inProgress = rows.Count(r => r.ActPctAvg.HasValue && r.ActPctAvg.Value > 0 && r.ActPctAvg.Value < 100);
        int notStarted = rows.Count(r => !r.ActPctAvg.HasValue || r.ActPctAvg.Value == 0);
        double actualPct = rows.Where(r => r.ActPctAvg.HasValue)
                               .Select(r => r.ActPctAvg!.Value)
                               .DefaultIfEmpty(0).Average();
        actualPct = Math.Round(actualPct, 1);
        double revenuePlan = rows.Sum(r => r.PlannedRev ?? 0);
        double revenueAct  = rows.Sum(r => r.ActualRev  ?? 0);
        var today = DateOnly.FromDateTime(DateTime.Today);
        var upcomingCutoff = today.AddDays(30);
        int delayedCnt = rows.Count(r => !r.ActualFinishDate.HasValue
                                        && r.RigOffDate.HasValue
                                        && r.RigOffDate.Value < today);
        int upcomingEnds = rows.Count(r => !r.ActualFinishDate.HasValue
                                          && r.RigOffDate.HasValue
                                          && r.RigOffDate.Value >= today
                                          && r.RigOffDate.Value <= upcomingCutoff);
        var revenuePct = revenuePlan > 0 ? Math.Round(revenueAct * 100.0 / revenuePlan, 2) : 0.0;

        // VsPlan stays 0 until a separate baseline is wired up. DelayedPct is share of Total.
        const double plannedPct  = 0.0;
        const double variancePct = 0.0;
        var delayedPct = total > 0 ? Math.Round(delayedCnt * 100.0 / total, 1) : 0.0;

        // The dashboard formats revenue as "X.YYM" when >=1, else "NNN K" — so feed it millions.
        var actualM  = Math.Round(revenueAct  / 1_000_000.0, 2);
        var plannedM = Math.Round(revenuePlan / 1_000_000.0, 2);

        // ── Time-series for the "Planned vs Actual Job Progress & Revenue" chart ──────────
        // Source: Dashboarding_Job_Progress. The `period` parameter controls bucket size:
        //   day   → up to 30 daily points (interpolated from the underlying weekly columns)
        //   week  → 6 weekly points (Prior Month End + Week-1..5 of current month)
        //   month → 2 monthly points (Prior Month End + Current Month End)
        // The chart range is clipped to [chartFrom, chartTo].
        var chartSeries  = await BuildWellExecChartSeriesAsync(cluster, wellType, wellId, chartFrom, chartTo, period, ct);

        var dto = new WellExecKpiDto(
            JobCounts:          new WellExecJobCountsDto(total, completed, inProgress, notStarted),
            Progress:           new WellExecProgressDto(actualPct, plannedPct, variancePct),
            Delayed:            new WellExecDelayedDto(delayedCnt, delayedPct),
            Revenue:            new WellExecRevenueDto(actualM, plannedM, revenuePct),
            UpcomingTargetEnds: upcomingEnds,
            ChartSeries:        chartSeries,
            Milestones:         Array.Empty<WellExecMilestoneDto>()
        );

        cache.Set(cacheKey, dto, CacheDuration);
        return dto;
    }

    /// <summary>
    /// Convert CLUSTER / WELL TYPE / WELL ID filters into a list of pdo_well_ids using
    /// the in-memory cluster-wells cache (instant — no DB hit). Returns:
    /// • <c>null</c> when no cluster/wellType filter is set (caller falls back to the
    ///   single-wellId predicate or unfiltered scope).
    /// • A list of well-ids matching the filter combination (possibly empty if no wells match).
    /// </summary>
    private async Task<List<string>?> ResolveScopedWellIdsAsync(string? cluster, string? wellType, string? wellId, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(cluster) && string.IsNullOrWhiteSpace(wellType))
            return null; // no narrowing needed; caller will apply single-wellId or no filter
        var clusters = await GetClusterWellsAsync(ct);
        var ids = new List<string>();
        foreach (var c in clusters)
        {
            if (!string.IsNullOrWhiteSpace(cluster)
                && !string.Equals(c.Cluster?.Trim(), cluster.Trim(), StringComparison.OrdinalIgnoreCase))
                continue;
            foreach (var w in c.Wells)
            {
                if (string.IsNullOrWhiteSpace(w.Id)) continue;
                if (!string.IsNullOrWhiteSpace(wellType)
                    && !string.Equals(w.WellType?.Trim(), wellType.Trim(), StringComparison.OrdinalIgnoreCase))
                    continue;
                ids.Add(w.Id);
            }
        }
        // If an explicit wellId is also set, intersect.
        if (!string.IsNullOrWhiteSpace(wellId))
            ids = ids.Where(id => string.Equals(id, wellId, StringComparison.OrdinalIgnoreCase)).ToList();
        // De-duplicate; SQL Server's IN-list has a 2100-param cap, but our well counts are well under that.
        return ids.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
    }

    private sealed record WellExecSnapshotRow(
        string WellId,
        double? ActPctAvg,
        double? PlannedRev,
        double? ActualRev,
        DateOnly? RigOffDate,
        DateOnly? ActualFinishDate);

    /// <summary>
    /// Loads ALL per-well rows for the Well Execution Dashboard cards — UNFILTERED on
    /// date, cluster, wellType, and wellId. The result is cached for 30 min. ALL filtering
    /// (date / cluster / wellType / wellId) happens in C# memory in the caller.
    /// Why: WMR has no usable indexes for date / cluster / well_type, so any WHERE
    /// filter forces a full table scan + bad join plan that times out (300 s) on this
    /// remote DB. A single unfiltered scan caches enough data to serve every filter
    /// combination instantly. WMR is ~13k rows × 6 columns = a few MB in memory.
    /// </summary>
    private async Task<List<WellExecSnapshotRow>> LoadWellExecSnapshotAsync(
        DateOnly from, DateOnly to, CancellationToken ct)
    {
        _ = from; _ = to; // filter applied in caller; kept here so the signature is stable
        const string key = "well-exec-snapshot:all";
        if (cache.TryGetValue(key, out List<WellExecSnapshotRow>? cached) && cached is not null)
            return cached;

        const string sql = """
            ;WITH WellAggregate AS (
                SELECT
                    r.well_id,
                    AVG(CASE WHEN TRY_CAST(r.act_percent AS FLOAT) > 1
                             THEN TRY_CAST(r.act_percent AS FLOAT)
                             ELSE ISNULL(TRY_CAST(r.act_percent AS FLOAT), 0) * 100 END) AS act_pct_avg,
                    SUM(TRY_CAST(r.planned_purpose_value AS FLOAT)) AS planned_rev,
                    SUM(TRY_CAST(r.actual_purpose_value  AS FLOAT)) AS actual_rev
                FROM [dbo].[Revenue] r WITH (NOLOCK)
                WHERE r.well_id IS NOT NULL
                GROUP BY r.well_id
            )
            SELECT
                w.pdo_well_id                          AS WellId,
                wa.act_pct_avg                         AS ActPctAvg,
                wa.planned_rev                         AS PlannedRev,
                wa.actual_rev                          AS ActualRev,
                w.[exp.rig_off_location_sap_data]      AS RigOffDate,
                w.actual_finish_date                   AS ActualFinishDate
            FROM [dbo].[WellMonitoringReport_Latest] w WITH (NOLOCK)
            LEFT JOIN WellAggregate wa ON wa.well_id = w.pdo_well_id
            WHERE w.pdo_well_id IS NOT NULL
              AND w.pdo_well_id <> '';
            """;

        var connStr = db.Database.GetConnectionString()!;
        await using var conn = new SqlConnection(connStr);
        await OpenWithRetryAsync(conn, ct);
        await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 300 };

        var rows = new List<WellExecSnapshotRow>(2048);
        await using var rdr = await cmd.ExecuteReaderAsync(ct);
        while (await rdr.ReadAsync(ct))
        {
            var wellId = rdr.IsDBNull(0) ? string.Empty : rdr.GetString(0)?.Trim() ?? string.Empty;
            if (string.IsNullOrEmpty(wellId)) continue;
            double? actPct = rdr.IsDBNull(1) ? null : Convert.ToDouble(rdr.GetValue(1));
            double? planRev = rdr.IsDBNull(2) ? null : Convert.ToDouble(rdr.GetValue(2));
            double? actRev = rdr.IsDBNull(3) ? null : Convert.ToDouble(rdr.GetValue(3));
            DateOnly? rigOff = rdr.IsDBNull(4) ? null : DateOnly.FromDateTime(Convert.ToDateTime(rdr.GetValue(4)));
            DateOnly? actFin = rdr.IsDBNull(5) ? null : DateOnly.FromDateTime(Convert.ToDateTime(rdr.GetValue(5)));
            rows.Add(new WellExecSnapshotRow(wellId, actPct, planRev, actRev, rigOff, actFin));
        }
        cache.Set(key, rows, CacheDuration);
        return rows;
    }

    /// <summary>
    /// Reads per-well planned / actual progress and revenue from the Revenue table, groups
    /// the rows by <paramref name="period"/> bucket (day / week / month) keyed on
    /// <c>created_at</c>, and emits chart points covering [<paramref name="from"/>, <paramref name="to"/>].
    /// </summary>
    private sealed record DjpSnapshotRow(
        string WellId,
        double CumPriorActualPct,
        double W1Plan, double W1Actual,
        double W2Plan, double W2Actual,
        double W3Plan, double W3Actual,
        double W4Plan, double W4Actual,
        double W5Plan, double W5Actual,
        double CumCurPlanPct,
        double CumCurActualPct,
        double CumPriorPlanRev,
        double CumPriorActualRev,
        double CumCurPlanRev,
        double CumCurActualRev);

    /// <summary>
    /// Loads UNFILTERED per-well rows from Dashboarding_Job_Progress for the chart, caches them.
    /// Same rationale as <see cref="LoadWellExecSnapshotAsync"/>: WMR/DJP have no useful indexes
    /// for cluster/wellType, so pushing those into SQL forces full scans + hash joins that time
    /// out on large clusters. One unfiltered fetch + in-memory aggregation is the only fast path.
    /// </summary>
    private async Task<List<DjpSnapshotRow>> LoadDjpSnapshotAsync(CancellationToken ct)
    {
        const string key = "djp-snapshot";
        if (cache.TryGetValue(key, out List<DjpSnapshotRow>? cached) && cached is not null)
            return cached;

        const string sql = """
            SET NOCOUNT ON;
            SELECT
                jp.[Well ID]                                                  AS WellId,
                CAST(ISNULL(jp.[Cum-Prior Month Actual %], 0)      AS FLOAT)  AS CumPriorActualPct,
                CAST(ISNULL(jp.[Week-1 Plan %], 0)                 AS FLOAT)  AS W1Plan,
                CAST(ISNULL(jp.[Week-1 Actual %], 0)               AS FLOAT)  AS W1Actual,
                CAST(ISNULL(jp.[Week-2 Plan %], 0)                 AS FLOAT)  AS W2Plan,
                CAST(ISNULL(jp.[Week-2 Actual %], 0)               AS FLOAT)  AS W2Actual,
                CAST(ISNULL(jp.[Week-3 Plan %], 0)                 AS FLOAT)  AS W3Plan,
                CAST(ISNULL(jp.[Week-3 Actual %], 0)               AS FLOAT)  AS W3Actual,
                CAST(ISNULL(jp.[Week-4 Plan %], 0)                 AS FLOAT)  AS W4Plan,
                CAST(ISNULL(jp.[Week-4 Actual %], 0)               AS FLOAT)  AS W4Actual,
                CAST(ISNULL(jp.[Week-5 Plan %], 0)                 AS FLOAT)  AS W5Plan,
                CAST(ISNULL(jp.[Week-5 Actual %], 0)               AS FLOAT)  AS W5Actual,
                CAST(ISNULL(jp.[Cum-Current Month Plan %], 0)      AS FLOAT)  AS CumCurPlanPct,
                CAST(ISNULL(jp.[Cum-Current Month Actual %], 0)    AS FLOAT)  AS CumCurActualPct,
                CAST(ISNULL(jp.[Cum-Prior Month Plan], 0)          AS FLOAT)  AS CumPriorPlanRev,
                CAST(ISNULL(jp.[Cum-Prior Month Actual], 0)        AS FLOAT)  AS CumPriorActualRev,
                CAST(ISNULL(jp.[Cum - Current Month Plan], 0)      AS FLOAT)  AS CumCurPlanRev,
                CAST(ISNULL(jp.[Cum - Current Month Actual], 0)    AS FLOAT)  AS CumCurActualRev
            FROM [dbo].[Dashboarding_Job_Progress] jp WITH (NOLOCK)
            WHERE jp.[Well ID] IS NOT NULL AND jp.[Well ID] <> '';
            """;

        var connStr = db.Database.GetConnectionString()!;
        await using var conn = new SqlConnection(connStr);
        await OpenWithRetryAsync(conn, ct);
        await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 300 };
        var rows = new List<DjpSnapshotRow>(1024);
        await using var rdr = await cmd.ExecuteReaderAsync(ct);
        while (await rdr.ReadAsync(ct))
        {
            var wid = rdr.IsDBNull(0) ? string.Empty : rdr.GetString(0)?.Trim() ?? string.Empty;
            if (string.IsNullOrEmpty(wid)) continue;
            rows.Add(new DjpSnapshotRow(
                wid,
                Convert.ToDouble(rdr.GetValue(1)),
                Convert.ToDouble(rdr.GetValue(2)),  Convert.ToDouble(rdr.GetValue(3)),
                Convert.ToDouble(rdr.GetValue(4)),  Convert.ToDouble(rdr.GetValue(5)),
                Convert.ToDouble(rdr.GetValue(6)),  Convert.ToDouble(rdr.GetValue(7)),
                Convert.ToDouble(rdr.GetValue(8)),  Convert.ToDouble(rdr.GetValue(9)),
                Convert.ToDouble(rdr.GetValue(10)), Convert.ToDouble(rdr.GetValue(11)),
                Convert.ToDouble(rdr.GetValue(12)),
                Convert.ToDouble(rdr.GetValue(13)),
                Convert.ToDouble(rdr.GetValue(14)),
                Convert.ToDouble(rdr.GetValue(15)),
                Convert.ToDouble(rdr.GetValue(16)),
                Convert.ToDouble(rdr.GetValue(17))));
        }
        cache.Set(key, rows, CacheDuration);
        return rows;
    }

    private async Task<IReadOnlyList<WellExecChartPointDto>> BuildWellExecChartSeriesAsync(
        string? cluster, string? wellType, string? wellId, DateOnly from, DateOnly to, string period, CancellationToken ct)
    {
        // Revenue.created_at is a bulk-insert timestamp (all rows share one moment), so it
        // can't drive a time-series. Instead, use Dashboarding_Job_Progress's pre-pivoted
        // weekly columns — Cum-Prior Month + Week-1..5 + Cum-Current Month — to build a
        // 6-point weekly series. Day mode interpolates onto a daily grid; Month mode
        // collapses to the two month-end anchors.
        var scopedWellIds = await ResolveScopedWellIdsAsync(cluster, wellType, wellId, ct);
        if (scopedWellIds is { Count: 0 }) return Array.Empty<WellExecChartPointDto>();

        var snapshot = await LoadDjpSnapshotAsync(ct);
        var scopeSet = scopedWellIds is { Count: > 0 }
            ? new HashSet<string>(scopedWellIds, StringComparer.OrdinalIgnoreCase)
            : null;
        var singleWell = !string.IsNullOrWhiteSpace(wellId) ? wellId.Trim() : null;

        IEnumerable<DjpSnapshotRow> filtered = snapshot;
        if (scopeSet is not null) filtered = filtered.Where(r => scopeSet.Contains(r.WellId));
        if (singleWell is not null) filtered = filtered.Where(r => string.Equals(r.WellId, singleWell, StringComparison.OrdinalIgnoreCase));
        var djpRows = filtered.ToList();

        double cumPriorAct = djpRows.Count > 0 ? djpRows.Average(r => r.CumPriorActualPct) : 0;
        double w1P = djpRows.Count > 0 ? djpRows.Average(r => r.W1Plan)   : 0;
        double w1A = djpRows.Count > 0 ? djpRows.Average(r => r.W1Actual) : 0;
        double w2P = djpRows.Count > 0 ? djpRows.Average(r => r.W2Plan)   : 0;
        double w2A = djpRows.Count > 0 ? djpRows.Average(r => r.W2Actual) : 0;
        double w3P = djpRows.Count > 0 ? djpRows.Average(r => r.W3Plan)   : 0;
        double w3A = djpRows.Count > 0 ? djpRows.Average(r => r.W3Actual) : 0;
        double w4P = djpRows.Count > 0 ? djpRows.Average(r => r.W4Plan)   : 0;
        double w4A = djpRows.Count > 0 ? djpRows.Average(r => r.W4Actual) : 0;
        double w5P = djpRows.Count > 0 ? djpRows.Average(r => r.W5Plan)   : 0;
        double w5A = djpRows.Count > 0 ? djpRows.Average(r => r.W5Actual) : 0;
        double cumCurPlanPct = djpRows.Count > 0 ? djpRows.Average(r => r.CumCurPlanPct) : 0;
        double cumPriorPlanRev = djpRows.Sum(r => r.CumPriorPlanRev);
        double cumPriorActRev  = djpRows.Sum(r => r.CumPriorActualRev);
        double cumCurPlanRev   = djpRows.Sum(r => r.CumCurPlanRev);
        double cumCurActRev    = djpRows.Sum(r => r.CumCurActualRev);

        // Build cumulative weekly progress = prior baseline + running sum of weekly deltas.
        var cumActual = new[]
        {
            cumPriorAct,
            cumPriorAct + w1A,
            cumPriorAct + w1A + w2A,
            cumPriorAct + w1A + w2A + w3A,
            cumPriorAct + w1A + w2A + w3A + w4A,
            cumPriorAct + w1A + w2A + w3A + w4A + w5A
        };
        var weeklyPlanSum = w1P + w2P + w3P + w4P + w5P;
        var cumPriorPlan  = cumCurPlanPct - weeklyPlanSum;
        var cumPlanned = new[]
        {
            cumPriorPlan,
            cumPriorPlan + w1P,
            cumPriorPlan + w1P + w2P,
            cumPriorPlan + w1P + w2P + w3P,
            cumPriorPlan + w1P + w2P + w3P + w4P,
            cumPriorPlan + w1P + w2P + w3P + w4P + w5P
        };
        // Revenue is monthly cumulative — interpolate linearly across the 6 weekly points.
        var revPlanInterp = LinearInterp(cumPriorPlanRev, cumCurPlanRev, 6);
        var revActInterp  = LinearInterp(cumPriorActRev,  cumCurActRev,  6);

        // Bucket dates: prior month end + last days of week-1..5 of the current month.
        var today      = DateTime.Today;
        var monthStart = new DateTime(today.Year, today.Month, 1);
        var daysInMon  = DateTime.DaysInMonth(today.Year, today.Month);
        var weeklyBucketDates = new DateOnly[]
        {
            DateOnly.FromDateTime(monthStart.AddDays(-1)),                                // prior month end
            DateOnly.FromDateTime(monthStart.AddDays(Math.Min( 6, daysInMon - 1))),
            DateOnly.FromDateTime(monthStart.AddDays(Math.Min(13, daysInMon - 1))),
            DateOnly.FromDateTime(monthStart.AddDays(Math.Min(20, daysInMon - 1))),
            DateOnly.FromDateTime(monthStart.AddDays(Math.Min(27, daysInMon - 1))),
            DateOnly.FromDateTime(monthStart.AddDays(daysInMon - 1))                      // current month end
        };

        var normalisedPeriod = (period ?? "week").ToLowerInvariant();
        var points = new List<WellExecChartPointDto>();
        switch (normalisedPeriod)
        {
            case "month":
            {
                int[] monthIdx = { 0, 5 };
                foreach (var i in monthIdx)
                {
                    var d = weeklyBucketDates[i];
                    if (d < from) continue;
                    points.Add(new WellExecChartPointDto(
                        Label:       d.ToString("MMM ''yy"),
                        PlannedPct:  Math.Round(cumPlanned[i], 1),
                        ActualPct:   Math.Round(cumActual[i],  1),
                        PlannedRevM: Math.Round(revPlanInterp[i] / 1_000_000.0, 2),
                        ActualRevM:  Math.Round(revActInterp[i]  / 1_000_000.0, 2)));
                }
                break;
            }
            case "day":
            {
                var dayStart = weeklyBucketDates[0];
                var dayEnd   = weeklyBucketDates[5];
                for (var d = dayStart; d <= dayEnd; d = d.AddDays(1))
                {
                    if (d < from) continue;
                    int seg = 0;
                    for (int i = 0; i < weeklyBucketDates.Length - 1; i++)
                    {
                        if (d >= weeklyBucketDates[i] && d <= weeklyBucketDates[i + 1]) { seg = i; break; }
                    }
                    var lo = weeklyBucketDates[seg];
                    var hi = weeklyBucketDates[seg + 1];
                    var span = hi.DayNumber - lo.DayNumber;
                    var frac = span > 0 ? (double)(d.DayNumber - lo.DayNumber) / span : 0.0;
                    double Lerp(double a, double b) => a + (b - a) * frac;
                    points.Add(new WellExecChartPointDto(
                        Label:       d.ToString("dd MMM"),
                        PlannedPct:  Math.Round(Lerp(cumPlanned[seg],    cumPlanned[seg + 1]),    1),
                        ActualPct:   Math.Round(Lerp(cumActual[seg],     cumActual[seg + 1]),     1),
                        PlannedRevM: Math.Round(Lerp(revPlanInterp[seg], revPlanInterp[seg + 1]) / 1_000_000.0, 2),
                        ActualRevM:  Math.Round(Lerp(revActInterp[seg],  revActInterp[seg + 1])  / 1_000_000.0, 2)));
                }
                break;
            }
            default: // "week"
            {
                for (int i = 0; i < weeklyBucketDates.Length; i++)
                {
                    var d = weeklyBucketDates[i];
                    if (d < from) continue;
                    points.Add(new WellExecChartPointDto(
                        Label:       d.ToString("dd MMM ''yy"),
                        PlannedPct:  Math.Round(cumPlanned[i], 1),
                        ActualPct:   Math.Round(cumActual[i],  1),
                        PlannedRevM: Math.Round(revPlanInterp[i] / 1_000_000.0, 2),
                        ActualRevM:  Math.Round(revActInterp[i]  / 1_000_000.0, 2)));
                }
                break;
            }
        }
        return points;
    }

    /// <summary>Linear interpolation between two endpoints across n equally spaced steps.</summary>
    private static double[] LinearInterp(double start, double end, int n)
    {
        if (n <= 0) return Array.Empty<double>();
        if (n == 1) return new[] { end };
        var arr = new double[n];
        for (int i = 0; i < n; i++) arr[i] = start + (end - start) * i / (n - 1);
        return arr;
    }

    // ─── Well Hookup KPI (Non-Standard stubs) ─────────────────────────────────

    public Task<WellHookupKpiDto> GetWellHookupKpiAsync(
        string?   cluster   = null,
        DateOnly? from      = null,
        DateOnly? to        = null,
        CancellationToken ct = default)
    {
        return Task.FromResult(new WellHookupKpiDto(0, 0, 0, 0, 0, 0, 0, 0, 0, 0));
    }

    public Task<NsHookupWaterfallDto> GetNsHookupWaterfallAsync(
        string?   cluster = null,
        DateOnly? from    = null,
        DateOnly? to      = null,
        CancellationToken ct = default)
    {
        var asOf = (to ?? DateOnly.FromDateTime(DateTime.Today)).ToString("yyyy-MM-dd");
        return Task.FromResult(new NsHookupWaterfallDto(0, 0, 0, 0, 0, 0, asOf));
    }

    public Task<NsHookupCompletionDto> GetNsHookupCompletionAsync(
        string?   cluster = null,
        DateOnly? from    = null,
        DateOnly? to      = null,
        CancellationToken ct = default)
    {
        var asOf = (to ?? DateOnly.FromDateTime(DateTime.Today)).ToString("yyyy-MM-dd");
        return Task.FromResult(new NsHookupCompletionDto(0, 0, 0, asOf));
    }

    public Task<NsHookupBreakdownDto> GetNsHookupBreakdownAsync(
        string?   cluster = null,
        DateOnly? from    = null,
        DateOnly? to      = null,
        CancellationToken ct = default)
    {
        var asOf = (to ?? DateOnly.FromDateTime(DateTime.Today)).ToString("yyyy-MM-dd");
        return Task.FromResult(new NsHookupBreakdownDto(0, 0, 0, 0, 0, 0, 0, asOf));
    }

    // ── Well Hookup Progress ──────────────────────────────────────────────────
    // Conventional is read live from WellMonitoringReport_Latest (joined to the
    // 'Conventional Well' ProjectIDs). Non-standard / well-conversions remain on
    // representative sample data until their source queries are defined.
    public async Task<HookupProgressDto> GetHookupProgressAsync(
        string    wellType = "conventional",
        string?   cluster  = null,
        string?   location = null,
        DateOnly? from     = null,
        DateOnly? to       = null,
        CancellationToken ct = default,
        string?   site     = null,
        string?   project  = null)
    {
        var scope = new HookupScope(
            string.IsNullOrWhiteSpace(cluster) ? null : cluster.Trim(),
            string.IsNullOrWhiteSpace(site)    ? null : site.Trim(),
            string.IsNullOrWhiteSpace(project) ? null : project.Trim(),
            from, to);

        if (wellType == "non-standard")
        {
            var ns = await GetNonStandardHookupProgressAsync(scope, ct);
            if (ns is not null) return ns;
            // fall through to sample data if the DB is unreachable
        }
        else if (wellType == "well-conversions")
        {
            var wc = await GetWellConversionsHookupProgressAsync(scope, ct);
            if (wc is not null) return wc;
            // fall through to sample data if the DB is unreachable
        }
        else
        {
            var conv = await GetConventionalHookupProgressAsync(scope, ct);
            if (conv is not null) return conv;
            // fall through to sample data if the DB is unreachable
        }

        HookupProgressDto dto = wellType switch
        {
            "non-standard" => new HookupProgressDto(
                wellType,
                new HookupProgressKpiDto(42, 38, 1, 310, 4, 3, 5, 6),
                new List<HookupWaterfallStepDto>
                {
                    new("PDO plan",        8),
                    new("FLAF/SCR",       -3),
                    new("After FLAF/SCR",  5),
                    new("PDO issues",     -1),
                    new("Clean target",    4),
                    new("Actual completed",4)
                },
                new HookupOverallDto(17.8, 15.0, 42, 12, 1, 62)),

            "well-conversions" => new HookupProgressDto(
                wellType,
                new HookupProgressKpiDto(28, 24, 0, 190, 3, 2, 2, 3),
                new List<HookupWaterfallStepDto>
                {
                    new("PDO plan",        4),
                    new("FLAF/SCR",       -1),
                    new("After FLAF/SCR",  3),
                    new("PDO issues",     -1),
                    new("Clean target",    2),
                    new("Actual completed",2)
                },
                new HookupOverallDto(19.5, 17.0, 28, 8, 0, 40)),

            _ => new HookupProgressDto(
                wellType,
                new HookupProgressKpiDto(69, 63, 0, 531, 6, 4, 3, 4),
                new List<HookupWaterfallStepDto>
                {
                    new("PDO plan",        5),
                    new("FLAF/SCR",       -2),
                    new("After FLAF/SCR",  3),
                    new("PDO issues",     -1),
                    new("Clean target",    2),
                    new("Actual completed",3)
                },
                new HookupOverallDto(13.0, 11.2, 69, 9, 0, 78))
        };
        return dto;
    }

    /// <summary>Global-filter scope shared by the three hookup funnels (all parts optional).</summary>
    private sealed record HookupScope(string? Cluster, string? Site, string? Project, DateOnly? From, DateOnly? To);

    /// <summary>
    /// SQL fragment that scopes the ProjectIDs CTE to the selected cluster / site / project.
    /// Each predicate is a no-op when its @param is NULL. Pass the ProjectIDs alias (e.g. "pid").
    /// </summary>
    private static string ProjectScopeSql(string alias) => $"""
                  AND (@cluster IS NULL OR LTRIM(RTRIM(CAST({alias}.[Cluster] AS NVARCHAR(200)))) = @cluster)
                  AND (@site    IS NULL OR LTRIM(RTRIM(CAST({alias}.[Site]    AS NVARCHAR(200)))) = @site)
                  AND (@project IS NULL OR LTRIM(RTRIM(CAST({alias}.[Project] AS NVARCHAR(200)))) = @project)
            """;

    /// <summary>Binds the @from/@to rig-off range and @cluster/@site/@project scope params.</summary>
    private static void AddScopeParams(SqlCommand cmd, HookupScope s)
    {
        cmd.Parameters.Add(new SqlParameter("@from", System.Data.SqlDbType.Date)
            { Value = s.From.HasValue ? s.From.Value.ToDateTime(TimeOnly.MinValue) : DBNull.Value });
        cmd.Parameters.Add(new SqlParameter("@to", System.Data.SqlDbType.Date)
            { Value = s.To.HasValue ? s.To.Value.ToDateTime(TimeOnly.MinValue) : DBNull.Value });
        cmd.Parameters.Add(new SqlParameter("@cluster", System.Data.SqlDbType.NVarChar, 200)
            { Value = (object?)s.Cluster ?? DBNull.Value });
        cmd.Parameters.Add(new SqlParameter("@site", System.Data.SqlDbType.NVarChar, 200)
            { Value = (object?)s.Site ?? DBNull.Value });
        cmd.Parameters.Add(new SqlParameter("@project", System.Data.SqlDbType.NVarChar, 200)
            { Value = (object?)s.Project ?? DBNull.Value });
    }

    /// <summary>Cache-key suffix capturing the full scope so each filter combination caches separately.</summary>
    private static string ScopeKey(HookupScope s) =>
        $"{s.Cluster ?? "all"}:{s.Site ?? "all"}:{s.Project ?? "all"}:{s.From?.ToString("yyyy-MM-dd") ?? "all"}:{s.To?.ToString("yyyy-MM-dd") ?? "all"}";

    /// <summary>
    /// Live Conventional hook-up funnel, read from WellMonitoringReport_Latest joined to the
    /// 'Conventional Well' ProjectIDs. Optionally scoped to a rig-off date range. Returns null on
    /// any DB failure so the caller can fall back to sample data. Cached 30 min per date range.
    /// </summary>
    private async Task<HookupProgressDto?> GetConventionalHookupProgressAsync(HookupScope scope, CancellationToken ct)
    {
        var cacheKey = $"hookup-progress:conventional:{ScopeKey(scope)}";
        if (cache.TryGetValue(cacheKey, out HookupProgressDto? cached) && cached is not null)
            return cached;

        // Period filter (optional): a well is "in" the selected range when its rig-off date falls
        // inside it. Wells with no rig-off date are excluded once a range is set.
        var sql = $"""
            WITH ConventionalProjects AS (
                SELECT pid.ID AS project_id_key
                FROM [dbo].[ProjectIDs] pid WITH (NOLOCK)
                WHERE pid.Type = 'Conventional Well'
            {ProjectScopeSql("pid")}
            ),
            ConventionalWells AS (
                SELECT
                    wmr.pdo_well_id,
                    wmr.scr_no,
                    wmr.buffer_status,
                    wmr.[remark_status_area_of_attention_issues_]                                     AS remark,
                    wmr.[actual_eng._completion_date]                                                AS eng_completion_date,
                    wmr.[actual_comm._finish_date_with_in_2_days_from_actual_engg._completion_date]  AS hookup_completion_date
                FROM [dbo].[WellMonitoringReport_Latest] wmr WITH (NOLOCK)
                INNER JOIN ConventionalProjects cp
                    ON wmr.project_id = CAST(cp.project_id_key AS NVARCHAR(50))
                WHERE (@from IS NULL OR TRY_CONVERT(DATE, wmr.[actual_rig_off_date]) >= @from)
                  AND (@to   IS NULL OR TRY_CONVERT(DATE, wmr.[actual_rig_off_date]) <= @to)
            ),
            Classified AS (
                SELECT
                    CASE WHEN scr_no IS NOT NULL AND LTRIM(RTRIM(scr_no)) <> ''
                         THEN 1 ELSE 0 END AS is_flaf_scr_delayed,
                    CASE WHEN remark LIKE '%PDO%'
                           OR buffer_status IN ('PDO Issue', 'On Hold')
                         THEN 1 ELSE 0 END AS is_pdo_issue,
                    CASE WHEN eng_completion_date IS NOT NULL
                           OR hookup_completion_date IS NOT NULL
                         THEN 1 ELSE 0 END AS is_hooked_up
                FROM ConventionalWells
            )
            SELECT
                COUNT(*)                                                                AS original_plan,
                SUM(is_flaf_scr_delayed)                                                AS flaf_scr_removed,
                COUNT(*) - SUM(is_flaf_scr_delayed)                                     AS after_flaf_scr,
                SUM(CASE WHEN is_flaf_scr_delayed = 0 THEN is_pdo_issue ELSE 0 END)     AS pdo_issues_removed,
                SUM(CASE WHEN is_flaf_scr_delayed = 0 AND is_pdo_issue = 0
                         THEN is_hooked_up ELSE 0 END)                                  AS hookup_completed
            FROM Classified;
            """;

        try
        {
            var connStr = db.Database.GetConnectionString()!;
            await using var conn = new SqlConnection(connStr);
            await OpenWithRetryAsync(conn, ct);
            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 120 };
            AddScopeParams(cmd, scope);

            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            if (!await rdr.ReadAsync(ct)) return null;

            int Col(string name) => rdr.IsDBNull(rdr.GetOrdinal(name)) ? 0 : Convert.ToInt32(rdr[name]);
            var originalPlan     = Col("original_plan");
            var flafScrRemoved   = Col("flaf_scr_removed");
            var afterFlafScr     = Col("after_flaf_scr");
            var pdoIssuesRemoved = Col("pdo_issues_removed");
            var hookupCompleted  = Col("hookup_completed");

            var cleanTarget = afterFlafScr - pdoIssuesRemoved;
            var backlog     = Math.Max(0, cleanTarget - hookupCompleted);
            var overallPct  = afterFlafScr > 0
                ? Math.Round((double)hookupCompleted / afterFlafScr * 100, 1)
                : 0;

            var dto = new HookupProgressDto(
                "conventional",
                new HookupProgressKpiDto(hookupCompleted, 0, 0, originalPlan, 0, 0, 0, 0),
                new List<HookupWaterfallStepDto>
                {
                    new("PDO plan",         originalPlan),
                    new("FLAF/SCR",        -flafScrRemoved),
                    new("After FLAF/SCR",   afterFlafScr),
                    new("PDO issues",      -pdoIssuesRemoved),
                    new("Clean target",     cleanTarget),
                    new("Actual completed", hookupCompleted)
                },
                new HookupOverallDto(overallPct, 0, hookupCompleted, backlog, 0, originalPlan));

            cache.Set(cacheKey, dto, TimeSpan.FromMinutes(30));
            return dto;
        }
        catch (SqlException)
        {
            // DB unreachable / query failure — let the caller serve sample data.
            return null;
        }
    }

    /// <summary>
    /// Live Non-Standard hook-up funnel, read from WellMonitoringReport_Latest joined to the
    /// 'Non Standard Well' ProjectIDs. FLAF/SCR delay rule differs from Conventional: a well is
    /// delayed if an SCR is raised, or rig-off + 80 days has not yet passed, or FLAF is unissued.
    /// Returns null on any DB failure so the caller can fall back to sample data. Cached 30 min.
    /// </summary>
    private async Task<HookupProgressDto?> GetNonStandardHookupProgressAsync(HookupScope scope, CancellationToken ct)
    {
        var cacheKey = $"hookup-progress:non-standard:{ScopeKey(scope)}";
        if (cache.TryGetValue(cacheKey, out HookupProgressDto? cached) && cached is not null)
            return cached;

        var sql = $"""
            WITH NonStandardProjects AS (
                SELECT pid.ID AS project_id_key
                FROM [dbo].[ProjectIDs] pid WITH (NOLOCK)
                WHERE pid.Type = 'Non Standard Well'
            {ProjectScopeSql("pid")}
            ),
            NonStandardWells AS (
                SELECT
                    wmr.pdo_well_id,
                    wmr.scr_no,
                    wmr.flaf_issue_date,
                    wmr.buffer_status,
                    wmr.[remark_status_area_of_attention_issues_]                                    AS remark,
                    wmr.[actual_rig_off_date]                                                        AS rig_off_date,
                    wmr.[actual_eng._completion_date]                                                AS eng_completion_date,
                    wmr.[actual_comm._finish_date_with_in_2_days_from_actual_engg._completion_date]  AS hookup_completion_date
                FROM [dbo].[WellMonitoringReport_Latest] wmr WITH (NOLOCK)
                INNER JOIN NonStandardProjects cp
                    ON wmr.project_id = CAST(cp.project_id_key AS NVARCHAR(50))
                WHERE (@from IS NULL OR TRY_CONVERT(DATE, wmr.[actual_rig_off_date]) >= @from)
                  AND (@to   IS NULL OR TRY_CONVERT(DATE, wmr.[actual_rig_off_date]) <= @to)
            ),
            Classified AS (
                SELECT
                    CASE WHEN (scr_no IS NOT NULL AND LTRIM(RTRIM(scr_no)) <> '')
                           OR (rig_off_date IS NOT NULL AND DATEADD(DAY, 80, rig_off_date) > CAST(GETDATE() AS DATE))
                           OR (flaf_issue_date IS NULL)
                         THEN 1 ELSE 0 END AS is_flaf_scr_delayed,
                    CASE WHEN remark LIKE '%PDO%'
                           OR buffer_status IN ('PDO Issue', 'On Hold')
                         THEN 1 ELSE 0 END AS is_pdo_issue,
                    CASE WHEN eng_completion_date IS NOT NULL
                           OR hookup_completion_date IS NOT NULL
                         THEN 1 ELSE 0 END AS is_hooked_up
                FROM NonStandardWells
            )
            SELECT
                COUNT(*)                                                                AS original_plan,
                SUM(is_flaf_scr_delayed)                                                AS flaf_scr_removed,
                COUNT(*) - SUM(is_flaf_scr_delayed)                                     AS after_flaf_scr,
                SUM(CASE WHEN is_flaf_scr_delayed = 0 THEN is_pdo_issue ELSE 0 END)     AS pdo_issues_removed,
                SUM(CASE WHEN is_flaf_scr_delayed = 0 AND is_pdo_issue = 0
                         THEN is_hooked_up ELSE 0 END)                                  AS hookup_completed
            FROM Classified;
            """;

        try
        {
            var connStr = db.Database.GetConnectionString()!;
            await using var conn = new SqlConnection(connStr);
            await OpenWithRetryAsync(conn, ct);
            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 120 };
            AddScopeParams(cmd, scope);

            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            if (!await rdr.ReadAsync(ct)) return null;

            int Col(string name) => rdr.IsDBNull(rdr.GetOrdinal(name)) ? 0 : Convert.ToInt32(rdr[name]);
            var originalPlan     = Col("original_plan");
            var flafScrRemoved   = Col("flaf_scr_removed");
            var afterFlafScr     = Col("after_flaf_scr");
            var pdoIssuesRemoved = Col("pdo_issues_removed");
            var hookupCompleted  = Col("hookup_completed");

            var cleanTarget = afterFlafScr - pdoIssuesRemoved;
            var backlog     = Math.Max(0, cleanTarget - hookupCompleted);
            var overallPct  = afterFlafScr > 0
                ? Math.Round((double)hookupCompleted / afterFlafScr * 100, 1)
                : 0;

            var dto = new HookupProgressDto(
                "non-standard",
                new HookupProgressKpiDto(hookupCompleted, 0, 0, originalPlan, 0, 0, 0, 0),
                new List<HookupWaterfallStepDto>
                {
                    new("PDO plan",         originalPlan),
                    new("FLAF/SCR",        -flafScrRemoved),
                    new("After FLAF/SCR",   afterFlafScr),
                    new("PDO issues",      -pdoIssuesRemoved),
                    new("Clean target",     cleanTarget),
                    new("Actual completed", hookupCompleted)
                },
                new HookupOverallDto(overallPct, 0, hookupCompleted, backlog, 0, originalPlan));

            cache.Set(cacheKey, dto, TimeSpan.FromMinutes(30));
            return dto;
        }
        catch (SqlException)
        {
            // DB unreachable / query failure — let the caller serve sample data.
            return null;
        }
    }

    /// <summary>
    /// Live Well-Conversions hook-up funnel, read from WellMonitoringReport_Latest joined to the
    /// 'Conversion with/without Flowline' ProjectIDs (project_id matched after stripping braces).
    /// Delay rules differ again: FLAF/SCR delayed if FLAF-to-rig-on or SCR-to-rig-on ≥ 28 days;
    /// PDO issue if an MOC was raised but not approved. Returns null on DB failure. Cached 30 min.
    /// </summary>
    private async Task<HookupProgressDto?> GetWellConversionsHookupProgressAsync(HookupScope scope, CancellationToken ct)
    {
        var cacheKey = $"hookup-progress:well-conversions:{ScopeKey(scope)}";
        if (cache.TryGetValue(cacheKey, out HookupProgressDto? cached) && cached is not null)
            return cached;

        // $$ raw string: SQL keeps single { } literals (brace-stripping); interpolation uses {{ }}.
        var sql = $$"""
            ;WITH ConversionProjects AS (
                SELECT
                    LOWER(REPLACE(REPLACE(CAST(pid.ID AS NVARCHAR(100)), '{', ''), '}', '')) AS project_id
                FROM dbo.ProjectIDs pid WITH (NOLOCK)
                WHERE pid.Type IN ('Conversion with Flowline', 'Conversion without Flowline')
            {{ProjectScopeSql("pid")}}
            ),
            WellConversions AS (
                SELECT
                    CASE
                        WHEN wd.flaf_issue_date IS NOT NULL
                             AND DATEDIFF(DAY,
                                     TRY_CAST(wd.flaf_issue_date AS DATE),
                                     ISNULL(w.[latest_exp.rig_on_location_sap_data], GETDATE())
                                 ) >= 28
                        THEN 1 ELSE 0
                    END AS Is_FLAF_Delayed,
                    CASE
                        WHEN w.scr_no IS NOT NULL AND w.scr_no <> ''
                             AND w.scr_date IS NOT NULL
                             AND DATEDIFF(DAY,
                                     w.scr_date,
                                     ISNULL(w.[latest_exp.rig_on_location_sap_data], GETDATE())
                                 ) >= 28
                        THEN 1 ELSE 0
                    END AS Is_SCR_Delayed,
                    CASE
                        WHEN w.moc_raised IS NOT NULL AND w.moc_raised <> ''
                             AND (w.moc_approved IS NULL OR w.moc_approved = '')
                        THEN 1 ELSE 0
                    END AS Has_PDO_Issue,
                    CASE
                        WHEN w.[actual_comm._finish_date_with_in_2_days_from_actual_engg._completion_date]
                             IS NOT NULL
                        THEN 1 ELSE 0
                    END AS Is_HookupCompleted,
                    CASE
                        WHEN w.actual_hoist_fbu_rsr_on_date IS NOT NULL
                             AND w.actual_hoist_fbu_rsr_off_date IS NULL
                        THEN 1 ELSE 0
                    END AS Is_Suspended
                FROM dbo.WellMonitoringReport_Latest w WITH (NOLOCK)
                INNER JOIN ConversionProjects cp
                    ON LOWER(REPLACE(REPLACE(w.project_id, '{', ''), '}', '')) = cp.project_id
                LEFT JOIN dbo.well_documents wd WITH (NOLOCK)
                    ON TRY_CAST(w.pdo_well_id AS BIGINT) = wd.wellid
                WHERE (@from IS NULL OR TRY_CONVERT(DATE, w.[actual_rig_off_date]) >= @from)
                  AND (@to   IS NULL OR TRY_CONVERT(DATE, w.[actual_rig_off_date]) <= @to)
            )
            SELECT
                COUNT(*)                                                                AS original_plan,
                SUM(CASE WHEN Is_FLAF_Delayed = 1 OR Is_SCR_Delayed = 1
                         THEN 1 ELSE 0 END)                                             AS flaf_scr_removed,
                COUNT(*) - SUM(CASE WHEN Is_FLAF_Delayed = 1 OR Is_SCR_Delayed = 1
                                    THEN 1 ELSE 0 END)                                  AS after_flaf_scr,
                SUM(Has_PDO_Issue)                                                      AS pdo_issues_removed,
                SUM(Is_HookupCompleted)                                                 AS hookup_completed,
                SUM(Is_Suspended)                                                       AS suspended_hookups,
                COUNT(*) - SUM(Is_HookupCompleted) - SUM(Is_Suspended)                  AS backlog_in_hookup
            FROM WellConversions;
            """;

        try
        {
            var connStr = db.Database.GetConnectionString()!;
            await using var conn = new SqlConnection(connStr);
            await OpenWithRetryAsync(conn, ct);
            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 120 };
            AddScopeParams(cmd, scope);

            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            if (!await rdr.ReadAsync(ct)) return null;

            int Col(string name) => rdr.IsDBNull(rdr.GetOrdinal(name)) ? 0 : Convert.ToInt32(rdr[name]);
            var originalPlan     = Col("original_plan");
            var flafScrRemoved   = Col("flaf_scr_removed");
            var afterFlafScr     = Col("after_flaf_scr");
            var pdoIssuesRemoved = Col("pdo_issues_removed");
            var hookupCompleted  = Col("hookup_completed");
            var suspended        = Col("suspended_hookups");
            var backlogInHookup  = Col("backlog_in_hookup");

            var cleanTarget = afterFlafScr - pdoIssuesRemoved;
            var backlog     = Math.Max(0, cleanTarget - hookupCompleted);
            var overallPct  = afterFlafScr > 0
                ? Math.Round((double)hookupCompleted / afterFlafScr * 100, 1)
                : 0;

            var dto = new HookupProgressDto(
                "well-conversions",
                new HookupProgressKpiDto(hookupCompleted, 0, suspended, originalPlan, 0, 0, 0, 0),
                new List<HookupWaterfallStepDto>
                {
                    new("PDO plan",         originalPlan),
                    new("FLAF/SCR",        -flafScrRemoved),
                    new("After FLAF/SCR",   afterFlafScr),
                    new("PDO issues",      -pdoIssuesRemoved),
                    new("Clean target",     cleanTarget),
                    new("Actual completed", hookupCompleted)
                },
                new HookupOverallDto(overallPct, 0, hookupCompleted, backlogInHookup, suspended, originalPlan));

            cache.Set(cacheKey, dto, TimeSpan.FromMinutes(30));
            return dto;
        }
        catch (SqlException)
        {
            // DB unreachable / query failure — let the caller serve sample data.
            return null;
        }
    }

    // ─── Crew PI Rating Heatmap ──────────────────────────────────────────────

    /// <summary>One daily PI observation for a crew, read from the dbo.PH_Productivity view.</summary>
    private sealed record CrewPiRaw(string Crew, DateOnly Date, int Rating);

    // Display caps so the heatmap stays readable — most recent columns per period.
    private const int CrewPiDayCols   = 7;
    private const int CrewPiWeekCols  = 8;
    private const int CrewPiMonthCols = 6;

    // P-rating colour stops (P0 red → P8 green) shared with the client colour axis.
    private static string CrewPiColor(int rating) => rating switch
    {
        >= 7 => "#15803D",
        6    => "#22C55E",
        >= 4 => "#EAB308",
        >= 2 => "#F97316",
        _    => "#DC2626",
    };

    public async Task<CrewPiHeatmapResponse> GetCrewPiHeatmapAsync(
        string?   cluster  = null,
        string?   wellType = null,
        string?   wellId   = null,
        DateOnly? from     = null,
        DateOnly? to       = null,
        CancellationToken ct = default)
    {
        var today     = DateOnly.FromDateTime(DateTime.UtcNow);
        var startDate = from ?? today.AddDays(-180);
        var endDate   = to   ?? today;

        var cacheKey = $"crew-pi-heatmap:{cluster ?? "all"}:{wellType ?? "all"}:{wellId ?? "all"}:{startDate}:{endDate}";
        if (cache.TryGetValue(cacheKey, out CrewPiHeatmapResponse? cached) && cached is not null)
            return cached;

        // PI label = PI (T-Wise), falling back to PI (CMR). Both are stored as text and are
        // frequently blank (empty string, not NULL), so NULLIF(TRIM(..),'') is required to skip them.
        const string PiExpr =
            "COALESCE(NULLIF(LTRIM(RTRIM([PI (T-Wise)])), ''), NULLIF(LTRIM(RTRIM([PI (CMR)])), ''))";

        var sql = $"""
            SELECT [Crew Type] AS crew, [Date] AS dt, {PiExpr} AS pi
            FROM [dbo].[PH_Productivity] WITH (NOLOCK)
            WHERE [Date] >= @from AND [Date] <= @to
              AND [Crew Type] IS NOT NULL AND LTRIM(RTRIM([Crew Type])) <> ''
              AND {PiExpr} IS NOT NULL
            """;

        var raw = new List<CrewPiRaw>();
        try
        {
            var connStr = db.Database.GetConnectionString()!;
            await using var conn = new SqlConnection(connStr);
            await OpenWithRetryAsync(conn, ct);

            // PH_Productivity has no well/cluster columns. When the page's cluster / WELL TYPE /
            // WELL ID filters are active, resolve them to the set of crew_types that worked the
            // matching wells via task_daily u2192 ProjectIDs ([Cluster] and [Type] columns).
            // dashboard widgets: first word = cluster, remainder = well type). Crews outside that
            // set are then dropped from the heatmap.
            HashSet<string>? allowedCrews = null;
            if (!string.IsNullOrWhiteSpace(cluster) || !string.IsNullOrWhiteSpace(wellType) || !string.IsNullOrWhiteSpace(wellId))
                allowedCrews = await LoadCrewTypesForWellFilterAsync(conn, cluster, wellType, wellId, startDate, ct);

            // A filter that matches no crews → empty heatmap (honest, not "all crews").
            if (allowedCrews is { Count: 0 })
                return CacheAndReturnEmptyCrewPi(cacheKey);

            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 60 };
            cmd.Parameters.Add(new SqlParameter("@from", System.Data.SqlDbType.Date) { Value = startDate.ToDateTime(TimeOnly.MinValue) });
            cmd.Parameters.Add(new SqlParameter("@to",   System.Data.SqlDbType.Date) { Value = endDate.ToDateTime(TimeOnly.MinValue) });

            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
            {
                if (rdr.IsDBNull(0) || rdr.IsDBNull(1) || rdr.IsDBNull(2)) continue;
                var crew = rdr.GetString(0).Trim();
                if (allowedCrews is not null && !allowedCrews.Contains(crew)) continue;
                if (!TryParsePRating(rdr.GetString(2), out var rating)) continue;
                raw.Add(new CrewPiRaw(crew, DateOnly.FromDateTime(rdr.GetDateTime(1)), rating));
            }
        }
        catch (SqlException)
        {
            // View/DB unreachable — return an empty payload so the client falls back to its
            // built-in sample data without erroring.
            raw = new List<CrewPiRaw>();
        }

        var day   = BuildCrewPiPeriod(raw, "Day",   CrewPiDayCols);
        var week  = BuildCrewPiPeriod(raw, "Week",  CrewPiWeekCols);
        var month = BuildCrewPiPeriod(raw, "Month", CrewPiMonthCols);

        var kpis     = BuildCrewPiKpis(raw, week);
        var insights = BuildCrewPiInsights(kpis);

        var response = new CrewPiHeatmapResponse(kpis, day, week, month, insights);

        // Only cache populated results so an empty/transient miss is re-tried next request.
        if (week.Rows.Count > 0 || day.Rows.Count > 0 || month.Rows.Count > 0)
            cache.Set(cacheKey, response, TimeSpan.FromMinutes(30));

        return response;
    }

    /// <summary>Builds an empty heatmap payload (used when an active well filter matches no crews).</summary>
    private CrewPiHeatmapResponse CacheAndReturnEmptyCrewPi(string cacheKey)
    {
        var empty = new CrewPiPeriodDto(Array.Empty<string>(), Array.Empty<CrewPiRowDto>(), Array.Empty<CrewPiDistributionDto>());
        var resp = new CrewPiHeatmapResponse(
            new CrewPiKpisDto(0, "0.0", "0.0", "—", "0.0", "—", "0.0", 0, 0),
            empty, empty, empty, Array.Empty<string>());
        cache.Set(cacheKey, resp, TimeSpan.FromMinutes(30));
        return resp;
    }

    /// <summary>
    /// Resolves the page's cluster / well-type / well-id filters to the set of crew_types that
    /// worked the matching wells, via task_daily u2192 ProjectIDs ([Cluster] and [Type] columns).
    /// by the other dashboard widgets (first word = cluster, remainder = well type).
    /// </summary>
    private static async Task<HashSet<string>> LoadCrewTypesForWellFilterAsync(
        SqlConnection conn, string? cluster, string? wellType, string? wellId, DateOnly startDate, CancellationToken ct)
    {
        var where = new List<string>
        {
            "t.crew_type IS NOT NULL AND LTRIM(RTRIM(t.crew_type)) <> ''",
            "t.ActionOn >= @tdFrom",
        };
        if (!string.IsNullOrWhiteSpace(wellId))   where.Add("t.well_id = @wellId");
        if (!string.IsNullOrWhiteSpace(cluster))  where.Add("LTRIM(RTRIM(p.[Cluster])) = @cluster");
        if (!string.IsNullOrWhiteSpace(wellType)) where.Add("LTRIM(RTRIM(p.[Type])) = @wellType");

        var sql = $"""
            SELECT DISTINCT LTRIM(RTRIM(t.crew_type))
            FROM dbo.task_daily t WITH (NOLOCK)
            LEFT JOIN (SELECT ID, MIN([Cluster]) AS [Cluster] FROM dbo.ProjectIDs WITH (NOLOCK) GROUP BY ID) p
                ON t.project_id = p.ID
            WHERE {string.Join(" AND ", where)}
            """;

        await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 60 };
        cmd.Parameters.Add(new SqlParameter("@tdFrom", System.Data.SqlDbType.DateTime) { Value = startDate.ToDateTime(TimeOnly.MinValue) });
        if (!string.IsNullOrWhiteSpace(wellId))   cmd.Parameters.AddWithValue("@wellId", wellId);
        if (!string.IsNullOrWhiteSpace(cluster))  cmd.Parameters.AddWithValue("@cluster", cluster);
        if (!string.IsNullOrWhiteSpace(wellType)) cmd.Parameters.AddWithValue("@wellType", wellType);

        var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        await using var rdr = await cmd.ExecuteReaderAsync(ct);
        while (await rdr.ReadAsync(ct))
            if (!rdr.IsDBNull(0)) set.Add(rdr.GetString(0).Trim());
        return set;
    }

    /// <summary>Parse a "P0".."P8" label into 0..8. Returns false for blanks / unexpected text.</summary>
    private static bool TryParsePRating(string? label, out int rating)
    {
        rating = 0;
        if (string.IsNullOrWhiteSpace(label)) return false;
        var s = label.Trim().TrimStart('P', 'p');
        if (!int.TryParse(s, out var n)) return false;
        rating = Math.Clamp(n, 0, 8);
        return true;
    }

    /// <summary>Snap a daily date to its period column: the day itself, the Monday of its week, or the 1st of its month.</summary>
    private static DateOnly CrewPiBucketStart(string period, DateOnly d) => period.ToLowerInvariant() switch
    {
        "week"  => d.AddDays(-(((int)d.DayOfWeek + 6) % 7)), // Monday-start week
        "month" => new DateOnly(d.Year, d.Month, 1),
        _       => d,                                        // day
    };

    private static CrewPiPeriodDto BuildCrewPiPeriod(List<CrewPiRaw> raw, string period, int maxCols)
    {
        if (raw.Count == 0)
            return new CrewPiPeriodDto(Array.Empty<string>(), Array.Empty<CrewPiRowDto>(), Array.Empty<CrewPiDistributionDto>());

        // Roll the daily observations up into this period's columns.
        var bucketed = raw.Select(r => (r.Crew, Bucket: CrewPiBucketStart(period, r.Date), r.Rating)).ToList();

        // Columns = most recent N distinct buckets, oldest → newest (left → right).
        var dates = bucketed.Select(b => b.Bucket).Distinct().OrderByDescending(d => d)
                            .Take(maxCols).OrderBy(d => d).ToList();
        if (dates.Count == 0)
            return new CrewPiPeriodDto(Array.Empty<string>(), Array.Empty<CrewPiRowDto>(), Array.Empty<CrewPiDistributionDto>());

        var dateIndex = dates.Select((d, i) => (d, i)).ToDictionary(x => x.d, x => x.i);
        var columns   = dates.Select((d, i) => FormatCrewPiColumn(period, d, i + 1)).ToList();

        var crewRows = new List<CrewPiRowDto>();
        foreach (var grp in bucketed.GroupBy(b => b.Crew))
        {
            var vals        = new int?[dates.Count];   // null = no data for that crew in that bucket
            var presentVals = new List<double>();
            // Each cell = average PI of all the crew's individuals within that bucket.
            foreach (var cell in grp.GroupBy(b => b.Bucket))
            {
                if (!dateIndex.TryGetValue(cell.Key, out var ci)) continue;
                var a = cell.Average(x => x.Rating);
                vals[ci] = Math.Clamp((int)Math.Round(a), 0, 8);
                presentVals.Add(a);
            }

            if (presentVals.Count == 0) continue;
            var avg = Math.Round(presentVals.Average(), 1);
            crewRows.Add(new CrewPiRowDto(grp.Key, avg, vals));
        }

        crewRows = crewRows.OrderByDescending(r => r.Avg).ThenBy(r => r.Crew).ToList();
        var distribution = BuildCrewPiDistribution(crewRows);

        return new CrewPiPeriodDto(columns, crewRows, distribution);
    }

    private static string FormatCrewPiColumn(string period, DateOnly d, int ordinal)
    {
        var dt = d.ToDateTime(TimeOnly.MinValue);
        return period.ToLowerInvariant() switch
        {
            "day"   => $"{dt:ddd}\n{dt:dd MMM}",
            "week"  => $"W{ordinal}\n{dt:dd MMM} - {dt.AddDays(6):dd MMM}",
            "month" => $"{dt:MMM} '{dt:yy}",
            _       => dt.ToString("dd MMM"),
        };
    }

    private static IReadOnlyList<CrewPiDistributionDto> BuildCrewPiDistribution(List<CrewPiRowDto> rows)
    {
        if (rows.Count == 0) return Array.Empty<CrewPiDistributionDto>();

        var buckets = new (string Range, Func<int, bool> Match, string Color)[]
        {
            ("P8 - P7", n => n >= 7,            "#15803D"),
            ("P6",      n => n == 6,            "#22C55E"),
            ("P5 - P4", n => n is 4 or 5,       "#EAB308"),
            ("P3 - P2", n => n is 2 or 3,       "#F97316"),
            ("P1 - P0", n => n <= 1,            "#DC2626"),
        };

        var rounded = rows.Select(r => (int)Math.Round(r.Avg)).ToList();
        return buckets.Select(b =>
        {
            var count = rounded.Count(b.Match);
            var pct   = (int)Math.Round(count * 100.0 / rows.Count);
            return new CrewPiDistributionDto(b.Range, count, pct, b.Color);
        }).ToList();
    }

    private static CrewPiKpisDto BuildCrewPiKpis(List<CrewPiRaw> raw, CrewPiPeriodDto week)
    {
        var totalCrews = raw.Select(r => r.Crew).Distinct(StringComparer.OrdinalIgnoreCase).Count();

        if (week.Rows.Count == 0)
            return new CrewPiKpisDto(totalCrews, "0.0", "0.0", "—", "0.0", "—", "0.0", 0, 0);

        var top = week.Rows.First();              // already sorted desc
        var low = week.Rows.Last();
        var avg = Math.Round(week.Rows.Average(r => r.Avg), 1);

        // Delta = latest column average vs previous column average across all crews (ignoring no-data cells).
        var cols = week.Columns.Count;
        string delta = "0.0";
        if (cols >= 2)
        {
            var lastCol = week.Rows.Where(r => r.Vals.Count == cols).Select(r => r.Vals[cols - 1]).Where(v => v.HasValue).Select(v => v!.Value).ToList();
            var prevCol = week.Rows.Where(r => r.Vals.Count == cols).Select(r => r.Vals[cols - 2]).Where(v => v.HasValue).Select(v => v!.Value).ToList();
            if (lastCol.Count > 0 && prevCol.Count > 0)
                delta = Math.Round(lastCol.Average() - prevCol.Average(), 1).ToString("0.0", System.Globalization.CultureInfo.InvariantCulture);
        }

        var belowP3    = week.Rows.Count(r => r.Avg < 3);
        var belowP3Pct = (int)Math.Round(belowP3 * 100.0 / week.Rows.Count);

        string F(double v) => v.ToString("0.0", System.Globalization.CultureInfo.InvariantCulture);
        return new CrewPiKpisDto(
            totalCrews, F(avg), delta,
            top.Crew, F(top.Avg),
            low.Crew, F(low.Avg),
            belowP3, belowP3Pct);
    }

    private static IReadOnlyList<string> BuildCrewPiInsights(CrewPiKpisDto k)
    {
        if (k.TopCrew == "—") return Array.Empty<string>();
        var deltaVal = double.TryParse(k.AvgDelta, System.Globalization.NumberStyles.Any,
            System.Globalization.CultureInfo.InvariantCulture, out var d) ? d : 0;
        var dir = deltaVal >= 0 ? "improved" : "declined";
        return new[]
        {
            $"{k.TopCrew} is the top performer at P{k.TopRating}.",
            $"{k.LowCrew} is the lowest at P{k.LowRating} and needs attention.",
            $"Overall average PI Rating {dir} by {Math.Abs(deltaVal):0.0} compared to the previous period.",
        };
    }
}

