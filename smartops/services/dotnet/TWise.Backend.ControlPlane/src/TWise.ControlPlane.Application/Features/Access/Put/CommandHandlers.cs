using MediatR;
using TWise.Backend.ControlPlane.Application.Abstractions.Services;
using TWise.Backend.ControlPlane.Application.Common;

namespace TWise.Backend.ControlPlane.Application.Features.Access;

public sealed class UpdateUserHandler(IAccessService svc) : IRequestHandler<UpdateUserCommand, Result>
{
    public async Task<Result> Handle(UpdateUserCommand cmd, CancellationToken ct) => await svc.UpdateUserAsync(cmd.Id, cmd.Request, ct) ? Result.Success() : Result.NotFound();
}

public sealed class UpdateUserPlantAccessHandler(IAccessService svc) : IRequestHandler<UpdateUserPlantAccessCommand, Result>
{
    public async Task<Result> Handle(UpdateUserPlantAccessCommand cmd, CancellationToken ct) => await svc.UpdateUserPlantAccessAsync(cmd.UserId, cmd.PlantCodes, cmd.CallerTenantId, ct) ? Result.Success() : Result.NotFound();
}

public sealed class UpdateUserWithAccessHandler(IAccessService svc) : IRequestHandler<UpdateUserWithAccessCommand, Result>
{
    public async Task<Result> Handle(UpdateUserWithAccessCommand cmd, CancellationToken ct) => await svc.UpdateUserWithAccessAsync(cmd.Id, cmd.Request, cmd.CallerTenantId, ct) ? Result.Success() : Result.NotFound();
}

public sealed class UpdateRoleHandler(IAccessService svc) : IRequestHandler<UpdateRoleCommand, Result>
{
    public async Task<Result> Handle(UpdateRoleCommand cmd, CancellationToken ct) => await svc.UpdateRoleAsync(cmd.Id, cmd.Request, cmd.CallerTenantId, ct) ? Result.Success() : Result.NotFound();
}

public sealed class UpdateUserTenantRoleHandler(IAccessService svc) : IRequestHandler<UpdateUserTenantRoleCommand, Result>
{
    public async Task<Result> Handle(UpdateUserTenantRoleCommand cmd, CancellationToken ct) => await svc.UpdateUserTenantRoleAsync(cmd.Id, cmd.Request, cmd.CallerTenantId, ct) ? Result.Success() : Result.NotFound();
}

public sealed class UpdateFeatureHandler(IAccessService svc) : IRequestHandler<UpdateFeatureCommand, Result>
{
    public async Task<Result> Handle(UpdateFeatureCommand cmd, CancellationToken ct) => await svc.UpdateFeatureAsync(cmd.Id, cmd.Request, ct) ? Result.Success() : Result.NotFound();
}

public sealed class UpdateTenantFeatureHandler(IAccessService svc) : IRequestHandler<UpdateTenantFeatureCommand, Result>
{
    public async Task<Result> Handle(UpdateTenantFeatureCommand cmd, CancellationToken ct) => await svc.UpdateTenantFeatureAsync(cmd.Id, cmd.Request, ct) ? Result.Success() : Result.NotFound();
}

public sealed class UpdateModuleHandler(IAccessService svc) : IRequestHandler<UpdateModuleCommand, Result>
{
    public async Task<Result> Handle(UpdateModuleCommand cmd, CancellationToken ct) => await svc.UpdateModuleAsync(cmd.Id, cmd.Request, ct) ? Result.Success() : Result.NotFound();
}

public sealed class BulkUpsertRolePermissionsHandler(IAccessService svc) : IRequestHandler<BulkUpsertRolePermissionsCommand, Result>
{
    public async Task<Result> Handle(BulkUpsertRolePermissionsCommand cmd, CancellationToken ct)
    {
        return await svc.BulkUpsertRolePermissionsAsync(cmd.RoleId, cmd.Request, cmd.CallerTenantId, ct)
            ? Result.Success()
            : Result.NotFound("Role not found or access denied.");
    }
}
