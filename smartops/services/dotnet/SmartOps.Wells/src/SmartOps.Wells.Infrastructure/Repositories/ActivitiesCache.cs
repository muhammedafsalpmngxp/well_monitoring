using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using System.IO;

namespace SmartOps.Wells.Infrastructure.Repositories;

/// <summary>
/// Pre-aggregated row: counts per project, well, and target_start date.
/// Uses the correct KPI logic from the Activities Progress docx:
/// - Completed: progress=1 AND actual_end IS NOT NULL AND actual_end &lt;= range end
/// - In Progress: 0 &lt; progress &lt; 1 AND actual_start IS NOT NULL
/// - Not Started: (progress IS NULL OR 0) AND actual_start IS NULL AND target_start &lt; GETDATE()
/// - Not Yet Due: excluded from totals (target_start >= GETDATE() AND no progress)
/// </summary>
public readonly record struct AggRow(
    string ProjectId,
    string WellId,
    DateTime TaskDate,       // target_start date (used as date filter key)
    int Total,               // excludes Not Yet Due
    int Completed,
    int InProgress,
    int NotStarted,
    string? EndDate,
    string? Assignee);

/// <summary>
/// Singleton in-memory cache for activities data. Loaded once at startup, refreshed every 5 minutes.
/// All API queries are served from memory in microseconds.
/// </summary>
public sealed class ActivitiesCache
{
    public static readonly ActivitiesCache Instance = new();

    private volatile IReadOnlyList<AggRow> _rows = Array.Empty<AggRow>();
    public IReadOnlyList<AggRow> Rows => _rows;
    public bool IsReady => _rows.Count > 0;
    public DateTime? LastRefresh { get; private set; }

    public void Update(IReadOnlyList<AggRow> rows)
    {
        _rows = rows;
        LastRefresh = DateTime.UtcNow;
    }
}

/// <summary>Individual activity row for list display (pre-sorted by target_start DESC).</summary>
public readonly record struct ActivityListRow(
    string Code,
    string Description,
    string WellId,
    string ProjectId,
    string Status,
    int ProgressPct,
    DateTime TargetStart,
    DateTime? TargetEnd,
    string? Assignee);

/// <summary>A single stage/phase row from ActivityTaskPlan (type != 'T'), keyed by WellId.</summary>
public readonly record struct WellStageCacheRow(
    string WellId,
    string Name,       // [text] column
    double Progress,   // 0–100
    string Type,       // e.g. 'P', 'W', 'G'
    string? StartDate, // ISO date string yyyy-MM-dd or null
    string? EndDate);

/// <summary>
/// In-memory cache for individual activity rows (for the list/grid view).
/// Loaded at startup alongside the aggregate cache, refreshed every 5 minutes.
/// </summary>
public sealed class ActivitiesListCache
{
    public static readonly ActivitiesListCache Instance = new();

    // Sorted by target_start DESC, then code
    private volatile IReadOnlyList<ActivityListRow> _rows = Array.Empty<ActivityListRow>();
    public IReadOnlyList<ActivityListRow> Rows => _rows;
    public bool IsReady => _rows.Count > 0;

    public void Update(IReadOnlyList<ActivityListRow> rows)
    {
        _rows = rows;
    }
}

/// <summary>
/// In-memory cache for well stage/phase rows, indexed by wellId.
/// Loaded at startup from file (instant) and refreshed from DB every 5 minutes.
/// </summary>
public sealed class WellStagesCache
{
    public static readonly WellStagesCache Instance = new();
    private volatile Dictionary<string, IReadOnlyList<WellStageCacheRow>> _byWell
        = new(StringComparer.OrdinalIgnoreCase);
    public bool IsReady { get; private set; }

    public void Update(List<WellStageCacheRow> rows)
    {
        var d = new Dictionary<string, List<WellStageCacheRow>>(StringComparer.OrdinalIgnoreCase);
        foreach (var r in rows)
            if (!string.IsNullOrEmpty(r.WellId))
            {
                if (!d.TryGetValue(r.WellId, out var lst)) d[r.WellId] = lst = [];
                lst.Add(r);
            }
        _byWell = d.ToDictionary(kv => kv.Key,
            kv => (IReadOnlyList<WellStageCacheRow>)kv.Value,
            StringComparer.OrdinalIgnoreCase);
        IsReady = true;
    }

    public IReadOnlyList<WellStageCacheRow> GetForWell(string wellId)
        => _byWell.TryGetValue(wellId, out var list) ? list : [];

    /// <summary>All wellIds currently held in the cache.</summary>
    public IEnumerable<string> GetAllWellIds() => _byWell.Keys;
}

/// <summary>
/// A single critical-date milestone row from ActivityTaskPlan, enriched with
/// Cluster and WellType from ProjectIDs.  Sentinel 1901-01-01 is used for "not set" dates.
/// </summary>
public readonly record struct CritDatesRow(
    string   WellId,
    string   StageText,
    string?  Assignee,
    DateTime TargetStart,
    DateTime TargetEnd,
    DateTime ActualStart,  // sentinel 1901-01-01 = not set
    DateTime ActualEnd,    // sentinel 1901-01-01 = not set
    float    Progress,     // 0.0–1.0
    string   Cluster,
    string   Site,
    string   WellType);

