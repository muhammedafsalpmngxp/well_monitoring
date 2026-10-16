using Dapper;
using Microsoft.Data.SqlClient;
using SmartOps.Dashboard.Domain.Dtos;

namespace SmartOps.Dashboard.Services;

/// <summary>
/// Service that queries ActivityTaskPlan table directly for the activities list grid.
/// Only returns data from NIMR and MARMUL clusters (project codes starting with N or M).
/// </summary>
public sealed class ActivitiesListService(IConfiguration config, ILogger<ActivitiesListService> log)
{
    // Same cluster→project mapping used by the KPI store
    private static readonly Dictionary<string, HashSet<string>> ClusterProjects = new(StringComparer.OrdinalIgnoreCase)
    {
        ["nimr"]   = new(StringComparer.OrdinalIgnoreCase) { "278c5587-bba7-46ea-9c6a-d79aa8bd2a69", "8c9c6b42-7a12-4eb3-935b-fc0437e7f33f" },
        ["alburj"] = new(StringComparer.OrdinalIgnoreCase) { "25482266-1cfe-469a-be26-3f0d69bf61c4", "6d07e3a5-d89b-47ac-9163-8a71e8ade03d" },
        ["amin"]   = new(StringComparer.OrdinalIgnoreCase) { "0b69907b-25e5-4165-8414-41ac56586d61", "ab623768-6e41-4a27-bea0-d509f828d32a" },
        ["tuqaa"]  = new(StringComparer.OrdinalIgnoreCase) { "7d73c8fe-b31b-4f9b-b616-855cc7388837", "fd0fd562-f8d1-4883-b61e-9cebc1943479" },
        ["rakid"]  = new(StringComparer.OrdinalIgnoreCase) { "b45b8a2e-c688-4ed1-a8be-a1223540ff1f", "91f79608-f510-459e-a13a-871006530a03" }
    };

    // All project IDs across all clusters (avoids expensive EXISTS subquery)
    private static readonly List<string> AllProjectIds = ClusterProjects.Values
        .SelectMany(s => s)
        .ToList();

    // Reverse mapping: project_id → cluster name
    private static readonly Dictionary<string, string> ProjectToCluster;

