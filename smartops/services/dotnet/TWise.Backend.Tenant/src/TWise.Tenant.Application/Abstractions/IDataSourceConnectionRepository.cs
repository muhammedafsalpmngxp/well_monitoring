using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Abstractions;

public interface IDataSourceConnectionRepository
{
    Task<IReadOnlyList<DataSourceConnection>> GetAllAsync(long tenantId, CancellationToken ct = default);
    Task<DataSourceConnection?> GetByIdAsync(long id, long tenantId, CancellationToken ct = default);
    Task<bool> ExistsByNameAsync(string name, long tenantId, long? excludeId = null, CancellationToken ct = default);
    Task<DataSourceConnection> AddAsync(DataSourceConnection entity, CancellationToken ct = default);
    Task UpdateAsync(DataSourceConnection entity, CancellationToken ct = default);
    Task<bool> SoftDeleteAsync(long id, long tenantId, CancellationToken ct = default);
}
