using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Abstractions;

public interface IDatabaseViewRepository
{
    Task<IReadOnlyList<DatabaseView>> GetAllAsync(long tenantId, string? viewType = null, CancellationToken cancellationToken = default);
    /// <summary>Id, name, type, description and SQL only; everything a contract check needs.</summary>
    Task<IReadOnlyList<DatabaseView>> GetContractSourcesAsync(long tenantId, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<DatabaseView>> GetByIdsAsync(IEnumerable<long> ids, long tenantId, CancellationToken cancellationToken = default);
    Task<DatabaseView?> GetByIdAsync(long id, long tenantId, CancellationToken cancellationToken = default);
    /// <summary>Only the name: GetByIdAsync also pulls the stored preview rows, which can be tens of MB.</summary>
    Task<string?> GetNameAsync(long id, long tenantId, CancellationToken cancellationToken = default);
    /// <summary>Read-only view without the stored preview (PreviewDataJson can be tens of MB).</summary>
    Task<DatabaseView?> GetDetailAsync(long id, long tenantId, CancellationToken cancellationToken = default);
    /// <summary>Writes the preview snapshot columns without loading the row.</summary>
    Task SavePreviewAsync(long id, long tenantId, string columnsJson, string dataJson, int rowCount, CancellationToken cancellationToken = default);
    /// <summary>The stored preview: column list, the first <paramref name="maxRows"/> rows as a JSON array, row count and run time.</summary>
    Task<(string? ColumnsJson, string? RowsJson, int? RowCount, DateTime? ExecutedAt)?> GetPreviewSnapshotAsync(long id, long tenantId, int maxRows, CancellationToken cancellationToken = default);
    Task<DatabaseView> AddAsync(DatabaseView entity, CancellationToken cancellationToken = default);
    Task UpdateAsync(DatabaseView entity, CancellationToken cancellationToken = default);
    Task<bool> SoftDeleteAsync(long id, long userId, long tenantId, CancellationToken cancellationToken = default);
    Task<bool> ExistsByNameAsync(string viewName, long tenantId, long? excludeId = null, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<DatabaseView>> GetWithColumnsUsedAsync(long tenantId, CancellationToken cancellationToken = default);
    Task UpdateReliabilityAsync(long id, long tenantId, decimal? reliability, CancellationToken cancellationToken = default);
}
