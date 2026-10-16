using MediatR;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.Application.Features.Operations;

public record UpdateIngestionRunCommand(long Id, IngestionRunUpdateRequest Request) : IRequest<Result>;
public record UpdateAuditEventCommand(long Id, AuditEventUpdateRequest Request) : IRequest<Result>;
