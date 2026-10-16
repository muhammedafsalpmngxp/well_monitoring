using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Features.Delivery;

namespace TWise.Tenant.Infrastructure.Delivery;

/// <summary>
/// Every Delivery:PollSeconds (60) runs up to ten due schedules, one after another, each in its own DI scope. Each is
/// claimed just before it runs, so its ten-minute lease is not used up waiting behind the others. Delivery:Enabled
/// false turns it off.
/// </summary>
// ponytail: delivery is at least once. A crash after the mail went but before the run was recorded sends it again when
// the lease runs out. Schedules run one at a time; run them in parallel (each has its own scope) if a tick starts to lag.
public sealed class ScheduleWorker(IServiceScopeFactory scopes, IConfiguration config, ILogger<ScheduleWorker> logger) : BackgroundService
{
    private const int BatchSize = 10;
    private static readonly TimeSpan Lease = TimeSpan.FromMinutes(10);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (bool.TryParse(config["Delivery:Enabled"], out var enabled) && !enabled) return;
        var every = TimeSpan.FromSeconds(int.TryParse(config["Delivery:PollSeconds"], out var seconds) && seconds > 0 ? seconds : 60);
        using var timer = new PeriodicTimer(every);
        try
        {
            do
            {
                await RunDueAsync(stoppingToken);
            }
            while (await timer.WaitForNextTickAsync(stoppingToken));
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
        }
    }

    private async Task RunDueAsync(CancellationToken ct)
    {
        for (var i = 0; i < BatchSize; i++)
        {
            using var scope = scopes.CreateScope();
            var store = scope.ServiceProvider.GetRequiredService<IScheduleStore>();
            long id;
            try
            {
                var now = DateTime.UtcNow;
                var claimed = await store.ClaimDueAsync(now, 1, now + Lease, ct);
                if (claimed.Count == 0) return;
                id = claimed[0];
            }
            catch (Exception ex) when (!ct.IsCancellationRequested)
            {
                logger.LogWarning(ex, "Could not read due scheduled deliveries");
                return;
            }

            try
            {
                // Paused or deleted after the claim: leave it; resume sets its next run again.
                var schedule = await store.GetAsync(id, null, ct);
                if (schedule is not { IsActive: true, IsDeleted: false }) continue;
                var run = await scope.ServiceProvider.GetRequiredService<DeliveryRunner>().RunAsync(schedule, DeliveryTerms.OnSchedule, DateTime.UtcNow, ct);
                logger.LogInformation("Scheduled delivery {ScheduleId} {Status}", id, run.Status);
            }
            catch (Exception ex) when (!ct.IsCancellationRequested)
            {
                // The lease runs out and the schedule is tried again.
                logger.LogError(ex, "Scheduled delivery {ScheduleId} could not be run", id);
            }
        }
    }
}
