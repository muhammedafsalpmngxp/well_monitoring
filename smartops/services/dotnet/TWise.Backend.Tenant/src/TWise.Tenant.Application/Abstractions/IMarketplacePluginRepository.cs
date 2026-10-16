using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Abstractions;

public interface IMarketplacePluginRepository
{
    /// <summary>Active plugins of the built-in marketplace, in display order.</summary>
    Task<IReadOnlyList<MarketplacePlugin>> GetActiveAsync(CancellationToken ct = default);

    /// <summary>Inserts, or updates the row with the same PluginId.</summary>
    Task<MarketplacePlugin> UpsertAsync(MarketplacePlugin plugin, CancellationToken ct = default);
}
