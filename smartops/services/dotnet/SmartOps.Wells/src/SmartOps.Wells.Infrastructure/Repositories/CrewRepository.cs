
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

using Microsoft.Extensions.Caching.Memory;

using SmartOps.Wells.Application.Abstractions;
using SmartOps.Wells.Contracts;
using SmartOps.Wells.Infrastructure.Persistence;

namespace SmartOps.Wells.Infrastructure.Repositories;


public sealed class CrewRepository(WellsDbContext db, ILogger<CrewRepository> logger, IMemoryCache cache) : ICrewRepository
{
    // Same cluster → project_id mapping as DashboardRepository to ensure data integrity.
    private static readonly IReadOnlyDictionary<string, HashSet<string>> ClusterProjectIds =
        new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase)
        {
            ["nimr"] = new(StringComparer.OrdinalIgnoreCase)
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
            ["marmul"] = new(StringComparer.OrdinalIgnoreCase)
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

    // Reverse lookup: project_id → cluster name
    private static readonly Dictionary<string, string> ProjectIdToCluster =
        ClusterProjectIds
            .SelectMany(kv => kv.Value.Select(pid => (pid, cluster: kv.Key)))
            .ToDictionary(x => x.pid, x => x.cluster, StringComparer.OrdinalIgnoreCase);

    public async Task<List<ActivityMasterAllActivitiesItemDto>> GetActivityMasterAllActivitiesAsync(
        CancellationToken ct = default)
    {
        var rows = new List<ActivityMasterAllActivitiesItemDto>();

        try
        {
            var conn = db.Database.GetDbConnection();
            if (conn.State != System.Data.ConnectionState.Open)
                await conn.OpenAsync(ct);

            await using var cmd = conn.CreateCommand();
            cmd.CommandTimeout = 30;
            cmd.CommandText = """
                SELECT
                    a.ACTIVITY_CODE,
                    a.Activity_Group_Description AS [Description],
                    a.DISCIPLINE,
                    a.ACTIVITY_DESCRIPTION AS [ActivityGroup],
                    a.CREW_GROUP_CODE,
                    a.APPLICATION,
                    m.UOM,
                    m.Norms AS [QtyHrNorm],
                    ct.Description AS [CrewGroupName]
                FROM dbo.ActivityMasterCSV a
                LEFT JOIN dbo.ActivityMasterMapping m
                    ON m.Activity_Code = a.ACTIVITY_CODE
                LEFT JOIN dbo.CrewType ct
                    ON ct.Code = a.CREW_GROUP_CODE
                WHERE NOT (
                        a.ACTIVITY_CODE IS NULL
                    AND a.Activity_Group_Description IS NULL
                    AND a.DISCIPLINE IS NULL
                    AND a.ACTIVITY_DESCRIPTION IS NULL
                    AND a.CREW_GROUP_CODE IS NULL
                    AND a.APPLICATION IS NULL
                    AND m.UOM IS NULL
                    AND m.Norms IS NULL
                    AND ct.Description IS NULL
                )
                ORDER BY a.DISCIPLINE, a.ACTIVITY_CODE;
                """;

            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
            {
                rows.Add(new ActivityMasterAllActivitiesItemDto(
                    ActivityCode: rdr.IsDBNull(0) ? null : rdr.GetValue(0).ToString(),
                    Description: rdr.IsDBNull(1) ? null : rdr.GetValue(1).ToString(),
                    Discipline: rdr.IsDBNull(2) ? null : rdr.GetValue(2).ToString(),
                    ActivityGroup: rdr.IsDBNull(3) ? null : rdr.GetValue(3).ToString(),
                    CrewGroupCode: rdr.IsDBNull(4) ? null : rdr.GetValue(4).ToString(),
                    CrewGroupName: rdr.IsDBNull(8) ? null : rdr.GetValue(8).ToString(),
                    Application: rdr.IsDBNull(5) ? null : rdr.GetValue(5).ToString(),
                    Uom: rdr.IsDBNull(6) ? null : rdr.GetValue(6).ToString(),
                    QtyHrNorm: rdr.IsDBNull(7) ? null : Convert.ToDecimal(rdr.GetValue(7))
                ));
            }
        }
        catch (Exception ex) when (ex is SqlException or OperationCanceledException or InvalidOperationException)
        {
            logger.LogError(ex, "Failed to load Activity Master all-activities data (CrewRepository).");
            return new List<ActivityMasterAllActivitiesItemDto>();
        }

        return rows;
    }

    public async Task<List<CrewMasterItemDto>> GetCrewMasterAsync(CancellationToken ct = default)
    {
        var rows = new List<CrewMasterItemDto>();

        try
        {
            var conn = db.Database.GetDbConnection();
            if (conn.State != System.Data.ConnectionState.Open)
                await conn.OpenAsync(ct);

            await using var cmd = conn.CreateCommand();
            cmd.CommandTimeout = 30;
            cmd.CommandText = """
                SELECT Code, Description
                FROM dbo.CrewType
                ORDER BY Code;
                """;

            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
            {
                rows.Add(new CrewMasterItemDto(
                    Code:       rdr.IsDBNull(0) ? null : rdr.GetValue(0).ToString(),
                    Name:       rdr.IsDBNull(1) ? null : rdr.GetValue(1).ToString(),
                    Category:   null,
                    Discipline: null,
                    Activity:   null,
                    Formation:  null
                ));
            }
        }
        catch (Exception ex) when (ex is SqlException or OperationCanceledException or InvalidOperationException)
        {
            logger.LogError(ex, "Failed to load Crew Master data (CrewRepository).");
            return new List<CrewMasterItemDto>();
        }

        return rows;
    }

    public Task<CrewListResponse> GetCrewListAsync(
        string? crewGroup,
        string? cluster,
        string? wellId,
        DateOnly? from,
        DateOnly? to,
        int page,
        int pageSize,
        CancellationToken ct = default)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 200);

        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var startDate = from ?? today.AddDays(-90);
        var endDate = to ?? today;

        IEnumerable<CrewCacheRow> filtered = CrewCache.Instance.Rows;
        CrewCache.Instance.RecordHit();

        // Date range filter
        filtered = filtered.Where(c =>
        {
            var d = DateOnly.FromDateTime(c.LastActionOn);
            return d >= startDate && d <= endDate;
        });

        if (!string.IsNullOrWhiteSpace(crewGroup))
            filtered = filtered.Where(c => string.Equals(c.Discipline, crewGroup, StringComparison.OrdinalIgnoreCase));

        if (!string.IsNullOrWhiteSpace(wellId))
            filtered = filtered.Where(c => string.Equals(c.WellId, wellId, StringComparison.OrdinalIgnoreCase));

        var list = filtered.ToList();

        // Cluster filter: use project_id mapping (same as Dashboard KPI EXISTS logic).
        HashSet<string>? clusterProjectIds = null;
        if (!string.IsNullOrWhiteSpace(cluster) && ClusterProjectIds.TryGetValue(cluster!, out var pids))
            clusterProjectIds = pids;

        var crewPids = CrewCache.Instance.CrewProjectIds;
        var crewGroupCodes = CrewCache.Instance.CrewGroupCodes;

        // For every group code in the master list, find the best-matching deployed cache row
        // (if any). A match requires the crew_code to CONTAIN the group code (case-insensitive),
        // plus — when a cluster filter is active — at least one project_id in the cluster set.
        // This single pass drives both the grid rows AND the KPI counts so they always agree.
        var groupEntries = crewGroupCodes
            .Select(gc =>
            {
                var bestRow = list
                    .Where(c => c.CrewCode.Contains(gc, StringComparison.OrdinalIgnoreCase))
                    .Where(c => clusterProjectIds is null ||
                                (crewPids.TryGetValue(c.CrewCode, out var pidSet) &&
                                 pidSet.Overlaps(clusterProjectIds)))
                    .OrderByDescending(c => c.LastActionOn)
                    .FirstOrDefault();
                return (GroupCode: gc, BestRow: bestRow);
            })
            .ToList();

        // KPI totals derived directly from the same per-group evaluation.
        int totalCount = groupEntries.Count;
        int deployedCount = groupEntries.Count(x => x.BestRow is not null);
        int unassignedCount = totalCount - deployedCount;

        static string ValueOrNa(string? value) => string.IsNullOrWhiteSpace(value) ? "N/A" : value;

        // Build paged grid rows — every group code always appears.
        var paged = groupEntries
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(x =>
            {
                var row = x.BestRow;
                bool isDeployed = row is not null;

                // DeployedOn uses actual_start from the enriched cache row.
                string? deployedOn = isDeployed && row!.ActualStart.HasValue
                    ? row.ActualStart.Value.ToString("yyyy-MM-dd")
                    : "N/A";

                return new CrewListItemDto(
                    ValueOrNa(x.GroupCode),
                    ValueOrNa(row?.CrewName),
                    ValueOrNa(row?.Discipline),
                    ValueOrNa(row?.Activity),
                    ValueOrNa(row?.Leader),
                    ValueOrNa(row is not null ? ResolveCluster(row, cluster) : null),
                    null,
                    ValueOrNa(row?.PRating),
                    row?.Productivity,
                    isDeployed ? "Deployed" : "Unassigned",
                    deployedOn,
                    "N/A");
            })
            .ToList();

        var response = new CrewListResponse(
            totalCount, deployedCount, 0, unassignedCount,
            page, pageSize, paged);

        return Task.FromResult(response);
    }

    private static string? ResolveCluster(CrewCacheRow c, string? filterCluster)
    {
        return string.IsNullOrWhiteSpace(c.Cluster) ? null : c.Cluster;
    }

    public Task<CrewCalendarResponse> GetCrewCalendarAsync(
        string? cluster,
        string? site,
        string? wellType,
        string? project,
        DateOnly? from,
        DateOnly? to,
        CancellationToken ct = default)
    {
        var calendarRepo = new CrewCalendarRepository(db, cache);
        return calendarRepo.GetCrewCalendarAsync(cluster, site, wellType, project, from, to, ct);
    }
}
