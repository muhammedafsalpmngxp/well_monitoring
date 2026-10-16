using MediatR;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Application.Common.Caching;
using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.Application.Features.Access;

public record UpdateUserCommand(long Id, AppUserUpdateRequest Request) : IRequest<Result>;
public record UpdateUserPlantAccessCommand(long UserId, List<int> PlantCodes, long CallerTenantId) : IRequest<Result>;
public record UpdateUserWithAccessCommand(long Id, UpdateUserWithAccessRequest Request, long CallerTenantId) : IRequest<Result>;
public record UpdateRoleCommand(int Id, RoleUpdateRequest Request, long CallerTenantId) : IRequest<Result>, ICacheInvalidator
{
    public string[] CacheKeysToInvalidate => ["roles:*"];
}
public record UpdateUserTenantRoleCommand(long Id, UserTenantRoleUpdateRequest Request, long CallerTenantId) : IRequest<Result>;
public record UpdateFeatureCommand(int Id, FeatureUpdateRequest Request) : IRequest<Result>, ICacheInvalidator
{
    public string[] CacheKeysToInvalidate => ["features:*"];
}
public record UpdateTenantFeatureCommand(long Id, TenantFeatureUpdateRequest Request) : IRequest<Result>;
public record UpdateModuleCommand(int Id, ModuleUpdateRequest Request) : IRequest<Result>, ICacheInvalidator
{
    public string[] CacheKeysToInvalidate => ["modules:*"];
}
public record BulkUpsertRolePermissionsCommand(int RoleId, RoleModulePermissionBulkRequest Request, long CallerTenantId) : IRequest<Result>, ICacheInvalidator
{
    public string[] CacheKeysToInvalidate => ["modules:*", "roles:*"];
}
