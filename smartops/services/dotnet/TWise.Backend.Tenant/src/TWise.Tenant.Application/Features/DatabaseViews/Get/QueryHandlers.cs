using MediatR;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.DatabaseViews;

public sealed class ListDatabaseViewsHandler(IDatabaseViewService svc)
    : IRequestHandler<ListDatabaseViewsQuery, IReadOnlyList<DatabaseViewListDto>>
{
    public Task<IReadOnlyList<DatabaseViewListDto>> Handle(ListDatabaseViewsQuery request, CancellationToken cancellationToken)
        => svc.GetAllAsync(request.TenantId, request.ViewType, cancellationToken);
}

public sealed class GetDatabaseViewHandler(IDatabaseViewService svc)
    : IRequestHandler<GetDatabaseViewQuery, DatabaseViewDto?>
{
    public Task<DatabaseViewDto?> Handle(GetDatabaseViewQuery request, CancellationToken cancellationToken)
        => svc.GetByIdAsync(request.Id, request.TenantId, cancellationToken);
}

public sealed class GetPreviewSnapshotHandler(IDatabaseViewService svc)
    : IRequestHandler<GetPreviewSnapshotQuery, PreviewSnapshotDto?>
{
    public Task<PreviewSnapshotDto?> Handle(GetPreviewSnapshotQuery request, CancellationToken cancellationToken)
        => svc.GetPreviewSnapshotAsync(request.Id, request.TenantId, request.MaxRows, cancellationToken);
}

public sealed class GetViewContractReportHandler(IDatabaseViewService svc)
    : IRequestHandler<GetViewContractReportQuery, IReadOnlyList<ViewContractReportItem>>
{
    public Task<IReadOnlyList<ViewContractReportItem>> Handle(GetViewContractReportQuery request, CancellationToken cancellationToken)
        => svc.GetContractReportAsync(request.TenantId, cancellationToken);
}

public sealed class GetViewIndexAdviceHandler(IDatabaseViewService svc)
    : IRequestHandler<GetViewIndexAdviceQuery, ViewIndexAdviceResponse?>
{
    public Task<ViewIndexAdviceResponse?> Handle(GetViewIndexAdviceQuery request, CancellationToken cancellationToken)
        => svc.GetIndexAdviceAsync(request.Request, request.TenantId, cancellationToken);
}
