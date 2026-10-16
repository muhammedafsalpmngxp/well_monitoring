using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Abstractions.Services;

public interface IDatabaseConnectionService
{
    Task<IReadOnlyList<DatabaseConnectionDto>> GetAllAsync(long tenantId, CancellationToken cancellationToken = default);
    Task<DatabaseConnectionDto?> GetByIdAsync(long id, long tenantId, CancellationToken cancellationToken = default);
    Task<DatabaseConnectionDto> CreateAsync(CreateDatabaseConnectionRequest request, long userId, long tenantId, CancellationToken cancellationToken = default);
    Task<DatabaseConnectionDto?> UpdateAsync(long id, UpdateDatabaseConnectionRequest request, long userId, long tenantId, CancellationToken cancellationToken = default);
    Task<bool> DeleteAsync(long id, long tenantId, CancellationToken cancellationToken = default);
    Task<DatabaseSchemaResponse?> GetSchemaAsync(long connectionId, long tenantId, CancellationToken cancellationToken = default);
    Task<DatabaseSchemaResponse?> SyncSchemaAsync(long connectionId, long tenantId, CancellationToken cancellationToken = default);
}
