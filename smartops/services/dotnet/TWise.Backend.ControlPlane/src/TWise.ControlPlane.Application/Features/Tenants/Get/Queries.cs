using MediatR;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Application.Common.Caching;
using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.Application.Features.Tenants;

public record ListRegionsQuery(int Page = 1, int PageSize = 200) : IRequest<Result<PagedResult<RegionDto>>>, ICacheableQuery
{
    public string CacheKey => $"regions:p{Page}:s{PageSize}";
    public TimeSpan? AbsoluteExpiration => TimeSpan.FromMinutes(10);
}
public record GetRegionQuery(int Id) : IRequest<Result<RegionDto>>;
public record ListSchemaVersionsQuery(int Page = 1, int PageSize = 200) : IRequest<Result<PagedResult<SchemaVersionDto>>>, ICacheableQuery
{
    public string CacheKey => $"schema-versions:p{Page}:s{PageSize}";
    public TimeSpan? AbsoluteExpiration => TimeSpan.FromMinutes(5);
}
public record GetSchemaVersionQuery(int Id) : IRequest<Result<SchemaVersionDto>>;
public record ListTenantsQuery(int Page = 1, int PageSize = 200) : IRequest<Result<PagedResult<TenantDto>>>, ICacheableQuery
{
    public string CacheKey => $"tenants:p{Page}:s{PageSize}";
    public TimeSpan? AbsoluteExpiration => TimeSpan.FromMinutes(2);
}
public record GetTenantQuery(long Id) : IRequest<Result<TenantDto>>;
public record GetProvisionStatusQuery(long TenantId) : IRequest<Result<TenantProvisionStatusDto>>;
