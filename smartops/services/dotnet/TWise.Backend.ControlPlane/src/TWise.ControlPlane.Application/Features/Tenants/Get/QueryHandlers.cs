using MediatR;
using TWise.Backend.ControlPlane.Application.Abstractions;
using TWise.Backend.ControlPlane.Application.Abstractions.Services;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Domain.DTOs;
using TWise.Backend.ControlPlane.Domain.Entities;

namespace TWise.Backend.ControlPlane.Application.Features.Tenants;

public sealed class ListRegionsHandler(ITenantService svc) : IRequestHandler<ListRegionsQuery, Result<PagedResult<RegionDto>>>
{
    public async Task<Result<PagedResult<RegionDto>>> Handle(ListRegionsQuery request, CancellationToken cancellationToken)
        => Result<PagedResult<RegionDto>>.Success(await svc.ListRegionsAsync(request.Page, request.PageSize, cancellationToken));
}

public sealed class GetRegionHandler(ITenantService svc) : IRequestHandler<GetRegionQuery, Result<RegionDto>>
{
    public async Task<Result<RegionDto>> Handle(GetRegionQuery request, CancellationToken cancellationToken)
    {
        var dto = await svc.GetRegionAsync(request.Id, cancellationToken);
        return dto is null ? Result<RegionDto>.NotFound() : Result<RegionDto>.Success(dto);
    }
}

public sealed class ListSchemaVersionsHandler(ITenantService svc) : IRequestHandler<ListSchemaVersionsQuery, Result<PagedResult<SchemaVersionDto>>>
{
    public async Task<Result<PagedResult<SchemaVersionDto>>> Handle(ListSchemaVersionsQuery request, CancellationToken cancellationToken)
        => Result<PagedResult<SchemaVersionDto>>.Success(await svc.ListSchemaVersionsAsync(request.Page, request.PageSize, cancellationToken));
}

public sealed class GetSchemaVersionHandler(ITenantService svc) : IRequestHandler<GetSchemaVersionQuery, Result<SchemaVersionDto>>
{
    public async Task<Result<SchemaVersionDto>> Handle(GetSchemaVersionQuery request, CancellationToken cancellationToken)
    {
        var dto = await svc.GetSchemaVersionAsync(request.Id, cancellationToken);
        return dto is null ? Result<SchemaVersionDto>.NotFound() : Result<SchemaVersionDto>.Success(dto);
    }
}

public sealed class ListTenantsHandler(ITenantService svc) : IRequestHandler<ListTenantsQuery, Result<PagedResult<TenantDto>>>
{
    public async Task<Result<PagedResult<TenantDto>>> Handle(ListTenantsQuery request, CancellationToken cancellationToken)
        => Result<PagedResult<TenantDto>>.Success(await svc.ListTenantsAsync(request.Page, request.PageSize, cancellationToken));
}

public sealed class GetTenantHandler(ITenantService svc) : IRequestHandler<GetTenantQuery, Result<TenantDto>>
{
    public async Task<Result<TenantDto>> Handle(GetTenantQuery request, CancellationToken cancellationToken)
    {
        var dto = await svc.GetTenantAsync(request.Id, cancellationToken);
        return dto is null ? Result<TenantDto>.NotFound() : Result<TenantDto>.Success(dto);
    }
}

public sealed class GetProvisionStatusHandler(IGenericRepository<Tenant> repo)
    : IRequestHandler<GetProvisionStatusQuery, Result<TenantProvisionStatusDto>>
{
    public async Task<Result<TenantProvisionStatusDto>> Handle(GetProvisionStatusQuery query, CancellationToken cancellationToken)
    {
        var tenant = await repo.GetAsync(query.TenantId, cancellationToken);
        return tenant is null
            ? Result<TenantProvisionStatusDto>.NotFound()
            : Result<TenantProvisionStatusDto>.Success(new TenantProvisionStatusDto(tenant.TenantId, tenant.Status, tenant.ProvisionStep, tenant.DataPlaneRef, tenant.RetryCount));
    }
}
