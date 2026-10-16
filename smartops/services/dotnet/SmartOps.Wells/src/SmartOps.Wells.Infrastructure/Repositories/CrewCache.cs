using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace SmartOps.Wells.Infrastructure.Repositories;

public record CrewCacheRow(
    string CrewCode,
    string? CrewType,
    string? WellId,
    string? CrewName,
    string? Discipline,
    string? Activity,
    string? Leader,
    string? Cluster,
    string? PRating,
    double? Productivity,
    string Status,
    DateTime LastActionOn,
    string? ProjectId = null,
    DateTime? ActualStart = null);

public sealed class CrewCache
{
    public static readonly CrewCache Instance = new();

    private volatile IReadOnlyList<CrewCacheRow> _rows = Array.Empty<CrewCacheRow>();

    /// <summary>
    /// All distinct project_ids associated with each crew_code (across all rows).
    /// Used for cluster filtering to avoid MAX(project_id) losing information.
    /// </summary>
    private volatile IReadOnlyDictionary<string, HashSet<string>> _crewProjectIds =
        new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase);

    private volatile IReadOnlyList<SmartOps.Wells.Contracts.CrewPRatingDistributionDto> _pRatingDistribution =
        Array.Empty<SmartOps.Wells.Contracts.CrewPRatingDistributionDto>();

    /// <summary>
    /// True only after the enrichment batch (joining PH_PRODUCTIVITY_WEEKLY_REPORT) has
    /// completed at least once and written P-rating data into the cache.
    /// Base-load rows have PRating = null and must not be served as the final P-rating result.
    /// </summary>
    private volatile bool _isEnriched;
    private long _hitCount;
    private long _hitCountAtLastRefresh;
    private DateTime _lastHitTime = DateTime.MinValue;

    private volatile string[] _crewGroupCodes = Array.Empty<string>();

    public IReadOnlyList<CrewCacheRow> Rows => _rows;
    public bool IsReady => _rows.Count > 0;

    /// <summary>
    /// False until the slow enrichment batch has succeeded at least once.
    /// P-rating APIs must not serve base-only data (all Unrated) — wait for this flag.
    /// </summary>
    public bool IsEnriched => _isEnriched;

    /// <summary>Called by CrewCacheLoader after a successful enrichment batch.</summary>
    public void MarkEnriched() => _isEnriched = true;

    /// <summary>
    /// Called immediately after publishing base rows at the start of each refresh cycle.
    /// Resets IsEnriched so the API does not serve stale base-only data while the
    /// enrichment batch is running on subsequent refresh cycles.
    /// </summary>
    public void MarkPending() => _isEnriched = false;

    /// <summary>
    /// All distinct project_ids per crew_code — used for cluster filtering.
    /// </summary>
    public IReadOnlyDictionary<string, HashSet<string>> CrewProjectIds => _crewProjectIds;

    /// <summary>
    /// Crew group codes from OLD_NEW_CREW_MAPPING — the master list used by the Dashboard KPI.
    /// </summary>
    public string[] CrewGroupCodes => _crewGroupCodes;

    public void UpdateCrewGroupCodes(string[] codes)
    {
        _crewGroupCodes = codes;
    }

    public void UpdateCrewProjectIds(IReadOnlyDictionary<string, HashSet<string>> map)
    {
        _crewProjectIds = map;
    }

     /// <summary>
    /// Pre-computed P-Rating distribution (non-empty only after enrichment completes).
    /// Computed in-process with zero DB round-trips.
    /// </summary>
    public IReadOnlyList<SmartOps.Wells.Contracts.CrewPRatingDistributionDto> PratingDistribution
        => _pRatingDistribution;
    public DateTime? LastRefresh { get; private set; }

    public void Update(IReadOnlyList<CrewCacheRow> rows)
    {
        _rows = rows;
        LastRefresh = DateTime.UtcNow;
        Interlocked.Exchange(ref _hitCountAtLastRefresh, Interlocked.Read(ref _hitCount));

        
        // Recompute p-rating distribution only when enriched data is present.
        // Base rows have PRating = null, so we skip the update on the first fast load.
        var countByRating = rows
            .GroupBy(r => r.CrewCode)
            .Select(g => g.OrderByDescending(r => r.LastActionOn).First())
            .Where(r => !string.IsNullOrWhiteSpace(r.PRating))
            .GroupBy(r => r.PRating!.Trim(), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.Count(), StringComparer.OrdinalIgnoreCase);

        if (countByRating.Count == 0)
            return; // No enriched P-rating data yet — keep previous distribution

        // Always emit all P0–P8 so the chart has a complete 9-bar dataset.
        var dist = Enumerable.Range(0, 9)
            .Select(i =>
            {
                var key = "P" + i;
                return new SmartOps.Wells.Contracts.CrewPRatingDistributionDto(
                    key,
                    countByRating.GetValueOrDefault(key, 0));
            })
            .ToList();
        _pRatingDistribution = dist.AsReadOnly();
    }

    /// <summary>
    /// Call on every API read to track usage for dynamic refresh interval.
    /// </summary>
    public void RecordHit()
    {
        Interlocked.Increment(ref _hitCount);
        _lastHitTime = DateTime.UtcNow;
    }

    /// <summary>
    /// Returns the dynamic refresh interval based on recent usage.
    /// High usage (active hits in last 2 min) → 1 minute refresh.
    /// Medium usage (hits in last 5 min) → 3 minute refresh.
    /// Low/no usage → 10 minute refresh.
    /// </summary>
    public TimeSpan GetRefreshInterval()
    {
        var sinceLastHit = DateTime.UtcNow - _lastHitTime;
        var hitsSinceRefresh = Interlocked.Read(ref _hitCount) - Interlocked.Read(ref _hitCountAtLastRefresh);

        if (sinceLastHit <= TimeSpan.FromMinutes(2) || hitsSinceRefresh >= 5)
            return TimeSpan.FromMinutes(5);

        if (sinceLastHit <= TimeSpan.FromMinutes(5))
            return TimeSpan.FromMinutes(8);

        return TimeSpan.FromMinutes(15);
    }
}

