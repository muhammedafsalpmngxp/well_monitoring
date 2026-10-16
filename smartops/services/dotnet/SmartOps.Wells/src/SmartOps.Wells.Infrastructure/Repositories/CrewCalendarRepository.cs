using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using SmartOps.Wells.Application.Abstractions;
using SmartOps.Wells.Contracts;
using SmartOps.Wells.Infrastructure.Persistence;

namespace SmartOps.Wells.Infrastructure.Repositories;

/// <summary>
/// Retrieves crew calendar data from ActivityTaskPlan for the Gantt schedule board.
/// Uses COALESCE(OLD_NEW_CREW_MAPPING.CREW_GROUP_CODE, crew_type) for reliable crew group resolution.
/// Filters 1900-01-01 sentinel dates, deduplicates via ROW_NUMBER, and derives activity status.
/// Results grouped: CrewGroup → CrewId → Activities. Milestones returned separately.
/// Cached for 5 minutes per filter combination.
/// </summary>
public sealed class CrewCalendarRepository(WellsDbContext db, IMemoryCache cache)
{
    private static readonly TimeSpan CacheDuration = TimeSpan.FromMinutes(5);

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

    public async Task<CrewCalendarResponse> GetCrewCalendarAsync(
        string? cluster,
        string? site,
        string? wellType,
        string? project,
        DateOnly? from,
        DateOnly? to,
        CancellationToken ct = default)
    {
        var today  = DateTime.UtcNow.Date;
        var fromDt = (from ?? DateOnly.FromDateTime(today.AddDays(-14))).ToDateTime(TimeOnly.MinValue);
        var toDt   = (to   ?? DateOnly.FromDateTime(today.AddDays( 14))).ToDateTime(TimeOnly.MaxValue);

        var cacheKey = $"crew-cal3:{cluster}:{site}:{wellType}:{project}:{fromDt:yyyyMMdd}:{toDt:yyyyMMdd}";
        if (cache.TryGetValue(cacheKey, out CrewCalendarResponse? cached) && cached is not null)
            return cached;

        var result = await ExecuteAsync(cluster, site, wellType, project, fromDt, toDt, ct);
        cache.Set(cacheKey, result, CacheDuration);
        return result;
    }

