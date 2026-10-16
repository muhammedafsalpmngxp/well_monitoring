using Microsoft.EntityFrameworkCore;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Infrastructure.Persistence;

namespace TWise.Tenant.Infrastructure.Repositories;

public sealed class MarketplaceCatalogRepository(TenantDbContext db) : IMarketplaceCatalogRepository
{
    public async Task<IReadOnlyList<MarketplaceCatalog>> GetAllAsync(long tenantId, CancellationToken ct = default)
        => await db.MarketplaceCatalogs.AsNoTracking()
            .Where(c => c.TenantId == tenantId)
            .OrderBy(c => c.Name)
            .ToListAsync(ct);

    public Task<MarketplaceCatalog?> GetByKeyAsync(string catalogKey, long tenantId, CancellationToken ct = default)
        => db.MarketplaceCatalogs.AsNoTracking()
            .FirstOrDefaultAsync(c => c.TenantId == tenantId && c.CatalogKey == catalogKey, ct);

    public async Task<MarketplaceCatalog> AddAsync(MarketplaceCatalog catalog, CancellationToken ct = default)
    {
        db.MarketplaceCatalogs.Add(catalog);
        await db.SaveChangesAsync(ct);
        return catalog;
    }

    public Task UpdateAsync(MarketplaceCatalog catalog, CancellationToken ct = default)
    {
        db.MarketplaceCatalogs.Update(catalog);
        return db.SaveChangesAsync(ct);
    }

    public async Task<bool> SoftDeleteAsync(string catalogKey, long tenantId, CancellationToken ct = default)
    {
        var row = await db.MarketplaceCatalogs.FirstOrDefaultAsync(c => c.TenantId == tenantId && c.CatalogKey == catalogKey, ct);
        if (row is null) return false;
        row.IsDeleted = true;
        row.ModifiedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return true;
    }
}
