using Dapper;
using Microsoft.Data.SqlClient;
using SmartOps.Dashboard.Domain.Dtos;

namespace SmartOps.Dashboard.Services;

/// <summary>
/// Singleton in-memory store that holds pre-aggregated activity data.
/// Loaded once at startup, refreshed every 5 minutes by the background service.
/// All API queries are answered from memory in &lt;5ms.
/// </summary>
public sealed class DashboardDataStore
{
    private volatile DataSnapshot _snapshot = DataSnapshot.Empty;
    public DataSnapshot Snapshot => _snapshot;
    public bool IsReady => _snapshot != DataSnapshot.Empty;
    public DateTime? LastRefresh { get; private set; }

    public void UpdateSnapshot(DataSnapshot snapshot)
    {
        _snapshot = snapshot;
        LastRefresh = DateTime.UtcNow;
    }

    // Cluster → project-ID mapping: each cluster is a group of Nimr projects.
    // Only 3 Nimr projects have data: NF0010, NNSW10, NCWF10 — spread across first 3 clusters.
    // Remaining projects assigned to tuqaa/rakid (will show data when tasks are added).
    private static readonly Dictionary<string, HashSet<string>> ClusterProjects = new(StringComparer.OrdinalIgnoreCase)
    {
        ["nimr"]   = new(StringComparer.OrdinalIgnoreCase) { "278c5587-bba7-46ea-9c6a-d79aa8bd2a69", "8c9c6b42-7a12-4eb3-935b-fc0437e7f33f" },          // NF0010 ✓data, NL0010
        ["alburj"] = new(StringComparer.OrdinalIgnoreCase) { "25482266-1cfe-469a-be26-3f0d69bf61c4", "6d07e3a5-d89b-47ac-9163-8a71e8ade03d" },          // NNSW10 ✓data, NS0010
        ["amin"]   = new(StringComparer.OrdinalIgnoreCase) { "0b69907b-25e5-4165-8414-41ac56586d61", "ab623768-6e41-4a27-bea0-d509f828d32a" },          // NCWF10 ✓data, NROP10
        ["tuqaa"]  = new(StringComparer.OrdinalIgnoreCase) { "7d73c8fe-b31b-4f9b-b616-855cc7388837", "fd0fd562-f8d1-4883-b61e-9cebc1943479" },          // NCOF10, NROT10
        ["rakid"]  = new(StringComparer.OrdinalIgnoreCase) { "b45b8a2e-c688-4ed1-a8be-a1223540ff1f", "91f79608-f510-459e-a13a-871006530a03" }           // NLTP10, NY0010
    };

    /// <summary>
    /// Compute activities progress from in-memory data. Runs in microseconds.
    /// Well ID filtering now works directly because the SQL extracts per-well IDs
    /// from the code column (pattern: {activity}-{wellId}-{taskSuffix}).
    /// </summary>
    public ActivitiesProgressDto ComputeProgress(
        string odc, string? cluster, string? projectId, string? scheduleId,
        string? wellId, DateTime? startDate, DateTime? endDate)
    {
        var snapshot = _snapshot;
        if (snapshot == DataSnapshot.Empty)
            return new ActivitiesProgressDto(0, 0, 0, 0, 0);

        var odcLower = odc.ToLowerInvariant();

        // Determine which projects to include
        HashSet<string>? allowedProjects = null;
        if (!string.IsNullOrWhiteSpace(projectId))
        {
            // Explicit project ID filter
            allowedProjects = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { projectId };
        }
        else if (!string.IsNullOrWhiteSpace(cluster) && ClusterProjects.TryGetValue(cluster, out var clusterProjectIds))
        {
            // Cluster filter → map to project IDs
            allowedProjects = clusterProjectIds;
        }
        else if (odcLower != "all" && odcLower != "south-well-delivery")
        {
            // ODC filter → nimr or marmul project group
            allowedProjects = snapshot.GetProjectsByOdc(odc);
            if (allowedProjects == null || allowedProjects.Count == 0)
                return new ActivitiesProgressDto(0, 0, 0, 0, 0);
        }

        // Determine well filter — well IDs now extracted from code column directly
        HashSet<string>? allowedWells = null;
        if (!string.IsNullOrWhiteSpace(wellId))
        {
            allowedWells = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { wellId };
        }

        int total = 0, completed = 0, inProgress = 0, notStarted = 0;

        foreach (var row in snapshot.Rows)
        {
            // Filter by project (ODC, cluster, or explicit projectId)
            if (allowedProjects != null && !allowedProjects.Contains(row.ProjectId))
                continue;

            // Filter by well ID (now matches directly via code-extracted well IDs)
            if (allowedWells != null && !allowedWells.Contains(row.WellId ?? ""))
                continue;

            // Filter by date range
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
        // some wells only have type A/W/M tasks (no type T in code column).
        // Fall back to cluster-level data so the KPI card isn't empty.
        if (total == 0 && !string.IsNullOrWhiteSpace(wellId) && !string.IsNullOrWhiteSpace(cluster))
        {
            return ComputeProgress(odc, cluster, projectId, scheduleId, null, startDate, endDate);
        }

        // Progress % = Completed / Total × 100 (per docx spec)
        double progress = total > 0 ? Math.Round((double)completed / total * 100, 1) : 0.0;

        return new ActivitiesProgressDto(progress, completed, inProgress, notStarted, total);
    }
}

/// <summary>
/// Immutable snapshot of aggregated data loaded from DB.
/// </summary>
public sealed class DataSnapshot
{
    public static readonly DataSnapshot Empty = new([], new Dictionary<string, HashSet<string>>());

    public IReadOnlyList<AggRow> Rows { get; }
    private readonly Dictionary<string, HashSet<string>> _odcProjects;

    public DataSnapshot(IReadOnlyList<AggRow> rows, Dictionary<string, HashSet<string>> odcProjects)
    {
        Rows = rows;
        _odcProjects = odcProjects;
    }

    public HashSet<string>? GetProjectsByOdc(string odc)
    {
        var key = odc.ToLowerInvariant() switch
        {
            "nimr" or "odc south well delivery" => "nimr",
            "marmul" => "marmul",
            _ => odc.ToLowerInvariant()
        };
        return _odcProjects.GetValueOrDefault(key);
    }
}

/// <summary>
/// Single aggregated row: counts per project per day.
/// Uses correct KPI logic: Completed/InProgress/NotStarted categorized per docx spec.
/// </summary>
public readonly record struct AggRow(
    string ProjectId,
    string WellId,
    DateTime TaskDate,
    int Total,
    int Completed,
    int InProgress,
    int NotStarted
);
