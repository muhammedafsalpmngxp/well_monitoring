using MediatR;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Application.Common.Caching;
using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.Application.Features.Sources;

public record ListSourceSystemsQuery(int Page = 1, int PageSize = 200) : IRequest<Result<PagedResult<SourceSystemDto>>>, ICacheableQuery
{
    public string CacheKey => $"source-systems:p{Page}:s{PageSize}";
    public TimeSpan? AbsoluteExpiration => TimeSpan.FromMinutes(10);
}
public record GetSourceSystemQuery(int Id) : IRequest<Result<SourceSystemDto>>;
public record ListTenantSourcesQuery(int Page = 1, int PageSize = 200) : IRequest<Result<PagedResult<TenantSourceDto>>>;
public record GetTenantSourceQuery(long Id) : IRequest<Result<TenantSourceDto>>;
public record ListCanonicalEntitiesQuery(int Page = 1, int PageSize = 200) : IRequest<Result<PagedResult<CanonicalEntityDto>>>, ICacheableQuery
{
    public string CacheKey => $"canonical-entities:p{Page}:s{PageSize}";
    public TimeSpan? AbsoluteExpiration => TimeSpan.FromMinutes(5);
}
public record GetCanonicalEntityQuery(int Id) : IRequest<Result<CanonicalEntityDto>>;
public record ListCanonicalFieldsQuery(int Page = 1, int PageSize = 200) : IRequest<Result<PagedResult<CanonicalFieldDto>>>, ICacheableQuery
{
    public string CacheKey => $"canonical-fields:p{Page}:s{PageSize}";
    public TimeSpan? AbsoluteExpiration => TimeSpan.FromMinutes(5);
}
public record GetCanonicalFieldQuery(int Id) : IRequest<Result<CanonicalFieldDto>>;
public record ListFieldMappingsQuery(int Page = 1, int PageSize = 200) : IRequest<Result<PagedResult<FieldMappingDto>>>;
public record GetFieldMappingQuery(long Id) : IRequest<Result<FieldMappingDto>>;
public record ListCapabilityProfilesQuery(int Page = 1, int PageSize = 200) : IRequest<Result<PagedResult<CapabilityProfileDto>>>;
public record GetCapabilityProfileQuery(long Id) : IRequest<Result<CapabilityProfileDto>>;
