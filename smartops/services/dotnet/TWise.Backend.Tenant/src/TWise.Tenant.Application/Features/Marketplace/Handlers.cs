using MediatR;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Marketplace;

// Thin handlers — behaviour lives in IMarketplaceService, matching the other features.

public sealed class GetBuiltInCatalogHandler(IMarketplaceService svc) : IRequestHandler<GetBuiltInCatalogQuery, IReadOnlyList<CatalogPluginDto>>
{
    public Task<IReadOnlyList<CatalogPluginDto>> Handle(GetBuiltInCatalogQuery r, CancellationToken ct) => svc.GetBuiltInCatalogAsync(ct);
}
public sealed class ImportPowerBiVisualHandler(IMarketplaceService svc) : IRequestHandler<ImportPowerBiVisualCommand, CatalogPluginDto>
{
    public Task<CatalogPluginDto> Handle(ImportPowerBiVisualCommand r, CancellationToken ct) => svc.ImportPowerBiVisualAsync(r.Package, ct);
}
public sealed class ListCatalogsHandler(IMarketplaceService svc) : IRequestHandler<ListCatalogsQuery, IReadOnlyList<MarketplaceCatalogDto>>
{
    public Task<IReadOnlyList<MarketplaceCatalogDto>> Handle(ListCatalogsQuery r, CancellationToken ct) => svc.GetCatalogsAsync(r.TenantId, ct);
}
public sealed class AddCatalogHandler(IMarketplaceService svc) : IRequestHandler<AddCatalogCommand, MarketplaceCatalogDto>
{
    public Task<MarketplaceCatalogDto> Handle(AddCatalogCommand r, CancellationToken ct) => svc.AddCatalogAsync(r.Request, r.TenantId, r.UserId, ct);
}
public sealed class UpdateCatalogHandler(IMarketplaceService svc) : IRequestHandler<UpdateCatalogCommand, MarketplaceCatalogDto?>
{
    public Task<MarketplaceCatalogDto?> Handle(UpdateCatalogCommand r, CancellationToken ct) => svc.UpdateCatalogAsync(r.CatalogKey, r.Request, r.TenantId, ct);
}
public sealed class RemoveCatalogHandler(IMarketplaceService svc) : IRequestHandler<RemoveCatalogCommand, bool>
{
    public Task<bool> Handle(RemoveCatalogCommand r, CancellationToken ct) => svc.RemoveCatalogAsync(r.CatalogKey, r.TenantId, ct);
}

public sealed class ListInstalledVisualsHandler(IMarketplaceService svc)
    : IRequestHandler<ListInstalledVisualsQuery, IReadOnlyList<CustomVisualDto>>
{
    public Task<IReadOnlyList<CustomVisualDto>> Handle(ListInstalledVisualsQuery request, CancellationToken cancellationToken)
        => svc.GetInstalledAsync(request.TenantId, cancellationToken);
}

public sealed class BrowseCatalogHandler(IMarketplaceService svc)
    : IRequestHandler<BrowseCatalogQuery, IReadOnlyList<MarketplaceListingDto>>
{
    public Task<IReadOnlyList<MarketplaceListingDto>> Handle(BrowseCatalogQuery request, CancellationToken cancellationToken)
        => svc.BrowseAsync(request.CatalogId, request.TenantId, cancellationToken);
}

public sealed class InstallPluginHandler(IMarketplaceService svc)
    : IRequestHandler<InstallPluginCommand, CustomVisualDto>
{
    public Task<CustomVisualDto> Handle(InstallPluginCommand request, CancellationToken cancellationToken)
        => svc.InstallAsync(request.Request, request.TenantId, request.UserId, cancellationToken);
}

public sealed class UninstallPluginHandler(IMarketplaceService svc)
    : IRequestHandler<UninstallPluginCommand, bool>
{
    public Task<bool> Handle(UninstallPluginCommand request, CancellationToken cancellationToken)
        => svc.UninstallAsync(request.CatalogId, request.PluginId, request.TenantId, cancellationToken);
}
