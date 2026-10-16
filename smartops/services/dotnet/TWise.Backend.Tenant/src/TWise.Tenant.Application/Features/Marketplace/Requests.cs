using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Marketplace;

public sealed record GetBuiltInCatalogQuery : IRequest<IReadOnlyList<CatalogPluginDto>>;
public sealed record ImportPowerBiVisualCommand(Stream Package) : IRequest<CatalogPluginDto>;
public sealed record ListCatalogsQuery(long TenantId) : IRequest<IReadOnlyList<MarketplaceCatalogDto>>;
public sealed record AddCatalogCommand(SaveCatalogRequest Request, long TenantId, long UserId) : IRequest<MarketplaceCatalogDto>;
public sealed record UpdateCatalogCommand(string CatalogKey, SaveCatalogRequest Request, long TenantId) : IRequest<MarketplaceCatalogDto?>;
public sealed record RemoveCatalogCommand(string CatalogKey, long TenantId) : IRequest<bool>;

public sealed record ListInstalledVisualsQuery(long TenantId)
    : IRequest<IReadOnlyList<CustomVisualDto>>;

public sealed record BrowseCatalogQuery(string CatalogId, long TenantId)
    : IRequest<IReadOnlyList<MarketplaceListingDto>>;

public sealed record InstallPluginCommand(InstallPluginRequest Request, long TenantId, long UserId)
    : IRequest<CustomVisualDto>;

public sealed record UninstallPluginCommand(string CatalogId, string PluginId, long TenantId)
    : IRequest<bool>;
