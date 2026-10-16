using TWise.Backend.ControlPlane.Application.Common;

namespace TWise.Backend.ControlPlane.Application.Abstractions.Services;

public interface ITenantProvisioningService
{
    Task<Result> ProvisionAsync(long tenantId, CancellationToken ct);
    Task<Result> RetryProvisionAsync(long tenantId, CancellationToken ct);
    Task<Result> DecommissionAsync(long tenantId, CancellationToken ct);
}
