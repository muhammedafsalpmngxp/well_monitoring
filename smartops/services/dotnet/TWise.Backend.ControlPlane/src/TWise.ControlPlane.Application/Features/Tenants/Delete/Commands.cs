using MediatR;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Application.Common.Caching;

namespace TWise.Backend.ControlPlane.Application.Features.Tenants;

public record DeleteRegionCommand(int Id) : IRequest<Result>, ICacheInvalidator
{
    public string[] CacheKeysToInvalidate => ["regions:*"];
}
public record DeleteSchemaVersionCommand(int Id) : IRequest<Result>, ICacheInvalidator
{
    public string[] CacheKeysToInvalidate => ["schema-versions:*"];
}
public record DeleteTenantCommand(long Id) : IRequest<Result>, ICacheInvalidator
{
    public string[] CacheKeysToInvalidate => ["tenants:*"];
}
public record DecommissionTenantCommand(long TenantId) : IRequest<Result>, ICacheInvalidator
{
    public string[] CacheKeysToInvalidate => ["tenants:*"];
}
