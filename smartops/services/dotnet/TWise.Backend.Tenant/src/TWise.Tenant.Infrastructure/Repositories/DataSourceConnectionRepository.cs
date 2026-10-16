using Microsoft.EntityFrameworkCore;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Infrastructure.Persistence;

namespace TWise.Tenant.Infrastructure.Repositories;

public sealed class DataSourceConnectionRepository(TenantDbContext db) : IDataSourceConnectionRepository
{
    public async Task<IReadOnlyList<DataSourceConnection>> GetAllAsync(long tenantId, CancellationToken ct = default)
        => await db.DataSourceConnections
            .AsNoTracking()
            .Where(c => c.TenantId == tenantId)
            .OrderByDescending(c => c.CreatedAt)
            .ToListAsync(ct);

    public async Task<DataSourceConnection?> GetByIdAsync(long id, long tenantId, CancellationToken ct = default)
        => await db.DataSourceConnections
            .FirstOrDefaultAsync(c => c.Id == id && c.TenantId == tenantId, ct);

    public async Task<bool> ExistsByNameAsync(string name, long tenantId, long? excludeId = null, CancellationToken ct = default)
        => await db.DataSourceConnections
            .AnyAsync(c => c.TenantId == tenantId
                        && c.ConnectionName == name
                        && (excludeId == null || c.Id != excludeId), ct);

    public async Task<DataSourceConnection> AddAsync(DataSourceConnection entity, CancellationToken ct = default)
    {
        db.DataSourceConnections.Add(entity);
        await db.SaveChangesAsync(ct);
        return entity;
    }

    public async Task UpdateAsync(DataSourceConnection entity, CancellationToken ct = default)
    {
        db.DataSourceConnections.Update(entity);
        await db.SaveChangesAsync(ct);
    }

    public async Task<bool> SoftDeleteAsync(long id, long tenantId, CancellationToken ct = default)
    {
        var entity = await db.DataSourceConnections.FirstOrDefaultAsync(c => c.Id == id && c.TenantId == tenantId, ct);
        if (entity is null) return false;

        entity.IsDeleted = true;
        entity.ModifiedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return true;
    }
}
