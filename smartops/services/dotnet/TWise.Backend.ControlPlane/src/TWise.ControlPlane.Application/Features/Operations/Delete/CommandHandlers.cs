using MediatR;
using TWise.Backend.ControlPlane.Application.Abstractions.Services;
using TWise.Backend.ControlPlane.Application.Common;

namespace TWise.Backend.ControlPlane.Application.Features.Operations;

public sealed class DeleteIngestionRunHandler(IOperationService svc) : IRequestHandler<DeleteIngestionRunCommand, Result>
{
    public async Task<Result> Handle(DeleteIngestionRunCommand cmd, CancellationToken ct) => await svc.DeleteIngestionRunAsync(cmd.Id, ct) ? Result.Success() : Result.NotFound();
}

public sealed class DeleteAuditEventHandler(IOperationService svc) : IRequestHandler<DeleteAuditEventCommand, Result>
{
    public async Task<Result> Handle(DeleteAuditEventCommand cmd, CancellationToken ct) => await svc.DeleteAuditEventAsync(cmd.Id, ct) ? Result.Success() : Result.NotFound();
}
