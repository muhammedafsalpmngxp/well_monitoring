using MediatR;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Application.Features.Dashboards;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Features.GlobalSearch;

public sealed class GlobalSearchHandler(
    IGlobalSearchRepository searchRepo,
    ICurrentUserService currentUser)
    : IRequestHandler<GlobalSearchQuery, Result<IReadOnlyList<GlobalSearchResultItem>>>
{
    private const int MaxResults = 50;

    public async Task<Result<IReadOnlyList<GlobalSearchResultItem>>> Handle(GlobalSearchQuery request, CancellationToken ct)
    {
        var term = request.SearchTerm?.Trim();
        if (string.IsNullOrEmpty(term))
            return Result<IReadOnlyList<GlobalSearchResultItem>>.Success([]);

        var dashboardUserId = currentUser.UserId ?? string.Empty;
        long.TryParse(dashboardUserId, out var userId);

        // Runs all three entity searches concurrently on separate DbContext instances instead of
        // one after another — cuts wall time to roughly the slowest single query, not the sum.
        var (dashboards, widgets, reports) = await searchRepo.SearchAllAsync(term, dashboardUserId, userId, ct);

        // Results open the detail (view) page with the same list context the WIP/Standard pages pass.
        static string From(string? status) => string.Equals(status, "published", StringComparison.OrdinalIgnoreCase) ? "standard" : "wip";

        var dashboardResults = dashboards.Select(d => new GlobalSearchResultItem(
            "dashboard",
            d.DashboardId.ToString(),
            d.DashboardName,
            d.Category?.CategoryName,
            d.Status,
            DashboardKind.Of(d.ConfigJson) == DashboardKind.Canvas
                ? $"/canvas/{d.DashboardId}"
                : $"/dashboard/operations-dashboard/{d.DashboardId}?from={From(d.Status)}"));

        var widgetResults = widgets.Select(w => new GlobalSearchResultItem(
            w.Type.ToLowerInvariant(),
            w.Id.ToString(),
            w.Name,
            w.Category?.CategoryName,
            w.Status,
            $"/charts-tiles/view/{w.Id}?type={w.Type.ToLowerInvariant()}&from={From(w.Status)}"));

        var reportResults = reports.Select(r => new GlobalSearchResultItem(
            "report",
            r.Id.ToString(),
            r.ReportName,
            r.Category?.CategoryName,
            r.Status,
            $"/reports/view/{r.Id}?from={From(r.Status)}"));

        var results = dashboardResults.Concat(widgetResults).Concat(reportResults)
            .OrderBy(r => r.Name, StringComparer.OrdinalIgnoreCase)
            .Take(MaxResults)
            .ToList();

        return Result<IReadOnlyList<GlobalSearchResultItem>>.Success(results);
    }
}
