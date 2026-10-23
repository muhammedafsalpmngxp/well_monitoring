using System.Diagnostics;
using System.Globalization;
using System.Reflection;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs.Legacy;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Infrastructure.Services.Legacy;

namespace TWise.Tenant.Infrastructure.Services;

/// <remarks>
/// Calendar activities are read from AlTasnimBI.dbo.crew_calendar_result. When the requested range is not inside
/// the range this process last loaded, the table is reloaded for the requested range with
/// dbo.Load_CrewCalendar_Result first. The roster is loaded once without a date window and clipped per range in
/// memory. Unassigned crews and assignable activities use the existing crew calendar service.
/// </remarks>
public sealed class CrewCalendarService(
    IConfiguration configuration,
    IMemoryCache cache,
    ICrewAssignmentRepository assignmentRepo,
    ILegacyCrewCalendarService crewData,
    ILogger<CrewCalendarService> logger) : ICrewCalendarService
{
    private static readonly TimeSpan CacheDuration = TimeSpan.FromMinutes(5);
    private const string CalendarDateFormat = "yyyy-MM-dd";
    private readonly CrewCalendarCache calendarCache = new(cache);

    private const string PlantCompatibilitySql = """
        IF TRY_CONVERT(int, @plant) IS NOT NULL
        BEGIN
            SELECT @plant = COALESCE(MAX(NULLIF(LTRIM(RTRIM(plant_description)), '')), @plant)
            FROM AlTasnimBI.core.plant_description
            WHERE plant_code = TRY_CONVERT(int, @plant);
        END;
        """;

    private const string ScopeProjectsSql = """
        SELECT DISTINCT projects.project_id AS ProjectId
        FROM AlTasnimBI.project.project_mstr projects
        INNER JOIN AlTasnimBI.core.plant_description plants
            ON plants.plant_code = TRY_CONVERT(int, projects.site_code)
        INNER JOIN AlTasnimBI.ref.cluster clusters
            ON clusters.cluster_code = plants.cluster_code
        WHERE (@cluster IS NULL OR LTRIM(RTRIM(clusters.cluster_name)) = @cluster)
          AND (@site IS NULL OR plants.plant_code = TRY_CONVERT(int, @site)
               OR LTRIM(RTRIM(plants.plant_description)) = @site)
        """;

    private static readonly Lazy<string> CalendarSql = new(() =>
        PlantCompatibilitySql + Environment.NewLine + LoadSql("crew-calendar-result.sql"));
    private static readonly Lazy<string> RosterSourceSql = new(() => LoadSql("crew-roster-source.sql"));
    internal const string RosterSourceCacheKey = "bi:crew-roster-source:v1";

    public async Task<CrewCalendarResponse> GetCrewCalendarAsync(
        string? cluster, string? site, string? wellType, string? project,
        DateOnly? from, DateOnly? to, bool includeAssignments = false, CancellationToken ct = default)
    {
        var today = DateTime.UtcNow.Date;
        var fromDt = (from ?? DateOnly.FromDateTime(today.AddDays(-14))).ToDateTime(TimeOnly.MinValue);
        var toDt = (to ?? DateOnly.FromDateTime(today.AddDays(14))).ToDateTime(TimeOnly.MaxValue);

        if (!string.IsNullOrWhiteSpace(project) && !Guid.TryParse(project, out _))
            return SeparatePlanningData(new CrewCalendarResponse(0, 0, 0, 0,
                fromDt.ToString(CalendarDateFormat), toDt.ToString(CalendarDateFormat), [], []), fromDt, toDt);

        var cacheKey = $"bi:crew-cal-result:v1:{cluster}:{site}:{wellType}:{project}:{fromDt:yyyyMMdd}:{toDt:yyyyMMdd}";
        var cached = await calendarCache.GetOrCreateAsync(cacheKey, CacheDuration,
            token => ExecuteAsync(cluster, site, wellType, project, fromDt, toDt, token), ct);

        // Assignments are merged after the cached read so newly assigned crews appear immediately.
        var response = includeAssignments
            ? await OverlayAssignmentsAsync(cached, cluster, site, project, fromDt, toDt, ct)
            : cached;
        return await PopulateCrewGroupNamesAsync(SeparatePlanningData(response, fromDt, toDt), ct);
    }

    public Task<UnassignedCrewsResponse> GetUnassignedCrewsAsync(
        string? crewGroup, DateOnly? from, DateOnly? to, CancellationToken ct = default) =>
        crewData.GetUnassignedCrewsAsync(crewGroup, from, to, ct);

    public Task PreloadRosterAsync(CancellationToken ct = default) => GetRosterSourceAsync(ct);

    private Task<RosterSource> GetRosterSourceAsync(CancellationToken ct) =>
        calendarCache.GetOrCreateAsync(RosterSourceCacheKey, CacheDuration, LoadRosterSourceAsync, ct);

    public async Task<CrewRosterResponse> GetCrewRosterAsync(
        DateOnly from, DateOnly to, CancellationToken ct = default, bool includeAssignments = true)
    {
        var fromDt = from.ToDateTime(TimeOnly.MinValue);
        var toDt = to.ToDateTime(TimeOnly.MaxValue);
        // The roster query is the slow part of a calendar load and does not depend on the date range,
        // so it is loaded once and each range's bookings are derived from it in memory.
        var source = await GetRosterSourceAsync(ct);
        var roster = BuildRoster(source, fromDt, toDt);

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

    public Task<AssignableActivitiesResponse> GetAssignableActivitiesAsync(
        string? crewGroup, string? crewTypeCode, CancellationToken ct = default) =>
        crewData.GetAssignableActivitiesAsync(crewGroup, crewTypeCode, ct);

    internal static SqlCommand CreateCalendarCommand(SqlConnection connection,
        string? cluster, string? site, string? wellType, string? project, DateTime fromDt, DateTime toDt)
    {
        var command = new SqlCommand(CalendarSql.Value, connection) { CommandTimeout = 120 };
        command.Parameters.Add("@fromDate", System.Data.SqlDbType.Date).Value = fromDt.Date;
        command.Parameters.Add("@toDate", System.Data.SqlDbType.Date).Value = toDt.Date;
        command.Parameters.Add("@cluster", System.Data.SqlDbType.NVarChar, 100).Value =
            string.IsNullOrWhiteSpace(cluster) ? DBNull.Value : cluster.Trim();
        command.Parameters.Add("@plant", System.Data.SqlDbType.NVarChar, 100).Value =
            string.IsNullOrWhiteSpace(site) ? DBNull.Value : site.Trim();
        command.Parameters.Add("@wellType", System.Data.SqlDbType.NVarChar, 50).Value =
            string.IsNullOrWhiteSpace(wellType) ? DBNull.Value : wellType.Trim();
        command.Parameters.Add("@project", System.Data.SqlDbType.UniqueIdentifier).Value =
            string.IsNullOrWhiteSpace(project) ? DBNull.Value : Guid.Parse(project);
        return command;
    }

    private async Task<CrewCalendarResponse> ExecuteAsync(
        string? cluster, string? site, string? wellType, string? project,
        DateTime fromDt, DateTime toDt, CancellationToken ct)
    {
        var stopwatch = Stopwatch.StartNew();
        var projectClusters = await GetProjectClustersAsync(ct);
        await using var connection = new SqlConnection(GetConnectionString());
        await connection.OpenAsync(ct);

        var rows = new List<CalendarRow>();
        await using (await AcquireLoadedRangeAsync(connection, fromDt, toDt, ct))
        {
            await using var command = CreateCalendarCommand(connection, cluster, site, wellType, project, fromDt, toDt);
            await using var reader = await command.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                rows.Add(new CalendarRow(
                    CrewGroup: reader.IsDBNull(0) ? null : reader.GetString(0),
                    CrewId: reader.IsDBNull(2) ? null : reader.GetString(2),
                    Category: reader.IsDBNull(3) ? null : reader.GetString(3),
                    ActivityCode: reader.GetString(4),
                    ActivityName: reader.GetString(5),
                    PlannedStart: reader.IsDBNull(7) ? "" : reader.GetString(7),
                    PlannedEnd: reader.IsDBNull(8) ? "" : reader.GetString(8),
                    ActualStart: reader.IsDBNull(9) ? null : reader.GetString(9),
                    ActualEnd: reader.IsDBNull(10) ? null : reader.GetString(10),
                    Progress: reader.GetDecimal(11),
                    WellId: reader.GetString(12),
                    IsMilestone: reader.GetInt32(13) == 1,
                    Status: reader.GetString(14),
                    RigOnDate: reader.IsDBNull(15) ? null : reader.GetString(15),
                    NormsPerDay: reader.IsDBNull(19) ? null : reader.GetDecimal(19),
                    ProductivityPct: reader.IsDBNull(20) ? null : reader.GetDecimal(20),
                    ProjectId: reader.IsDBNull(21) ? null : reader.GetString(21),
                    PlantCode: reader.IsDBNull(22) ? null : reader.GetInt32(22)));
            }
        }

        logger.LogInformation("Crew calendar result: {Count} rows from DB in {ElapsedMs} ms",
            rows.Count, stopwatch.ElapsedMilliseconds);

        var crewRows = rows.Where(row => !row.IsMilestone && !string.IsNullOrEmpty(row.CrewGroup)).ToList();
        var groups = crewRows
            .GroupBy(row => row.CrewGroup!, StringComparer.OrdinalIgnoreCase)
            .OrderBy(group => group.Key, StringComparer.OrdinalIgnoreCase)
            .Select(group =>
            {
                var activities = group.ToList();
                var completed = activities.Count(activity => activity.Status == "completed");
                return new CrewCalendarGroupDto(
                    CrewGroupCode: group.Key,
                    ActivityCount: activities.Count,
                    CompletionPct: Math.Round((decimal)completed / activities.Count * 100, 1),
                    Crews: group
                        .GroupBy(row => row.CrewId?.Trim() ?? "", StringComparer.OrdinalIgnoreCase)
                        .OrderBy(crew => crew.Key, StringComparer.OrdinalIgnoreCase)
                        .Select(crew => new CrewCalendarCrewDto(crew.Key,
                            crew.Select(row => ToDto(row, projectClusters)).ToList()))
                        .ToList());
            })
            .ToList();
        var milestones = rows.Where(row => row.IsMilestone).Select(row => ToDto(row, projectClusters)).ToList();

        return new CrewCalendarResponse(
            TotalGroups: groups.Count,
            TotalCrews: groups.Sum(group => group.Crews.Count(crew => !string.IsNullOrWhiteSpace(crew.CrewCode))),
            TotalActivities: crewRows.Count,
            TotalMilestones: milestones.Count,
            FromDate: fromDt.ToString(CalendarDateFormat),
            ToDate: toDt.ToString(CalendarDateFormat),
            Groups: groups,
            Milestones: milestones);
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
                    CompletionPct = Math.Round((decimal)actualActivities.Count(activity =>
                        TryCalendarDate(activity.ActualEnd, out _)) / actualActivities.Count * 100, 1)
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
        const string cacheKey = "bi:crew-group-names:v1";
        if (!cache.TryGetValue(cacheKey, out Dictionary<string, string>? names) || names is null)
        {
            await using var connection = new SqlConnection(GetConnectionString());
            await connection.OpenAsync(ct);
            const string sql = """
                SELECT LTRIM(RTRIM(crew_type_code)), MAX(NULLIF(LTRIM(RTRIM(crew_type_name)), ''))
                FROM AlTasnimBI.ref.crew_type
                WHERE crew_type_code IS NOT NULL
                GROUP BY LTRIM(RTRIM(crew_type_code));
                """;
            await using var command = new SqlCommand(sql, connection) { CommandTimeout = 120 };
            await using var reader = await command.ExecuteReaderAsync(ct);
            names = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            while (await reader.ReadAsync(ct))
                if (!reader.IsDBNull(1)) names[reader.GetString(0)] = reader.GetString(1);
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
        const string cacheKey = "bi:crew-project-clusters:v1";
        if (cache.TryGetValue(cacheKey, out Dictionary<Guid, string>? clusters) && clusters is not null)
            return clusters;

        await using var connection = new SqlConnection(GetConnectionString());
        await connection.OpenAsync(ct);
        const string sql = """
            SELECT projects.project_id,
                MIN(NULLIF(LTRIM(RTRIM(projects.cluster)), ''))
            FROM AlTasnimBI.project.project_mstr projects
            WHERE projects.project_id IS NOT NULL
            GROUP BY projects.project_id
            HAVING COUNT(DISTINCT NULLIF(LTRIM(RTRIM(projects.cluster)), '')) = 1;
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
        var cacheKey = $"bi:crew-scope:v1:{cluster?.Trim()}:{site?.Trim()}";
        if (cache.TryGetValue(cacheKey, out HashSet<Guid>? projects) && projects is not null) return projects;

        await using var connection = new SqlConnection(GetConnectionString());
        await connection.OpenAsync(ct);
        await using var command = new SqlCommand(ScopeProjectsSql, connection) { CommandTimeout = 120 };
        command.Parameters.Add("@cluster", System.Data.SqlDbType.NVarChar, 200).Value =
            string.IsNullOrWhiteSpace(cluster) ? DBNull.Value : cluster.Trim();
        command.Parameters.Add("@site", System.Data.SqlDbType.NVarChar, 200).Value =
            string.IsNullOrWhiteSpace(site) ? DBNull.Value : site.Trim();
        projects = [];
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
            if (!reader.IsDBNull(0)) projects.Add(reader.GetGuid(0));
        cache.Set(cacheKey, projects, CacheDuration);
        return projects;
    }

    private async Task<CrewCalendarResponse> OverlayAssignmentsAsync(
        CrewCalendarResponse calendar, string? cluster, string? site, string? project,
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
            assignments = assignments.Where(assignment => assignment.ProjectId == null || assignment.ProjectId == project)
                .ToList();
        if (assignments.Count == 0) return calendar;

        var projectClusters = await GetProjectClustersAsync(ct);
        var model = new Dictionary<string, Dictionary<string, List<CrewCalendarActivityDto>>>(StringComparer.OrdinalIgnoreCase);
        foreach (var group in calendar.Groups)
        {
            var crews = new Dictionary<string, List<CrewCalendarActivityDto>>(StringComparer.OrdinalIgnoreCase);
            foreach (var crew in group.Crews) crews[crew.CrewCode] = crew.Activities.ToList();
            model[group.CrewGroupCode] = crews;
        }

        foreach (var assignment in assignments)
        {
            if (!model.TryGetValue(assignment.CrewGroupCode, out var crews))
            {
                crews = new Dictionary<string, List<CrewCalendarActivityDto>>(StringComparer.OrdinalIgnoreCase);
                model[assignment.CrewGroupCode] = crews;
            }
            if (!crews.TryGetValue(assignment.CrewUid, out var activities))
            {
                activities = [];
                crews[assignment.CrewUid] = activities;
            }
            var activity = ToAssignmentDto(assignment) with { Cluster = ProjectCluster(assignment.ProjectId, projectClusters) };
            if (activities.Any(existing =>
                    string.Equals(existing.ActivityCode, activity.ActivityCode, StringComparison.OrdinalIgnoreCase) &&
                    string.Equals(existing.WellId, activity.WellId, StringComparison.OrdinalIgnoreCase) &&
                    existing.PlannedStart == activity.PlannedStart && existing.PlannedEnd == activity.PlannedEnd))
                continue;
            activities.Add(activity);
        }

        var groups = model
            .OrderBy(group => group.Key, StringComparer.OrdinalIgnoreCase)
            .Select(group =>
            {
                var activities = group.Value.Values.SelectMany(activity => activity).ToList();
                var completed = activities.Count(activity => activity.Status == "completed");
                var completionPct = activities.Count > 0 ? (decimal)completed / activities.Count * 100 : 0;
                return new CrewCalendarGroupDto(
                    CrewGroupCode: group.Key,
                    ActivityCount: activities.Count,
                    CompletionPct: Math.Round(completionPct, 1),
                    Crews: group.Value
                        .OrderBy(crew => crew.Key, StringComparer.OrdinalIgnoreCase)
                        .Select(crew => new CrewCalendarCrewDto(crew.Key, crew.Value))
                        .ToList());
            })
            .ToList();

        return calendar with
        {
            TotalGroups = groups.Count,
            TotalCrews = groups.Sum(group => group.Crews.Count(crew => !string.IsNullOrWhiteSpace(crew.CrewCode))),
            TotalActivities = groups.Sum(group => group.Crews.Sum(crew => crew.Activities.Count)),
            Groups = groups
        };
    }

    private static CrewCalendarActivityDto ToAssignmentDto(CrewActivityAssignment assignment) => new(
        ActivityCode: assignment.ActivityCode,
        ActivityName: assignment.ActivityName,
        WellId: assignment.WellId ?? "",
        Category: null,
        PlannedStart: assignment.PlannedStart?.ToString(CalendarDateFormat) ?? "",
        PlannedEnd: assignment.PlannedEnd?.ToString(CalendarDateFormat) ?? "",
        ActualStart: null,
        ActualEnd: null,
        Progress: assignment.Progress,
        Status: "notstarted",
        IsMilestone: false,
        RigOnDate: null,
        ExpectedRigOnDate: null,
        NormsPerDay: null,
        ProductivityPct: null,
        Source: "assignment",
        AssignmentId: assignment.Id);

    // Source stays "legacy" because that is the existing UI contract for database-backed activities.
    private static CrewCalendarActivityDto ToDto(CalendarRow row, IReadOnlyDictionary<Guid, string> projectClusters) => new(
        ActivityCode: row.ActivityCode,
        ActivityName: row.ActivityName,
        WellId: row.WellId,
        Category: row.Category,
        PlannedStart: row.PlannedStart,
        PlannedEnd: row.PlannedEnd,
        ActualStart: row.ActualStart,
        ActualEnd: row.ActualEnd,
        Progress: row.Progress,
        Status: row.Status,
        IsMilestone: row.IsMilestone,
        RigOnDate: row.RigOnDate,
        ExpectedRigOnDate: null,
        NormsPerDay: row.NormsPerDay,
        ProductivityPct: row.ProductivityPct,
        Source: "legacy",
        Cluster: ProjectCluster(row.ProjectId, projectClusters),
        PlantCode: row.PlantCode);

    private string GetConnectionString() => configuration.GetConnectionString("AlTasnimBI")
        ?? throw new InvalidOperationException("ConnectionStrings:AlTasnimBI is not configured.");

    private const string LoadLockResource = "TWise.CrewCalendarResult";
    private static readonly TimeSpan LoadTimeout = TimeSpan.FromMinutes(10);

    // crew_calendar_result records neither the range it was loaded for nor who loaded it, so this process
    // remembers the range it last loaded together with that load's created_at stamp. A different stamp
    // means the table was reloaded elsewhere, and the range is then treated as unknown.
    private static LoadedRange? lastLoadedRange;

    internal sealed record LoadedRange(DateOnly From, DateOnly To, DateTime? Stamp);

    internal static bool Covers(LoadedRange? loaded, DateTime? currentStamp, DateOnly from, DateOnly to) =>
        loaded is not null && loaded.Stamp == currentStamp && loaded.From <= from && loaded.To >= to;

    /// <summary>
    /// Ensures crew_calendar_result holds a range covering the request, reloading it with
    /// dbo.Load_CrewCalendar_Result when it does not, and holds a database-wide lock until the returned lease is
    /// disposed, so another request cannot replace the data between the check and the read.
    /// </summary>
    private async Task<IAsyncDisposable> AcquireLoadedRangeAsync(
        SqlConnection connection, DateTime fromDt, DateTime toDt, CancellationToken ct)
    {
        var from = DateOnly.FromDateTime(fromDt);
        var to = DateOnly.FromDateTime(toDt);

        await AcquireLoadLockAsync(connection, "Shared", ct);
        try
        {
            if (Covers(Volatile.Read(ref lastLoadedRange), await ReadLoadStampAsync(connection, null, ct), from, to))
                return new LoadLockLease(connection, logger);
        }
        catch
        {
            await ReleaseLoadLockAsync(connection, logger);
            throw;
        }
        await ReleaseLoadLockAsync(connection, logger);

        await AcquireLoadLockAsync(connection, "Exclusive", ct);
        try
        {
            if (!Covers(Volatile.Read(ref lastLoadedRange), await ReadLoadStampAsync(connection, null, ct), from, to))
            {
                var stopwatch = Stopwatch.StartNew();
                // The procedure truncates before inserting; the transaction keeps readers on the previous data
                // until the new range is complete, and restores it if the load fails or is cancelled.
                await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(ct);
                await using (var load = new SqlCommand("AlTasnimBI.dbo.Load_CrewCalendar_Result", connection, transaction)
                {
                    CommandType = System.Data.CommandType.StoredProcedure,
                    CommandTimeout = (int)LoadTimeout.TotalSeconds
                })
                {
                    load.Parameters.Add("@fromDate", System.Data.SqlDbType.Date).Value = from.ToDateTime(TimeOnly.MinValue);
                    load.Parameters.Add("@toDate", System.Data.SqlDbType.Date).Value = to.ToDateTime(TimeOnly.MinValue);
                    await load.ExecuteNonQueryAsync(ct);
                }
                var stamp = await ReadLoadStampAsync(connection, transaction, ct);
                await transaction.CommitAsync(ct);
                Volatile.Write(ref lastLoadedRange, new LoadedRange(from, to, stamp));
                logger.LogInformation("Crew calendar result reloaded for {From:yyyy-MM-dd}..{To:yyyy-MM-dd} in {ElapsedMs} ms",
                    from, to, stopwatch.ElapsedMilliseconds);
            }
            return new LoadLockLease(connection, logger);
        }
        catch
        {
            await ReleaseLoadLockAsync(connection, logger);
            throw;
        }
    }

    private static async Task<DateTime?> ReadLoadStampAsync(
        SqlConnection connection, SqlTransaction? transaction, CancellationToken ct)
    {
        await using var command = new SqlCommand(
            "SELECT MAX(created_at) FROM AlTasnimBI.dbo.crew_calendar_result;", connection, transaction)
        {
            CommandTimeout = (int)LoadTimeout.TotalSeconds
        };
        return await command.ExecuteScalarAsync(ct) is DateTime stamp ? stamp : null;
    }

    private static async Task AcquireLoadLockAsync(SqlConnection connection, string mode, CancellationToken ct)
    {
        await using var command = new SqlCommand("""
            DECLARE @result int;
            EXEC @result = sp_getapplock @Resource = @resource, @LockMode = @mode,
                @LockOwner = 'Session', @LockTimeout = @timeoutMs;
            SELECT @result;
            """, connection)
        {
            CommandTimeout = (int)LoadTimeout.TotalSeconds + 30
        };
        command.Parameters.Add("@resource", System.Data.SqlDbType.NVarChar, 255).Value = LoadLockResource;
        command.Parameters.Add("@mode", System.Data.SqlDbType.NVarChar, 32).Value = mode;
        command.Parameters.Add("@timeoutMs", System.Data.SqlDbType.Int).Value = (int)LoadTimeout.TotalMilliseconds;
        if (Convert.ToInt32(await command.ExecuteScalarAsync(ct), CultureInfo.InvariantCulture) < 0)
            throw new TimeoutException("Crew calendar data is still being refreshed. Please try again shortly.");
    }

    private static async Task ReleaseLoadLockAsync(SqlConnection connection, ILogger logger)
    {
        if (connection.State != System.Data.ConnectionState.Open) return;
        try
        {
            await using var command = new SqlCommand(
                "EXEC sp_releaseapplock @Resource = @resource, @LockOwner = 'Session';", connection);
            command.Parameters.Add("@resource", System.Data.SqlDbType.NVarChar, 255).Value = LoadLockResource;
            await command.ExecuteNonQueryAsync(CancellationToken.None);
        }
        catch (SqlException exception)
        {
            // Closing the connection resets the session, which also releases its application locks.
            logger.LogWarning(exception, "Could not release the crew calendar load lock explicitly");
        }
    }

    private sealed class LoadLockLease(SqlConnection connection, ILogger logger) : IAsyncDisposable
    {
        public async ValueTask DisposeAsync() => await ReleaseLoadLockAsync(connection, logger);
    }

    private async Task<RosterSource> LoadRosterSourceAsync(CancellationToken ct)
    {
        var stopwatch = Stopwatch.StartNew();
        await using var connection = new SqlConnection(GetConnectionString());
        await connection.OpenAsync(ct);
        await using var command = CreateRosterSourceCommand(connection);
        await using var reader = await command.ExecuteReaderAsync(ct);

        var members = new List<RosterMember>();
        while (await reader.ReadAsync(ct))
            members.Add(new RosterMember(reader.GetString(0), reader.IsDBNull(1) ? null : reader.GetString(1),
                reader.GetString(2), reader.IsDBNull(3) ? null : reader.GetString(3)));

        await reader.NextResultAsync(ct);
        var activities = new List<RosterActivity>();
        while (await reader.ReadAsync(ct))
            activities.Add(new RosterActivity(reader.GetString(0), NullableDate(reader, 1), NullableDate(reader, 2),
                NullableDate(reader, 3), NullableDate(reader, 4)));

        await reader.NextResultAsync(ct);
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

        logger.LogInformation("Crew roster source loaded in {ElapsedMs} ms; members: {Members}, activities: {Activities}",
            stopwatch.ElapsedMilliseconds, members.Count, activities.Count);
        return new RosterSource(members, activities, projects);
    }

    internal static SqlCommand CreateRosterSourceCommand(SqlConnection connection) =>
        new(RosterSourceSql.Value, connection) { CommandTimeout = 120 };

    private static DateTime? NullableDate(SqlDataReader reader, int ordinal) =>
        reader.IsDBNull(ordinal) ? null : reader.GetDateTime(ordinal);

    internal static CrewRosterResponse BuildRoster(RosterSource source, DateTime fromDt, DateTime toDt)
    {
        var bookings = new Dictionary<string, List<CrewBookingDto>>(StringComparer.OrdinalIgnoreCase);
        var seen = new HashSet<(string Crew, CrewBookingDto Booking)>(new CrewBookingKeyComparer());
        foreach (var activity in source.Activities)
        {
            var booking = ToBooking(activity, fromDt, toDt);
            if (booking is null || !seen.Add((activity.CrewUid, booking))) continue;
            if (!bookings.TryGetValue(activity.CrewUid, out var reserved))
            {
                reserved = [];
                bookings[activity.CrewUid] = reserved;
            }
            reserved.Add(booking);
        }

        return new CrewRosterResponse(source.Members
            .GroupBy(member => member.Group, StringComparer.OrdinalIgnoreCase)
            .Select(group => new CrewRosterGroupDto(group.Key, group.Select(member => member.Name)
                    .FirstOrDefault(name => !string.IsNullOrWhiteSpace(name)),
                group.DistinctBy(member => member.Crew, StringComparer.OrdinalIgnoreCase)
                    .Select(member => new CrewRosterMemberDto(member.Crew, member.Type,
                        bookings.GetValueOrDefault(member.Crew) ?? [],
                        source.Projects.GetValueOrDefault(member.Crew) ?? []))
                    .ToList()))
            .ToList());
    }

    // Mirrors the Bookings/SafeBookings rules in crew-roster.sql for a single activity.
    private static CrewBookingDto? ToBooking(RosterActivity activity, DateTime fromDt, DateTime toDt)
    {
        var start = activity.ActualStart < activity.PlannedStart
            ? activity.ActualStart!.Value
            : activity.PlannedStart ?? activity.ActualStart ?? fromDt;
        DateTime end;
        if (activity.ActualStart is not null && activity.ActualEnd is null)
            end = activity.PlannedEnd > toDt ? activity.PlannedEnd.Value : toDt;
        else if (activity.ActualEnd > activity.PlannedEnd)
            end = activity.ActualEnd.Value;
        else
            end = activity.PlannedEnd ?? activity.ActualEnd ?? toDt;

        if (end < start)
        {
            start = fromDt;
            end = toDt;
        }
        if (start > toDt || end < fromDt || end < start) return null;
        return new CrewBookingDto(start.ToString(CalendarDateFormat, CultureInfo.InvariantCulture),
            end.ToString(CalendarDateFormat, CultureInfo.InvariantCulture));
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
        return new CrewBookingDto(start.ToString(CalendarDateFormat), end.ToString(CalendarDateFormat));
    }

    private static string LoadSql(string fileName)
    {
        var assembly = Assembly.GetExecutingAssembly();
        var resource = assembly.GetManifestResourceNames()
            .Single(name => name.EndsWith(fileName, StringComparison.OrdinalIgnoreCase));
        using var stream = assembly.GetManifestResourceStream(resource)!;
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }

    private sealed record CalendarRow(
        string? CrewGroup, string? CrewId, string? Category, string ActivityCode, string ActivityName,
        string PlannedStart, string PlannedEnd, string? ActualStart, string? ActualEnd, decimal Progress,
        string WellId, bool IsMilestone, string Status, string? RigOnDate, decimal? NormsPerDay,
        decimal? ProductivityPct, string? ProjectId, int? PlantCode);

    internal sealed record RosterMember(string Group, string? Name, string Crew, string? Type);

    internal sealed record RosterActivity(
        string CrewUid, DateTime? PlannedStart, DateTime? PlannedEnd, DateTime? ActualStart, DateTime? ActualEnd);

    internal sealed record RosterSource(
        IReadOnlyList<RosterMember> Members,
        IReadOnlyList<RosterActivity> Activities,
        IReadOnlyDictionary<string, List<CrewProjectMappingDto>> Projects);

    private sealed class CrewBookingKeyComparer : IEqualityComparer<(string Crew, CrewBookingDto Booking)>
    {
        public bool Equals((string Crew, CrewBookingDto Booking) x, (string Crew, CrewBookingDto Booking) y) =>
            StringComparer.OrdinalIgnoreCase.Equals(x.Crew, y.Crew) && x.Booking == y.Booking;

        public int GetHashCode((string Crew, CrewBookingDto Booking) obj) =>
            HashCode.Combine(StringComparer.OrdinalIgnoreCase.GetHashCode(obj.Crew), obj.Booking);
    }
}
