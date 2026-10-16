using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Abstractions.Services;

/// <summary>Runs the three global-search entity queries concurrently (on separate DbContext
/// instances, since EF Core forbids concurrent operations on one shared context).</summary>
public interface IGlobalSearchRepository
{
    Task<(IReadOnlyList<Dashboard> Dashboards, IReadOnlyList<Widget> Widgets, IReadOnlyList<Report> Reports)> SearchAllAsync(
        string term, string dashboardCreatedBy, long userId, CancellationToken ct = default);
}
