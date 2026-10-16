using Microsoft.EntityFrameworkCore;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Infrastructure.Persistence;

namespace TWise.Tenant.Infrastructure.Repositories;

public sealed class AiAlertRepository(TenantDbContext db) : IAiAlertRepository
{
    public async Task<IReadOnlyList<AiAlert>> ListAsync(long tenantId, string userId, CancellationToken ct) =>
        await db.AiAlerts.AsNoTracking().Where(a => a.TenantId == tenantId && a.UserId == userId).OrderByDescending(a => a.Id).ToListAsync(ct);

    public Task<AiAlert?> GetAsync(long id, long tenantId, string? userId, CancellationToken ct) =>
        db.AiAlerts.FirstOrDefaultAsync(a => a.Id == id && a.TenantId == tenantId && (userId == null || a.UserId == userId), ct);

    public async Task<IReadOnlyList<(long Id, long TenantId)>> DueAsync(DateTime now, int max, CancellationToken ct) =>
        (await db.AiAlerts.AsNoTracking().Where(a => a.NextCheckAt <= now).OrderBy(a => a.NextCheckAt).Take(max)
            .Select(a => new { a.Id, a.TenantId }).ToListAsync(ct)).Select(a => (a.Id, a.TenantId)).ToList();

    public void Add(AiAlert alert) => db.AiAlerts.Add(alert);

    public void Remove(AiAlert alert) => db.AiAlerts.Remove(alert);

    public Task SaveAsync(CancellationToken ct) => db.SaveChangesAsync(ct);
}
