using MediatR;
using TWise.Backend.ControlPlane.Application.Abstractions.Services;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.Application.Features.Operations;

public sealed class ListIngestionRunsHandler(IOperationService svc) : IRequestHandler<ListIngestionRunsQuery, Result<PagedResult<IngestionRunDto>>>
{
    public async Task<Result<PagedResult<IngestionRunDto>>> Handle(ListIngestionRunsQuery request, CancellationToken ct)
        => Result<PagedResult<IngestionRunDto>>.Success(await svc.ListIngestionRunsAsync(request.Page, request.PageSize, ct));
}

public sealed class GetIngestionRunHandler(IOperationService svc) : IRequestHandler<GetIngestionRunQuery, Result<IngestionRunDto>>
{
    public async Task<Result<IngestionRunDto>> Handle(GetIngestionRunQuery request, CancellationToken ct)
    {
        var dto = await svc.GetIngestionRunAsync(request.Id, ct);
        return dto is null ? Result<IngestionRunDto>.NotFound() : Result<IngestionRunDto>.Success(dto);
    }
}

public sealed class ListAuditEventsHandler(IOperationService svc) : IRequestHandler<ListAuditEventsQuery, Result<PagedResult<AuditEventDto>>>
{
    public async Task<Result<PagedResult<AuditEventDto>>> Handle(ListAuditEventsQuery request, CancellationToken ct)
        => Result<PagedResult<AuditEventDto>>.Success(await svc.ListAuditEventsAsync(request.Page, request.PageSize, ct));
}

public sealed class GetAuditEventHandler(IOperationService svc) : IRequestHandler<GetAuditEventQuery, Result<AuditEventDto>>
{
    public async Task<Result<AuditEventDto>> Handle(GetAuditEventQuery request, CancellationToken ct)
    {
        var dto = await svc.GetAuditEventAsync(request.Id, ct);
        return dto is null ? Result<AuditEventDto>.NotFound() : Result<AuditEventDto>.Success(dto);
    }
}
