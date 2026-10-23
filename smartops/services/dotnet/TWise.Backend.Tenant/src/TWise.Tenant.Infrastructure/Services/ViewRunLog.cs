using System.Threading.Channels;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Features.SelfHealing;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Infrastructure.Persistence;
using TWise.Tenant.Infrastructure.Persistence.Configurations;

namespace TWise.Tenant.Infrastructure.Services;

/// <summary>
/// The view run log: loads are queued in memory (bounded, SelfHealing:QueueCapacity) and written in the background every
/// SelfHealing:FlushSeconds, at most SelfHealing:BatchSize per insert, so a chart never waits on the log. Every
/// SelfHealing:CleanupHours runs older than SelfHealing:RetentionDays are removed. A failed write is logged and dropped.
/// </summary>
public sealed class ViewRunLog(IDbContextFactory<TenantDbContext> dbs, SelfHealingOptions options, ILogger<ViewRunLog> logger)
    : BackgroundService, IViewRunRecorder
{
    private readonly Channel<ViewRun> queue = Channel.CreateBounded<ViewRun>(
        new BoundedChannelOptions(options.QueueCapacity) { FullMode = BoundedChannelFullMode.DropWrite, SingleReader = true });

    public void Record(ViewRun run)
    {
        if (!options.RecordRuns) return;
        if (run.Error is { Length: > ViewRunConfiguration.ErrorLength } e) run.Error = e[..ViewRunConfiguration.ErrorLength];
        queue.Writer.TryWrite(run);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(options.FlushSeconds));
        var nextCleanup = DateTime.UtcNow;
        try
        {
            while (await timer.WaitForNextTickAsync(stoppingToken))
            {
                await FlushAsync(stoppingToken);
                if (DateTime.UtcNow < nextCleanup) continue;
                await CleanupAsync(stoppingToken);
                nextCleanup = DateTime.UtcNow.AddHours(options.CleanupHours);
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
        }
    }

    /// <summary>Writes everything queued, a batch at a time.</summary>
    internal async Task FlushAsync(CancellationToken ct)
    {
        var batch = new List<ViewRun>(options.BatchSize);
        while (true)
        {
            batch.Clear();
            while (batch.Count < options.BatchSize && queue.Reader.TryRead(out var run)) batch.Add(run);
            if (batch.Count == 0) return;
            try
            {
                await using var db = await dbs.CreateDbContextAsync(ct);
                db.ViewRuns.AddRange(batch);
                await db.SaveChangesAsync(ct);
            }
            catch (Exception ex) when (!ct.IsCancellationRequested)
            {
                logger.LogWarning(ex, "Could not write {Count} view runs to the run log", batch.Count);
            }
        }
    }

    private async Task CleanupAsync(CancellationToken ct)
    {
        try
        {
            await using var db = await dbs.CreateDbContextAsync(ct);
            var before = DateTime.UtcNow.AddDays(-options.RetentionDays);
            var removed = await db.ViewRuns.Where(r => r.CreatedAt < before).ExecuteDeleteAsync(ct);
            if (removed > 0) logger.LogInformation("Removed {Count} view runs older than {Days} days", removed, options.RetentionDays);
        }
        catch (Exception ex) when (!ct.IsCancellationRequested)
        {
            logger.LogWarning(ex, "Could not remove old view runs");
        }
    }
}
