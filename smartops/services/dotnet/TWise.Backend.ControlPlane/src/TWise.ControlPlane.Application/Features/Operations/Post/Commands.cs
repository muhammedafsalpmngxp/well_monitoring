using MediatR;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.Application.Features.Operations;

public record CreateIngestionRunCommand(IngestionRunCreateRequest Request) : IRequest<Result<IngestionRunDto>>;
public record CreateAuditEventCommand(AuditEventCreateRequest Request) : IRequest<Result<AuditEventDto>>;
