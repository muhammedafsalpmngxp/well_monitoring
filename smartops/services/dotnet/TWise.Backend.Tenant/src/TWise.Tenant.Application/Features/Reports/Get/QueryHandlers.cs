using MediatR;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Reports;

public sealed class ListReportsHandler(IReportService svc)
    : IRequestHandler<ListReportsQuery, IReadOnlyList<ReportDto>>
{
    public Task<IReadOnlyList<ReportDto>> Handle(ListReportsQuery request, CancellationToken cancellationToken)
        => svc.GetAllAsync(request.Status, request.UserId, request.IsAdmin, cancellationToken);
}

public sealed class GetReportByIdHandler(IReportService svc)
    : IRequestHandler<GetReportByIdQuery, ReportDto?>
{
    public Task<ReportDto?> Handle(GetReportByIdQuery request, CancellationToken cancellationToken)
        => svc.GetByIdAsync(request.Id, request.UserId, cancellationToken);
}

public sealed class GetReportVersionsHandler(IReportService svc)
    : IRequestHandler<GetReportVersionsQuery, IReadOnlyList<ReportVersionSummaryDto>?>
{
    public Task<IReadOnlyList<ReportVersionSummaryDto>?> Handle(GetReportVersionsQuery request, CancellationToken cancellationToken)
        => svc.GetVersionsAsync(request.Id, request.UserId, request.TenantId, cancellationToken);
}
