using Microsoft.EntityFrameworkCore;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Features.SelfHealing;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Infrastructure.Persistence;

namespace TWise.Tenant.Infrastructure.Repositories;

public sealed class ViewRunRepository(TenantDbContext db) : IViewRunRepository
{
    public async Task<SelfHealingOverviewDto> OverviewAsync(long tenantId, int days, SelfHealingOptions options, CancellationToken ct = default)
    {
        var now = DateTime.UtcNow;
        var since = now.AddDays(-days);
        var slow = options.SlowMs;
        var runs = db.ViewRuns.AsNoTracking().Where(r => r.CreatedAt >= since);

        var daily = (await runs.GroupBy(r => r.CreatedAt.Date)
                .Select(g => new { Day = g.Key, Runs = g.Count(), Failures = g.Count(r => r.Error != null), Avg = g.Average(r => (double)r.DurationMs) })
                .OrderBy(x => x.Day).ToListAsync(ct))
            .Select(x => new SelfHealingDayDto(x.Day, x.Runs, x.Failures, (int)Math.Round(x.Avg))).ToList();

        var totals = await runs.GroupBy(_ => 1)
            .Select(g => new { Runs = g.Count(), Failures = g.Count(r => r.Error != null), Slow = g.Count(r => r.Error == null && r.DurationMs >= slow),
                Avg = g.Average(r => (double)r.DurationMs), Max = g.Max(r => r.DurationMs) })
            .FirstOrDefaultAsync(ct);

        var bySource = runs.GroupBy(r => new { r.ViewId, r.SourceName, r.SourceType });
        var failing = await bySource.Where(g => g.Count(r => r.Error != null) > 0)
            .Select(g => new
            {
                g.Key.ViewId, g.Key.SourceName, g.Key.SourceType, Runs = g.Count(), Failures = g.Count(r => r.Error != null),
                LastRunAt = g.Max(r => r.CreatedAt),
                LastFailedAt = g.Where(r => r.Error != null).Max(r => r.CreatedAt),
                LastError = g.Where(r => r.Error != null).OrderByDescending(r => r.CreatedAt).Select(r => r.Error).FirstOrDefault(),
            })
            .OrderByDescending(x => x.Failures).ThenByDescending(x => x.LastFailedAt)
            .ToListAsync(ct);

        var slowViews = (await bySource.Where(g => g.Count(r => r.Error == null && r.DurationMs >= slow) > 0)
                .Select(g => new
                {
                    g.Key.ViewId, g.Key.SourceName, g.Key.SourceType, Runs = g.Count(r => r.Error == null),
                    Avg = g.Where(r => r.Error == null).Average(r => (double)r.DurationMs), Max = g.Where(r => r.Error == null).Max(r => r.DurationMs),
                })
                .OrderByDescending(x => x.Avg).Take(options.TopViews).ToListAsync(ct))
            .Select(x => new SlowViewDto(x.ViewId, x.SourceName, x.SourceType, x.Runs, (int)Math.Round(x.Avg), x.Max)).ToList();

        var log = await runs.Where(r => r.Error != null || r.DurationMs >= slow)
            .OrderByDescending(r => r.CreatedAt).Take(options.LogRows)
            .Select(r => new ViewRunDto(r.Id, r.ViewId, r.SourceName, r.SourceType, r.Caller, r.DurationMs, r.RowCount, r.Error, r.CreatedAt, r.Sql))
            .ToListAsync(ct);

        var dataLoads = await DataLoadIssuesAsync(tenantId, now.AddDays(-options.StaleDays), ct);

        return new SelfHealingOverviewDto(
            days, options.Days, slow, options.RecordRuns,
            new SelfHealingKpisDto(totals?.Runs ?? 0, totals?.Failures ?? 0, totals?.Slow ?? 0,
                (int)Math.Round(totals?.Avg ?? 0), totals?.Max ?? 0, failing.Count(f => f.LastFailedAt == f.LastRunAt), dataLoads.Count),
            daily,
            failing.Take(options.TopViews)
                .Select(x => new FailingViewDto(x.ViewId, x.SourceName, x.SourceType, x.Runs, x.Failures, x.LastError, x.LastFailedAt,
                    x.LastFailedAt == x.LastRunAt))
                .ToList(),
            slowViews, dataLoads, log);
    }

    /// <summary>Imports that failed, whose last refresh failed, or that are refreshable and not refreshed since <paramref name="staleBefore"/>.</summary>
    private async Task<List<DataLoadIssueDto>> DataLoadIssuesAsync(long tenantId, DateTime staleBefore, CancellationToken ct)
    {
        var imports = await db.ImportedDatasets.AsNoTracking()
            .Where(d => d.TenantId == tenantId && (d.Status == ImportFailed || d.LastRefreshStatus == RefreshJobStatuses.Failed
                || (d.DataSourceConnectionId != null && (d.LastRefreshedAt ?? d.CreatedAt) < staleBefore)))
            .Select(d => new
            {
                d.Id, d.DatasetName, d.Status, d.ErrorMessage, d.LastRefreshStatus, d.LastRefreshedAt, d.CreatedAt, d.ModifiedAt,
                RefreshError = db.RefreshJobs.Where(j => j.JobCode == d.LastRefreshJobCode).Select(j => j.ErrorMessage).FirstOrDefault(),
            })
            .ToListAsync(ct);
        return imports
            .Select(d => d.Status == ImportFailed ? new DataLoadIssueDto(d.Id, d.DatasetName, "failed", d.ErrorMessage, d.ModifiedAt)
                : d.LastRefreshStatus == RefreshJobStatuses.Failed ? new DataLoadIssueDto(d.Id, d.DatasetName, "refresh_failed", d.RefreshError, d.ModifiedAt)
                : new DataLoadIssueDto(d.Id, d.DatasetName, "stale", null, d.LastRefreshedAt ?? d.CreatedAt))
            .OrderByDescending(d => d.At)
            .ToList();
    }

    /// <summary>core.ImportedDatasets.status of an import that could not be read.</summary>
    private const string ImportFailed = "failed";
}
