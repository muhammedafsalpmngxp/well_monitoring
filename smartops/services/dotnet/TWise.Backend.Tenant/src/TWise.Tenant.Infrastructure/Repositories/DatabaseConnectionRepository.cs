using Microsoft.EntityFrameworkCore;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Infrastructure.Persistence;

namespace TWise.Tenant.Infrastructure.Repositories;

public sealed class DatabaseConnectionRepository(TenantDbContext db) : IDatabaseConnectionRepository
{
    public async Task<IReadOnlyList<DatabaseConnection>> GetAllAsync(long tenantId, CancellationToken cancellationToken = default)
        => await db.DatabaseConnections
            .Where(c => c.TenantId == tenantId)
            .OrderBy(c => c.ConnectionName)
            .AsNoTracking()
            .ToListAsync(cancellationToken);

    public async Task<DatabaseConnection?> GetByIdAsync(long id, long tenantId, CancellationToken cancellationToken = default)
        => await db.DatabaseConnections
            .FirstOrDefaultAsync(c => c.Id == id && c.TenantId == tenantId, cancellationToken);

    public async Task<DatabaseConnection> AddAsync(DatabaseConnection entity, CancellationToken cancellationToken = default)
    {
        db.DatabaseConnections.Add(entity);
        await db.SaveChangesAsync(cancellationToken);
        return entity;
    }

    public async Task UpdateAsync(DatabaseConnection entity, CancellationToken cancellationToken = default)
    {
        db.DatabaseConnections.Update(entity);
        await db.SaveChangesAsync(cancellationToken);
    }

    public async Task<bool> SoftDeleteAsync(long id, long tenantId, CancellationToken cancellationToken = default)
    {
        var entity = await db.DatabaseConnections
            .FirstOrDefaultAsync(c => c.Id == id && c.TenantId == tenantId, cancellationToken);
        if (entity is null) return false;

        entity.IsDeleted = true;
        entity.ModifiedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        return true;
    }

    public async Task<bool> ExistsByNameAsync(string connectionName, long tenantId, long? excludeId = null, CancellationToken cancellationToken = default)
    {
        var query = db.DatabaseConnections
            .Where(c => c.TenantId == tenantId && c.ConnectionName == connectionName);

        if (excludeId.HasValue)
            query = query.Where(c => c.Id != excludeId.Value);

        return await query.AnyAsync(cancellationToken);
    }
}