    static ActivitiesListService()
    {
        ProjectToCluster = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var (cluster, projectIds) in ClusterProjects)
        {
            foreach (var pid in projectIds)
                ProjectToCluster[pid] = cluster.ToUpperInvariant();
        }
    }

    public async Task<ActivitiesListResponseDto> GetActivitiesListAsync(
        string? odc, string? cluster, string? wellId,
        DateTime? startDate, DateTime? endDate,
        int page, int pageSize, CancellationToken ct = default)
    {
        await using var db = new SqlConnection(config.GetConnectionString("AppMasterDB"));
        await db.OpenAsync(ct);

        // Build dynamic WHERE clause — always restrict to NIMR/MARMUL projects
        var conditions = new List<string>
        {
            "atp.type = 'T'",
            "atp.target_start IS NOT NULL",
            // Only NIMR and MARMUL: use direct IN clause instead of expensive EXISTS subquery
            "atp.project_id IN @AllProjectIds"
        };

        var parameters = new DynamicParameters();
        parameters.Add("AllProjectIds", AllProjectIds);

        // Cluster filter → restrict to specific project IDs
        if (!string.IsNullOrWhiteSpace(cluster) && ClusterProjects.TryGetValue(cluster, out var clusterProjectIds))
        {
            conditions.Add("atp.project_id IN @ClusterProjectIds");
            parameters.Add("ClusterProjectIds", clusterProjectIds.ToList());
        }

        // Well ID filter
        if (!string.IsNullOrWhiteSpace(wellId))
        {
            conditions.Add(@"(
                atp.Well_ID = @WellId 
                OR (CHARINDEX('-', atp.code) > 0 AND CHARINDEX('-', atp.code, CHARINDEX('-', atp.code) + 1) > 0
                    AND SUBSTRING(atp.code, CHARINDEX('-', atp.code) + 1, 
                        CHARINDEX('-', atp.code, CHARINDEX('-', atp.code) + 1) - CHARINDEX('-', atp.code) - 1) = @WellId)
            )");
            parameters.Add("WellId", wellId);
        }

        // Date range filter — uses target_start per docx specification
        if (startDate.HasValue)
        {
            conditions.Add("atp.target_start >= @StartDate");
            parameters.Add("StartDate", startDate.Value.Date);
        }
        if (endDate.HasValue)
        {
            conditions.Add("atp.target_start <= @EndDate");
            parameters.Add("EndDate", endDate.Value.Date);
        }

        // Exclude "Not Yet Due" rows (per docx: no progress, no real start, future target)
        conditions.Add(@"NOT (
            (TRY_CAST(atp.progress AS FLOAT) IS NULL OR TRY_CAST(atp.progress AS FLOAT) = 0)
            AND (atp.actual_start IS NULL OR atp.actual_start <= '1901-01-01')
            AND atp.target_start >= GETDATE()
        )");

        var whereClause = string.Join(" AND ", conditions);

        // Count total rows
        var countSql = $"SELECT COUNT(*) FROM [AppMasterDB].[dbo].[ActivityTaskPlan] atp WITH (NOLOCK) WHERE {whereClause}";
        var totalRows = await db.ExecuteScalarAsync<int>(
            new CommandDefinition(countSql, parameters, commandTimeout: 180, cancellationToken: ct));

        var totalPages = totalRows > 0 ? (int)Math.Ceiling((double)totalRows / pageSize) : 0;

        // Fetch paginated rows with correct status derivation
        var offset = (page - 1) * pageSize;
        parameters.Add("Offset", offset);
        parameters.Add("PageSize", pageSize);

        var dataSql = $@"
            SELECT 
                atp.code AS Code,
                COALESCE(atp.[text], atp.Parent_WBS, atp.code) AS Description,
                CASE 
                    WHEN CHARINDEX('-', atp.code) > 0 AND CHARINDEX('-', atp.code, CHARINDEX('-', atp.code) + 1) > 0
                    THEN SUBSTRING(atp.code, CHARINDEX('-', atp.code) + 1, 
                         CHARINDEX('-', atp.code, CHARINDEX('-', atp.code) + 1) - CHARINDEX('-', atp.code) - 1)
                    ELSE ISNULL(atp.Well_ID, '')
                END AS WellId,
                atp.project_id AS ProjectId,
                CASE 
                    WHEN TRY_CAST(atp.progress AS FLOAT) = 1 AND atp.actual_end IS NOT NULL AND atp.actual_end > '1901-01-01'
                    THEN 'Completed'
                    WHEN TRY_CAST(atp.progress AS FLOAT) > 0 AND TRY_CAST(atp.progress AS FLOAT) < 1 AND atp.actual_start IS NOT NULL AND atp.actual_start > '1901-01-01'
                    THEN 'In Progress'
                    WHEN (TRY_CAST(atp.progress AS FLOAT) IS NULL OR TRY_CAST(atp.progress AS FLOAT) = 0) AND (atp.actual_start IS NULL OR atp.actual_start <= '1901-01-01') AND atp.target_start < GETDATE()
                    THEN 'Not Started'
                    WHEN TRY_CAST(atp.progress AS FLOAT) = 1
                    THEN 'Completed'
                    WHEN TRY_CAST(atp.progress AS FLOAT) > 0
                    THEN 'In Progress'
                    ELSE 'Not Started'
                END AS Status,
                CASE 
                    WHEN atp.progress IS NULL OR LTRIM(RTRIM(atp.progress)) = '' THEN 0
                    ELSE CAST(TRY_CAST(atp.progress AS FLOAT) * 100 AS INT)
                END AS ProgressPct,
                FORMAT(atp.target_start, 'yyyy-MM-dd') AS StartDate,
                FORMAT(atp.target_end, 'yyyy-MM-dd') AS EndDate,
                atp.task_assignee AS Assignee
            FROM [AppMasterDB].[dbo].[ActivityTaskPlan] atp WITH (NOLOCK)
            WHERE {whereClause}
            ORDER BY atp.target_start DESC, atp.code
            OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY
            OPTION (MAXDOP 4)";

        var rawRows = await db.QueryAsync<RawActivityRow>(
            new CommandDefinition(dataSql, parameters, commandTimeout: 180, cancellationToken: ct));

        var items = rawRows.Select(r => new ActivityRowDto(
            Code: r.Code ?? "",
            Description: r.Description ?? r.Code ?? "",
            WellId: r.WellId ?? "",
            Cluster: ResolveCluster(r.ProjectId),
            Status: r.Status ?? "Not Started",
            ProgressPct: r.ProgressPct,
            StartDate: r.StartDate,
            EndDate: r.EndDate,
            Assignee: r.Assignee
        )).ToList();

        // Compute summary using correct KPI logic with sentinel date handling
        var summarySql = $@"
            SELECT 
                COUNT(*) AS Total,
                SUM(CASE WHEN TRY_CAST(atp.progress AS FLOAT) = 1 AND atp.actual_end IS NOT NULL AND atp.actual_end > '1901-01-01' THEN 1 ELSE 0 END) AS Completed,
                SUM(CASE WHEN TRY_CAST(atp.progress AS FLOAT) > 0 AND TRY_CAST(atp.progress AS FLOAT) < 1 AND atp.actual_start IS NOT NULL AND atp.actual_start > '1901-01-01' THEN 1 ELSE 0 END) AS InProgress,
                SUM(CASE WHEN (TRY_CAST(atp.progress AS FLOAT) IS NULL OR TRY_CAST(atp.progress AS FLOAT) = 0) AND (atp.actual_start IS NULL OR atp.actual_start <= '1901-01-01') AND atp.target_start < GETDATE() THEN 1 ELSE 0 END) AS NotStarted
            FROM [AppMasterDB].[dbo].[ActivityTaskPlan] atp WITH (NOLOCK)
            WHERE {whereClause}";

        var summary = await db.QueryFirstOrDefaultAsync<SummaryRow>(
            new CommandDefinition(summarySql, parameters, commandTimeout: 180, cancellationToken: ct));

        var total = summary?.Total ?? 0;
        var completed = summary?.Completed ?? 0;
        var inProgress = summary?.InProgress ?? 0;
        var notStarted = summary?.NotStarted ?? 0;
        // Progress % = Completed / Total × 100 (per docx spec)
        var progress = total > 0 ? Math.Round((double)completed / total * 100, 1) : 0.0;

        var summaryDto = new ActivitiesProgressDto(progress, completed, inProgress, notStarted, total);

        return new ActivitiesListResponseDto(summaryDto, items, page, pageSize, totalRows, totalPages);
    }

    private static string ResolveCluster(string? projectId)
    {
        if (string.IsNullOrWhiteSpace(projectId)) return "";
        return ProjectToCluster.GetValueOrDefault(projectId, "NIMR");
    }

    private sealed class RawActivityRow
    {
        public string? Code { get; init; }
        public string? Description { get; init; }
        public string? WellId { get; init; }
        public string? ProjectId { get; init; }
        public string? Status { get; init; }
        public double ProgressPct { get; init; }
        public string? StartDate { get; init; }
        public string? EndDate { get; init; }
        public string? Assignee { get; init; }
    }

    private sealed class SummaryRow
    {
        public int Total { get; init; }
        public int Completed { get; init; }
        public int InProgress { get; init; }
        public int NotStarted { get; init; }
    }
}
