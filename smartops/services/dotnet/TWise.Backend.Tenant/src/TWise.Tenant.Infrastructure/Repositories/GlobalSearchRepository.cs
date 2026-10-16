using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Infrastructure.Persistence;

namespace TWise.Tenant.Infrastructure.Repositories;

/// <summary>
/// Backs the global search feature. Uses a DbContext factory (instead of the request's shared
/// scoped DbContext) so the three entity searches below can run concurrently via Task.WhenAll —
/// EF Core throws if more than one operation runs at a time on the same DbContext instance.
/// </summary>
public sealed class GlobalSearchRepository(
    IDbContextFactory<TenantDbContext> contextFactory,
    ILogger<GlobalSearchRepository> logger) : IGlobalSearchRepository
{
    // Overrides the app-wide 120s command timeout — a search should fail fast (and show "no
    // matches") rather than leave the user staring at a spinner for up to 2 minutes if a query
    // gets blocked behind another slow operation.
    private const int CommandTimeoutSeconds = 8;

    public async Task<(IReadOnlyList<Dashboard> Dashboards, IReadOnlyList<Widget> Widgets, IReadOnlyList<Report> Reports)> SearchAllAsync(
        string term, string dashboardCreatedBy, long userId, CancellationToken ct = default)
    {
        var dashboardsTask = SearchDashboardsAsync(term, dashboardCreatedBy, ct);
        var widgetsTask = SearchWidgetsAsync(term, userId, ct);
        var reportsTask = SearchReportsAsync(term, userId, ct);
        await Task.WhenAll(dashboardsTask, widgetsTask, reportsTask);
        return (dashboardsTask.Result, widgetsTask.Result, reportsTask.Result);
    }

    private async Task<IReadOnlyList<Dashboard>> SearchDashboardsAsync(string term, string createdBy, CancellationToken ct)
    {
        try
        {
            await using var db = await contextFactory.CreateDbContextAsync(ct);
            db.Database.SetCommandTimeout(CommandTimeoutSeconds);
            return await (
                from d in db.Set<Dashboard>().AsNoTracking()
                join c in db.Set<Category>() on d.CategoryId equals c.CategoryId
                where !d.IsDeleted
                      && d.DashboardName.Contains(term)
                      && ((d.Status == DashboardStatus.Published && d.IsLatestVersion)
                          || (d.CreatedBy == createdBy && (d.Status == DashboardStatus.Draft || d.Status == DashboardStatus.Completed)))
                select new Dashboard
                {
                    DashboardId = d.DashboardId,
                    DashboardName = d.DashboardName,
                    Status = d.Status,
                    // Read by DashboardKind.Of to route a canvas to its editor.
                    // ponytail: loads the config of every name match (at most 64 KB each); project JSON_VALUE(ConfigJson, '$.kind') through a mapped function if searches get slow.
                    ConfigJson = d.ConfigJson,
                    Category = new Category { CategoryName = c.CategoryName },
                }
            ).ToListAsync(ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // A slow/blocked query for one entity type shouldn't fail the whole search.
            logger.LogWarning(ex, "Global search: dashboard search failed for term '{Term}'.", term);
            return [];
        }
    }

    private async Task<IReadOnlyList<Widget>> SearchWidgetsAsync(string term, long userId, CancellationToken ct)
    {
        try
        {
            await using var db = await contextFactory.CreateDbContextAsync(ct);
            db.Database.SetCommandTimeout(CommandTimeoutSeconds);
            return await db.Widgets
                .AsNoTracking()
                .Include(w => w.Category)
                .Where(w => !w.IsDeleted && w.Name.Contains(term) && (w.Status == "published" || w.CreatedBy == userId))
                .ToListAsync(ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "Global search: widget search failed for term '{Term}'.", term);
            return [];
        }
    }

    private async Task<IReadOnlyList<Report>> SearchReportsAsync(string term, long userId, CancellationToken ct)
    {
        try
        {
            await using var db = await contextFactory.CreateDbContextAsync(ct);
            db.Database.SetCommandTimeout(CommandTimeoutSeconds);
            return await db.Reports
                .AsNoTracking()
                .Include(r => r.Category)
                .Where(r => !r.IsDeleted && r.ReportName.Contains(term) && (r.Status == "published" || r.CreatedBy == userId))
                .ToListAsync(ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "Global search: report search failed for term '{Term}'.", term);
            return [];
        }
    }
}
