using MediatR;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Application.Common.Caching;
using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.Application.Features.Tenants;

public record CreateRegionCommand(RegionCreateRequest Request) : IRequest<Result<RegionDto>>, ICacheInvalidator
{
    public string[] CacheKeysToInvalidate => ["regions:*"];
}
public record CreateSchemaVersionCommand(SchemaVersionCreateRequest Request) : IRequest<Result<SchemaVersionDto>>, ICacheInvalidator
{
    public string[] CacheKeysToInvalidate => ["schema-versions:*"];
}
public record CreateTenantCommand(TenantCreateRequest Request) : IRequest<Result<TenantDto>>, ICacheInvalidator
{
    public string[] CacheKeysToInvalidate => ["tenants:*"];
}
public record ProvisionTenantCommand(long TenantId) : IRequest<Result>, ICacheInvalidator
{
    public string[] CacheKeysToInvalidate => ["tenants:*"];
}
public record RetryProvisionCommand(long TenantId) : IRequest<Result>, ICacheInvalidator
{
    public string[] CacheKeysToInvalidate => ["tenants:*"];
}
