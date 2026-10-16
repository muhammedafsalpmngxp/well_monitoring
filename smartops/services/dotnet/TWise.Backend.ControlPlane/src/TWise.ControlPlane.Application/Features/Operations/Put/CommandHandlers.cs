using MediatR;
using TWise.Backend.ControlPlane.Application.Abstractions.Services;
using TWise.Backend.ControlPlane.Application.Common;

namespace TWise.Backend.ControlPlane.Application.Features.Operations;

public sealed class UpdateIngestionRunHandler(IOperationService svc) : IRequestHandler<UpdateIngestionRunCommand, Result>
{
    public async Task<Result> Handle(UpdateIngestionRunCommand cmd, CancellationToken ct) => await svc.UpdateIngestionRunAsync(cmd.Id, cmd.Request, ct) ? Result.Success() : Result.NotFound();
}

public sealed class UpdateAuditEventHandler(IOperationService svc) : IRequestHandler<UpdateAuditEventCommand, Result>
{
    public async Task<Result> Handle(UpdateAuditEventCommand cmd, CancellationToken ct) => await svc.UpdateAuditEventAsync(cmd.Id, cmd.Request, ct) ? Result.Success() : Result.NotFound();
}
