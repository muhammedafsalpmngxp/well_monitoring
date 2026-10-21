using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Features.Agents;

namespace TWise.Tenant.Infrastructure.Services;

/// <summary>
/// Every AgentSchedules:PollSeconds (60) runs up to five due agent triggers, one after another, each in its own DI
/// scope and claimed just before it runs (30-minute lease). AgentSchedules:Enabled false turns it off.
/// </summary>
public sealed class AgentScheduleWorker(IServiceScopeFactory scopes, IConfiguration config, ILogger<AgentScheduleWorker> logger) : BackgroundService
{
    private const int BatchSize = 5;
    private static readonly TimeSpan Lease = TimeSpan.FromMinutes(30);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (bool.TryParse(config["AgentSchedules:Enabled"], out var enabled) && !enabled) return;
        var every = TimeSpan.FromSeconds(int.TryParse(config["AgentSchedules:PollSeconds"], out var seconds) && seconds > 0 ? seconds : 60);
        using var timer = new PeriodicTimer(every);
        try
        {
            do await RunDueAsync(stoppingToken);
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
            long id;
            try
            {
                var now = DateTime.UtcNow;
                var claimed = await scope.ServiceProvider.GetRequiredService<IAiAgentRepository>().ClaimDueSchedulesAsync(now, 1, now + Lease, ct);
                if (claimed.Count == 0) return;
                id = claimed[0];
            }
            catch (Exception ex) when (!ct.IsCancellationRequested)
            {
                logger.LogWarning(ex, "Could not read due agent triggers");
                return;
            }

            try
            {
                await scope.ServiceProvider.GetRequiredService<AgentScheduleRunner>().RunAsync(id, ct);
                logger.LogInformation("Agent trigger {ScheduleId} ran", id);
            }
            catch (Exception ex) when (!ct.IsCancellationRequested)
            {
                // The lease runs out and the trigger is tried again.
                logger.LogError(ex, "Agent trigger {ScheduleId} could not be run", id);
            }
        }
    }
}