    private async Task<CrewCalendarResponse> ExecuteAsync(
        string? cluster,
        string? site,
        string? wellType,
        string? project,
        DateTime fromDt,
        DateTime toDt,
        CancellationToken ct)
    {
        // Optional cluster filter as inline IN list
        var clusterFilter = "";
        if (!string.IsNullOrWhiteSpace(cluster) && ClusterProjectIds.TryGetValue(cluster!, out var pids))
        {
            var list = string.Join(",", pids.Select(p => $"'{p.Replace("'", "''")}'"));
            clusterFilter = $" AND atp.project_id IN ({list})";
        }

        var sql = $"""
            ;WITH CrewGroupMap AS (
                SELECT Old_Crew_Code, MIN(CREW_GROUP_CODE) AS CREW_GROUP_CODE
                FROM dbo.OLD_NEW_CREW_MAPPING
                WHERE Old_Crew_Code IS NOT NULL AND Old_Crew_Code != ''
                  AND CREW_GROUP_CODE IS NOT NULL AND CREW_GROUP_CODE != ''
                GROUP BY Old_Crew_Code
            ),
            WmrLatest AS (
                SELECT
                    LTRIM(RTRIM(pdo_well_id)) AS WellID,
                    MAX(CASE WHEN TRY_CONVERT(DATE, actual_rig_on_date) IS NOT NULL
                             THEN CONVERT(varchar(10), TRY_CONVERT(DATE, actual_rig_on_date), 23) END) AS RigOnDate,
                    MAX(CASE WHEN TRY_CONVERT(DATE, actual_rig_on_date) IS NOT NULL
                             THEN TRY_CONVERT(DATE, actual_rig_on_date) END) AS RigOnDateDt
                FROM dbo.WMR WITH (NOLOCK)
                WHERE pdo_well_id IS NOT NULL AND LTRIM(RTRIM(pdo_well_id)) != ''
                GROUP BY LTRIM(RTRIM(pdo_well_id))
            ),
            Ranked AS (
                SELECT
                    COALESCE(m.CREW_GROUP_CODE, LTRIM(RTRIM(atp.crew_type))) AS CrewGroup,
                    LTRIM(RTRIM(atp.crew_type))                              AS CrewCode,
                    LTRIM(RTRIM(atp.crew_uid))                               AS CrewId,
                    CASE
                        WHEN atp.Parent_WBS LIKE 'W[0-9]%' THEN NULL
                        WHEN LTRIM(RTRIM(atp.Parent_WBS)) = '' THEN NULL
                        ELSE LTRIM(RTRIM(atp.Parent_WBS))
                    END                                                      AS Category,
                    LTRIM(RTRIM(atp.code))                                   AS ActivityCode,
                    LTRIM(RTRIM(COALESCE(NULLIF(CAST(atp.[text] AS NVARCHAR(500)), ''), atp.code, 'Unnamed'))) AS ActivityText,
                    atp.type                                                 AS ActivityType,
                    atp.target_start                                         AS PlannedStart,
                    atp.target_end                                           AS PlannedEnd,
                    CASE WHEN YEAR(atp.actual_start) > 1900 THEN atp.actual_start END AS ActualStart,
                    CASE WHEN YEAR(atp.actual_end)   > 1900 THEN atp.actual_end   END AS ActualEnd,
                    TRY_CAST(atp.progress AS DECIMAL(10,4))                  AS ProgressRaw,
                    TRY_CAST(atp.qty AS DECIMAL(18,4))                       AS Qty,
                    TRY_CAST(atp.manhours AS DECIMAL(18,4))                   AS Manhours,
                    TRY_CAST(atp.qtyactual AS DECIMAL(18,4))                  AS QtyActual,
                    LTRIM(RTRIM(atp.Well_ID))                                AS WellID,
                    CASE WHEN atp.type = 'M' THEN 1 ELSE 0 END              AS IsMilestone,
                    ROW_NUMBER() OVER (
                        PARTITION BY atp.code, atp.Well_ID, COALESCE(LTRIM(RTRIM(atp.crew_type)), '')
                        ORDER BY atp.schedule_id DESC, atp.updated_at DESC
                    ) AS rn
                FROM dbo.ActivityTaskPlan atp WITH (NOLOCK)
                LEFT JOIN CrewGroupMap m ON LTRIM(RTRIM(atp.crew_type)) = m.Old_Crew_Code
                WHERE atp.target_start IS NOT NULL
                  AND atp.target_end   IS NOT NULL
                  AND atp.target_start <= @toDate
                  AND atp.target_end   >= @fromDate
                  AND YEAR(atp.target_start) >= 2020
                  AND atp.Well_ID IS NOT NULL
                  AND (atp.crew_type IS NOT NULL AND LTRIM(RTRIM(atp.crew_type)) != '')
                  {(string.IsNullOrWhiteSpace(wellType) ? "" : " AND atp.type = @wellType")}
                  {(string.IsNullOrWhiteSpace(project)  ? "" : " AND atp.project_id = @project")}
                  {clusterFilter}
            )
            SELECT
                r.CrewGroup,
                r.CrewCode,
                r.CrewId,
                r.Category,
                r.ActivityCode,
                r.ActivityText,
                r.ActivityType,
                CONVERT(varchar(10), r.PlannedStart, 23) AS PlannedStart,
                CONVERT(varchar(10), r.PlannedEnd,   23) AS PlannedEnd,
                CASE WHEN r.ActualStart IS NOT NULL THEN CONVERT(varchar(10), r.ActualStart, 23) END AS ActualStart,
                CASE WHEN r.ActualEnd   IS NOT NULL THEN CONVERT(varchar(10), r.ActualEnd,   23) END AS ActualEnd,
                CAST(ISNULL(r.ProgressRaw, 0) * 100 AS DECIMAL(10,2)) AS Progress,
                r.WellID,
                r.IsMilestone,
                CASE
                    WHEN r.ActivityType = 'M' THEN 'milestone'
                    WHEN r.ProgressRaw >= 1.0 THEN 'completed'
                    WHEN r.ActualStart IS NOT NULL AND r.ProgressRaw > 0
                         AND COALESCE(w.RigOnDateDt, CAST(r.PlannedEnd AS DATE)) < CAST(GETDATE() AS DATE) THEN 'delayed'
                    WHEN r.ActualStart IS NOT NULL AND r.ProgressRaw > 0 THEN 'inprogress'
                    ELSE 'notstarted'
                END AS Status,
                w.RigOnDate,
                r.Qty,
                r.Manhours,
                r.QtyActual,
                CASE WHEN r.Manhours > 0
                     THEN CAST(r.Qty / (r.Manhours / 8.0) AS DECIMAL(10,2))
                     ELSE NULL END AS NormsPerDay,
                CASE WHEN r.Manhours > 0 AND r.ActualStart IS NOT NULL
                          AND DATEDIFF(DAY, r.ActualStart, GETDATE()) > 0
                          AND r.QtyActual IS NOT NULL AND r.QtyActual > 0
                     THEN CAST(
                         (r.QtyActual / CAST(DATEDIFF(DAY, r.ActualStart, GETDATE()) AS DECIMAL(18,4)))
                         / (r.Qty / (r.Manhours / 8.0)) * 100
                         AS DECIMAL(10,1))
                     ELSE NULL END AS ProductivityPct
            FROM Ranked r
            LEFT JOIN WmrLatest w ON r.WellID = w.WellID
            WHERE r.rn = 1
            ORDER BY r.CrewGroup ASC, r.CrewCode ASC, r.PlannedStart ASC;
            """;

        var connStr = db.Database.GetConnectionString()!;
        await using var conn = new SqlConnection(connStr);
        await conn.OpenAsync(ct);

        var rows = new List<FlatRow>();
        await using (var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 })
        {
            cmd.Parameters.AddWithValue("@fromDate", fromDt);
            cmd.Parameters.AddWithValue("@toDate",   toDt);
            if (!string.IsNullOrWhiteSpace(wellType)) cmd.Parameters.AddWithValue("@wellType", wellType);
            if (!string.IsNullOrWhiteSpace(project))  cmd.Parameters.AddWithValue("@project",  project);

            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
            {
                rows.Add(new FlatRow(
                    CrewGroup:    rdr.IsDBNull(0) ? null : rdr.GetString(0),
                    CrewCode:     rdr.IsDBNull(1) ? null : rdr.GetString(1),
                    CrewId:       rdr.IsDBNull(2) ? null : rdr.GetString(2),
                    Category:     rdr.IsDBNull(3) ? null : rdr.GetString(3),
                    ActivityCode: rdr.GetString(4),
                    ActivityName: rdr.GetString(5),
                    ActivityType: rdr.IsDBNull(6) ? null : rdr.GetString(6),
                    PlannedStart: rdr.GetString(7),
                    PlannedEnd:   rdr.GetString(8),
                    ActualStart:  rdr.IsDBNull(9)  ? null : rdr.GetString(9),
                    ActualEnd:    rdr.IsDBNull(10) ? null : rdr.GetString(10),
                    Progress:     rdr.GetDecimal(11),
                    WellId:       rdr.GetString(12),
                    IsMilestone:  rdr.GetInt32(13) == 1,
                    Status:       rdr.GetString(14),
                    RigOnDate:    rdr.IsDBNull(15) ? null : rdr.GetString(15),
                    ExpectedRigOnDate: null,
                    NormsPerDay:  rdr.IsDBNull(19) ? null : rdr.GetDecimal(19),
                    ProductivityPct: rdr.IsDBNull(20) ? null : rdr.GetDecimal(20)));
            }
        }

        // ── Separate milestones (no crew) from crew activities ────────────
        var milestoneRows = rows.Where(r => r.IsMilestone).ToList();
        var crewRows = rows.Where(r => !r.IsMilestone && !string.IsNullOrEmpty(r.CrewGroup)).ToList();

        // ── Build Gantt hierarchy: CrewGroup → CrewId → Activities ────────
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
                        .GroupBy(r => r.CrewId ?? r.CrewCode ?? "unassigned", StringComparer.OrdinalIgnoreCase)
                        .OrderBy(g => g.Key, StringComparer.OrdinalIgnoreCase)
                        .Select(cg => new CrewCalendarCrewDto(
                            CrewCode: cg.Key,
                            Activities: cg.Select(r => ToDto(r)).ToList()))
                        .ToList());
            })
            .ToList();

        var milestones = milestoneRows.Select(r => ToDto(r)).ToList();

        return new CrewCalendarResponse(
            TotalGroups:      groups.Count,
            TotalCrews:       groups.Sum(g => g.Crews.Count),
            TotalActivities:  crewRows.Count,
            TotalMilestones:  milestones.Count,
            FromDate:         fromDt.ToString("yyyy-MM-dd"),
            ToDate:           toDt.ToString("yyyy-MM-dd"),
            Groups:           groups,
            Milestones:       milestones);
    }

    private static CrewCalendarActivityDto ToDto(FlatRow r) => new(
        ActivityCode: r.ActivityCode,
        ActivityName: r.ActivityName,
        WellId:       r.WellId,
        Category:     r.Category,
        PlannedStart: r.PlannedStart,
        PlannedEnd:   r.PlannedEnd,
        ActualStart:  r.ActualStart,
        ActualEnd:    r.ActualEnd,
        Progress:     r.Progress,
        Status:       r.Status,
        IsMilestone:  r.IsMilestone,
        RigOnDate:    r.RigOnDate,
        ExpectedRigOnDate: r.ExpectedRigOnDate,
        NormsPerDay:  r.NormsPerDay,
        ProductivityPct: r.ProductivityPct);

    private record FlatRow(
        string? CrewGroup,
        string? CrewCode,
        string? CrewId,
        string? Category,
        string ActivityCode,
        string ActivityName,
        string? ActivityType,
        string PlannedStart,
        string PlannedEnd,
        string? ActualStart,
        string? ActualEnd,
        decimal Progress,
        string WellId,
        bool IsMilestone,
        string Status,
        string? RigOnDate,
        string? ExpectedRigOnDate,
        decimal? NormsPerDay,
        decimal? ProductivityPct);
}
