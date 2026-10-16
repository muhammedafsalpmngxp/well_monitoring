using MediatR;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.Application.Features.Operations;

public record ListIngestionRunsQuery(int Page = 1, int PageSize = 200) : IRequest<Result<PagedResult<IngestionRunDto>>>;
public record GetIngestionRunQuery(long Id) : IRequest<Result<IngestionRunDto>>;
public record ListAuditEventsQuery(int Page = 1, int PageSize = 200) : IRequest<Result<PagedResult<AuditEventDto>>>;
public record GetAuditEventQuery(long Id) : IRequest<Result<AuditEventDto>>;
