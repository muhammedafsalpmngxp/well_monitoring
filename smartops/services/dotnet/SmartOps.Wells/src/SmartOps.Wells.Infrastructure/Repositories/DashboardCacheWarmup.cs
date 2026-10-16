using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using SmartOps.Wells.Application.Abstractions;

namespace SmartOps.Wells.Infrastructure.Repositories;

/// <summary>
/// Pre-warms slow dashboard queries (workload-analysis, well-progress-kpi) on startup
/// so the first user request hits the cache instead of waiting 10+ seconds.
/// </summary>
public sealed class DashboardCacheWarmup(
    IServiceScopeFactory scopeFactory,
    ILogger<DashboardCacheWarmup> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Small delay to let the app finish startup before hitting DB
        await Task.Delay(TimeSpan.FromSeconds(3), stoppingToken);

        // Run immediately on startup, then periodically refresh before cache expires
        while (!stoppingToken.IsCancellationRequested)
        {
            // Run both warmups concurrently so the slow KPI warmup doesn't block workload-analysis
            await Task.WhenAll(
                WarmupWorkloadAnalysis(stoppingToken),
                WarmupWellExecKpi(stoppingToken));
            // Refresh every 12 min (KPI cache TTL is 15 min) — ensures cache is always warm
            await Task.Delay(TimeSpan.FromMinutes(12), stoppingToken);
        }
    }

    private async Task WarmupWellExecKpi(CancellationToken ct)
    {
        try
        {
            var sw = System.Diagnostics.Stopwatch.StartNew();
            using var scope = scopeFactory.CreateScope();
            var repo = scope.ServiceProvider.GetRequiredService<IDashboardRepository>();

            // Pre-warm cluster-wells cache first — used by every cluster/wellType filter
            // resolution. Without this, the first user request that picks a cluster pays the
            // 30+ s cost of ProjectIDs + WMR scan.
            await repo.GetClusterWellsAsync(ct);

            // Pre-warm all three period variants so any tab the user opens is instant.
            // Inside GetWellExecKpiAsync these calls also seed the WMR snapshot and DJP
            // snapshot caches that all filter combinations share.
            await repo.GetWellExecKpiAsync(period: "week",  ct: ct);
            await repo.GetWellExecKpiAsync(period: "month", ct: ct);
            await repo.GetWellExecKpiAsync(period: "day",   ct: ct);
            sw.Stop();
            log.LogInformation("DashboardCacheWarmup: well-exec-kpi pre-warmed in {Elapsed:F1}s",
                sw.Elapsed.TotalSeconds);
        }
        catch (Exception ex)
        {
            log.LogWarning(ex, "DashboardCacheWarmup: failed to pre-warm well-exec-kpi");
        }
    }

    private async Task WarmupWorkloadAnalysis(CancellationToken ct)
    {
        try
        {
            var sw = System.Diagnostics.Stopwatch.StartNew();
            using var scope = scopeFactory.CreateScope();
            var repo = scope.ServiceProvider.GetRequiredService<IDashboardRepository>();

            var year = DateTime.UtcNow.Year;
            var from = new DateOnly(year, 1, 1);
            var to = new DateOnly(year, 12, 31);

            await repo.GetWorkloadAnalysisAsync(from, to, ct: ct);
            sw.Stop();
            log.LogInformation("DashboardCacheWarmup: workload-analysis pre-warmed in {Elapsed:F1}s",
                sw.Elapsed.TotalSeconds);
        }
        catch (Exception ex)
        {
            log.LogWarning(ex, "DashboardCacheWarmup: failed to pre-warm workload-analysis");
        }
    }
}
