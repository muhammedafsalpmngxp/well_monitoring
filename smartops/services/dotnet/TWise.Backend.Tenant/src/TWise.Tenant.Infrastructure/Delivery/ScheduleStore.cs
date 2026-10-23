using Microsoft.EntityFrameworkCore;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Features.Delivery;
using TWise.Tenant.Domain.Entities.Delivery;
using TWise.Tenant.Infrastructure.Persistence;

namespace TWise.Tenant.Infrastructure.Delivery;

public sealed class ScheduleStore(TenantDbContext db) : IScheduleStore
{
    public async Task<IReadOnlyList<Schedule>> ListAsync(long tenantId, string? targetType, long? targetId, CancellationToken ct = default)
    {
        var query = db.Schedules.AsNoTracking().Include(s => s.Recipients).Where(s => s.TenantId == tenantId);
        if (!string.IsNullOrWhiteSpace(targetType)) query = query.Where(s => s.TargetType == targetType);
        if (targetId is { } id) query = query.Where(s => s.TargetId == id);
        return await query.OrderByDescending(s => s.Id).ToListAsync(ct);
    }

    public Task<Schedule?> GetAsync(long id, long? tenantId, CancellationToken ct = default)
        => db.Schedules.Include(s => s.Recipients).FirstOrDefaultAsync(s => s.Id == id && (tenantId == null || s.TenantId == tenantId), ct);

    public async Task AddAsync(Schedule schedule, CancellationToken ct = default)
    {
        db.Schedules.Add(schedule);
        await db.SaveChangesAsync(ct);
    }

    public Task SaveAsync(CancellationToken ct = default) => db.SaveChangesAsync(ct);

    public Task ReloadAsync(Schedule schedule, CancellationToken ct = default) => db.Entry(schedule).ReloadAsync(ct);

    public async Task<IReadOnlyList<long>> ClaimDueAsync(DateTime nowUtc, int max, DateTime leaseUntilUtc, CancellationToken ct = default)
    {
        // UPDLOCK + READPAST: rows another instance is claiming are skipped, not waited on, and never taken twice.
        // Moving NextRunAt to the lease in the same statement means a crash mid-run only delays the schedule.
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        var ids = await db.Database.SqlQuery<long>($"""
            WITH due AS (
                SELECT TOP ({max}) Id, NextRunAt
                FROM delivery.Schedule WITH (UPDLOCK, READPAST, ROWLOCK)
                WHERE IsActive = 1 AND IsDeleted = 0 AND NextRunAt <= {nowUtc}
                ORDER BY NextRunAt)
            UPDATE due SET NextRunAt = {leaseUntilUtc}
            OUTPUT inserted.Id AS Value;
            """).ToListAsync(ct);
        await transaction.CommitAsync(ct);
        return ids;
    }

    public async Task AddRunAsync(ScheduleRun run, CancellationToken ct = default)
    {
        db.ScheduleRuns.Add(run);
        await db.SaveChangesAsync(ct);
    }

    public async Task<(IReadOnlyList<ScheduleRun> Items, int Total)> RunsAsync(
        long tenantId, long? scheduleId, string? status, DateTime? from, DateTime? to, int page, int pageSize, CancellationToken ct = default)
    {
        var query = db.ScheduleRuns.AsNoTracking().Where(r => r.TenantId == tenantId);
        if (scheduleId is { } id) query = query.Where(r => r.ScheduleId == id);
        if (!string.IsNullOrWhiteSpace(status)) query = query.Where(r => r.Status == status);
        if (from is { } start) query = query.Where(r => r.StartedAt >= start);
        if (to is { } end) query = query.Where(r => r.StartedAt < end);
        var total = await query.CountAsync(ct);
        var items = await query.OrderByDescending(r => r.StartedAt).ThenByDescending(r => r.Id)
            .Skip((page - 1) * pageSize).Take(pageSize).ToListAsync(ct);
        return (items, total);
    }

    public async Task<IReadOnlyDictionary<(string Type, long Id), string>> TargetNamesAsync(
        long tenantId, IReadOnlyCollection<(string Type, long Id)> targets, long? readerId = null, CancellationToken ct = default)
    {
        var names = new Dictionary<(string, long), string>();
        var reportIds = targets.Where(t => t.Type == DeliveryTerms.Report).Select(t => t.Id).Distinct().ToList();
        if (reportIds.Count > 0)
        {
            var reports = db.Reports.AsNoTracking().Where(r => reportIds.Contains(r.Id) && r.TenantId == tenantId && !r.IsDeleted);
            if (readerId is { } reader) reports = reports.Where(TargetAccess.Reports(tenantId, reader));
            foreach (var r in await reports.Select(r => new { r.Id, r.ReportName }).ToListAsync(ct))
                names[(DeliveryTerms.Report, r.Id)] = r.ReportName;
        }
        // Dashboards and canvases share core.Dashboard; the tenant database holds one tenant's rows.
        var boardIds = targets.Where(t => t.Type is DeliveryTerms.Dashboard or DeliveryTerms.Canvas && t.Id <= int.MaxValue)
            .Select(t => (int)t.Id).Distinct().ToList();
        if (boardIds.Count > 0)
        {
            var query = db.Dashboards.AsNoTracking().Where(d => boardIds.Contains(d.DashboardId) && !d.IsDeleted);
            if (readerId is { } reader) query = query.Where(TargetAccess.Boards(reader));
            var boards = await query.Select(d => new { d.DashboardId, d.DashboardName }).ToListAsync(ct);
            foreach (var target in targets.Where(t => t.Type is DeliveryTerms.Dashboard or DeliveryTerms.Canvas))
                if (boards.FirstOrDefault(b => b.DashboardId == target.Id) is { } board) names[target] = board.DashboardName;
        }
        // An insight is an assistant answer in one of the reader's own chats, named by the question it answered.
        var answerIds = targets.Where(t => t.Type == DeliveryTerms.Insight).Select(t => t.Id).Distinct().ToList();
        if (answerIds.Count > 0)
        {
            var reader = readerId?.ToString(System.Globalization.CultureInfo.InvariantCulture);
            var answers = await (from m in db.AiChatMessages.AsNoTracking()
                                 join c in db.AiConversations.AsNoTracking() on m.ConversationId equals c.Id
                                 where answerIds.Contains(m.Id) && m.Role == "assistant" && c.TenantId == tenantId && !c.IsDeleted
                                       && (reader == null || c.UserId == reader)
                                 select new
                                 {
                                     m.Id, c.Title,
                                     Question = db.AiChatMessages.Where(u => u.ConversationId == m.ConversationId && u.Role == "user" && u.Id < m.Id)
                                         .OrderByDescending(u => u.Id).Select(u => u.Content).FirstOrDefault(),
                                 }).ToListAsync(ct);
            foreach (var a in answers) names[(DeliveryTerms.Insight, a.Id)] = a.Question ?? a.Title;
        }
        return names;
    }
}
