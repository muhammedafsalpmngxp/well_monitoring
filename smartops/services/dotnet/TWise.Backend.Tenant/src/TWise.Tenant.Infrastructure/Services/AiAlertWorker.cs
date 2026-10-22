using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Features.Ai;

namespace TWise.Tenant.Infrastructure.Services;

/// <summary>
/// Every AiAlerts:PollSeconds checks up to AiAlerts:BatchSize due alerts, each in its own DI scope.
/// AiAlerts:Enabled false turns it off.
/// </summary>
// ponytail: no lease like the schedule worker; with several API instances a due alert may be checked twice in one
// tick. Harmless (it only notifies when the alert starts firing), so a claim is not worth it yet.
public sealed class AiAlertWorker(IServiceScopeFactory scopes, AiAlertOptions options, ILogger<AiAlertWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!options.Enabled) return;
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(options.PollSeconds));
        try
        {
            do await CheckDueAsync(stoppingToken);
            while (await timer.WaitForNextTickAsync(stoppingToken));
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
        }
    }

    private async Task CheckDueAsync(CancellationToken ct)
    {
        IReadOnlyList<(long Id, long TenantId)> due;
        try
        {
            using var scope = scopes.CreateScope();
            due = await scope.ServiceProvider.GetRequiredService<IAiAlertRepository>().DueAsync(DateTime.UtcNow, options.BatchSize, ct);
        }
        catch (Exception ex) when (!ct.IsCancellationRequested)
        {
            logger.LogWarning(ex, "Could not read due AI alerts");
            return;
        }

        foreach (var (id, tenantId) in due)
        {
            try
            {
                using var scope = scopes.CreateScope();
                var alert = await scope.ServiceProvider.GetRequiredService<IAiAlertService>().CheckAsync(id, tenantId, null, ct);
                logger.LogInformation("AI alert {AlertId} checked: {Triggered}", id, alert?.IsTriggered);
            }
            catch (Exception ex) when (!ct.IsCancellationRequested)
            {
                logger.LogError(ex, "AI alert {AlertId} could not be checked", id);
            }
        }
    }
}
