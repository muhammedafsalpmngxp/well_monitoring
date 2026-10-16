using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Abstractions.Services;

public interface IImportedDatasetService
{
    Task<IReadOnlyList<ImportedDatasetListDto>> GetAllAsync(long tenantId, long userId, CancellationToken ct = default);
    Task<ImportedDatasetDto?> GetByIdAsync(long id, long tenantId, CancellationToken ct = default);
    Task<ImportedDatasetDataResponse?> GetDataAsync(long id, long tenantId, CancellationToken ct = default);
    Task<ImportedDatasetDto> ImportAsync(Stream fileStream, string fileName, string? datasetName, long userId, long tenantId, CancellationToken ct = default);
    Task<bool> DeleteAsync(long id, long userId, long tenantId, CancellationToken ct = default);
}
