using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Abstractions.Services;

public interface IMarketplaceService
{
    Task<IReadOnlyList<MarketplaceCatalogDto>> GetCatalogsAsync(long tenantId, CancellationToken ct = default);

    /// <summary>The built-in catalog as a plain plugin array, so it can be served as a marketplace URL.</summary>
    Task<IReadOnlyList<CatalogPluginDto>> GetBuiltInCatalogAsync(CancellationToken ct = default);

    /// <summary>Catalogues a Power BI custom visual (.pbiviz) in the built-in marketplace from its package metadata.</summary>
    Task<CatalogPluginDto> ImportPowerBiVisualAsync(Stream package, CancellationToken ct = default);

    /// <summary>Registers a catalog. Throws <see cref="InvalidOperationException"/> on an invalid or unsafe URL.</summary>
    Task<MarketplaceCatalogDto> AddCatalogAsync(SaveCatalogRequest request, long tenantId, long userId, CancellationToken ct = default);

    /// <summary>Updates a registered catalog. Returns null when the key is unknown to this tenant.</summary>
    Task<MarketplaceCatalogDto?> UpdateCatalogAsync(string catalogKey, SaveCatalogRequest request, long tenantId, CancellationToken ct = default);
    Task<bool> RemoveCatalogAsync(string catalogKey, long tenantId, CancellationToken ct = default);

    /// <summary>Active installed visuals, which the client registers as renderers at startup.</summary>
    Task<IReadOnlyList<CustomVisualDto>> GetInstalledAsync(long tenantId, CancellationToken ct = default);

    /// <summary>Catalog contents with this tenant's install state merged in.</summary>
    Task<IReadOnlyList<MarketplaceListingDto>> BrowseAsync(string catalogId, long tenantId, CancellationToken ct = default);

    /// <summary>
    /// Installs a plugin, or updates it in place when already installed from the same catalog.
    /// Throws <see cref="InvalidOperationException"/> when the catalog is unknown, the plugin is
    /// missing, or its template fails validation.
    /// </summary>
    Task<CustomVisualDto> InstallAsync(InstallPluginRequest request, long tenantId, long userId, CancellationToken ct = default);

    /// <summary>Removes an installed plugin. Returns false when it was not installed.</summary>
    Task<bool> UninstallAsync(string catalogId, string pluginId, long tenantId, CancellationToken ct = default);
}
