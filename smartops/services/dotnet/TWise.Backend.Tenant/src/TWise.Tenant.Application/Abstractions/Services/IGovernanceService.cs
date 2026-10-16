using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Abstractions.Services;

/// <summary>Data governance: the data dictionary and the lineage graph.</summary>
public interface IGovernanceService
{
    Task<IReadOnlyList<DictionaryDatasetDto>> ListDatasetsAsync(long tenantId, CancellationToken ct = default);

    /// <summary>Null when the dataset does not exist for the tenant.</summary>
    Task<DictionaryDatasetDetailDto?> GetDatasetAsync(string kind, long id, long tenantId, CancellationToken ct = default);

    /// <summary>Upserts the dataset-level entry and every column sent; columns not sent are left alone.</summary>
    Task<DictionaryDatasetDetailDto?> SaveDatasetAsync(string kind, long id, SaveDictionaryRequest request, long userId, long tenantId, CancellationToken ct = default);

    Task<LineageGraphDto> GetLineageAsync(long tenantId, CancellationToken ct = default);
}
