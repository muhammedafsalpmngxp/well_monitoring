using MediatR;
using TWise.Backend.ControlPlane.Application.Abstractions.Services;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.Application.Features.Operations;

public sealed class CreateIngestionRunHandler(IOperationService svc) : IRequestHandler<CreateIngestionRunCommand, Result<IngestionRunDto>>
{
    public async Task<Result<IngestionRunDto>> Handle(CreateIngestionRunCommand cmd, CancellationToken ct)
        => Result<IngestionRunDto>.Success(await svc.CreateIngestionRunAsync(cmd.Request, ct));
}

public sealed class CreateAuditEventHandler(IOperationService svc) : IRequestHandler<CreateAuditEventCommand, Result<AuditEventDto>>
{
    public async Task<Result<AuditEventDto>> Handle(CreateAuditEventCommand cmd, CancellationToken ct)
        => Result<AuditEventDto>.Success(await svc.CreateAuditEventAsync(cmd.Request, ct));
}
