using MediatR;
using SmartOps.Wells.Application.Abstractions;
using SmartOps.Wells.Contracts;

namespace SmartOps.Wells.Application.Features.PhProductivity;

/// <summary>
/// Query to retrieve the PH Productivity Weekly Report.
/// </summary>
public sealed record GetPhProductivityReportQuery(
    string FromDate,
    string ToDate,
    string? Category = null)
    : IRequest<PhProductivityReportResponse>;

/// <summary>
/// Handler — delegates to the dedicated IPhProductivityRepository.
/// </summary>
public sealed class GetPhProductivityReportQueryHandler(IPhProductivityRepository repo)
    : IRequestHandler<GetPhProductivityReportQuery, PhProductivityReportResponse>
{
    public Task<PhProductivityReportResponse> Handle(
        GetPhProductivityReportQuery request, CancellationToken ct)
        => repo.GetReportAsync(request.FromDate, request.ToDate, request.Category, ct);
}
