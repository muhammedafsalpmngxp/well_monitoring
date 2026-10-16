using MediatR;
using TWise.Backend.ControlPlane.Application.Common;

namespace TWise.Backend.ControlPlane.Application.Features.Operations;

public record DeleteIngestionRunCommand(long Id) : IRequest<Result>;
public record DeleteAuditEventCommand(long Id) : IRequest<Result>;
