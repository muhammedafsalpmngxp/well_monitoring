using MediatR;
using TWise.Backend.ControlPlane.Application.Abstractions.Services;
using TWise.Backend.ControlPlane.Application.Common;

namespace TWise.Backend.ControlPlane.Application.Features.Tenants;

public sealed class UpdateRegionHandler(ITenantService svc) : IRequestHandler<UpdateRegionCommand, Result>
{
    public async Task<Result> Handle(UpdateRegionCommand cmd, CancellationToken ct) => await svc.UpdateRegionAsync(cmd.Id, cmd.Request, ct) ? Result.Success() : Result.NotFound();
}

public sealed class UpdateSchemaVersionHandler(ITenantService svc) : IRequestHandler<UpdateSchemaVersionCommand, Result>
{
    public async Task<Result> Handle(UpdateSchemaVersionCommand cmd, CancellationToken ct) => await svc.UpdateSchemaVersionAsync(cmd.Id, cmd.Request, ct) ? Result.Success() : Result.NotFound();
}

public sealed class UpdateTenantHandler(ITenantService svc) : IRequestHandler<UpdateTenantCommand, Result>
{
    public async Task<Result> Handle(UpdateTenantCommand cmd, CancellationToken ct) => await svc.UpdateTenantAsync(cmd.Id, cmd.Request, ct) ? Result.Success() : Result.NotFound();
}
