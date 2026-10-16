using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Abstractions;

public interface IMarketplaceCatalogRepository
{
    Task<IReadOnlyList<MarketplaceCatalog>> GetAllAsync(long tenantId, CancellationToken ct = default);
    Task<MarketplaceCatalog?> GetByKeyAsync(string catalogKey, long tenantId, CancellationToken ct = default);
    Task<MarketplaceCatalog> AddAsync(MarketplaceCatalog catalog, CancellationToken ct = default);
    Task UpdateAsync(MarketplaceCatalog catalog, CancellationToken ct = default);
    Task<bool> SoftDeleteAsync(string catalogKey, long tenantId, CancellationToken ct = default);
}
