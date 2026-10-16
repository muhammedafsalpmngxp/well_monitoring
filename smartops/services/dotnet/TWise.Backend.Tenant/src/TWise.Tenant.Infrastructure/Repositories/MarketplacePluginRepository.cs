using Microsoft.EntityFrameworkCore;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Infrastructure.Persistence;

namespace TWise.Tenant.Infrastructure.Repositories;

public sealed class MarketplacePluginRepository(TenantDbContext db) : IMarketplacePluginRepository
{
    public async Task<IReadOnlyList<MarketplacePlugin>> GetActiveAsync(CancellationToken ct = default)
        => await db.MarketplacePlugins.AsNoTracking()
            .Where(p => p.IsActive)
            .OrderBy(p => p.Id)
            .ToListAsync(ct);

    public async Task<MarketplacePlugin> UpsertAsync(MarketplacePlugin plugin, CancellationToken ct = default)
    {
        var existing = await db.MarketplacePlugins.FirstOrDefaultAsync(p => p.PluginId == plugin.PluginId, ct);
        if (existing is null)
        {
            db.MarketplacePlugins.Add(plugin);
            await db.SaveChangesAsync(ct);
            return plugin;
        }

        existing.Name = plugin.Name;
        existing.Description = plugin.Description;
        existing.Version = plugin.Version;
        existing.Publisher = plugin.Publisher;
        existing.VisualKey = plugin.VisualKey;
        existing.RenderKind = plugin.RenderKind;
        existing.Icon = plugin.Icon;
        existing.ImageUrl = plugin.ImageUrl;
        existing.DataRolesJson = plugin.DataRolesJson;
        existing.FeaturesJson = plugin.FeaturesJson;
        existing.OptionsTemplateJson = plugin.OptionsTemplateJson;
        existing.IsActive = true;
        existing.ModifiedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return existing;
    }
}
