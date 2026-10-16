using MediatR;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Application.Common.Caching;
using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.Application.Features.Tenants;

public record UpdateRegionCommand(int Id, RegionUpdateRequest Request) : IRequest<Result>, ICacheInvalidator
{
    public string[] CacheKeysToInvalidate => ["regions:*"];
}
public record UpdateSchemaVersionCommand(int Id, SchemaVersionUpdateRequest Request) : IRequest<Result>, ICacheInvalidator
{
    public string[] CacheKeysToInvalidate => ["schema-versions:*"];
}
public record UpdateTenantCommand(long Id, TenantUpdateRequest Request) : IRequest<Result>, ICacheInvalidator
{
    public string[] CacheKeysToInvalidate => ["tenants:*"];
}
