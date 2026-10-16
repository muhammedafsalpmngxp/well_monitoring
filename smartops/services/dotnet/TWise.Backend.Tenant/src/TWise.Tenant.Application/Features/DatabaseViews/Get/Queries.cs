using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.DatabaseViews;

public record ListDatabaseViewsQuery(long TenantId, string? ViewType = null) : IRequest<IReadOnlyList<DatabaseViewListDto>>;
public record GetViewContractReportQuery(long TenantId) : IRequest<IReadOnlyList<ViewContractReportItem>>;
public record GetDatabaseViewQuery(long Id, long TenantId) : IRequest<DatabaseViewDto?>;
public record GetPreviewSnapshotQuery(long Id, long TenantId, int MaxRows) : IRequest<PreviewSnapshotDto?>;
/// <summary>Existing and suggested indexes for the tables the given SQL reads. Read-only: nothing is created.</summary>
public record GetViewIndexAdviceQuery(ViewIndexAdviceRequest Request, long TenantId) : IRequest<ViewIndexAdviceResponse?>;
