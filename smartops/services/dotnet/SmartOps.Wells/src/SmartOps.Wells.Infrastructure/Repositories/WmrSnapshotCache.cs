using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace SmartOps.Wells.Infrastructure.Repositories;

/// <summary>
/// A single WMR row (latest per well) with pre-cast typed fields.
/// Eliminates repeated TRY_CAST and full-table scans on the WMR heap.
/// </summary>
public sealed record WmrSnapshotRow(
    string WellId,
    string? ProjectId,
    string? Rig,
    string? WellLocation,
    string? WellType,
    double Progress,
    DateOnly? RigOnDate,
    DateOnly? RigOffDate,
    DateOnly? FlafDate,
    DateOnly? EngCompletionDate,
    DateOnly? WeekDate,
    string? LocPrepStatus,
    string? FlStatus,
    string? CommStatus,
    double LocPrepPct,
    double FlPct,
    double CommPct,
    double OhlPct,
    string? BufferStatus);

/// <summary>
/// A single SAP drilling sequence entry (one per Well_ID + Earl_start_date).
/// Not pre-aggregated — consumers filter by date range then GROUP BY Well_ID.
/// </summary>
public sealed record SapPlanRow(
    string WellId,
    DateOnly PlanStart,
    DateOnly? PlanEnd);

/// <summary>
/// In-memory singleton holding the latest WMR snapshot and SAP plan data.
/// Refreshed every 10 minutes by <see cref="WmrSnapshotCacheLoader"/>.
/// All wells-readiness computations read from this instead of hitting the DB.
/// </summary>
public sealed class WmrSnapshotCache
{
    public static readonly WmrSnapshotCache Instance = new();

    private volatile IReadOnlyList<WmrSnapshotRow> _wmrRows = Array.Empty<WmrSnapshotRow>();
    private volatile IReadOnlyDictionary<string, WmrSnapshotRow> _wmrByWell =
        new Dictionary<string, WmrSnapshotRow>(StringComparer.OrdinalIgnoreCase);
    private volatile IReadOnlyList<SapPlanRow> _sapRows = Array.Empty<SapPlanRow>();
    private volatile IReadOnlyDictionary<string, SapPlanRow> _sapByWell =
        new Dictionary<string, SapPlanRow>(StringComparer.OrdinalIgnoreCase);
    // ProjectId → (Cluster, Type, Project) lookup
    private volatile IReadOnlyDictionary<string, (string Cluster, string WellType, string Project)> _projectInfo =
        new Dictionary<string, (string, string, string)>(StringComparer.OrdinalIgnoreCase);
    // Wells with PDO issues (from WellMonitoringReportOptimized.reason_if_kpi_not_met)
    private volatile IReadOnlySet<string> _pdoIssueWells = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

    public bool IsReady => _wmrRows.Count > 0;
    public DateTime? LastRefresh { get; private set; }

    public IReadOnlyList<WmrSnapshotRow> WmrRows => _wmrRows;
    public IReadOnlyDictionary<string, WmrSnapshotRow> WmrByWell => _wmrByWell;
    public IReadOnlyList<SapPlanRow> SapRows => _sapRows;
    public IReadOnlyDictionary<string, SapPlanRow> SapByWell => _sapByWell;
    public IReadOnlyDictionary<string, (string Cluster, string WellType, string Project)> ProjectInfo => _projectInfo;
    public IReadOnlySet<string> PdoIssueWells => _pdoIssueWells;

    public void Update(
        IReadOnlyList<WmrSnapshotRow> wmrRows,
        IReadOnlyList<SapPlanRow> sapRows,
        IReadOnlyDictionary<string, (string Cluster, string WellType, string Project)> projectInfo,
        IReadOnlySet<string>? pdoIssueWells = null)
    {
        var wmrDict = new Dictionary<string, WmrSnapshotRow>(wmrRows.Count, StringComparer.OrdinalIgnoreCase);
        foreach (var r in wmrRows)
            wmrDict.TryAdd(r.WellId, r); // first = latest due to ORDER BY in SQL

        var sapDict = new Dictionary<string, SapPlanRow>(sapRows.Count, StringComparer.OrdinalIgnoreCase);
        foreach (var r in sapRows)
            sapDict.TryAdd(r.WellId, r);

        _wmrRows = wmrRows;
        _wmrByWell = wmrDict;
        _sapRows = sapRows;
        _sapByWell = sapDict;
        _projectInfo = projectInfo;
        if (pdoIssueWells is not null) _pdoIssueWells = pdoIssueWells;
        LastRefresh = DateTime.UtcNow;
    }

