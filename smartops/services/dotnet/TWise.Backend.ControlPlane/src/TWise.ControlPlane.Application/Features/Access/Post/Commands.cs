using MediatR;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Application.Common.Caching;
using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.Application.Features.Access;

public record CreateUserCommand(AppUserCreateRequest Request) : IRequest<Result<AppUserDto>>;
public record CreateRoleCommand(RoleCreateRequest Request, long CallerTenantId) : IRequest<Result<RoleDto>>, ICacheInvalidator
{
    public string[] CacheKeysToInvalidate => ["roles:*"];
}
public record CreateUserTenantRoleCommand(UserTenantRoleCreateRequest Request, long CallerTenantId) : IRequest<Result<UserTenantRoleDto>>;
public record CreateFeatureCommand(FeatureCreateRequest Request) : IRequest<Result<FeatureDto>>, ICacheInvalidator
{
    public string[] CacheKeysToInvalidate => ["features:*"];
}
public record CreateTenantFeatureCommand(TenantFeatureCreateRequest Request) : IRequest<Result<TenantFeatureDto>>;
public record CreateModuleCommand(ModuleCreateRequest Request) : IRequest<Result<ModuleDto>>, ICacheInvalidator
{
    public string[] CacheKeysToInvalidate => ["modules:*"];
}
public record CreateUserWithAccessCommand(CreateUserWithAccessRequest Request, long CallerTenantId) : IRequest<Result<CreateUserWithAccessResponse>>;
public record ResetUserPasswordCommand(long UserId, long CallerTenantId, long? ActingUserId) : IRequest<Result<ResetPasswordResponse>>;
