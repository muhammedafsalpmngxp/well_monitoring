using MediatR;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Application.Common.Caching;

namespace TWise.Backend.ControlPlane.Application.Features.Access;

public record DeleteUserCommand(long Id) : IRequest<Result>;
public record DeleteRoleCommand(int Id, long CallerTenantId) : IRequest<Result>, ICacheInvalidator
{
    public string[] CacheKeysToInvalidate => ["roles:*"];
}
public record DeleteUserTenantRoleCommand(long Id, long CallerTenantId) : IRequest<Result>;
public record DeleteFeatureCommand(int Id) : IRequest<Result>, ICacheInvalidator
{
    public string[] CacheKeysToInvalidate => ["features:*"];
}
public record DeleteTenantFeatureCommand(long Id) : IRequest<Result>;
public record DeleteModuleCommand(int Id) : IRequest<Result>, ICacheInvalidator
{
    public string[] CacheKeysToInvalidate => ["modules:*"];
}
