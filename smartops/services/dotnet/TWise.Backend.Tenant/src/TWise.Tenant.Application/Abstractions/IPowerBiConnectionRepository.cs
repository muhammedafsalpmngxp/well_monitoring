using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Abstractions;

public interface IPowerBiConnectionRepository
{
    Task<PowerBiConnection?> GetAsync(long tenantId, CancellationToken ct = default);
    Task<PowerBiConnection> SaveAsync(PowerBiConnection connection, CancellationToken ct = default);
}
