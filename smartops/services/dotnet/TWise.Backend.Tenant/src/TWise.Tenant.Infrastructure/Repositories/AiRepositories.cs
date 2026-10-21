using Microsoft.EntityFrameworkCore;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Infrastructure.Persistence;

namespace TWise.Tenant.Infrastructure.Repositories;

public sealed class AiSettingsRepository(TenantDbContext db) : IAiSettingsRepository
{
    public Task<AiSettings?> GetAsync(long tenantId, CancellationToken ct) =>
        db.AiSettings.FirstOrDefaultAsync(s => s.TenantId == tenantId, ct);

    public async Task UpsertAsync(AiSettings settings, CancellationToken ct)
    {
        if (settings.Id == 0) db.AiSettings.Add(settings);
        await db.SaveChangesAsync(ct);
    }
}

public sealed class AiProviderRepository(TenantDbContext db) : IAiProviderRepository
{
    public async Task<IReadOnlyList<AiProvider>> ListAsync(long tenantId, CancellationToken ct) =>
        await db.AiProviders.Where(p => p.TenantId == tenantId).OrderByDescending(p => p.IsActive).ThenBy(p => p.Name).ToListAsync(ct);

    public Task<AiProvider?> GetAsync(long id, long tenantId, CancellationToken ct) =>
        db.AiProviders.FirstOrDefaultAsync(p => p.Id == id && p.TenantId == tenantId, ct);

    public async Task<IReadOnlyList<AiModelPrice>> ListPricesAsync(long tenantId, CancellationToken ct) =>
        await db.AiModelPrices.AsNoTracking().Where(p => p.TenantId == tenantId).OrderBy(p => p.Model).ToListAsync(ct);

    public async Task ReplacePricesAsync(long tenantId, IReadOnlyList<AiModelPrice> prices, CancellationToken ct)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        await db.AiModelPrices.Where(p => p.TenantId == tenantId).ExecuteDeleteAsync(ct);
        db.AiModelPrices.AddRange(prices);
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
    }

    public Task<AiProvider?> GetActiveAsync(long tenantId, CancellationToken ct) =>
        db.AiProviders.FirstOrDefaultAsync(p => p.TenantId == tenantId && p.IsActive, ct);

    public Task AddAsync(AiProvider provider, CancellationToken ct)
    {
        db.AiProviders.Add(provider);
        return Task.CompletedTask;
    }

    public async Task SetActiveAsync(AiProvider provider, CancellationToken ct)
    {
        await db.AiProviders.Where(p => p.TenantId == provider.TenantId && p.IsActive && p.Id != provider.Id)
            .ExecuteUpdateAsync(s => s.SetProperty(p => p.IsActive, false), ct);
        provider.IsActive = true;
        await db.SaveChangesAsync(ct);
    }

    public async Task DeleteAsync(AiProvider provider, CancellationToken ct)
    {
        db.AiProviders.Remove(provider);
        await db.SaveChangesAsync(ct);
    }

    public Task SaveAsync(CancellationToken ct) => db.SaveChangesAsync(ct);
}

public sealed class AiFeatureRoleRepository(TenantDbContext db) : IAiFeatureRoleRepository
{
    public async Task<IReadOnlyList<AiFeatureRole>> GetAsync(long tenantId, CancellationToken ct) =>
        await db.AiFeatureRoles.Where(r => r.TenantId == tenantId).ToListAsync(ct);

    public async Task ReplaceAsync(long tenantId, IReadOnlyList<AiFeatureRole> grants, CancellationToken ct)
    {
        await db.AiFeatureRoles.Where(r => r.TenantId == tenantId).ExecuteDeleteAsync(ct);
        db.AiFeatureRoles.AddRange(grants);
        await db.SaveChangesAsync(ct);
    }
}

public sealed class AiUsageRepository(TenantDbContext db) : IAiUsageRepository
{
    public async Task AddAsync(AiUsageLog log, CancellationToken ct)
    {
        db.AiUsageLogs.Add(log);
        await db.SaveChangesAsync(ct);
    }

    public Task<int> CountTodayAsync(long tenantId, CancellationToken ct)
    {
        var start = DateTime.UtcNow.Date;
        return db.AiUsageLogs.CountAsync(l => l.TenantId == tenantId && l.CreatedAt >= start, ct);
    }

    public async Task<IReadOnlyList<AiUsageDayDto>> GetDailyAsync(long tenantId, int days, CancellationToken ct)
    {
        var start = DateTime.UtcNow.Date.AddDays(-(days - 1));
        // Anonymous projection: EF cannot translate a record constructor inside a GroupBy select.
        var rows = await db.AiUsageLogs
            .Where(l => l.TenantId == tenantId && l.CreatedAt >= start)
            .GroupBy(l => l.CreatedAt.Date)
            .Select(g => new { Day = g.Key, Calls = g.Count(), Failed = g.Count(x => !x.Succeeded), Prompt = g.Sum(x => (long)x.PromptTokens), Completion = g.Sum(x => (long)x.CompletionTokens) })
            .OrderBy(d => d.Day)
            .ToListAsync(ct);
        return rows.Select(r => new AiUsageDayDto(r.Day, r.Calls, r.Failed, r.Prompt, r.Completion)).ToList();
    }

    public async Task<IReadOnlyList<AiUsageLog>> GetFailuresAsync(long tenantId, DateTime since, int take, CancellationToken ct) =>
        await db.AiUsageLogs.AsNoTracking().Where(u => u.TenantId == tenantId && !u.Succeeded && u.CreatedAt >= since)
            .OrderByDescending(u => u.Id).Take(take).ToListAsync(ct);

}
