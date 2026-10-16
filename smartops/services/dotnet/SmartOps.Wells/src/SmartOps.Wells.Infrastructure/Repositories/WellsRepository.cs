using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using SmartOps.Wells.Application.Abstractions;
using SmartOps.Wells.Contracts;
using SmartOps.Wells.Domain.Entities;
using SmartOps.Wells.Infrastructure.Persistence;

namespace SmartOps.Wells.Infrastructure.Repositories;

/// <summary>
/// EF Core implementation of <see cref="IWellsRepository"/>.
/// All public methods are async and accept a <see cref="CancellationToken"/>.
/// </summary>
public sealed class WellsRepository(WellsDbContext db) : IWellsRepository
{
    // ── Clusters ─────────────────────────────────────────────────────────────

    public Task<List<ClusterDto>> ListClustersAsync(CancellationToken ct = default) =>
        db.Clusters.OrderBy(c => c.Name)
          .Select(c => new ClusterDto(c.Id, c.Key, c.Name, c.Color, c.Total, c.Ready, c.Pct))
          .ToListAsync(ct);

    // ── Wells ─────────────────────────────────────────────────────────────────

    public Task<List<WellDto>> ListWellsAsync(
        string? cluster, string? status, string? search, CancellationToken ct = default)
    {
        var q = db.Wells.AsQueryable();
        if (!string.IsNullOrWhiteSpace(cluster)) q = q.Where(w => w.Cluster == cluster);
        if (!string.IsNullOrWhiteSpace(status))  q = q.Where(w => w.Status == status);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var like = $"%{search}%";
            q = q.Where(w => EF.Functions.Like(w.WellId, like)
                          || EF.Functions.Like(w.Location ?? "", like)
                          || EF.Functions.Like(w.Activity ?? "", like));
        }
        return q.OrderBy(w => w.Cluster).ThenBy(w => w.WellId)
                .Select(w => ToDto(w))
                .ToListAsync(ct);
    }

    public async Task<WellDto?> GetWellAsync(string wellId, CancellationToken ct = default)
    {
        var w = await db.Wells.FirstOrDefaultAsync(x => x.WellId == wellId, ct);
        return w is null ? null : ToDto(w);
    }

    public async Task<WellDto> CreateWellAsync(WellCreateRequest r, CancellationToken ct = default)
    {
        if (await db.Wells.AnyAsync(w => w.WellId == r.WellId, ct))
            throw new ArgumentException($"Well '{r.WellId}' already exists.");

        var w = new Well
        {
            WellId      = r.WellId,      Cluster  = r.Cluster,  Location    = r.Location,
            WellType    = r.WellType,    ActivityCode = r.ActivityCode, Activity = r.Activity,
            CrewGroup   = r.CrewGroup,   Crew     = r.Crew,
            Progress    = r.Progress,    Planned  = r.Planned,  RateDay = r.RateDay,
            AskRate     = r.AskRate,     RigOn    = r.RigOn,    Status  = r.Status,
            Spi         = r.Spi,         Cpi      = r.Cpi
        };
        db.Wells.Add(w);
        await db.SaveChangesAsync(ct);
        return ToDto(w);
    }

    public async Task<WellDto?> UpdateWellAsync(
        string wellId, WellUpdateRequest r, CancellationToken ct = default)
    {
        var w = await db.Wells.FirstOrDefaultAsync(x => x.WellId == wellId, ct);
        if (w is null) return null;

        if (r.Activity is not null) w.Activity  = r.Activity;
        if (r.Progress is not null) w.Progress  = r.Progress.Value;
        if (r.Planned  is not null) w.Planned   = r.Planned.Value;
        if (r.Status   is not null) w.Status    = r.Status;
        if (r.Spi      is not null) w.Spi       = r.Spi;
        if (r.Cpi      is not null) w.Cpi       = r.Cpi;

        await db.SaveChangesAsync(ct);
        return ToDto(w);
    }

    public async Task<bool> DeleteWellAsync(string wellId, CancellationToken ct = default)
    {
        var w = await db.Wells.FirstOrDefaultAsync(x => x.WellId == wellId, ct);
        if (w is null) return false;
        db.Wells.Remove(w);
        await db.SaveChangesAsync(ct);
        return true;
    }

    // ── Milestones ────────────────────────────────────────────────────────────

    public Task<List<MilestoneDto>> ListMilestonesAsync(
        string? wellId, string? status, CancellationToken ct = default)
    {
        var q = db.Milestones.AsQueryable();
        if (!string.IsNullOrWhiteSpace(wellId)) q = q.Where(m => m.WellId == wellId);
        if (!string.IsNullOrWhiteSpace(status)) q = q.Where(m => m.Status == status);
        return q.OrderBy(m => m.Planned)
                .Select(m => new MilestoneDto(m.Id, m.WellId, m.Name, m.Owner,
                    m.Planned, m.Forecast, m.Actual, m.VarDays, m.Status))
                .ToListAsync(ct);
    }

    // ── Watchlist ─────────────────────────────────────────────────────────────

    public Task<List<WatchlistEntryDto>> ListWatchlistAsync(int userId, CancellationToken ct = default) =>
        db.Watchlist.Where(w => w.UserId == userId)
          .Select(w => new WatchlistEntryDto(w.Id, w.UserId, w.WellId, w.Reason, w.CreatedAt))
          .ToListAsync(ct);

    public async Task<WatchlistEntryDto> AddWatchlistAsync(
        int userId, WatchlistAddRequest r, CancellationToken ct = default)
    {
        if (await db.Watchlist.AnyAsync(w => w.UserId == userId && w.WellId == r.WellId, ct))
            throw new ArgumentException("Well is already on the watchlist.");

        var entry = new WatchlistEntry { UserId = userId, WellId = r.WellId, Reason = r.Reason };
        db.Watchlist.Add(entry);
        await db.SaveChangesAsync(ct);
        return new WatchlistEntryDto(entry.Id, entry.UserId, entry.WellId, entry.Reason, entry.CreatedAt);
    }

    public async Task<bool> RemoveWatchlistAsync(int userId, string wellId, CancellationToken ct = default)
    {
        var entry = await db.Watchlist.FirstOrDefaultAsync(
            w => w.UserId == userId && w.WellId == wellId, ct);
        if (entry is null) return false;
        db.Watchlist.Remove(entry);
        await db.SaveChangesAsync(ct);
        return true;
    }

    // ── Critical Dates ────────────────────────────────────────────────────────

    public Task<List<CriticalDateDto>> ListCriticalDatesAsync(
        string? wellId, CancellationToken ct = default)
    {
        var q = db.CriticalDates.AsQueryable();
        if (!string.IsNullOrWhiteSpace(wellId)) q = q.Where(c => c.WellId == wellId);
        return q.OrderBy(c => c.Target)
                .Select(c => new CriticalDateDto(c.Id, c.WellId, c.Label, c.Target, c.Status, c.Notes))
                .ToListAsync(ct);
    }

    public async Task<CriticalDateDto> CreateCriticalDateAsync(
        CriticalDateCreateRequest r, CancellationToken ct = default)
    {
        var c = new CriticalDate
        {
            WellId = r.WellId, Label = r.Label, Target = r.Target,
            Status = r.Status, Notes = r.Notes
        };
        db.CriticalDates.Add(c);
        await db.SaveChangesAsync(ct);
        return new CriticalDateDto(c.Id, c.WellId, c.Label, c.Target, c.Status, c.Notes);
    }

    // ── Well Report Data (supplementary tables) ───────────────────────────────

    public async Task<WellReportDataDto> GetWellReportDataAsync(
        string wellId, CancellationToken ct = default)
    {
        var drillingRows = new List<DrillingSequenceItemDto>();
        var dailyRows    = new List<TaskDailyItemDto>();

        try
        {
            // Reuse EF Core's pooled connection — avoids a new TCP handshake per call.
            var conn = db.Database.GetDbConnection();
            if (conn.State != System.Data.ConnectionState.Open)
                await conn.OpenAsync(ct);

            // ── 1. SAP Drilling Sequence ─────────────────────────────────────
            try
            {
                await using var cmd = conn.CreateCommand();
                cmd.CommandTimeout = 8;
                cmd.Parameters.Add(new SqlParameter("@wellId", wellId));
                cmd.CommandText = """
                    SELECT TOP 200
                           Work_Center, Operation_Short, Activity, Opr_System_status,
                           Earl_start_date, EarliestEndDate, Normal_duration, Norm_duratn_un
                    FROM [dbo].[SAP_DRILLING_SEQUENCE_History] WITH (NOLOCK)
                    WHERE Well_ID = @wellId
                    ORDER BY Earl_start_date
                    """;
                await using var rdr = await cmd.ExecuteReaderAsync(ct);
                while (await rdr.ReadAsync(ct))
                {
                    drillingRows.Add(new DrillingSequenceItemDto(
                        WorkCenter:     rdr.IsDBNull(0) ? null : rdr.GetString(0),
                        OperationShort: rdr.IsDBNull(1) ? null : rdr.GetString(1),
                        Activity:       rdr.IsDBNull(2) ? null : rdr.GetString(2),
                        SystemStatus:   rdr.IsDBNull(3) ? null : rdr.GetString(3),
                        PlannedStart:   rdr.IsDBNull(4) ? null : rdr.GetDateTime(4).ToString("yyyy-MM-dd"),
                        PlannedEnd:     rdr.IsDBNull(5) ? null : rdr.GetDateTime(5).ToString("yyyy-MM-dd"),
                        Duration:       rdr.IsDBNull(6) ? null : rdr.GetString(6),
                        DurationUnit:   rdr.IsDBNull(7) ? null : rdr.GetString(7)
                    ));
                }
            }
            catch (Exception ex) when (ex is SqlException or InvalidOperationException) { }

            // ── 2. task_daily (ActivityTaskPlan skipped — no Well_ID index) ──
            try
            {
                await using var cmd = conn.CreateCommand();
                cmd.CommandTimeout = 8;
                cmd.Parameters.Add(new SqlParameter("@wellId", wellId));
                cmd.CommandText = """
                    SELECT TOP 60
                           task_code,
                           CAST(ActionOn             AS NVARCHAR(20)),
                           ISNULL(TRY_CAST(TRY_CAST(progress AS FLOAT) * 100 AS INT), 0) AS pct,
                           CAST(actual_start         AS NVARCHAR(20)),
                           CAST(actual_end           AS NVARCHAR(20)),
                           crew_type, crew_code, task_uom,
                           daily_actual_quantity, daily_actual_hours,
                           CAST(COALESCE(daily_completed, 0) AS BIT)
                    FROM [dbo].[task_daily] WITH (NOLOCK)
                    WHERE well_id = @wellId
                    """;
                await using var rdr = await cmd.ExecuteReaderAsync(ct);
                while (await rdr.ReadAsync(ct))
                {
                    dailyRows.Add(new TaskDailyItemDto(
                        TaskCode:       rdr.IsDBNull(0) ? null : rdr.GetString(0),
                        ActionOn:       rdr.IsDBNull(1) ? null : rdr.GetString(1),
                        ProgressPct:    rdr.IsDBNull(2) ? 0    : rdr.GetInt32(2),
                        ActualStart:    rdr.IsDBNull(3) ? null : rdr.GetString(3),
                        ActualEnd:      rdr.IsDBNull(4) ? null : rdr.GetString(4),
                        CrewType:       rdr.IsDBNull(5) ? null : rdr.GetString(5),
                        CrewCode:       rdr.IsDBNull(6) ? null : rdr.GetString(6),
                        TaskUom:        rdr.IsDBNull(7) ? null : rdr.GetString(7),
                        ActualQuantity: rdr.IsDBNull(8) ? null : rdr.GetDecimal(8),
                        ActualHours:    rdr.IsDBNull(9) ? null : rdr.GetDecimal(9),
                        DailyCompleted: !rdr.IsDBNull(10) && rdr.GetBoolean(10)
                    ));
                }
            }
            catch (Exception ex) when (ex is SqlException or InvalidOperationException) { }
        }
        catch (Exception ex) when (ex is SqlException or OperationCanceledException or InvalidOperationException)
        {
            // Server unreachable or connection error — return empty arrays; front-end falls back gracefully.
        }

        return new WellReportDataDto(wellId, drillingRows, new List<ActivityTaskItemDto>(), dailyRows);
    }

    // ── Weekly Progress Timeline ──────────────────────────────────────────────

    public async Task<List<WeeklyProgressPointDto>> GetWeeklyProgressAsync(
        string projectId, string wellId,
        DateTime? from, DateTime? to,
        TimelineViewType viewType = TimelineViewType.Week,
        CancellationToken ct = default)
    {
        var rawRows = new List<WeeklyProgressPointDto>();
        var startDate = from?.Date;
        var endDate = to?.Date;
        if (startDate.HasValue && endDate.HasValue && endDate.Value < startDate.Value)
            (startDate, endDate) = (endDate, startDate);

        try
        {
            var conn = db.Database.GetDbConnection();
            if (conn.State != System.Data.ConnectionState.Open)
                await conn.OpenAsync(ct);

            await using var cmd = conn.CreateCommand();
            cmd.CommandTimeout = 20;
            cmd.Parameters.Add(new SqlParameter("@ProjectID", projectId));
            cmd.Parameters.Add(new SqlParameter("@WellID",    wellId));

            // Weekly timeline query from WMR using Week_Number date parsing logic.
            cmd.CommandText = """
                    ;WITH ProgressData AS
                    (
                        SELECT
                            CASE
                                WHEN Week_Number LIKE '____-__-__'
                                    THEN TRY_CONVERT(DATE, Week_Number, 23)
                                ELSE TRY_CONVERT(DATE, '20' + Week_Number, 23)
                            END AS ProgressDate,
                            TRY_CAST(over_all_progress_percentages AS DECIMAL(5,2)) AS ProgressPercentage
                        FROM dbo.WMR WITH (NOLOCK)
                        WHERE project_id = @ProjectID
                          AND pdo_well_id = @WellID
                    )
                    SELECT
                        ProgressDate,
                        ProgressPercentage
                    FROM ProgressData
                    WHERE ProgressDate IS NOT NULL
                    ORDER BY ProgressDate;
                    """;

            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
            {
                if (rdr.IsDBNull(0)) continue;
                var progress = rdr.IsDBNull(1) ? 0m : Convert.ToDecimal(rdr.GetValue(1));
                rawRows.Add(new WeeklyProgressPointDto(
                    ProgressDate:       rdr.GetDateTime(0),
                    ProgressPercentage: decimal.Round(progress, 2)
                ));
            }
        }
        catch (Exception ex) when (ex is SqlException or OperationCanceledException or InvalidOperationException)
        {
            // Connection error — return empty; front-end handles gracefully.
        }

        if (rawRows.Count == 0) return new List<WeeklyProgressPointDto>();

        var daily = rawRows
            .Where(x => x.ProgressDate != default)
            .OrderBy(x => x.ProgressDate)
            .ToList();
        if (daily.Count == 0) return new List<WeeklyProgressPointDto>();

        return viewType switch
        {
            TimelineViewType.Day => daily
                .Where(x => (!startDate.HasValue || x.ProgressDate.Date >= startDate.Value)
                         && (!endDate.HasValue   || x.ProgressDate.Date <= endDate.Value))
                .Select(x => new WeeklyProgressPointDto(x.ProgressDate.Date, x.ProgressPercentage, x.Label))
                .ToList(),

            TimelineViewType.Month => BuildMonthlyTimeline(daily, startDate, endDate),

            _ => BuildWeeklyTimeline(daily, startDate, endDate)
        };
    }

    private static List<WeeklyProgressPointDto> BuildWeeklyTimeline(
        List<WeeklyProgressPointDto> daily,
        DateTime? startDate,
        DateTime? endDate)
    {
        var result = new List<WeeklyProgressPointDto>();
        if (daily.Count == 0) return result;

        var wellStart = daily[0].ProgressDate.Date;
        var rangeStart = startDate?.Date ?? wellStart;
        var rangeEnd = endDate?.Date ?? daily[^1].ProgressDate.Date;
        if (rangeEnd < rangeStart) return result;

        var weekEnd = rangeStart.AddDays(6);
        while (weekEnd <= rangeEnd)
        {
            var weekStart = weekEnd.AddDays(-6);

            var withinWeek = daily
                .Where(x => x.ProgressDate.Date >= weekStart && x.ProgressDate.Date <= weekEnd)
                .OrderByDescending(x => x.ProgressDate)
                .FirstOrDefault();

            var carryForward = daily
                .Where(x => x.ProgressDate.Date <= weekEnd)
                .OrderByDescending(x => x.ProgressDate)
                .FirstOrDefault();

            var point = withinWeek ?? carryForward;
            var progress = point?.ProgressPercentage ?? 0m;
            result.Add(new WeeklyProgressPointDto(weekEnd, decimal.Round(progress, 2)));

            weekEnd = weekEnd.AddDays(7);
        }

        // If the range ends in an incomplete week, append the latest available
        // progress inside that trailing segment using its actual progress date.
        var lastCompletedWeekEnd = weekEnd.AddDays(-7);
        var latestInRange = daily
            .Where(x => x.ProgressDate.Date >= rangeStart && x.ProgressDate.Date <= rangeEnd)
            .OrderByDescending(x => x.ProgressDate)
            .FirstOrDefault();

        if (latestInRange is not null && latestInRange.ProgressDate.Date > lastCompletedWeekEnd)
        {
            result.Add(new WeeklyProgressPointDto(
                latestInRange.ProgressDate.Date,
                decimal.Round(latestInRange.ProgressPercentage, 2)));
        }

        return result;
    }

    private static List<WeeklyProgressPointDto> BuildMonthlyTimeline(
        List<WeeklyProgressPointDto> daily,
        DateTime? startDate,
        DateTime? endDate)
    {
        var result = new List<WeeklyProgressPointDto>();
        if (daily.Count == 0) return result;

        var rangeStart = startDate?.Date ?? daily[0].ProgressDate.Date;
        var rangeEnd = endDate?.Date ?? daily[^1].ProgressDate.Date;
        if (rangeEnd < rangeStart) return result;

        var monthStart = new DateTime(rangeStart.Year, rangeStart.Month, 1);
        var lastMonthStart = new DateTime(rangeEnd.Year, rangeEnd.Month, 1);

        while (monthStart <= lastMonthStart)
        {
            var monthEnd = new DateTime(
                monthStart.Year,
                monthStart.Month,
                DateTime.DaysInMonth(monthStart.Year, monthStart.Month));

            // Keep the latest partial month by capping the bucket end to rangeEnd.
            var bucketEnd = monthEnd > rangeEnd ? rangeEnd : monthEnd;

            var withinMonth = daily
                .Where(x => x.ProgressDate.Date >= monthStart && x.ProgressDate.Date <= bucketEnd)
                .OrderByDescending(x => x.ProgressDate)
                .FirstOrDefault();

            var carryForward = daily
                .Where(x => x.ProgressDate.Date <= bucketEnd)
                .OrderByDescending(x => x.ProgressDate)
                .FirstOrDefault();

            var point = withinMonth ?? carryForward;
            var progress = point?.ProgressPercentage ?? 0m;
            result.Add(new WeeklyProgressPointDto(bucketEnd, decimal.Round(progress, 2)));

            monthStart = monthStart.AddMonths(1);
        }

        return result;
    }


    // ── Mapping ───────────────────────────────────────────────────────────────

    private static WellDto ToDto(Well w) =>
        new(w.Id, w.WellId, w.Cluster, w.Location, w.WellType, w.ActivityCode, w.Activity,
            w.CrewGroup, w.Crew, w.Progress, w.Planned, w.RateDay, w.AskRate,
            w.RigOn, w.Status, w.Spi, w.Cpi);
}
