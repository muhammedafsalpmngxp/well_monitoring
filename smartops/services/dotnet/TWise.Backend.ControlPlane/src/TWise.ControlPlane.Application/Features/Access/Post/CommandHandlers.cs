using MediatR;
using TWise.Backend.ControlPlane.Application.Abstractions.Services;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.Application.Features.Access;

public sealed class CreateUserHandler(IAccessService svc) : IRequestHandler<CreateUserCommand, Result<AppUserDto>>
{
    public async Task<Result<AppUserDto>> Handle(CreateUserCommand cmd, CancellationToken ct)
        => Result<AppUserDto>.Success(await svc.CreateUserAsync(cmd.Request, ct));
}

public sealed class CreateRoleHandler(IAccessService svc) : IRequestHandler<CreateRoleCommand, Result<RoleDto>>
{
    public async Task<Result<RoleDto>> Handle(CreateRoleCommand cmd, CancellationToken ct)
        => Result<RoleDto>.Success(await svc.CreateRoleAsync(cmd.Request, cmd.CallerTenantId, ct));
}

public sealed class CreateUserTenantRoleHandler(IAccessService svc) : IRequestHandler<CreateUserTenantRoleCommand, Result<UserTenantRoleDto>>
{
    public async Task<Result<UserTenantRoleDto>> Handle(CreateUserTenantRoleCommand cmd, CancellationToken ct)
        => Result<UserTenantRoleDto>.Success(await svc.CreateUserTenantRoleAsync(cmd.Request, cmd.CallerTenantId, ct));
}

public sealed class CreateFeatureHandler(IAccessService svc) : IRequestHandler<CreateFeatureCommand, Result<FeatureDto>>
{
    public async Task<Result<FeatureDto>> Handle(CreateFeatureCommand cmd, CancellationToken ct)
        => Result<FeatureDto>.Success(await svc.CreateFeatureAsync(cmd.Request, ct));
}

public sealed class CreateTenantFeatureHandler(IAccessService svc) : IRequestHandler<CreateTenantFeatureCommand, Result<TenantFeatureDto>>
{
    public async Task<Result<TenantFeatureDto>> Handle(CreateTenantFeatureCommand cmd, CancellationToken ct)
        => Result<TenantFeatureDto>.Success(await svc.CreateTenantFeatureAsync(cmd.Request, ct));
}

public sealed class CreateModuleHandler(IAccessService svc) : IRequestHandler<CreateModuleCommand, Result<ModuleDto>>
{
    public async Task<Result<ModuleDto>> Handle(CreateModuleCommand cmd, CancellationToken ct)
        => Result<ModuleDto>.Success(await svc.CreateModuleAsync(cmd.Request, ct));
}

public sealed class CreateUserWithAccessHandler(IAccessService svc) : IRequestHandler<CreateUserWithAccessCommand, Result<CreateUserWithAccessResponse>>
{
    public async Task<Result<CreateUserWithAccessResponse>> Handle(CreateUserWithAccessCommand cmd, CancellationToken ct)
        => Result<CreateUserWithAccessResponse>.Success(await svc.CreateUserWithAccessAsync(cmd.Request, cmd.CallerTenantId, ct));
}

public sealed class ResetUserPasswordHandler(IAccessService svc) : IRequestHandler<ResetUserPasswordCommand, Result<ResetPasswordResponse>>
{
    public async Task<Result<ResetPasswordResponse>> Handle(ResetUserPasswordCommand cmd, CancellationToken ct)
    {
        var result = await svc.ResetUserPasswordAsync(cmd.UserId, cmd.CallerTenantId, cmd.ActingUserId, ct);
        return result is null
            ? Result<ResetPasswordResponse>.NotFound("User not found.")
            : Result<ResetPasswordResponse>.Success(result);
    }
}
