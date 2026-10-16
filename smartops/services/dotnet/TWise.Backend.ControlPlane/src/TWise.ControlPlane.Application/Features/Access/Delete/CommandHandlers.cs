using MediatR;
using TWise.Backend.ControlPlane.Application.Abstractions.Services;
using TWise.Backend.ControlPlane.Application.Common;

namespace TWise.Backend.ControlPlane.Application.Features.Access;

public sealed class DeleteUserHandler(IAccessService svc) : IRequestHandler<DeleteUserCommand, Result>
{
    public async Task<Result> Handle(DeleteUserCommand cmd, CancellationToken ct) => await svc.DeleteUserAsync(cmd.Id, ct) ? Result.Success() : Result.NotFound();
}

public sealed class DeleteRoleHandler(IAccessService svc) : IRequestHandler<DeleteRoleCommand, Result>
{
    public async Task<Result> Handle(DeleteRoleCommand cmd, CancellationToken ct) => await svc.DeleteRoleAsync(cmd.Id, cmd.CallerTenantId, ct) ? Result.Success() : Result.NotFound();
}

public sealed class DeleteUserTenantRoleHandler(IAccessService svc) : IRequestHandler<DeleteUserTenantRoleCommand, Result>
{
    public async Task<Result> Handle(DeleteUserTenantRoleCommand cmd, CancellationToken ct) => await svc.DeleteUserTenantRoleAsync(cmd.Id, cmd.CallerTenantId, ct) ? Result.Success() : Result.NotFound();
}

public sealed class DeleteFeatureHandler(IAccessService svc) : IRequestHandler<DeleteFeatureCommand, Result>
{
    public async Task<Result> Handle(DeleteFeatureCommand cmd, CancellationToken ct) => await svc.DeleteFeatureAsync(cmd.Id, ct) ? Result.Success() : Result.NotFound();
}

public sealed class DeleteTenantFeatureHandler(IAccessService svc) : IRequestHandler<DeleteTenantFeatureCommand, Result>
{
    public async Task<Result> Handle(DeleteTenantFeatureCommand cmd, CancellationToken ct) => await svc.DeleteTenantFeatureAsync(cmd.Id, ct) ? Result.Success() : Result.NotFound();
}

public sealed class DeleteModuleHandler(IAccessService svc) : IRequestHandler<DeleteModuleCommand, Result>
{
    public async Task<Result> Handle(DeleteModuleCommand cmd, CancellationToken ct) => await svc.DeleteModuleAsync(cmd.Id, ct) ? Result.Success() : Result.NotFound();
}
