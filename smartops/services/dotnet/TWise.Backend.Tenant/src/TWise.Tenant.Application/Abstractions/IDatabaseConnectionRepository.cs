using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Abstractions;

public interface IDatabaseConnectionRepository
{
    Task<IReadOnlyList<DatabaseConnection>> GetAllAsync(long tenantId, CancellationToken cancellationToken = default);
    Task<DatabaseConnection?> GetByIdAsync(long id, long tenantId, CancellationToken cancellationToken = default);
    Task<DatabaseConnection> AddAsync(DatabaseConnection entity, CancellationToken cancellationToken = default);
    Task UpdateAsync(DatabaseConnection entity, CancellationToken cancellationToken = default);
    Task<bool> SoftDeleteAsync(long id, long tenantId, CancellationToken cancellationToken = default);
    Task<bool> ExistsByNameAsync(string connectionName, long tenantId, long? excludeId = null, CancellationToken cancellationToken = default);
}
