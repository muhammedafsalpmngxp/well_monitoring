using MediatR;
using TWise.Backend.ControlPlane.Application.Abstractions.Services;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.Application.Features.Tenants;

public sealed class CreateRegionHandler(ITenantService svc) : IRequestHandler<CreateRegionCommand, Result<RegionDto>>
{
    public async Task<Result<RegionDto>> Handle(CreateRegionCommand cmd, CancellationToken cancellationToken)
        => Result<RegionDto>.Success(await svc.CreateRegionAsync(cmd.Request, cancellationToken));
}

public sealed class CreateSchemaVersionHandler(ITenantService svc) : IRequestHandler<CreateSchemaVersionCommand, Result<SchemaVersionDto>>
{
    public async Task<Result<SchemaVersionDto>> Handle(CreateSchemaVersionCommand cmd, CancellationToken cancellationToken)
        => Result<SchemaVersionDto>.Success(await svc.CreateSchemaVersionAsync(cmd.Request, cancellationToken));
}

public sealed class CreateTenantHandler(ITenantService svc) : IRequestHandler<CreateTenantCommand, Result<TenantDto>>
{
    public async Task<Result<TenantDto>> Handle(CreateTenantCommand cmd, CancellationToken cancellationToken)
    {
        // Creates metadata with status='pending_provision'.
        // ProvisioningWorker detects this and provisions the DB automatically.
        return Result<TenantDto>.Success(await svc.CreateTenantAsync(cmd.Request, cancellationToken));
    }
}

public sealed class ProvisionTenantHandler(ITenantProvisioningService provisioning)
    : IRequestHandler<ProvisionTenantCommand, Result>
{
    public Task<Result> Handle(ProvisionTenantCommand cmd, CancellationToken cancellationToken)
        => provisioning.ProvisionAsync(cmd.TenantId, cancellationToken);
}

public sealed class RetryProvisionHandler(ITenantProvisioningService provisioning)
    : IRequestHandler<RetryProvisionCommand, Result>
{
    public Task<Result> Handle(RetryProvisionCommand cmd, CancellationToken cancellationToken)
        => provisioning.RetryProvisionAsync(cmd.TenantId, cancellationToken);
}
