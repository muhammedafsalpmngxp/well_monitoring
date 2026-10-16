using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Infrastructure.Services;

/// <summary>
/// Polls for due refresh schedules and runs them.
///
/// Deliberately a poller rather than an in-memory timer per schedule: schedules change while
/// the process runs, and the database is the single source of truth for what is due. Polling
/// also means a restart loses nothing — anything that came due while the process was down is
/// picked up on the next tick.
///
/// Configuration (appsettings):
///   Refresh:Enabled              true (default) — set false to disable scheduling entirely
///   Refresh:PollSeconds          30 (default)
///   Refresh:MaxSchedulesPerTick  10 (default)
///   Refresh:JobRetentionDays     90 (default, 0 disables) — history older than this is purged
///   Refresh:PurgeBatchSize       500 (default)
/// </summary>
public sealed class RefreshWorker(
    IServiceScopeFactory scopeFactory,
    IConfiguration configuration,
    ILogger<RefreshWorker> logger) : BackgroundService
{
    private const int DefaultPollSeconds = 30;
    private const int DefaultMaxSchedulesPerTick = 10;
    private const int DefaultJobRetentionDays = 90;
    private const int DefaultPurgeBatchSize = 500;

    /// <summary>
    /// Retention runs on its own cadence, not every poll tick — purging is a whole-table scan
    /// and does not need to happen every 30 seconds.
    /// </summary>
    private static readonly TimeSpan PurgeInterval = TimeSpan.FromHours(6);

    /// <summary>Back-off after an unexpected tick failure, so a broken DB doesn't spin the loop.</summary>
    private static readonly TimeSpan ErrorBackoff = TimeSpan.FromMinutes(1);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!configuration.GetValue("Refresh:Enabled", true))
        {
            logger.LogInformation("Refresh scheduling is disabled (Refresh:Enabled = false).");
            return;
        }

        var pollInterval = TimeSpan.FromSeconds(configuration.GetValue("Refresh:PollSeconds", DefaultPollSeconds));
        var maxPerTick = configuration.GetValue("Refresh:MaxSchedulesPerTick", DefaultMaxSchedulesPerTick);

        var retentionDays = configuration.GetValue("Refresh:JobRetentionDays", DefaultJobRetentionDays);
        var purgeBatchSize = configuration.GetValue("Refresh:PurgeBatchSize", DefaultPurgeBatchSize);

        logger.LogInformation(
            "Refresh worker started. Poll={PollSeconds}s, MaxSchedulesPerTick={MaxPerTick}, JobRetentionDays={RetentionDays}",
            pollInterval.TotalSeconds, maxPerTick, retentionDays);

        // Purge on the first tick so a long-running backlog starts clearing at startup rather
        // than six hours later.
        var nextPurgeAt = DateTime.UtcNow;

        while (!stoppingToken.IsCancellationRequested)
        {
            var delay = pollInterval;

            try
            {
                await RunDueSchedulesAsync(maxPerTick, stoppingToken);

                if (retentionDays > 0 && DateTime.UtcNow >= nextPurgeAt)
                {
                    await PurgeOldJobsAsync(retentionDays, purgeBatchSize, stoppingToken);
                    nextPurgeAt = DateTime.UtcNow.Add(PurgeInterval);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                // A failure here is infrastructure-level (database unreachable). Individual
                // refresh failures are handled inside the executor and never reach this point.
                logger.LogError(ex, "Refresh worker tick failed; backing off for {Backoff}.", ErrorBackoff);
                delay = ErrorBackoff;
            }

            try
            {
                await Task.Delay(delay, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }

        logger.LogInformation("Refresh worker stopped.");
    }

    /// <summary>
    /// Deletes refresh history past the retention window. Without this the table grows without
    /// bound — a per-minute schedule alone adds roughly 1,440 rows a day.
    /// </summary>
    private async Task PurgeOldJobsAsync(int retentionDays, int batchSize, CancellationToken ct)
    {
        using var scope = scopeFactory.CreateScope();
        var repo = scope.ServiceProvider.GetRequiredService<IRefreshRepository>();

        var cutoff = DateTime.UtcNow.AddDays(-retentionDays);
        var deleted = await repo.PurgeJobsOlderThanAsync(cutoff, batchSize, ct);

        // One batch per pass keeps the delete short. A backlog larger than the batch is cleared
        // over successive passes rather than in one long-running transaction.
        if (deleted == batchSize)
            logger.LogInformation(
                "Job purge filled its {BatchSize}-row batch; more history remains and will be removed on the next pass.",
                batchSize);
    }

    private async Task RunDueSchedulesAsync(int maxPerTick, CancellationToken ct)
    {
        // A scope per tick: the repositories and DbContext are scoped, and holding one for the
        // lifetime of the worker would leak tracked entities and stale data.
        using var scope = scopeFactory.CreateScope();

        var repo = scope.ServiceProvider.GetRequiredService<IRefreshRepository>();
        var cron = scope.ServiceProvider.GetRequiredService<ICronEvaluator>();
        var executor = scope.ServiceProvider.GetRequiredService<IRefreshExecutor>();

        var now = DateTime.UtcNow;
        var due = await repo.GetDueSchedulesAsync(now, maxPerTick, ct);
        if (due.Count == 0) return;

        logger.LogInformation("Refresh worker found {Count} due schedule(s).", due.Count);

        foreach (var schedule in due)
        {
            if (ct.IsCancellationRequested) break;

            // Advance NextRunAt BEFORE running. If the run is slow or the process dies mid-way,
            // the schedule will not be picked up again on the next tick and run twice.
            var next = cron.GetNextOccurrence(schedule.CronExpression, schedule.TimeZoneId, now);

            if (next is null)
            {
                // An expression that never fires again would otherwise stay due forever.
                logger.LogWarning(
                    "Schedule {ScheduleId} ('{Name}') has no future occurrence; disabling it.",
                    schedule.Id, schedule.ScheduleName);

                schedule.IsEnabled = false;
                schedule.NextRunAt = null;
            }
            else
            {
                schedule.NextRunAt = next;
            }

            schedule.ModifiedAt = now;
            await repo.UpdateScheduleAsync(schedule, ct);

            if (next is null) continue;

            var job = await QueueJobAsync(repo, schedule, ct);
            await executor.ExecuteAsync(job.Id, ct);
        }
    }

    private static async Task<RefreshJob> QueueJobAsync(
        IRefreshRepository repo, RefreshSchedule schedule, CancellationToken ct)
    {
        var job = new RefreshJob
        {
            JobCode = await repo.NextJobCodeAsync(ct),
            ScheduleId = schedule.Id,
            DataSourceConnectionId = schedule.DataSourceConnectionId,
            ImportedDatasetId = schedule.ImportedDatasetId,
            JobProcess = schedule.ScheduleName,
            Status = RefreshJobStatuses.Queued,
            TriggeredBy = RefreshTriggers.Schedule,
            RefreshMode = schedule.RefreshMode,
            QueuedAt = DateTime.UtcNow,
            TenantId = schedule.TenantId
        };

        return await repo.AddJobAsync(job, ct);
    }
}
