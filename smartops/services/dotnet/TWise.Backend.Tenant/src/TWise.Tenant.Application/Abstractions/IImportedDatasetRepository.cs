using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Abstractions;

public interface IImportedDatasetRepository
{
    Task<IReadOnlyList<ImportedDataset>> GetAllAsync(long tenantId, long userId, CancellationToken ct = default);

    /// <summary>
    /// Every dataset in the tenant, regardless of who created it. Used by refresh monitoring,
    /// which reports on the tenant's data rather than one user's uploads.
    /// </summary>
    Task<IReadOnlyList<ImportedDataset>> GetAllForTenantAsync(long tenantId, CancellationToken ct = default);
    Task<ImportedDataset?> GetByIdAsync(long id, long tenantId, CancellationToken ct = default);
    Task<ImportedDataset> CreateWithRowsAsync(ImportedDataset dataset, IReadOnlyList<string> rowJsonList, CancellationToken ct = default);
    Task<IReadOnlyList<string>> GetRowsAsync(long datasetId, int maxRows, CancellationToken ct = default);
    Task<bool> SoftDeleteAsync(long id, long userId, long tenantId, CancellationToken ct = default);
}
