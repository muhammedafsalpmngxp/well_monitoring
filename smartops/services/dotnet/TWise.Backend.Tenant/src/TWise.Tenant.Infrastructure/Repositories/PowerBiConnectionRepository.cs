using Microsoft.EntityFrameworkCore;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Infrastructure.Persistence;

namespace TWise.Tenant.Infrastructure.Repositories;

public sealed class PowerBiConnectionRepository(TenantDbContext db) : IPowerBiConnectionRepository
{
    public Task<PowerBiConnection?> GetAsync(long tenantId, CancellationToken ct = default)
        => db.PowerBiConnections.FirstOrDefaultAsync(c => c.TenantId == tenantId, ct);

    public async Task<PowerBiConnection> SaveAsync(PowerBiConnection connection, CancellationToken ct = default)
    {
        if (connection.Id == 0) db.PowerBiConnections.Add(connection);
        await db.SaveChangesAsync(ct);
        return connection;
    }
}