    /// <summary>
    /// Resolve cluster name for a project_id.
    /// </summary>
    public string? GetCluster(string? projectId)
    {
        if (string.IsNullOrWhiteSpace(projectId)) return null;
        return _projectInfo.TryGetValue(projectId, out var info) ? info.Cluster : null;
    }

    /// <summary>
    /// Resolve well type for a project_id.
    /// </summary>
    public string? GetWellType(string? projectId)
    {
        if (string.IsNullOrWhiteSpace(projectId)) return null;
        return _projectInfo.TryGetValue(projectId, out var info) ? info.WellType : null;
    }

    /// <summary>
    /// Resolve project name for a project_id.
    /// </summary>
    public string? GetProject(string? projectId)
    {
        if (string.IsNullOrWhiteSpace(projectId)) return null;
        return _projectInfo.TryGetValue(projectId, out var info) ? info.Project : null;
    }
}

/// <summary>
/// Background service that loads the WMR "latest per well" snapshot + SAP plan
/// into <see cref="WmrSnapshotCache"/> on startup and refreshes every 10 minutes.
/// This eliminates the expensive per-request full-table scans on the WMR heap.
/// </summary>
public sealed class WmrSnapshotCacheLoader(
    IConfiguration config,
    ILogger<WmrSnapshotCacheLoader> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Small delay for app startup
        await Task.Delay(TimeSpan.FromSeconds(2), stoppingToken);

        while (!stoppingToken.IsCancellationRequested)
        {
            await LoadSnapshot(stoppingToken);
            // Refresh every 10 minutes — WMR data changes weekly at most
            await Task.Delay(TimeSpan.FromMinutes(10), stoppingToken);
        }
    }

    private async Task LoadSnapshot(CancellationToken ct)
    {
        try
        {
            var sw = System.Diagnostics.Stopwatch.StartNew();
            var cs = config.GetConnectionString("Default");
            if (string.IsNullOrWhiteSpace(cs))
            {
                log.LogWarning("WmrSnapshotCacheLoader: No connection string, skipping.");
                return;
            }

            await using var conn = new SqlConnection(cs);
            await conn.OpenAsync(ct);

            // 1. Load ProjectIDs lookup (small table)
            var projectInfo = await LoadProjectInfo(conn, ct);

            // 2. Load latest WMR row per well (single full scan, pre-cast all dates)
            var wmrRows = await LoadWmrLatest(conn, ct);

            // 3. Load SAP plan rows (earliest start + latest end per well)
            var sapRows = await LoadSapPlan(conn, ct);

            // 4. Load PDO issue wells from WellMonitoringReportOptimized
            var pdoIssueWells = await LoadPdoIssueWells(conn, ct);

            WmrSnapshotCache.Instance.Update(wmrRows, sapRows, projectInfo, pdoIssueWells);
            sw.Stop();
            log.LogInformation(
                "WmrSnapshotCacheLoader: loaded {WmrCount} WMR rows, {SapCount} SAP rows, {ProjCount} projects, {PdoCount} PDO-issue wells in {Elapsed:F1}s",
                wmrRows.Count, sapRows.Count, projectInfo.Count, pdoIssueWells.Count, sw.Elapsed.TotalSeconds);
        }
        catch (Exception ex)
        {
            log.LogWarning(ex, "WmrSnapshotCacheLoader: failed to load snapshot");
        }
    }

    private static async Task<IReadOnlyDictionary<string, (string Cluster, string WellType, string Project)>> LoadProjectInfo(
        SqlConnection conn, CancellationToken ct)
    {
        const string sql = """
            SELECT CAST(ID AS NVARCHAR(100)) AS ProjId,
                   LTRIM(RTRIM([Cluster])) AS Cluster,
                   LTRIM(RTRIM([Type])) AS WellType,
                   LTRIM(RTRIM([Project])) AS Project
            FROM [dbo].[ProjectIDs] WITH (NOLOCK)
            WHERE ID IS NOT NULL
            """;

        await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
        await using var rdr = await cmd.ExecuteReaderAsync(ct);
        var dict = new Dictionary<string, (string, string, string)>(200, StringComparer.OrdinalIgnoreCase);
        while (await rdr.ReadAsync(ct))
        {
            var projId = rdr.IsDBNull(0) ? null : rdr.GetString(0);
            var cluster = rdr.IsDBNull(1) ? "" : rdr.GetString(1);
            var wellType = rdr.IsDBNull(2) ? "" : rdr.GetString(2);
            var project = rdr.IsDBNull(3) ? "" : rdr.GetString(3);
            if (!string.IsNullOrWhiteSpace(projId))
                dict.TryAdd(projId, (cluster, wellType, project));
        }
        return dict;
    }

    private static async Task<IReadOnlyList<WmrSnapshotRow>> LoadWmrLatest(
        SqlConnection conn, CancellationToken ct)
    {
        // Single full scan of WMR with ROW_NUMBER to get latest row per well.
        // All TRY_CAST happens once here, never again at query time.
        const string sql = """
            SELECT pdo_well_id, project_id, rig_no, well_location, well_type,
                   Progress, RigOn, RigOff, FlafDate, EngCompletion, WeekDate,
                   loc_status, fl_status, comm_status,
                   loc_pct, fl_pct, comm_pct, ohl_pct, buffer_status
            FROM (
                SELECT w.pdo_well_id,
                       w.project_id,
                       w.rig_no,
                       w.well_location,
                       w.well_type,
                       COALESCE(TRY_CAST(w.over_all_progress_percentages AS FLOAT), 0) AS Progress,
                       TRY_CAST(w.actual_rig_on_date AS DATE) AS RigOn,
                       TRY_CAST(w.actual_rig_off_date AS DATE) AS RigOff,
                       TRY_CAST(w.flaf_issue_date AS DATE) AS FlafDate,
                       TRY_CAST(w.[actual_eng._completion_date] AS DATE) AS EngCompletion,
                       TRY_CAST(w.Week_Number AS DATE) AS WeekDate,
                       w.[location_preparation_status_in_progress_completed] AS loc_status,
                       w.[flow_line_const._status_in_progress_completed] AS fl_status,
                       w.[flow_line_commi._status_in_progress_completed] AS comm_status,
                       COALESCE(TRY_CAST(w.[overall_loc._preparation_10_100] AS FLOAT), 0) AS loc_pct,
                       COALESCE(TRY_CAST(w.[overall_const._10_100] AS FLOAT), 0) AS fl_pct,
                       COALESCE(TRY_CAST(w.[overall_comm_progress_100] AS FLOAT), 0) AS comm_pct,
                       COALESCE(TRY_CAST(w.ohl_progress AS FLOAT), 0) AS ohl_pct,
                       w.buffer_status,
                       ROW_NUMBER() OVER (
                           PARTITION BY w.pdo_well_id
                            ORDER BY TRY_CAST(w.Week_Number AS DATE) DESC, w.project_id
                       ) AS rn
                FROM dbo.WMR w WITH (NOLOCK)
                WHERE w.pdo_well_id IS NOT NULL AND w.pdo_well_id <> ''
                  AND TRY_CAST(w.Week_Number AS DATE) IS NOT NULL
            ) ranked
            WHERE rn = 1
            """;

        await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 120 };
        await using var rdr = await cmd.ExecuteReaderAsync(ct);
        var rows = new List<WmrSnapshotRow>(500);
        while (await rdr.ReadAsync(ct))
        {
            rows.Add(new WmrSnapshotRow(
                WellId: rdr.GetString(0),
                ProjectId: rdr.IsDBNull(1) ? null : rdr.GetString(1),
                Rig: rdr.IsDBNull(2) ? null : rdr.GetString(2),
                WellLocation: rdr.IsDBNull(3) ? null : rdr.GetString(3),
                WellType: rdr.IsDBNull(4) ? null : rdr.GetString(4),
                Progress: rdr.IsDBNull(5) ? 0 : rdr.GetDouble(5),
                RigOnDate: rdr.IsDBNull(6) ? null : DateOnly.FromDateTime(rdr.GetDateTime(6)),
                RigOffDate: rdr.IsDBNull(7) ? null : DateOnly.FromDateTime(rdr.GetDateTime(7)),
                FlafDate: rdr.IsDBNull(8) ? null : DateOnly.FromDateTime(rdr.GetDateTime(8)),
                EngCompletionDate: rdr.IsDBNull(9) ? null : DateOnly.FromDateTime(rdr.GetDateTime(9)),
                WeekDate: rdr.IsDBNull(10) ? null : DateOnly.FromDateTime(rdr.GetDateTime(10)),
                LocPrepStatus: rdr.IsDBNull(11) ? null : rdr.GetString(11),
                FlStatus: rdr.IsDBNull(12) ? null : rdr.GetString(12),
                CommStatus: rdr.IsDBNull(13) ? null : rdr.GetString(13),
                LocPrepPct: rdr.IsDBNull(14) ? 0 : rdr.GetDouble(14),
                FlPct: rdr.IsDBNull(15) ? 0 : rdr.GetDouble(15),
                CommPct: rdr.IsDBNull(16) ? 0 : rdr.GetDouble(16),
                OhlPct: rdr.IsDBNull(17) ? 0 : rdr.GetDouble(17),
                BufferStatus: rdr.IsDBNull(18) ? null : rdr.GetString(18)));
        }
        return rows;
    }

    private static async Task<IReadOnlySet<string>> LoadPdoIssueWells(
        SqlConnection conn, CancellationToken ct)
    {
        // Wells where reason_if_kpi_not_met matches known PDO issue keywords.
        const string sql = """
            SELECT DISTINCT pdo_well_id
            FROM [dbo].[WellMonitoringReportOptimized] WITH (NOLOCK)
            WHERE pdo_well_id IS NOT NULL AND pdo_well_id <> ''
              AND reason_if_kpi_not_met IS NOT NULL AND LTRIM(RTRIM(reason_if_kpi_not_met)) <> ''
              AND (
                  LOWER(LTRIM(RTRIM(reason_if_kpi_not_met))) IN (
                      'awaiting handover', 'awaiting manifold', 'msv',
                      'material availability', 'scope change',
                      'operation issue', 'appraisal well', 'technical issue'
                  )
                  OR LOWER(reason_if_kpi_not_met) LIKE '%rsr%'
                  OR LOWER(reason_if_kpi_not_met) LIKE '%hoist delay%'
              )
            """;

        await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
        await using var rdr = await cmd.ExecuteReaderAsync(ct);
        var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        while (await rdr.ReadAsync(ct))
        {
            if (!rdr.IsDBNull(0)) set.Add(rdr.GetString(0));
        }
        return set;
    }

    private static async Task<IReadOnlyList<SapPlanRow>> LoadSapPlan(
        SqlConnection conn, CancellationToken ct)
    {
        // Load individual SAP entries (not pre-aggregated) so that date-range
        // filtering can happen at query time — matching the SQL CTE which filters
        // Earl_start_date to the requested range BEFORE grouping by Well_ID.
        const string sql = """
            SELECT Well_ID,
                   TRY_CAST(Earl_start_date AS DATE) AS PlanStart,
                   TRY_CAST(EarliestEndDate AS DATE) AS PlanEnd
            FROM dbo.SAP_DRILLING_SEQUENCE_History WITH (NOLOCK)
            WHERE Well_ID IS NOT NULL AND Well_ID <> ''
              AND Well_Function NOT IN ('Unspecified', 'RIG MOVE', 'RIG MAINTENANCE')
              AND TRY_CAST(Earl_start_date AS DATE) IS NOT NULL
            """;

        await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 60 };
        await using var rdr = await cmd.ExecuteReaderAsync(ct);
        var rows = new List<SapPlanRow>(2000);
        while (await rdr.ReadAsync(ct))
        {
            if (rdr.IsDBNull(0) || rdr.IsDBNull(1)) continue;
            rows.Add(new SapPlanRow(
                WellId: rdr.GetString(0),
                PlanStart: DateOnly.FromDateTime(rdr.GetDateTime(1)),
                PlanEnd: rdr.IsDBNull(2) ? null : DateOnly.FromDateTime(rdr.GetDateTime(2))));
        }
        return rows;
    }
}
