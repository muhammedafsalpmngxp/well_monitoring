using System.Globalization;
using System.Diagnostics;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Text.Json;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs.Legacy;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Infrastructure.Services.Legacy;

/// <remarks>LEGACY: reads from AppMasterDB (ActivityTaskPlan). Remove when data migrates to tenant DB.</remarks>
public sealed class LegacyCrewCalendarService(
    IConfiguration configuration,
    IMemoryCache cache,
    ICrewAssignmentRepository assignmentRepo,
    ILogger<LegacyCrewCalendarService> logger) : ILegacyCrewCalendarService
{
    private static readonly TimeSpan CacheDuration = TimeSpan.FromMinutes(5);
    private const string CalendarDateFormat = "yyyy-MM-dd";
    private static readonly ConditionalWeakTable<object, LatestRowsSnapshot> SourceSnapshots = new();
    private readonly CrewCalendarCache calendarCache = new(cache);

    private sealed record LatestRowsSnapshot(long[] RowIds, DateTimeOffset ExpiresAt);

    private static DateTimeOffset? SnapshotExpiry(object result) =>
        SourceSnapshots.TryGetValue(result, out var snapshot) ? snapshot.ExpiresAt : null;

    private Task<LatestRowsSnapshot> GetLatestRowsAsync(CancellationToken ct) =>
        calendarCache.GetOrCreateAsync("legacy:crew-latest-rows:v1", CacheDuration, LoadLatestRowsAsync, ct,
            snapshot => snapshot.ExpiresAt);

    private async Task<LatestRowsSnapshot> LoadLatestRowsAsync(CancellationToken ct)
    {
        var stopwatch = Stopwatch.StartNew();
        var assembly = Assembly.GetExecutingAssembly();
        var resource = assembly.GetManifestResourceNames()
            .First(name => name.EndsWith("crew-latest-rows.sql", StringComparison.OrdinalIgnoreCase));
        using var stream = assembly.GetManifestResourceStream(resource)!;
        using var sqlReader = new StreamReader(stream);
        var sql = await sqlReader.ReadToEndAsync(ct);
        var connectionString = configuration.GetConnectionString("LegacyWellsDb")
            ?? throw new InvalidOperationException("ConnectionStrings:LegacyWellsDb is not configured.");
        await using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync(ct);
        await using var command = new SqlCommand(sql, connection) { CommandTimeout = 120 };
        await using var reader = await command.ExecuteReaderAsync(ct);
        var rowIds = new List<long>();
        while (await reader.ReadAsync(ct)) rowIds.Add(reader.GetInt64(0));
        logger.LogInformation("Legacy latest activity snapshot: {Count} rows loaded in {ElapsedMs} ms",
            rowIds.Count, stopwatch.ElapsedMilliseconds);
        return new LatestRowsSnapshot(rowIds.ToArray(), DateTimeOffset.UtcNow.Add(CacheDuration));
    }

    private const string ScopeProjectsSql = """
        SELECT DISTINCT TRY_CONVERT(uniqueidentifier, LTRIM(RTRIM(projects.ID))) AS ProjectId
        FROM dbo.ProjectIDs projects
        INNER JOIN dbo.PlantDescription plants
            ON TRY_CONVERT(int, plants.PlantCode) = TRY_CONVERT(int, projects.Site_Code)
        WHERE (@cluster IS NULL OR LTRIM(RTRIM(plants.Cluster)) = @cluster)
          AND (@site IS NULL OR TRY_CONVERT(int, plants.PlantCode) = TRY_CONVERT(int, @site)
               OR LTRIM(RTRIM(plants.PlantDescription)) = @site)
        """;

    private static string? _sqlTemplate;

    private static string LoadSqlTemplate()
    {
        if (_sqlTemplate is not null) return _sqlTemplate;
        var asm = Assembly.GetExecutingAssembly();
        var name = asm.GetManifestResourceNames()
            .First(n => n.EndsWith("crew-calendar.sql", StringComparison.OrdinalIgnoreCase));
        using var stream = asm.GetManifestResourceStream(name)!;
        using var reader = new StreamReader(stream);
        _sqlTemplate = reader.ReadToEnd();
        return _sqlTemplate;
    }

    private static string? _unassignedSqlTemplate;

    private static string LoadUnassignedSqlTemplate()
    {
        if (_unassignedSqlTemplate is not null) return _unassignedSqlTemplate;
        var asm = Assembly.GetExecutingAssembly();
        var name = asm.GetManifestResourceNames()
            .First(n => n.EndsWith("unassigned-crews.sql", StringComparison.OrdinalIgnoreCase));
        using var stream = asm.GetManifestResourceStream(name)!;
        using var reader = new StreamReader(stream);
        _unassignedSqlTemplate = reader.ReadToEnd();
        return _unassignedSqlTemplate;
    }

    private static string? _assignableSqlTemplate;

    private static string LoadAssignableSqlTemplate()
    {
        if (_assignableSqlTemplate is not null) return _assignableSqlTemplate;
        var asm = Assembly.GetExecutingAssembly();
        var name = asm.GetManifestResourceNames()
            .First(n => n.EndsWith("assignable-activities.sql", StringComparison.OrdinalIgnoreCase));
        using var stream = asm.GetManifestResourceStream(name)!;
        using var reader = new StreamReader(stream);
        _assignableSqlTemplate = reader.ReadToEnd();
        return _assignableSqlTemplate;
    }

    public async Task<CrewCalendarResponse> GetCrewCalendarAsync(
        string? cluster, string? site, string? wellType, string? project,
        DateOnly? from, DateOnly? to, bool includeAssignments = false, CancellationToken ct = default)
    {
        var today = DateTime.UtcNow.Date;
        var fromDt = (from ?? DateOnly.FromDateTime(today.AddDays(-14))).ToDateTime(TimeOnly.MinValue);
        var toDt = (to ?? DateOnly.FromDateTime(today.AddDays(14))).ToDateTime(TimeOnly.MaxValue);

        var cacheKey = $"legacy:crew-cal:{cluster}:{site}:{wellType}:{project}:{fromDt:yyyyMMdd}:{toDt:yyyyMMdd}";
        var cached = await calendarCache.GetOrCreateAsync(cacheKey, CacheDuration,
            token => ExecuteAsync(cluster, site, wellType, project, fromDt, toDt, token), ct, SnapshotExpiry);

        // Tenant-DB assignments are merged on top of the (cached) legacy view so newly
        // assigned crews appear immediately, without polluting the legacy cache entry.
        var response = includeAssignments
            ? await OverlayAssignmentsAsync(cached, cluster, site, project, fromDt, toDt, ct)
            : cached;
        return await PopulateCrewGroupNamesAsync(SeparatePlanningData(response, fromDt, toDt), ct);
    }

    private static CrewCalendarResponse SeparatePlanningData(
        CrewCalendarResponse response, DateTime fromDt, DateTime toDt)
    {
        var from = DateOnly.FromDateTime(fromDt);
        var to = DateOnly.FromDateTime(toDt);
        var actualWork = new HashSet<CrewActualWorkDto>();
        var groups = new List<CrewCalendarGroupDto>();
        var actualGroups = new List<CrewCalendarGroupDto>();

        foreach (var group in response.Groups)
        {
            var crews = new List<CrewCalendarCrewDto>();
            var actualCrews = new List<CrewCalendarCrewDto>();
            foreach (var crew in group.Crews)
            {
                actualWork.UnionWith(crew.Activities.Select(activity =>
                    ToActualCrewWork(group.CrewGroupCode, crew.CrewCode, activity)).OfType<CrewActualWorkDto>());
                var actual = crew.Activities.Where(activity => ActualInRange(
                    ToActualCrewWork(group.CrewGroupCode, crew.CrewCode, activity), from, to)).ToList();
                if (actual.Count > 0) actualCrews.Add(crew with { Activities = actual });
                var planned = crew.Activities.Where(activity => PlannedInRange(activity, from, to)).ToList();
                if (planned.Count > 0) crews.Add(crew with { Activities = planned });
            }
            if (actualCrews.Count > 0)
            {
                var actualActivities = actualCrews.SelectMany(crew => crew.Activities).ToList();
                actualGroups.Add(group with
                {
                    Crews = actualCrews,
                    ActivityCount = actualActivities.Count,
                    CompletionPct = Math.Round((decimal)actualActivities.Count(activity => TryCalendarDate(activity.ActualEnd, out _)) /
                        actualActivities.Count * 100, 1)
                });
            }
            if (crews.Count == 0) continue;
            var activities = crews.SelectMany(crew => crew.Activities).ToList();
            groups.Add(group with
            {
                Crews = crews,
                ActivityCount = activities.Count,
                CompletionPct = Math.Round((decimal)activities.Count(activity => activity.Status == "completed") /
                    activities.Count * 100, 1)
            });
        }

        var milestones = response.Milestones.Where(activity => PlannedInRange(activity, from, to)).ToList();
        return response with
        {
            Groups = groups,
            TotalGroups = groups.Count,
            TotalCrews = groups.Sum(group => group.Crews.Count(crew => !string.IsNullOrWhiteSpace(crew.CrewCode))),
            TotalActivities = groups.Sum(group => group.ActivityCount),
            Milestones = milestones,
            TotalMilestones = milestones.Count,
            ActualCrewWork = actualWork.ToList(),
            ActualGroups = actualGroups
        };
    }

    private static bool ActualInRange(CrewActualWorkDto? work, DateOnly from, DateOnly to)
    {
        if (work is null || !TryCalendarDate(work.ActualStart, out var start)) return false;
        var end = TryCalendarDate(work.ActualEnd, out var actualEnd)
            ? actualEnd : DateOnly.FromDateTime(DateTime.UtcNow);
        return start <= to && end >= from && end >= start;
    }

    private static bool TryCalendarDate(string? value, out DateOnly date) =>
        DateOnly.TryParseExact(value, CalendarDateFormat, CultureInfo.InvariantCulture, DateTimeStyles.None, out date);

    private static bool PlannedInRange(CrewCalendarActivityDto activity, DateOnly from, DateOnly to) =>
        TryCalendarDate(activity.PlannedStart, out var start) &&
        TryCalendarDate(activity.PlannedEnd, out var end) && end >= start && start <= to && end >= from;

    private static CrewActualWorkDto? ToActualCrewWork(
        string groupCode, string crewCode, CrewCalendarActivityDto activity)
    {
        if (string.IsNullOrWhiteSpace(crewCode) || activity.IsMilestone) return null;
        var hasStart = TryCalendarDate(activity.ActualStart, out var start);
        var hasEnd = TryCalendarDate(activity.ActualEnd, out var end);
        if (!hasStart && !hasEnd) return null;
        if (!hasStart)
        {
            start = end;
            if (TryCalendarDate(activity.PlannedStart, out var plannedStart) &&
                TryCalendarDate(activity.PlannedEnd, out var plannedEnd) &&
                plannedEnd >= plannedStart && plannedStart <= end) start = plannedStart;
        }
        if (hasEnd && end < start) return null;
        return new CrewActualWorkDto(groupCode.Trim(), crewCode.Trim(),
            start.ToString(CalendarDateFormat, CultureInfo.InvariantCulture),
            hasEnd ? end.ToString(CalendarDateFormat, CultureInfo.InvariantCulture) : null);
    }

    private async Task<CrewCalendarResponse> PopulateCrewGroupNamesAsync(
        CrewCalendarResponse response, CancellationToken ct)
    {
        if (response.Groups.Count == 0 && (response.ActualGroups?.Count ?? 0) == 0) return response;
        const string cacheKey = "legacy:crew-group-names";
        if (!cache.TryGetValue(cacheKey, out Dictionary<string, string>? names) || names is null)
        {
            var connStr = configuration.GetConnectionString("LegacyWellsDb")
                ?? throw new InvalidOperationException("ConnectionStrings:LegacyWellsDb is not configured.");
            await using var conn = new SqlConnection(connStr);
            await conn.OpenAsync(ct);
            const string sql = """
                SELECT LTRIM(RTRIM(Code)), MAX(NULLIF(LTRIM(RTRIM(Description)), ''))
                FROM dbo.CrewType
                WHERE Code IS NOT NULL
                GROUP BY LTRIM(RTRIM(Code));
                """;
            await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 120 };
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            names = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            while (await reader.ReadAsync(ct))
            {
                if (!reader.IsDBNull(1)) names[reader.GetString(0)] = reader.GetString(1);
            }
            cache.Set(cacheKey, names, CacheDuration);
        }
        return response with
        {
            Groups = response.Groups.Select(group => group with
            {
                CrewGroupName = names.GetValueOrDefault(group.CrewGroupCode.Trim()) ?? group.CrewGroupName
            }).ToList(),
            ActualGroups = response.ActualGroups?.Select(group => group with
            {
                CrewGroupName = names.GetValueOrDefault(group.CrewGroupCode.Trim()) ?? group.CrewGroupName
            }).ToList()
        };
    }

    private async Task<Dictionary<Guid, string>> GetProjectClustersAsync(CancellationToken ct)
    {
        const string cacheKey = "legacy:crew-project-clusters";
        if (cache.TryGetValue(cacheKey, out Dictionary<Guid, string>? clusters) && clusters is not null)
            return clusters;

        var connectionString = configuration.GetConnectionString("LegacyWellsDb")
            ?? throw new InvalidOperationException("ConnectionStrings:LegacyWellsDb is not configured.");
        await using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync(ct);
        const string sql = """
            SELECT TRY_CONVERT(uniqueidentifier, LTRIM(RTRIM(ID))),
                   MIN(NULLIF(LTRIM(RTRIM(Cluster)), ''))
            FROM dbo.ProjectIDs
            WHERE TRY_CONVERT(uniqueidentifier, LTRIM(RTRIM(ID))) IS NOT NULL
            GROUP BY TRY_CONVERT(uniqueidentifier, LTRIM(RTRIM(ID)))
            HAVING COUNT(DISTINCT NULLIF(LTRIM(RTRIM(Cluster)), '')) = 1;
            """;
        await using var command = new SqlCommand(sql, connection) { CommandTimeout = 120 };
        await using var reader = await command.ExecuteReaderAsync(ct);
        clusters = [];
        while (await reader.ReadAsync(ct)) clusters.Add(reader.GetGuid(0), reader.GetString(1));
        cache.Set(cacheKey, clusters, CacheDuration);
        return clusters;
    }

    private static string? ProjectCluster(string? projectId, IReadOnlyDictionary<Guid, string> clusters) =>
        Guid.TryParse(projectId?.Trim(), out var parsed) ? clusters.GetValueOrDefault(parsed) : null;

    private async Task<HashSet<Guid>> GetScopeProjectIdsAsync(string? cluster, string? site, CancellationToken ct)
    {
        var cacheKey = $"legacy:crew-scope:{cluster?.Trim()}:{site?.Trim()}";
        if (cache.TryGetValue(cacheKey, out HashSet<Guid>? projects) && projects is not null) return projects;

        var connectionString = configuration.GetConnectionString("LegacyWellsDb")
            ?? throw new InvalidOperationException("ConnectionStrings:LegacyWellsDb is not configured.");
        await using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync(ct);
        await using var command = new SqlCommand(ScopeProjectsSql, connection) { CommandTimeout = 120 };
        AddScopeParameters(command, cluster, site);
        projects = [];
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
            if (!reader.IsDBNull(0)) projects.Add(reader.GetGuid(0));
        cache.Set(cacheKey, projects, CacheDuration);
        return projects;
    }

    private static void AddScopeParameters(SqlCommand command, string? cluster, string? site)
    {
        command.Parameters.Add("@cluster", System.Data.SqlDbType.NVarChar, 200).Value =
            string.IsNullOrWhiteSpace(cluster) ? DBNull.Value : cluster.Trim();
        command.Parameters.Add("@site", System.Data.SqlDbType.NVarChar, 200).Value =
            string.IsNullOrWhiteSpace(site) ? DBNull.Value : site.Trim();
    }

    private async Task<CrewCalendarResponse> OverlayAssignmentsAsync(
        CrewCalendarResponse legacy, string? cluster, string? site, string? project,
        DateTime fromDt, DateTime toDt, CancellationToken ct)
    {
        var assignments = await assignmentRepo.GetForScopeAsync(null, null, fromDt, toDt, ct);
        assignments = assignments.Where(assignment =>
            assignment.PlannedStart.HasValue && assignment.PlannedEnd.HasValue &&
            assignment.PlannedStart.Value <= toDt && assignment.PlannedEnd.Value >= fromDt).ToList();
        if (!string.IsNullOrWhiteSpace(cluster) || !string.IsNullOrWhiteSpace(site))
        {
            var scopeProjects = await GetScopeProjectIdsAsync(cluster, site, ct);
            assignments = assignments.Where(assignment =>
                Guid.TryParse(assignment.ProjectId?.Trim(), out var projectId) && scopeProjects.Contains(projectId)).ToList();
        }
        if (!string.IsNullOrWhiteSpace(project))
            assignments = assignments
                .Where(a => a.ProjectId == null || a.ProjectId == project)
                .ToList();
        if (assignments.Count == 0)
            return legacy;

        var projectClusters = await GetProjectClustersAsync(ct);

        // crewGroup -> crewUid -> activities
        var model = new Dictionary<string, Dictionary<string, List<CrewCalendarActivityDto>>>(StringComparer.OrdinalIgnoreCase);
        foreach (var g in legacy.Groups)
        {
            var crews = new Dictionary<string, List<CrewCalendarActivityDto>>(StringComparer.OrdinalIgnoreCase);
            foreach (var c in g.Crews)
                crews[c.CrewCode] = c.Activities.ToList();
            model[g.CrewGroupCode] = crews;
        }

        foreach (var a in assignments)
        {
            if (!model.TryGetValue(a.CrewGroupCode, out var crews))
            {
                crews = new Dictionary<string, List<CrewCalendarActivityDto>>(StringComparer.OrdinalIgnoreCase);
                model[a.CrewGroupCode] = crews;
            }
            if (!crews.TryGetValue(a.CrewUid, out var acts))
            {
                acts = new List<CrewCalendarActivityDto>();
                crews[a.CrewUid] = acts;
            }
            var activity = ToActivityDto(a) with { Cluster = ProjectCluster(a.ProjectId, projectClusters) };
            if (acts.Any(x =>
                string.Equals(x.ActivityCode, activity.ActivityCode, StringComparison.OrdinalIgnoreCase) &&
                string.Equals(x.WellId, activity.WellId, StringComparison.OrdinalIgnoreCase) &&
                x.PlannedStart == activity.PlannedStart && x.PlannedEnd == activity.PlannedEnd))
                continue;
            acts.Add(activity);
        }

        var groups = model
            .OrderBy(kv => kv.Key, StringComparer.OrdinalIgnoreCase)
            .Select(kv =>
            {
                var allActs = kv.Value.Values.SelectMany(x => x).ToList();
                var completed = allActs.Count(x => x.Status == "completed");
                var pct = allActs.Count > 0 ? (decimal)completed / allActs.Count * 100 : 0;
                return new CrewCalendarGroupDto(
                    CrewGroupCode: kv.Key,
                    ActivityCount: allActs.Count,
                    CompletionPct: Math.Round(pct, 1),
                    Crews: kv.Value
                        .OrderBy(c => c.Key, StringComparer.OrdinalIgnoreCase)
                        .Select(c => new CrewCalendarCrewDto(c.Key, c.Value))
                        .ToList());
            })
            .ToList();

        return legacy with
        {
            TotalGroups = groups.Count,
            TotalCrews = groups.Sum(g => g.Crews.Count(c => !string.IsNullOrWhiteSpace(c.CrewCode))),
            TotalActivities = groups.Sum(g => g.Crews.Sum(c => c.Activities.Count)),
            Groups = groups
        };
    }

    private static CrewCalendarActivityDto ToActivityDto(CrewActivityAssignment a)
    {
        return new CrewCalendarActivityDto(
            ActivityCode: a.ActivityCode,
            ActivityName: a.ActivityName,
            WellId: a.WellId ?? "",
            Category: null,
            PlannedStart: a.PlannedStart?.ToString("yyyy-MM-dd") ?? "",
            PlannedEnd: a.PlannedEnd?.ToString("yyyy-MM-dd") ?? "",
            ActualStart: null,
            ActualEnd: null,
            Progress: a.Progress,
            Status: "notstarted",
            IsMilestone: false,
            RigOnDate: null,
            ExpectedRigOnDate: null,
            NormsPerDay: null,
            ProductivityPct: null,
                Source: "assignment",
                AssignmentId: a.Id);
    }

    public async Task<CrewRosterResponse> GetCrewRosterAsync(
        DateOnly from, DateOnly to, CancellationToken ct = default, bool includeAssignments = true)
    {
        var fromDt = from.ToDateTime(TimeOnly.MinValue);
        var toDt = to.ToDateTime(TimeOnly.MaxValue);
        var cacheKey = $"legacy:crew-roster:{from:yyyyMMdd}:{to:yyyyMMdd}";
        var roster = await calendarCache.GetOrCreateAsync(cacheKey, CacheDuration,
            token => LoadCrewRosterAsync(fromDt, toDt, token), ct, SnapshotExpiry);

        if (!includeAssignments) return roster;

        var assignments = await assignmentRepo.GetForScopeAsync(null, null, fromDt, toDt, ct);
        var bookings = assignments.Where(assignment => !assignment.IsDeleted &&
                !string.IsNullOrWhiteSpace(assignment.CrewUid))
            .ToLookup(assignment => assignment.CrewUid.Trim(), StringComparer.OrdinalIgnoreCase);
        return new CrewRosterResponse(roster.Groups.Select(group => group with
        {
            Crews = group.Crews.Select(crew => crew with
            {
                Bookings = crew.Bookings.Concat(bookings[crew.CrewUid].Select(assignment =>
                    ToRosterBooking(assignment, fromDt, toDt)))
                    .Distinct().ToList()
            }).ToList()
        }).ToList());
    }

    private static CrewBookingDto ToRosterBooking(CrewActivityAssignment assignment, DateTime from, DateTime to)
    {
        var start = assignment.PlannedStart ?? from;
        var end = assignment.PlannedEnd ?? to;
        if (end < start)
        {
            start = from;
            end = to;
        }
        return new CrewBookingDto(start.ToString("yyyy-MM-dd"), end.ToString("yyyy-MM-dd"));
    }

    private async Task<CrewRosterResponse> LoadCrewRosterAsync(
        DateTime fromDt, DateTime toDt, CancellationToken ct)
    {
        var stopwatch = Stopwatch.StartNew();
        var snapshot = await GetLatestRowsAsync(ct);
        var assembly = Assembly.GetExecutingAssembly();
        var resource = assembly.GetManifestResourceNames()
            .First(name => name.EndsWith("crew-roster.sql", StringComparison.OrdinalIgnoreCase));
        using var stream = assembly.GetManifestResourceStream(resource)!;
        using var sqlReader = new StreamReader(stream);
        var sql = await sqlReader.ReadToEndAsync(ct);
        sql = sql.Replace("/* __SHARED_LATEST_ROWS__ */", "SET @sharedLatestRows = @latestRowsJson;");
        var connectionString = configuration.GetConnectionString("LegacyWellsDb")
            ?? throw new InvalidOperationException("ConnectionStrings:LegacyWellsDb is not configured.");
        await using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync(ct);
        await using var command = new SqlCommand(sql, connection) { CommandTimeout = 120 };
        command.Parameters.Add("@fromDate", System.Data.SqlDbType.DateTime2).Value = fromDt;
        command.Parameters.Add("@toDate", System.Data.SqlDbType.DateTime2).Value = toDt;
        command.Parameters.Add("@latestRowsJson", System.Data.SqlDbType.NVarChar, -1).Value = JsonSerializer.Serialize(snapshot.RowIds);
        var members = new List<(string Group, string? Name, string Crew, string? Type)>();
        var bookings = new Dictionary<string, List<CrewBookingDto>>(StringComparer.OrdinalIgnoreCase);
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
            members.Add((reader.GetString(0), reader.IsDBNull(1) ? null : reader.GetString(1),
                reader.GetString(2), reader.IsDBNull(3) ? null : reader.GetString(3)));
        await reader.NextResultAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            var crew = reader.GetString(0);
            if (!bookings.TryGetValue(crew, out var reserved))
            {
                reserved = [];
                bookings[crew] = reserved;
            }
            reserved.Add(new CrewBookingDto(reader.GetString(1), reader.GetString(2)));
        }
        await reader.NextResultAsync(ct);
        var projects = await ReadCrewProjectsAsync(reader, ct);
        var groups = members.GroupBy(member => member.Group, StringComparer.OrdinalIgnoreCase)
            .Select(group => new CrewRosterGroupDto(group.Key, group.Select(member => member.Name)
                .FirstOrDefault(name => !string.IsNullOrWhiteSpace(name)),
                group.DistinctBy(member => member.Crew, StringComparer.OrdinalIgnoreCase)
                    .Select(member => new CrewRosterMemberDto(member.Crew, member.Type,
                        bookings.GetValueOrDefault(member.Crew) ?? [],
                        projects.GetValueOrDefault(member.Crew) ?? [])).ToList())).ToList();
        logger.LogInformation("Legacy crew roster loaded in {ElapsedMs} ms; shared latest rows: {SharedLatestRows}; groups: {Groups}",
            stopwatch.ElapsedMilliseconds, true, groups.Count);
        var result = new CrewRosterResponse(groups);
        SourceSnapshots.Add(result, snapshot);
        return result;
    }

    private static async Task<Dictionary<string, List<CrewProjectMappingDto>>> ReadCrewProjectsAsync(
        SqlDataReader reader, CancellationToken ct)
    {
        var projects = new Dictionary<string, List<CrewProjectMappingDto>>(StringComparer.OrdinalIgnoreCase);
        while (await reader.ReadAsync(ct))
        {
            var crew = reader.GetString(0);
            if (!projects.TryGetValue(crew, out var mappings))
            {
                mappings = [];
                projects[crew] = mappings;
            }
            mappings.Add(new CrewProjectMappingDto(reader.GetString(1),
                reader.IsDBNull(2) ? null : reader.GetString(2),
                reader.IsDBNull(3) ? null : reader.GetString(3)));
        }
        return projects;
    }

    public async Task<UnassignedCrewsResponse> GetUnassignedCrewsAsync(
        string? crewGroup, DateOnly? from, DateOnly? to, CancellationToken ct = default)
    {
        var today = DateTime.UtcNow.Date;
        var fromDt = (from ?? DateOnly.FromDateTime(today.AddDays(-14))).ToDateTime(TimeOnly.MinValue);
        var toDt = (to ?? DateOnly.FromDateTime(today.AddDays(14))).ToDateTime(TimeOnly.MaxValue);

        var cacheKey = $"legacy:unassigned-crews:{crewGroup}:{fromDt:yyyyMMdd}:{toDt:yyyyMMdd}";
        if (cache.TryGetValue(cacheKey, out UnassignedCrewsResponse? cached) && cached is not null)
            return await ExcludeAssignedCrewsAsync(cached, fromDt, toDt, ct);

        var sql = LoadUnassignedSqlTemplate().Replace(
            "/* __GROUP_FILTER__ */",
            string.IsNullOrWhiteSpace(crewGroup) ? "" : "AND d.GroupCode = @crewGroup");

        var connStr = configuration.GetConnectionString("LegacyWellsDb")
            ?? throw new InvalidOperationException("ConnectionStrings:LegacyWellsDb is not configured.");

        await using var conn = new SqlConnection(connStr);
        await conn.OpenAsync(ct);
        await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 120 };
        cmd.Parameters.Add("@fromDate", System.Data.SqlDbType.DateTime2).Value = fromDt;
        cmd.Parameters.Add("@toDate", System.Data.SqlDbType.DateTime2).Value = toDt;
        if (!string.IsNullOrWhiteSpace(crewGroup))
            cmd.Parameters.AddWithValue("@crewGroup", crewGroup);

        var flat = new List<(string Group, string? GroupName, string CrewUid, string? TypeCode)>();
        await using var rdr = await cmd.ExecuteReaderAsync(ct);
        while (await rdr.ReadAsync(ct))
        {
            flat.Add((
                rdr.IsDBNull(0) ? "UNKNOWN" : rdr.GetString(0),
                rdr.IsDBNull(1) ? null : rdr.GetString(1),
                rdr.GetString(2),
                rdr.IsDBNull(3) ? null : rdr.GetString(3)));
        }

        logger.LogInformation("Legacy unassigned crews: {Count} rows from DB", flat.Count);

        var groups = flat
            .GroupBy(r => r.Group, StringComparer.OrdinalIgnoreCase)
            .OrderBy(g => g.Key, StringComparer.OrdinalIgnoreCase)
            .Select(g => new UnassignedCrewGroupDto(
                CrewGroupCode: g.Key,
                CrewGroupName: g.Select(x => x.GroupName).FirstOrDefault(n => !string.IsNullOrEmpty(n)),
                Crews: g.OrderBy(x => x.CrewUid, StringComparer.OrdinalIgnoreCase)
                        .Select(x => new UnassignedCrewDto(x.CrewUid, x.TypeCode))
                        .ToList()))
            .ToList();

        var response = new UnassignedCrewsResponse(
            TotalGroups: groups.Count,
            TotalCrews: flat.Count,
            Groups: groups);

        cache.Set(cacheKey, response, CacheDuration);
        return await ExcludeAssignedCrewsAsync(response, fromDt, toDt, ct);
    }

    private async Task<UnassignedCrewsResponse> ExcludeAssignedCrewsAsync(
        UnassignedCrewsResponse legacy, DateTime fromDt, DateTime toDt, CancellationToken ct)
    {
        var assignments = await assignmentRepo.GetForScopeAsync(null, null, fromDt, toDt, ct);
        if (assignments.Count == 0)
            return legacy;

        var assignedCrews = assignments.Select(assignment => assignment.CrewUid.Trim())
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var groups = legacy.Groups
            .Select(group => group with
            {
                Crews = group.Crews.Where(crew => !assignedCrews.Contains(crew.CrewUid.Trim())).ToList()
            })
            .Where(group => group.Crews.Count > 0)
            .ToList();

        return legacy with
        {
            Groups = groups,
            TotalGroups = groups.Count,
            TotalCrews = groups.Sum(group => group.Crews.Count)
        };
    }

    public async Task<AssignableActivitiesResponse> GetAssignableActivitiesAsync(
        string? crewGroup, string? crewTypeCode, CancellationToken ct = default)
    {
        crewGroup = string.IsNullOrWhiteSpace(crewGroup) ? null : crewGroup.Trim();
        var cacheKey = $"legacy:assignable-activities:v2:{crewGroup}:{crewTypeCode}";
        if (cache.TryGetValue(cacheKey, out AssignableActivitiesResponse? cached) && cached is not null)
            return cached;

        var filter = crewGroup is null && !string.IsNullOrWhiteSpace(crewTypeCode)
            ? "AND LTRIM(RTRIM(a.CREW_GROUP_CODE)) = @crewTypeCode"
            : "";

        var sql = LoadAssignableSqlTemplate().Replace("/* __FILTER__ */", filter);

        var connStr = configuration.GetConnectionString("LegacyWellsDb")
            ?? throw new InvalidOperationException("ConnectionStrings:LegacyWellsDb is not configured.");

        await using var conn = new SqlConnection(connStr);
        await conn.OpenAsync(ct);
        await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 120 };
        cmd.Parameters.Add("@crewGroup", System.Data.SqlDbType.NVarChar, 255).Value = (object?)crewGroup ?? DBNull.Value;
        if (crewGroup is null && !string.IsNullOrWhiteSpace(crewTypeCode))
            cmd.Parameters.AddWithValue("@crewTypeCode", crewTypeCode);

        var activities = new List<AssignableActivityDto>();
        await using var rdr = await cmd.ExecuteReaderAsync(ct);
        while (await rdr.ReadAsync(ct))
        {
            activities.Add(new AssignableActivityDto(
                ActivityCode: rdr.GetString(0),
                ActivityName: rdr.IsDBNull(1) ? "" : rdr.GetString(1),
                CrewGroupCode: rdr.IsDBNull(2) ? null : rdr.GetString(2),
                CrewTypeCode: rdr.IsDBNull(3) ? null : rdr.GetString(3),
                Discipline: rdr.IsDBNull(4) ? null : rdr.GetString(4),
                Uom: rdr.IsDBNull(5) ? null : rdr.GetString(5),
                Norm: rdr.IsDBNull(6) ? null : Convert.ToDecimal(rdr.GetValue(6))));
        }

        logger.LogInformation("Legacy assignable activities: {Count} rows from DB", activities.Count);

        var response = new AssignableActivitiesResponse(activities.Count, activities);
        cache.Set(cacheKey, response, CacheDuration);
        return response;
    }

    private async Task<CrewCalendarResponse> ExecuteAsync(
        string? cluster, string? site, string? wellType, string? project,
        DateTime fromDt, DateTime toDt, CancellationToken ct)
    {
        var stopwatch = Stopwatch.StartNew();
        var sql = LoadSqlTemplate();
        var projectClusters = await GetProjectClustersAsync(ct);
        var shareLatestRows = string.IsNullOrWhiteSpace(cluster) && string.IsNullOrWhiteSpace(site)
            && string.IsNullOrWhiteSpace(wellType) && string.IsNullOrWhiteSpace(project);
        var snapshot = shareLatestRows ? await GetLatestRowsAsync(ct) : null;
        if (shareLatestRows)
        {
            sql = sql.Replace("/* __SHARED_LATEST_ROWS__ */", "SET @sharedLatestRows = @latestRowsJson;");
        }

        // Apply optional filters by replacing placeholders
        sql = sql.Replace("/* __WELL_TYPE_FILTER__ */",
            string.IsNullOrWhiteSpace(wellType) ? "" : "AND atp.type = @wellType");
        sql = sql.Replace("/* __PROJECT_FILTER__ */",
            string.IsNullOrWhiteSpace(project) ? "" : "AND atp.project_id = @project");

        var hasScope = !string.IsNullOrWhiteSpace(cluster) || !string.IsNullOrWhiteSpace(site);
        sql = sql.Replace("/* __SCOPE_FILTER__ */", hasScope
            ? $"AND TRY_CONVERT(uniqueidentifier, LTRIM(RTRIM(atp.project_id))) IN ({ScopeProjectsSql})"
            : "");

        var connStr = configuration.GetConnectionString("LegacyWellsDb")
            ?? throw new InvalidOperationException("ConnectionStrings:LegacyWellsDb is not configured.");

        await using var conn = new SqlConnection(connStr);
        await conn.OpenAsync(ct);
        await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 120 };
        cmd.Parameters.Add("@fromDate", System.Data.SqlDbType.DateTime2).Value = fromDt;
        cmd.Parameters.Add("@toDate", System.Data.SqlDbType.DateTime2).Value = toDt;
        if (snapshot is not null)
            cmd.Parameters.Add("@latestRowsJson", System.Data.SqlDbType.NVarChar, -1).Value = JsonSerializer.Serialize(snapshot.RowIds);
        if (!string.IsNullOrWhiteSpace(wellType)) cmd.Parameters.AddWithValue("@wellType", wellType);
        if (!string.IsNullOrWhiteSpace(project)) cmd.Parameters.AddWithValue("@project", project);
        if (hasScope) AddScopeParameters(cmd, cluster, site);

        var rows = new List<FlatRow>();
        await using var rdr = await cmd.ExecuteReaderAsync(ct);
        while (await rdr.ReadAsync(ct))
        {
            rows.Add(new FlatRow(
                CrewGroup: rdr.IsDBNull(0) ? null : rdr.GetString(0),
                CrewCode: rdr.IsDBNull(1) ? null : rdr.GetString(1),
                CrewId: rdr.IsDBNull(2) ? null : rdr.GetString(2),
                Category: rdr.IsDBNull(3) ? null : rdr.GetString(3),
                ActivityCode: rdr.GetString(4),
                ActivityName: rdr.GetString(5),
                ActivityType: rdr.IsDBNull(6) ? null : rdr.GetString(6),
                PlannedStart: rdr.IsDBNull(7) ? "" : rdr.GetString(7),
                PlannedEnd: rdr.IsDBNull(8) ? "" : rdr.GetString(8),
                ActualStart: rdr.IsDBNull(9) ? null : rdr.GetString(9),
                ActualEnd: rdr.IsDBNull(10) ? null : rdr.GetString(10),
                Progress: rdr.GetDecimal(11),
                WellId: rdr.GetString(12),
                IsMilestone: rdr.GetInt32(13) == 1,
                Status: rdr.GetString(14),
                RigOnDate: rdr.IsDBNull(15) ? null : rdr.GetString(15),
                NormsPerDay: rdr.IsDBNull(19) ? null : rdr.GetDecimal(19),
                ProductivityPct: rdr.IsDBNull(20) ? null : rdr.GetDecimal(20),
                ProjectId: rdr.IsDBNull(21) ? null : rdr.GetString(21)));
        }

        logger.LogInformation("Legacy crew calendar: {Count} rows from DB in {ElapsedMs} ms; shared latest row IDs: {LatestRowCount}",
            rows.Count, stopwatch.ElapsedMilliseconds, snapshot?.RowIds.Length ?? 0);

        var milestoneRows = rows.Where(r => r.IsMilestone).ToList();
        var crewRows = rows.Where(r => !r.IsMilestone && !string.IsNullOrEmpty(r.CrewGroup)).ToList();

        var groups = crewRows
            .GroupBy(r => r.CrewGroup!, StringComparer.OrdinalIgnoreCase)
            .OrderBy(g => g.Key, StringComparer.OrdinalIgnoreCase)
            .Select(cgg =>
            {
                var activities = cgg.ToList();
                var completed = activities.Count(a => a.Status == "completed");
                var pct = activities.Count > 0 ? (decimal)completed / activities.Count * 100 : 0;
                return new CrewCalendarGroupDto(
                    CrewGroupCode: cgg.Key,
                    ActivityCount: activities.Count,
                    CompletionPct: Math.Round(pct, 1),
                    Crews: cgg
                        .GroupBy(r => r.CrewId?.Trim() ?? "", StringComparer.OrdinalIgnoreCase)
                        .OrderBy(g => g.Key, StringComparer.OrdinalIgnoreCase)
                        .Select(cg => new CrewCalendarCrewDto(
                            CrewCode: cg.Key,
                            Activities: cg.Select(row => ToDto(row, projectClusters)).ToList()))
                        .ToList());
            })
            .ToList();

        var milestones = milestoneRows.Select(row => ToDto(row, projectClusters)).ToList();

        var result = new CrewCalendarResponse(
            TotalGroups: groups.Count,
            TotalCrews: groups.Sum(g => g.Crews.Count(c => !string.IsNullOrWhiteSpace(c.CrewCode))),
            TotalActivities: crewRows.Count,
            TotalMilestones: milestones.Count,
            FromDate: fromDt.ToString("yyyy-MM-dd"),
            ToDate: toDt.ToString("yyyy-MM-dd"),
            Groups: groups,
            Milestones: milestones);
        if (snapshot is not null)
            SourceSnapshots.Add(result, snapshot);
        return result;
    }

    private static CrewCalendarActivityDto ToDto(FlatRow r, IReadOnlyDictionary<Guid, string> projectClusters) => new(
        ActivityCode: r.ActivityCode,
        ActivityName: r.ActivityName,
        WellId: r.WellId,
        Category: r.Category,
        PlannedStart: r.PlannedStart,
        PlannedEnd: r.PlannedEnd,
        ActualStart: r.ActualStart,
        ActualEnd: r.ActualEnd,
        Progress: r.Progress,
        Status: r.Status,
        IsMilestone: r.IsMilestone,
        RigOnDate: r.RigOnDate,
        ExpectedRigOnDate: null,
        NormsPerDay: r.NormsPerDay,
        ProductivityPct: r.ProductivityPct,
        Source: "legacy",
        Cluster: ProjectCluster(r.ProjectId, projectClusters));

    private record FlatRow(
        string? CrewGroup, string? CrewCode, string? CrewId,
        string? Category, string ActivityCode, string ActivityName,
        string? ActivityType, string PlannedStart, string PlannedEnd,
        string? ActualStart, string? ActualEnd, decimal Progress,
        string WellId, bool IsMilestone, string Status,
        string? RigOnDate, decimal? NormsPerDay, decimal? ProductivityPct,
        string? ProjectId);
}
