using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using TWise.Backend.ControlPlane.Application.Abstractions.Services;
using TWise.Backend.ControlPlane.Infrastructure.Persistence;

namespace TWise.Backend.ControlPlane.Infrastructure.Services;

/// <summary>
/// Background worker that polls for tenants in 'pending_provision' status
/// and triggers provisioning automatically.
/// </summary>
public sealed class ProvisioningWorker(
    IServiceScopeFactory scopeFactory,
    IOptions<ProvisioningOptions> options,
    ILogger<ProvisioningWorker> logger) : BackgroundService
{
    private readonly ProvisioningOptions _opts = options.Value;
    private static readonly TimeSpan MinDelay = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan MaxDelay = TimeSpan.FromMinutes(2);
    private TimeSpan _currentDelay = MinDelay;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation("ProvisioningWorker started — polling for pending tenants");

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var processed = await ProcessPendingTenantsAsync(stoppingToken);

                // Back off when idle, reset when work was done
                _currentDelay = processed > 0
                    ? MinDelay
                    : TimeSpan.FromTicks(Math.Min(_currentDelay.Ticks * 2, MaxDelay.Ticks));
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "ProvisioningWorker encountered an error");
                _currentDelay = TimeSpan.FromTicks(Math.Min(_currentDelay.Ticks * 2, MaxDelay.Ticks));
            }

            await Task.Delay(_currentDelay, stoppingToken);
        }
    }

    private async Task<int> ProcessPendingTenantsAsync(CancellationToken ct)
    {
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ControlPlaneDbContext>();
        var provisioning = scope.ServiceProvider.GetRequiredService<ITenantProvisioningService>();
        var processed = 0;

        var pendingTenants = await db.Tenants
            .Where(t => t.Status == "pending_provision")
            .Select(t => t.TenantId)
            .ToListAsync(ct);

        foreach (var tenantId in pendingTenants)
        {
            logger.LogInformation("Auto-provisioning tenant {TenantId}", tenantId);
            await provisioning.ProvisionAsync(tenantId, ct);
            processed++;
        }

        // Also retry failed tenants that haven't exceeded max retries
        var failedTenants = await db.Tenants
            .Where(t => t.Status == "provision_failed" && t.RetryCount < _opts.MaxRetries)
            .Select(t => t.TenantId)
            .ToListAsync(ct);

        foreach (var tenantId in failedTenants)
        {
            logger.LogInformation("Auto-retrying provisioning for tenant {TenantId}", tenantId);
            await provisioning.RetryProvisionAsync(tenantId, ct);
            processed++;
        }

        return processed;
    }
}
