using MediatR;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.CrewAssignments;

public record CreateCrewAssignmentCommand(CreateCrewAssignmentRequest Request)
    : IRequest<Result<CrewAssignmentResponse>>;

public record DeleteCrewAssignmentCommand(long Id) : IRequest<Result>;
