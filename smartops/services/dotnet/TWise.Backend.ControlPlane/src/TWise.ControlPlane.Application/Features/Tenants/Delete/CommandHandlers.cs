using MediatR;
using TWise.Backend.ControlPlane.Application.Abstractions.Services;
using TWise.Backend.ControlPlane.Application.Common;

namespace TWise.Backend.ControlPlane.Application.Features.Tenants;

public sealed class DeleteRegionHandler(ITenantService svc) : IRequestHandler<DeleteRegionCommand, Result>
{
    public async Task<Result> Handle(DeleteRegionCommand cmd, CancellationToken ct) => await svc.DeleteRegionAsync(cmd.Id, ct) ? Result.Success() : Result.NotFound();
}

public sealed class DeleteSchemaVersionHandler(ITenantService svc) : IRequestHandler<DeleteSchemaVersionCommand, Result>
{
    public async Task<Result> Handle(DeleteSchemaVersionCommand cmd, CancellationToken ct) => await svc.DeleteSchemaVersionAsync(cmd.Id, ct) ? Result.Success() : Result.NotFound();
}

public sealed class DeleteTenantHandler(ITenantService svc) : IRequestHandler<DeleteTenantCommand, Result>
{
    public async Task<Result> Handle(DeleteTenantCommand cmd, CancellationToken ct) => await svc.DeleteTenantAsync(cmd.Id, ct) ? Result.Success() : Result.NotFound();
}

public sealed class DecommissionTenantHandler(ITenantProvisioningService provisioning)
    : IRequestHandler<DecommissionTenantCommand, Result>
{
    public Task<Result> Handle(DecommissionTenantCommand cmd, CancellationToken ct)
        => provisioning.DecommissionAsync(cmd.TenantId, ct);
}
