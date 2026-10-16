namespace TWise.Tenant.Domain.DTOs;

/// <summary>One visual offered by a catalog, as the catalog publishes it.</summary>
public record CatalogPluginDto(
    string Id,
    string Name,
    string Description,
    string Version,
    string Publisher,
    string VisualKey,
    string RenderKind,
    IReadOnlyList<CustomVisualDataRole> DataRoles,
    string OptionsTemplateJson,
    string? Icon = null,
    IReadOnlyList<string>? Features = null,
    string? ImageUrl = null
);

/// <summary>
/// A catalog entry shown in the marketplace, with this tenant's install state merged in so the
/// UI can show Install / Installed / Update without a second call.
/// </summary>
public record MarketplaceListingDto(
    CatalogPluginDto Plugin,
    bool IsInstalled,
    string? InstalledVersion,
    bool UpdateAvailable
);

public record InstallPluginRequest(string CatalogId, string PluginId);

/// <summary>A catalog the tenant registered. The auth value is never returned; HasAuth says whether one is set.</summary>
public record MarketplaceCatalogDto(string CatalogKey, string Name, string Url, string? AuthHeader, bool HasAuth, DateTime CreatedAt, bool IsBuiltIn = false);

/// <summary>Registers a catalog. AuthHeader/AuthValue are optional and used together.</summary>
public record SaveCatalogRequest(string Name, string Url, string? AuthHeader = null, string? AuthValue = null);