/// <summary>
/// In-memory cache for critical-dates-timeline rows.
/// Loaded from file at startup (instant) and refreshed from DB every 5 minutes.
/// All filtering, sorting, and pagination is performed in C# to avoid DB timeouts.
/// </summary>
public sealed class CritDatesCache
{
    public static readonly CritDatesCache Instance = new();

    private volatile IReadOnlyList<CritDatesRow> _rows = Array.Empty<CritDatesRow>();
    public IReadOnlyList<CritDatesRow> Rows  => _rows;
    public bool IsReady { get; private set; }

    public void Update(IReadOnlyList<CritDatesRow> rows)
    {
        _rows   = rows;
        IsReady = true;
    }
}

/// <summary>
/// Background service that loads aggregated ActivityTaskPlan data into ActivitiesCache.
/// Uses the correct KPI categorisation logic per the Activities Progress specification document.
/// Implements file-based persistence: saves loaded data to disk, loads from file at startup for instant availability.
/// </summary>
public sealed class ActivitiesCacheLoader(
    IConfiguration config,
    ILogger<ActivitiesCacheLoader> log) : BackgroundService
{
    private static readonly string CacheDir = Path.Combine(AppContext.BaseDirectory, "cache");
    private static readonly string AggCacheFile      = Path.Combine(CacheDir, "activities-agg.bin");
    private static readonly string ListCacheFile     = Path.Combine(CacheDir, "activities-list.bin");
    private static readonly string StagesCacheFile   = Path.Combine(CacheDir, "well-stages.bin");
    private static readonly string CritDatesCacheFile = Path.Combine(CacheDir, "crit-dates-v2.bin");

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Phase 0: Invalidate stale cache files that may have been saved without date filters
        InvalidateStaleCacheFiles();

        // Phase 1: Load from local file instantly (if available)
        LoadFromFile();

        // Phase 1b: If crit-dates bin doesn't exist yet, kick it off NOW — independent of agg.
        // This means crit-dates runs in parallel with EVERYTHING (agg + list + stages)
        // rather than waiting behind the agg query (which can take 3+ minutes).
        Task earlyCompletionTask = Task.CompletedTask;
        if (!CritDatesCache.Instance.IsReady)
        {
            var cs0 = config.GetConnectionString("Default") ?? "";
            if (!string.IsNullOrWhiteSpace(cs0))
            {
                earlyCompletionTask = Task.Run(async () =>
                {
                    try
                    {
                        var rows = await LoadCritDatesData(cs0, stoppingToken);
                        SaveCritDatesToFile(rows);
                    }
                    catch (Exception ex)
                    {
                        log.LogWarning(ex, "ActivitiesCacheLoader: early crit-dates load failed");
                    }
                }, stoppingToken);
            }
        }

        // Phase 2: Refresh agg/list/stages from remote DB (retry aggressively until first success)
        var loaded = false;
        for (int attempt = 0; !loaded && !stoppingToken.IsCancellationRequested && attempt < 20; attempt++)
        {
            loaded = await LoadData(stoppingToken);
            if (!loaded)
            {
                log.LogWarning("ActivitiesCache: DB load attempt {Attempt} failed, retrying in 30s...", attempt + 1);
                await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);
            }
        }

        // Wait for early crit-dates task if it's still running
        await earlyCompletionTask;

        // Compact heap after initial load to reclaim deserialization buffers
        GC.Collect(2, GCCollectionMode.Optimized, blocking: false);

        // Phase 3: Periodic refresh every 5 minutes
        while (!stoppingToken.IsCancellationRequested)
        {
            await Task.Delay(TimeSpan.FromMinutes(5), stoppingToken);
            await LoadData(stoppingToken);
            GC.Collect(2, GCCollectionMode.Optimized, blocking: false);
        }
    }

    /// <summary>
    /// Deletes binary cache files that exceed a reasonable size threshold,
    /// indicating they were saved before date filters were applied.
    /// </summary>
    private void InvalidateStaleCacheFiles()
    {
        try
        {
            // Stages file > 50 MB is clearly stale (51M rows = multi-GB file)
            if (File.Exists(StagesCacheFile) && new FileInfo(StagesCacheFile).Length > 50 * 1024 * 1024)
            {
                File.Delete(StagesCacheFile);
                log.LogInformation("ActivitiesCacheLoader: deleted oversized stages cache file");
            }
            // List file > 30 MB is stale (date-filtered query should produce much less)
            if (File.Exists(ListCacheFile) && new FileInfo(ListCacheFile).Length > 30 * 1024 * 1024)
            {
                File.Delete(ListCacheFile);
                log.LogInformation("ActivitiesCacheLoader: deleted oversized list cache file");
            }
            // Crit-dates file > 50 MB is stale
            if (File.Exists(CritDatesCacheFile) && new FileInfo(CritDatesCacheFile).Length > 50 * 1024 * 1024)
            {
                File.Delete(CritDatesCacheFile);
                log.LogInformation("ActivitiesCacheLoader: deleted oversized crit-dates cache file");
            }
        }
        catch (Exception ex)
        {
            log.LogWarning(ex, "ActivitiesCacheLoader: failed to invalidate stale cache files");
        }
    }

    private void LoadFromFile()
    {
        try
        {
            if (File.Exists(AggCacheFile) && !ActivitiesCache.Instance.IsReady)
            {
                var sw = System.Diagnostics.Stopwatch.StartNew();
                using var fs = File.OpenRead(AggCacheFile);
                using var br = new BinaryReader(fs);
                var count = br.ReadInt32();
                var rows = new List<AggRow>(count);
                for (int i = 0; i < count; i++)
                {
                    rows.Add(new AggRow(
                        br.ReadString(), br.ReadString(),
                        DateTime.FromBinary(br.ReadInt64()),
                        br.ReadInt32(), br.ReadInt32(), br.ReadInt32(), br.ReadInt32(),
                        br.ReadBoolean() ? br.ReadString() : null,
                        br.ReadBoolean() ? br.ReadString() : null));
                }
                ActivitiesCache.Instance.Update(rows);
                log.LogInformation("ActivitiesCache: loaded {Count} agg rows from file in {Elapsed:F1}ms",
                    count, sw.Elapsed.TotalMilliseconds);
            }

            if (File.Exists(ListCacheFile) && !ActivitiesListCache.Instance.IsReady)
            {
                var sw = System.Diagnostics.Stopwatch.StartNew();
                using var fs = File.OpenRead(ListCacheFile);
                using var br = new BinaryReader(fs);
                var count = br.ReadInt32();
                var rows = new List<ActivityListRow>(count);
                for (int i = 0; i < count; i++)
                {
                    rows.Add(new ActivityListRow(
                        br.ReadString(), br.ReadString(), br.ReadString(), br.ReadString(),
                        br.ReadString(), br.ReadInt32(),
                        DateTime.FromBinary(br.ReadInt64()),
                        br.ReadBoolean() ? DateTime.FromBinary(br.ReadInt64()) : null,
                        br.ReadBoolean() ? br.ReadString() : null));
                }
                ActivitiesListCache.Instance.Update(rows);
                log.LogInformation("ActivitiesCache: loaded {Count} list rows from file in {Elapsed:F1}ms",
                    count, sw.Elapsed.TotalMilliseconds);
            }

            if (File.Exists(StagesCacheFile) && !WellStagesCache.Instance.IsReady)
            {
                var sw = System.Diagnostics.Stopwatch.StartNew();
                using var fs = File.OpenRead(StagesCacheFile);
                using var br = new BinaryReader(fs);
                var count = br.ReadInt32();
                var rows = new List<WellStageCacheRow>(count);
                for (int i = 0; i < count; i++)
                    rows.Add(new WellStageCacheRow(
                        br.ReadString(), br.ReadString(), br.ReadDouble(), br.ReadString(),
                        br.ReadBoolean() ? br.ReadString() : null,
                        br.ReadBoolean() ? br.ReadString() : null));
                WellStagesCache.Instance.Update(rows);
                log.LogInformation("WellStagesCache: loaded {Count} stage rows from file in {Elapsed:F1}ms",
                    count, sw.Elapsed.TotalMilliseconds);
            }

            if (File.Exists(CritDatesCacheFile) && !CritDatesCache.Instance.IsReady)
            {
                var sw = System.Diagnostics.Stopwatch.StartNew();
                using var fs = File.OpenRead(CritDatesCacheFile);
                using var br = new BinaryReader(fs);
                var count = br.ReadInt32();
                var rows = new List<CritDatesRow>(count);
                for (int i = 0; i < count; i++)
                    rows.Add(new CritDatesRow(
                        br.ReadString(),                                   // WellId
                        br.ReadString(),                                   // StageText
                        br.ReadBoolean() ? br.ReadString() : null,         // Assignee?
                        DateTime.FromBinary(br.ReadInt64()),               // TargetStart
                        DateTime.FromBinary(br.ReadInt64()),               // TargetEnd
                        DateTime.FromBinary(br.ReadInt64()),               // ActualStart
                        DateTime.FromBinary(br.ReadInt64()),               // ActualEnd
                        br.ReadSingle(),                                   // Progress
                        br.ReadString(),                                   // Cluster
                        br.ReadString(),                                   // Site
                        br.ReadString()));                                 // WellType
                CritDatesCache.Instance.Update(rows);
                log.LogInformation("CritDatesCache: loaded {Count} rows from file in {Elapsed:F1}ms",
                    count, sw.Elapsed.TotalMilliseconds);
            }
        }
        catch (Exception ex)
        {
            log.LogWarning(ex, "ActivitiesCache: failed to load from file (will fetch from DB)");
        }
    }

    private void SaveAggToFile(IReadOnlyList<AggRow> rows)
    {
        try
        {
            Directory.CreateDirectory(CacheDir);
            var tmp = AggCacheFile + ".tmp";
            using (var fs = File.Create(tmp))
            using (var bw = new BinaryWriter(fs))
            {
                bw.Write(rows.Count);
                foreach (var r in rows)
                {
                    bw.Write(r.ProjectId); bw.Write(r.WellId);
                    bw.Write(r.TaskDate.ToBinary());
                    bw.Write(r.Total); bw.Write(r.Completed); bw.Write(r.InProgress); bw.Write(r.NotStarted);
                    bw.Write(r.EndDate != null); if (r.EndDate != null) bw.Write(r.EndDate);
                    bw.Write(r.Assignee != null); if (r.Assignee != null) bw.Write(r.Assignee);
                }
            }
            File.Move(tmp, AggCacheFile, overwrite: true);
            log.LogInformation("ActivitiesCache: saved {Count} agg rows to file", rows.Count);
        }
        catch (Exception ex)
        {
            log.LogWarning(ex, "ActivitiesCache: failed to save agg file");
        }
    }

    private void SaveListToFile(IReadOnlyList<ActivityListRow> rows)
    {
        try
        {
            Directory.CreateDirectory(CacheDir);
            var tmp = ListCacheFile + ".tmp";
            using (var fs = File.Create(tmp))
            using (var bw = new BinaryWriter(fs))
            {
                bw.Write(rows.Count);
                foreach (var r in rows)
                {
                    bw.Write(r.Code); bw.Write(r.Description); bw.Write(r.WellId); bw.Write(r.ProjectId);
                    bw.Write(r.Status); bw.Write(r.ProgressPct);
                    bw.Write(r.TargetStart.ToBinary());
                    bw.Write(r.TargetEnd.HasValue); if (r.TargetEnd.HasValue) bw.Write(r.TargetEnd.Value.ToBinary());
                    bw.Write(r.Assignee != null); if (r.Assignee != null) bw.Write(r.Assignee);
                }
            }
            File.Move(tmp, ListCacheFile, overwrite: true);
            log.LogInformation("ActivitiesCache: saved {Count} list rows to file", rows.Count);
        }
        catch (Exception ex)
        {
            log.LogWarning(ex, "ActivitiesCache: failed to save list file");
        }
    }

    private void SaveStagesToFile(List<WellStageCacheRow> rows)
    {
        try
        {
            Directory.CreateDirectory(CacheDir);
            var tmp = StagesCacheFile + ".tmp";
            using (var fs = File.Create(tmp))
            using (var bw = new BinaryWriter(fs))
            {
                bw.Write(rows.Count);
                foreach (var r in rows)
                {
                    bw.Write(r.WellId); bw.Write(r.Name); bw.Write(r.Progress); bw.Write(r.Type);
                    bw.Write(r.StartDate != null); if (r.StartDate != null) bw.Write(r.StartDate);
                    bw.Write(r.EndDate != null); if (r.EndDate != null) bw.Write(r.EndDate);
                }
            }
            File.Move(tmp, StagesCacheFile, overwrite: true);
            log.LogInformation("WellStagesCache: saved {Count} stage rows to file", rows.Count);
        }
        catch (Exception ex)
        {
            log.LogWarning(ex, "WellStagesCache: failed to save stages file");
        }
    }

    private void SaveCritDatesToFile(IReadOnlyList<CritDatesRow> rows)
    {
        try
        {
            Directory.CreateDirectory(CacheDir);
            var tmp = CritDatesCacheFile + ".tmp";
            using (var fs = File.Create(tmp))
            using (var bw = new BinaryWriter(fs))
            {
                bw.Write(rows.Count);
                foreach (var r in rows)
                {
                    bw.Write(r.WellId);
                    bw.Write(r.StageText);
                    bw.Write(r.Assignee != null); if (r.Assignee != null) bw.Write(r.Assignee);
                    bw.Write(r.TargetStart.ToBinary());
                    bw.Write(r.TargetEnd.ToBinary());
                    bw.Write(r.ActualStart.ToBinary());
                    bw.Write(r.ActualEnd.ToBinary());
                    bw.Write(r.Progress);
                    bw.Write(r.Cluster);
                    bw.Write(r.Site);
                    bw.Write(r.WellType);
                }
            }
            File.Move(tmp, CritDatesCacheFile, overwrite: true);
            log.LogInformation("CritDatesCache: saved {Count} rows to file", rows.Count);
        }
        catch (Exception ex)
        {
            log.LogWarning(ex, "CritDatesCache: failed to save file");
        }
    }

    private async Task<bool> LoadData(CancellationToken ct)
    {
        try
        {
            var sw = System.Diagnostics.Stopwatch.StartNew();
            var cs = config.GetConnectionString("Default");
            if (string.IsNullOrWhiteSpace(cs))
            {
                log.LogWarning("ActivitiesCacheLoader: No connection string, skipping.");
                return false;
            }

            // Use longer connect timeout for slow/remote DB
            var builder = new SqlConnectionStringBuilder(cs) { ConnectTimeout = 120 };
            await using var conn = new SqlConnection(builder.ConnectionString);
            await conn.OpenAsync(ct);

            // Correct KPI logic per docx specification:
            // - Date dimension: target_start (NOT start_date)
            // - Completed: TRY_CAST(progress AS FLOAT) = 1 AND actual_end IS NOT NULL
            // - In Progress: progress > 0 AND < 1 AND actual_start IS NOT NULL
            // - Not Started: (progress IS NULL OR = 0) AND actual_start IS NULL AND target_start < GETDATE()
            // - Not Yet Due: (progress IS NULL OR = 0) AND target_start >= GETDATE() → EXCLUDED from Total
            // NOTE: Database uses sentinel dates (e.g. 1900-01-01) instead of NULL.
            //       We treat dates <= 1901-01-01 as effectively NULL.
            // Only loads NIMR and MARMUL clusters (project codes starting with N or M).
            var sql = @"
                ;WITH categorized AS (
                    SELECT
                        atp.project_id,
                        COALESCE(NULLIF(atp.Well_ID, ''),
                            CASE 
                                WHEN CHARINDEX('-', atp.code) > 0 AND CHARINDEX('-', atp.code, CHARINDEX('-', atp.code) + 1) > 0
                                THEN SUBSTRING(atp.code, CHARINDEX('-', atp.code) + 1, 
                                     CHARINDEX('-', atp.code, CHARINDEX('-', atp.code) + 1) - CHARINDEX('-', atp.code) - 1)
                                ELSE ''
                            END) AS WellId,
                        CAST(atp.target_start AS DATE) AS TaskDate,
                        CONVERT(VARCHAR(10), atp.target_end, 120) AS EndDate,
                        atp.task_assignee AS Assignee,
                        CASE
                            WHEN TRY_CAST(atp.progress AS FLOAT) = 1
                                 AND atp.actual_end IS NOT NULL AND atp.actual_end > '1901-01-01'
                            THEN 'Completed'
                            WHEN TRY_CAST(atp.progress AS FLOAT) > 0
                                 AND TRY_CAST(atp.progress AS FLOAT) < 1
                                 AND atp.actual_start IS NOT NULL AND atp.actual_start > '1901-01-01'
                            THEN 'InProgress'
                            WHEN (atp.progress IS NULL OR LTRIM(RTRIM(atp.progress)) = '' OR TRY_CAST(atp.progress AS FLOAT) = 0)
                                 AND (atp.actual_start IS NULL OR atp.actual_start <= '1901-01-01')
                                 AND atp.target_start < GETDATE()
                            THEN 'NotStarted'
                            WHEN (atp.progress IS NULL OR LTRIM(RTRIM(atp.progress)) = '' OR TRY_CAST(atp.progress AS FLOAT) = 0)
                                 AND (atp.actual_start IS NULL OR atp.actual_start <= '1901-01-01')
                                 AND atp.target_start >= GETDATE()
                            THEN 'NotYetDue'
                            WHEN (atp.progress IS NULL OR LTRIM(RTRIM(atp.progress)) = '' OR TRY_CAST(atp.progress AS FLOAT) = 0)
                                 AND atp.actual_start IS NOT NULL AND atp.actual_start > '1901-01-01'
                            THEN 'InProgress'
                            ELSE 'Other'
                        END AS activity_status
                    FROM ActivityTaskPlan atp WITH (NOLOCK)
                    INNER JOIN ProjectIDs p WITH (NOLOCK) ON p.ID = atp.project_id
                    WHERE atp.type = 'T'
                      AND atp.target_start IS NOT NULL
                      AND (p.Code LIKE 'N%' OR p.Code LIKE 'M%')
                )
                SELECT
                    project_id,
                    WellId,
                    TaskDate,
                    -- Total excludes NotYetDue rows
                    COUNT(CASE WHEN activity_status != 'NotYetDue' THEN 1 END) AS Total,
                    SUM(CASE WHEN activity_status = 'Completed' THEN 1 ELSE 0 END) AS Completed,
                    SUM(CASE WHEN activity_status = 'InProgress' THEN 1 ELSE 0 END) AS InProgress,
                    SUM(CASE WHEN activity_status = 'NotStarted' THEN 1 ELSE 0 END) AS NotStarted,
                    MAX(EndDate) AS EndDate,
                    MAX(Assignee) AS Assignee
                FROM categorized
                WHERE activity_status != 'NotYetDue'
                GROUP BY project_id, WellId, TaskDate
                OPTION (MAXDOP 4)";

            await using var cmd = conn.CreateCommand();
            cmd.CommandText = sql;
            cmd.CommandTimeout = 300; // allow up to 5 min for initial load

            var rows = new List<AggRow>(8000);
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                var projectId = reader.IsDBNull(0) ? "" : reader.GetString(0);
                var wellId = reader.IsDBNull(1) ? "" : reader.GetString(1);
                var taskDate = reader.GetDateTime(2);
                var total = reader.GetInt32(3);
                var completed = reader.GetInt32(4);
                var inProgress = reader.GetInt32(5);
                var notStarted = reader.GetInt32(6);
                var endDate = reader.IsDBNull(7) ? null : reader.GetString(7);
                var assignee = reader.IsDBNull(8) ? null : reader.GetString(8);
                rows.Add(new AggRow(projectId, wellId, taskDate, total, completed, inProgress, notStarted, endDate, string.IsNullOrWhiteSpace(assignee) ? null : assignee));
            }

            ActivitiesCache.Instance.Update(rows);
            sw.Stop();
            log.LogInformation(
                "ActivitiesCacheLoader: loaded {Count} aggregated rows in {Elapsed:F1}s",
                rows.Count, sw.Elapsed.TotalSeconds);

            // Save aggregate to file IMMEDIATELY (don't wait for list)
            SaveAggToFile(rows);

            // Try to load list data (non-blocking for aggregate availability)
            try
            {
                await LoadListData(cs, ct);
                SaveListToFile(ActivitiesListCache.Instance.Rows);
            }
            catch (Exception listEx)
            {
                log.LogWarning(listEx, "ActivitiesCacheLoader: list data load failed (aggregate still available)");
            }

            // Load stage/phase rows into WellStagesCache
            try
            {
                var stageRows = await LoadStagesData(cs, ct);
                SaveStagesToFile(stageRows);
            }
            catch (Exception stagesEx)
            {
                log.LogWarning(stagesEx, "ActivitiesCacheLoader: stages data load failed");
            }

            return true;
        }
        catch (Exception ex)
        {
            log.LogError(ex, "ActivitiesCacheLoader: failed to load data");
            return false;
        }
    }

    private async Task LoadListData(string cs, CancellationToken ct)
    {
        var builder = new SqlConnectionStringBuilder(cs) { ConnectTimeout = 120 };
        await using var conn = new SqlConnection(builder.ConnectionString);
        await conn.OpenAsync(ct);

        // String interning pool to deduplicate repeated values (Status, ProjectId, WellId)
        var stringPool = new Dictionary<string, string>(StringComparer.Ordinal);
        string Intern(string s)
        {
            if (string.IsNullOrEmpty(s)) return s;
            if (stringPool.TryGetValue(s, out var existing)) return existing;
            stringPool[s] = s;
            return s;
        }

        var sw = System.Diagnostics.Stopwatch.StartNew();
        // Minimal SQL: push all string/date logic to C# to minimize DB work
        var sql = @"
            SELECT
                atp.code,
                atp.[text],
                atp.Well_ID,
                atp.project_id,
                atp.progress,
                atp.actual_start,
                atp.actual_end,
                atp.target_start,
                atp.target_end,
                atp.task_assignee
            FROM ActivityTaskPlan atp WITH (NOLOCK)
            WHERE atp.type = 'T'
              AND atp.target_start IS NOT NULL
              AND atp.target_start >= DATEADD(month, -6, GETDATE())
              AND atp.project_id IN (SELECT ID FROM ProjectIDs WITH (NOLOCK) WHERE Code LIKE 'N%' OR Code LIKE 'M%')
            OPTION (MAXDOP 4)";

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        cmd.CommandTimeout = 600;

        var listRows = new List<ActivityListRow>(150000);
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            var code = reader.IsDBNull(0) ? "" : reader.GetString(0);
            var text = reader.IsDBNull(1) ? null : reader.GetString(1);
            var rawWellId = reader.IsDBNull(2) ? "" : reader.GetString(2);
            var projectId = reader.IsDBNull(3) ? "" : reader.GetString(3);
            var progressRaw = reader.IsDBNull(4) ? null : reader.GetString(4);
            var actualStart = reader.IsDBNull(5) ? (DateTime?)null : reader.GetDateTime(5);
            var actualEnd = reader.IsDBNull(6) ? (DateTime?)null : reader.GetDateTime(6);
            var targetStart = reader.IsDBNull(7) ? DateTime.MinValue : reader.GetDateTime(7);
            var targetEnd = reader.IsDBNull(8) ? (DateTime?)null : reader.GetDateTime(8);
            var assignee = reader.IsDBNull(9) ? null : reader.GetString(9);

            // Compute description in C#
            var description = !string.IsNullOrWhiteSpace(text) ? text : code;

            // Compute WellId in C# (extract from code if Well_ID is empty)
            string wellId = rawWellId;
            if (string.IsNullOrWhiteSpace(wellId))
            {
                var i1 = code.IndexOf('-');
                if (i1 >= 0)
                {
                    var i2 = code.IndexOf('-', i1 + 1);
                    if (i2 > i1)
                        wellId = code.Substring(i1 + 1, i2 - i1 - 1);
                }
                wellId ??= "";
            }

            // Progress
            double pn = 0;
            if (!string.IsNullOrWhiteSpace(progressRaw) && double.TryParse(progressRaw, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var pv)) pn = pv;

            // Sentinel date handling
            bool hasRealStart = actualStart.HasValue && actualStart.Value > new DateTime(1901, 1, 1);
            bool hasRealEnd = actualEnd.HasValue && actualEnd.Value > new DateTime(1901, 1, 1);

            // Exclude NotYetDue (was previously filtered in SQL)
            if (pn == 0 && !hasRealStart && targetStart >= DateTime.Now)
                continue;

            // Status derivation
            string status;
            if (pn == 1.0 && hasRealEnd) status = "Completed";
            else if (pn > 0 && pn < 1 && hasRealStart) status = "In Progress";
            else if (pn == 0 && hasRealStart) status = "In Progress";
            else if (pn == 0 && !hasRealStart && targetStart < DateTime.Now) status = "Not Started";
            else if (pn == 1.0) status = "Completed";
            else if (pn > 0) status = "In Progress";
            else status = "Not Started";

            listRows.Add(new ActivityListRow(
                code, description, Intern(wellId), Intern(projectId),
                Intern(status), (int)(pn * 100), targetStart, targetEnd,
                string.IsNullOrWhiteSpace(assignee) ? null : Intern(assignee)));
        }

        // Sort in memory (faster than ORDER BY on remote DB)
        listRows.Sort((a, b) =>
        {
            int cmp = b.TargetStart.CompareTo(a.TargetStart);
            return cmp != 0 ? cmp : string.Compare(a.Code, b.Code, StringComparison.OrdinalIgnoreCase);
        });

        ActivitiesListCache.Instance.Update(listRows);
        stringPool.Clear(); // Release interning pool
        sw.Stop();
        log.LogInformation(
            "ActivitiesCacheLoader: loaded {Count} list rows in {Elapsed:F1}s",
            listRows.Count, sw.Elapsed.TotalSeconds);
    }

    private async Task<List<WellStageCacheRow>> LoadStagesData(string cs, CancellationToken ct)
    {
        var builder = new SqlConnectionStringBuilder(cs) { ConnectTimeout = 120 };
        await using var conn = new SqlConnection(builder.ConnectionString);
        await conn.OpenAsync(ct);

        var sw = System.Diagnostics.Stopwatch.StartNew();

        // Load all non-task rows that have a Well_ID set.
        // type = 'T' are tasks (already in ActivitiesListCache).
        // Other types ('A', 'W', 'P', 'G', etc.) are activities / stages / phases.
        // Scoped to NIMR & MARMUL projects (same as agg cache) to avoid scanning all 52M rows.
        var sql = @"
            SELECT
                LTRIM(RTRIM(CAST(atp.Well_ID AS NVARCHAR(50)))),
                COALESCE(NULLIF(LTRIM(RTRIM(CAST(atp.[text] AS NVARCHAR(500)))), ''),
                         CAST(atp.code AS NVARCHAR(500))) AS Name,
                CAST(atp.progress AS NVARCHAR(50)),
                CAST(atp.[type] AS NVARCHAR(50)),
                CONVERT(VARCHAR(10), TRY_CAST(CAST(atp.start_date AS NVARCHAR(50)) AS DATE), 120),
                CONVERT(VARCHAR(10), TRY_CAST(CAST(atp.end_date   AS NVARCHAR(50)) AS DATE), 120)
            FROM ActivityTaskPlan atp WITH (NOLOCK)
            INNER JOIN ProjectIDs p WITH (NOLOCK) ON p.ID = atp.project_id
            WHERE atp.[type] != 'T'
              AND NULLIF(LTRIM(RTRIM(CAST(atp.Well_ID AS NVARCHAR(50)))), '') IS NOT NULL
              AND (p.Code LIKE 'N%' OR p.Code LIKE 'M%')
              AND atp.target_start >= DATEADD(month, -12, GETDATE())
            OPTION (MAXDOP 4)";

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        cmd.CommandTimeout = 300;

        var rows = new List<WellStageCacheRow>(50000);
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            var wellId = reader.IsDBNull(0) ? "" : reader.GetString(0);
            if (string.IsNullOrEmpty(wellId)) continue;

            var name = reader.IsDBNull(1) ? "" : reader.GetString(1).Trim();
            if (string.IsNullOrEmpty(name)) continue;

            // progress: raw string, may be "0.75", "75", "75%", or blank
            double progress = 0;
            if (!reader.IsDBNull(2))
            {
                var raw = reader.GetString(2).Replace("%", "").Trim();
                if (double.TryParse(raw, System.Globalization.NumberStyles.Float,
                    System.Globalization.CultureInfo.InvariantCulture, out var pv))
                    progress = Math.Round(pv <= 1.0 ? pv * 100.0 : pv, 1);
            }

            var type = reader.IsDBNull(3) ? "" : reader.GetString(3).Trim();
            var startDate = reader.IsDBNull(4) ? null : reader.GetString(4);
            var endDate   = reader.IsDBNull(5) ? null : reader.GetString(5);

            rows.Add(new WellStageCacheRow(wellId, name, progress, type, startDate, endDate));
        }

        WellStagesCache.Instance.Update(rows);
        sw.Stop();
        log.LogInformation("WellStagesCache: loaded {Count} stage rows in {Elapsed:F1}s",
            rows.Count, sw.Elapsed.TotalSeconds);
        return rows;
    }

    private async Task<List<CritDatesRow>> LoadCritDatesData(string cs, CancellationToken ct)
    {
        var builder = new SqlConnectionStringBuilder(cs) { ConnectTimeout = 120 };
        await using var conn = new SqlConnection(builder.ConnectionString);
        await conn.OpenAsync(ct);

        var sw = System.Diagnostics.Stopwatch.StartNew();

        // Load all rows that have a Well_ID, scoped to NIMR & MARMUL projects.
        // Cluster/Site/WellType from [Cluster], [Site], [Type] columns in ProjectIDs.
        // Dates use sentinel 1901-01-01 for "not set" (same as rest of codebase).
        const string sql = @"
            SELECT
                LTRIM(RTRIM(CAST(atp.Well_ID AS NVARCHAR(50)))) AS WellId,
                COALESCE(
                    NULLIF(LTRIM(RTRIM(CAST(atp.[text] AS NVARCHAR(500)))), ''),
                    CAST(atp.code AS NVARCHAR(500))) AS StageText,
                CAST(atp.task_assignee AS NVARCHAR(200)) AS Assignee,
                COALESCE(atp.target_start, '1901-01-01') AS TargetStart,
                COALESCE(atp.target_end,   '1901-01-01') AS TargetEnd,
                COALESCE(atp.actual_start, '1901-01-01') AS ActualStart,
                COALESCE(atp.actual_end,   '1901-01-01') AS ActualEnd,
                CAST(atp.progress AS NVARCHAR(50)) AS Progress,
                LTRIM(RTRIM(CAST(p.[Cluster] AS NVARCHAR(200)))) AS Cluster,
                LTRIM(RTRIM(CAST(p.[Site]    AS NVARCHAR(200)))) AS Site,
                LTRIM(RTRIM(CAST(p.[Type]    AS NVARCHAR(200)))) AS WellType
            FROM [dbo].[ActivityTaskPlan] atp WITH (NOLOCK)
            INNER JOIN [dbo].[ProjectIDs] p WITH (NOLOCK) ON p.ID = atp.project_id
            WHERE NULLIF(LTRIM(RTRIM(CAST(atp.Well_ID AS NVARCHAR(50)))), '') IS NOT NULL
              AND (p.Code LIKE 'N%' OR p.Code LIKE 'M%')
              AND atp.target_start >= DATEADD(month, -12, GETDATE())
            OPTION (MAXDOP 4)";

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        cmd.CommandTimeout = 600;

        var sentinel  = new DateTime(1901, 1, 2); // treat dates <= 1901-01-01 as sentinel
        var rows = new List<CritDatesRow>(200_000);
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            var wellId    = reader.IsDBNull(0) ? "" : reader.GetString(0);
            if (string.IsNullOrEmpty(wellId)) continue;

            var stageText = reader.IsDBNull(1) ? "" : reader.GetString(1).Trim();
            if (string.IsNullOrEmpty(stageText)) continue;

            var assignee    = reader.IsDBNull(2) ? null : reader.GetString(2)?.Trim();
            if (string.IsNullOrEmpty(assignee)) assignee = null;

            var targetStart = reader.IsDBNull(3) ? new DateTime(1901, 1, 1) : reader.GetDateTime(3);
            var targetEnd   = reader.IsDBNull(4) ? new DateTime(1901, 1, 1) : reader.GetDateTime(4);
            var actualStart = reader.IsDBNull(5) ? new DateTime(1901, 1, 1) : reader.GetDateTime(5);
            var actualEnd   = reader.IsDBNull(6) ? new DateTime(1901, 1, 1) : reader.GetDateTime(6);

            // Skip rows with no meaningful date at all
            if (targetStart < sentinel && targetEnd < sentinel &&
                actualStart < sentinel && actualEnd < sentinel)
                continue;

            // Parse progress 0.0–1.0
            float progress = 0f;
            if (!reader.IsDBNull(7))
            {
                var raw = reader.GetString(7).TrimEnd('%').Trim();
                if (float.TryParse(raw, System.Globalization.NumberStyles.Float,
                        System.Globalization.CultureInfo.InvariantCulture, out var pv))
                    progress = pv > 1f ? pv / 100f : pv;
            }

            var cluster  = reader.IsDBNull(8)  ? "" : reader.GetString(8).Trim();
            var site     = reader.IsDBNull(9)  ? "" : reader.GetString(9).Trim();
            var wellType = reader.IsDBNull(10) ? "" : reader.GetString(10).Trim();

            rows.Add(new CritDatesRow(wellId, stageText, assignee,
                targetStart, targetEnd, actualStart, actualEnd,
                progress, cluster, site, wellType));
        }

        CritDatesCache.Instance.Update(rows);
        sw.Stop();
        log.LogInformation("CritDatesCache: loaded {Count} rows in {Elapsed:F1}s",
            rows.Count, sw.Elapsed.TotalSeconds);
        return rows;
    }
}
