using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Reports;

public record ListReportsQuery(string? Status = null, long UserId = 0, bool IsAdmin = false) : IRequest<IReadOnlyList<ReportDto>>;
public record GetReportByIdQuery(long Id, long UserId) : IRequest<ReportDto?>;

/// <summary>Published snapshots for a report, newest first.</summary>
public record GetReportVersionsQuery(long Id, long UserId, long TenantId)
    : IRequest<IReadOnlyList<ReportVersionSummaryDto>?>;