public sealed class CrewCacheLoader(
    IConfiguration config,
    ILogger<CrewCacheLoader> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // First startup: do the fast base load so non-P-rating APIs (crew list etc.)
        // have data immediately, then enrich.
        await LoadData(isFirstRun: true, stoppingToken);

        while (!stoppingToken.IsCancellationRequested)
        {
            var interval = CrewCache.Instance.GetRefreshInterval();
            log.LogDebug("CrewCacheLoader: next refresh in {Interval}", interval);
            await Task.Delay(interval, stoppingToken);
            // Periodic refresh: skip base load entirely — old enriched data stays live
            // until the new enrichment batch completes and is atomically swapped in.
            // This eliminates the window where base-only (all Unrated) data is served.
            await LoadData(isFirstRun: false, stoppingToken);
        }
    }

    private async Task LoadData(bool isFirstRun, CancellationToken ct)
    {
        try
        {
            var sw = System.Diagnostics.Stopwatch.StartNew();
            var cs = config.GetConnectionString("Default");
            if (string.IsNullOrWhiteSpace(cs))
            {
                log.LogWarning("CrewCacheLoader: No connection string, skipping.");
                return;
            }

            await using var conn = new SqlConnection(cs);
            await conn.OpenAsync(ct);

            var today = DateTime.UtcNow.Date;
            var startDate = today.AddDays(-90);

            // Load crew group codes from OLD_NEW_CREW_MAPPING (same source as Dashboard KPI)
            var crewGroupCodes = await LoadCrewGroupCodes(conn, ct);
            CrewCache.Instance.UpdateCrewGroupCodes(crewGroupCodes);
            log.LogInformation("CrewCacheLoader: {Count} crew group codes loaded from OLD_NEW_CREW_MAPPING", crewGroupCodes.Length);

            if (isFirstRun)
            {
                // Step 1 (first run only): Quick base load — gives crew-list APIs fast data.
                // P-rating API is guarded by IsEnriched=false and will retry until enrichment done.
                var baseRows = await LoadCrewBase(conn, startDate, today, ct);
                CrewCache.Instance.MarkPending(); // IsEnriched=false until enrichment succeeds
                CrewCache.Instance.Update(baseRows);
                log.LogInformation("CrewCacheLoader: {Count} base crews ready in {E:F1}s (enriching...)",
                    baseRows.Count, sw.Elapsed.TotalSeconds);

                // Step 1b: Load full crew_code → project_ids mapping
                var pidMap = await LoadCrewProjectIds(conn, startDate, today, ct);
                CrewCache.Instance.UpdateCrewProjectIds(pidMap);
                log.LogInformation("CrewCacheLoader: {Count} crew→project_id mappings loaded", pidMap.Count);
            }
            else
            {
                // Periodic refresh: update PID map first (fast), then go straight to enrichment.
                // Old enriched rows stay in cache — IsEnriched remains true — API keeps serving
                // the previous correct P-rating data with zero interruption.
                var pidMap = await LoadCrewProjectIds(conn, startDate, today, ct);
                CrewCache.Instance.UpdateCrewProjectIds(pidMap);
                log.LogInformation("CrewCacheLoader: PID map refreshed ({Count} entries)", pidMap.Count);
            }

            // Enrichment — runs on every cycle (first and periodic)
            try
            {
                await using var enrichConn = new SqlConnection(cs);
                await enrichConn.OpenAsync(ct);
                var enriched = await LoadEnrichedBatch(enrichConn, startDate, today, ct);
                if (enriched.Count > 0)
                {
                    var withRating = enriched.Count(r => !string.IsNullOrWhiteSpace(r.PRating));
                    CrewCache.Instance.Update(enriched);
                    CrewCache.Instance.MarkEnriched();
                    log.LogInformation("CrewCacheLoader: enriched {Count} crews in {E:F1}s ({WithRating} have P-rating)",
                        enriched.Count, sw.Elapsed.TotalSeconds, withRating);
                }
                else
                {
                    log.LogWarning("CrewCacheLoader: enrichment returned 0 rows, keeping previous data");
                }
            }
            catch (Exception ex)
            {
                log.LogWarning(ex, "CrewCacheLoader: enrichment failed, keeping previous data");
            }

            // Help GC reclaim old cache lists after swap
            GC.Collect(2, GCCollectionMode.Optimized, blocking: false);
        }
        catch (Exception ex)
        {
            log.LogError(ex, "CrewCacheLoader: failed to load data");
        }
    }

    private static async Task<string[]> LoadCrewGroupCodes(SqlConnection conn, CancellationToken ct)
    {
        const string sql = @"SELECT DISTINCT LTRIM(RTRIM(CREW_GROUP_CODE))
            FROM dbo.OLD_NEW_CREW_MAPPING WITH (NOLOCK)
            WHERE CREW_GROUP_CODE IS NOT NULL AND LTRIM(RTRIM(CREW_GROUP_CODE)) <> ''";

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        cmd.CommandTimeout = 15;

        var codes = new List<string>();
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
            codes.Add(reader.GetString(0));

        return codes.ToArray();
    }

    private static async Task<IReadOnlyDictionary<string, HashSet<string>>> LoadCrewProjectIds(
        SqlConnection conn, DateTime startDate, DateTime today, CancellationToken ct)
    {
        const string sql = @"SET NOCOUNT ON;
            SELECT crew_code, CAST(project_id AS NVARCHAR(100)) AS project_id
            FROM dbo.task_daily WITH (NOLOCK)
            WHERE ActionOn BETWEEN @startDate AND @endDate
              AND crew_code IS NOT NULL AND crew_code <> ''
              AND project_id IS NOT NULL
            GROUP BY crew_code, project_id";

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        cmd.CommandTimeout = 120;
        cmd.Parameters.Add(new SqlParameter("@startDate", startDate));
        cmd.Parameters.Add(new SqlParameter("@endDate", today.AddDays(1)));

        var map = new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase);
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            var code = reader.GetString(0);
            var pid = reader.GetString(1);
            if (!map.TryGetValue(code, out var set))
            {
                set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                map[code] = set;
            }
            set.Add(pid);
        }
        return map;
    }

    private static async Task<List<CrewCacheRow>> LoadCrewBase(SqlConnection conn, DateTime startDate, DateTime today, CancellationToken ct)
    {
        const string sql = @"SET NOCOUNT ON;
            SELECT crew_code, crew_type, well_id, MAX(ActionOn) AS LastActionOn,
                   MAX(CAST(project_id AS NVARCHAR(100))) AS project_id
            FROM dbo.task_daily WITH (NOLOCK)
            WHERE ActionOn BETWEEN @startDate AND @endDate
              AND crew_code IS NOT NULL AND crew_code <> ''
            GROUP BY crew_code, crew_type, well_id
            ORDER BY crew_code";

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        cmd.CommandTimeout = 120;
        cmd.Parameters.Add(new SqlParameter("@startDate", startDate));
        cmd.Parameters.Add(new SqlParameter("@endDate", today.AddDays(1)));

        var rows = new List<CrewCacheRow>(1500);
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            var code = reader.GetString(0);

            var crewType = reader.IsDBNull(1) ? "" : reader.GetString(1);
            var wellId = reader.IsDBNull(2) ? null : reader.GetString(2);
            var lastAction = reader.GetDateTime(3);
            var projectId = reader.IsDBNull(4) ? null : reader.GetString(4);

            var status = lastAction.Date == today ? "deployed"
                       : lastAction.Date >= today.AddDays(-7) ? "standby"
                       : "rest";

            rows.Add(new CrewCacheRow(code, crewType, wellId,
                null, null, null, null, null, null, null,
                status, lastAction, projectId, null));
        }

        return rows;
    }

    private static async Task<List<CrewCacheRow>> LoadEnrichedBatch(SqlConnection conn, DateTime startDate, DateTime today, CancellationToken ct)
    {
        const string sql = @"SET NOCOUNT ON;
            ;WITH CrewLookup AS (
                SELECT [Crew Type], [Crew Name], [Crew Discipline], [PH Name],
                       [Month PI (CMR)], [Average Productivity (%)],
                       ROW_NUMBER() OVER (
                           PARTITION BY [Crew Type]
                           ORDER BY ISNULL([Month PI (T-Wise)], 0) DESC,
                                    ISNULL([Average Productivity (%)], 0) DESC
                       ) AS rn
                FROM dbo.PH_PRODUCTIVITY_WEEKLY_REPORT
            ),
            ClusterLookup AS (
                SELECT DISTINCT ID, LTRIM(RTRIM(Cluster)) AS Cluster
                FROM dbo.ProjectIDs
                WHERE ID IS NOT NULL AND ID <> ''
                  AND Cluster IS NOT NULL AND LTRIM(RTRIM(Cluster)) <> ''
            ),
            ActivityLookup AS (
                SELECT code, text AS Activity
                FROM dbo.ActivityTaskPlan
                WHERE code IS NOT NULL
            ),
            BaseData AS (
                SELECT crew_code, ActionOn, well_id, crew_type, task_code, actual_start,
                       CAST(project_id AS NVARCHAR(100)) AS project_id,
                       ROW_NUMBER() OVER (
                           PARTITION BY crew_code, well_id
                           ORDER BY ActionOn DESC
                       ) AS rn
                FROM dbo.task_daily
                WHERE ActionOn >= @startDate
                  AND ActionOn < @endDate
                  AND crew_code IS NOT NULL
                  AND crew_code <> N''
            )
            SELECT
                bd.crew_code,
                bd.crew_type,
                bd.well_id,
                bd.ActionOn,
                bd.actual_start,
                cl.[Crew Name],
                cl.[Crew Discipline],
                al.Activity,
                cl.[PH Name],
                clu.Cluster,
                cl.[Month PI (CMR)],
                cl.[Average Productivity (%)]
            FROM BaseData bd
            LEFT JOIN CrewLookup cl
                ON cl.[Crew Type] = bd.crew_type AND cl.rn = 1
            LEFT JOIN ClusterLookup clu
                ON clu.ID = bd.project_id
            LEFT JOIN ActivityLookup al
                ON al.code = bd.task_code
            WHERE bd.rn = 1
            ORDER BY bd.crew_code;";

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        cmd.CommandTimeout = 300; // 5 min cap to prevent runaway queries
        cmd.Parameters.Add(new SqlParameter("@startDate", startDate));
        cmd.Parameters.Add(new SqlParameter("@endDate", today.AddDays(1)));

        // Column ordinals (0-based):
        // 0  bd.crew_code
        // 1  bd.crew_type
        // 2  bd.well_id
        // 3  bd.ActionOn
        // 4  bd.actual_start
        // 5  cl.[Crew Name]
        // 6  cl.[Crew Discipline]
        // 7  al.Activity
        // 8  cl.[PH Name]
        // 9  clu.Cluster
        // 10 cl.[Month PI (CMR)]
        // 11 cl.[Average Productivity (%)]
        var rows = new List<CrewCacheRow>();
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            var code = reader.GetString(0);
            var crewType = reader.IsDBNull(1) ? "" : reader.GetString(1);
            var wellId = reader.IsDBNull(2) ? null : reader.GetString(2);
            var lastAction = reader.GetDateTime(3);
            var actualStart = reader.IsDBNull(4) ? (DateTime?)null : reader.GetDateTime(4);
            var crewName = reader.IsDBNull(5) ? null : reader.GetString(5);
            var discipline = reader.IsDBNull(6) ? null : reader.GetString(6);
            var activity = reader.IsDBNull(7) ? null : reader.GetString(7);
            var leader = reader.IsDBNull(8) ? null : reader.GetString(8);
            var cluster = reader.IsDBNull(9) ? null : reader.GetString(9);
            // [Month PI (CMR)] — numeric (0–8) or string ("P1"…) in the DB.
            string? pRating = null;
            if (!reader.IsDBNull(10))
            {
                var raw = reader.GetValue(10);
                var rawStr = Convert.ToString(raw)?.Trim() ?? "";
                if (rawStr.StartsWith("P", StringComparison.OrdinalIgnoreCase))
                    pRating = rawStr.ToUpperInvariant();
                else if (double.TryParse(rawStr, out var num))
                    pRating = "P" + (int)Math.Round(num);
                else if (!string.IsNullOrEmpty(rawStr))
                    pRating = rawStr;
            }
            var productivity = reader.IsDBNull(11) ? null : (double?)Convert.ToDouble(reader.GetValue(11));

            var status = lastAction.Date == today ? "deployed"
                       : lastAction.Date >= today.AddDays(-7) ? "standby"
                       : "rest";

            rows.Add(new CrewCacheRow(code, crewType, wellId,
                crewName, discipline, activity,
                leader, cluster, pRating, productivity,
                status, lastAction, null, actualStart));
        }

        return rows;
    }
}
