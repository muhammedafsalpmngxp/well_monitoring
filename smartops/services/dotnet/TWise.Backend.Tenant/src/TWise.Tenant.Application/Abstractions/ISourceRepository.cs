using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Abstractions;

public interface ISourceRepository
{
    Task<IReadOnlyList<SourceDto>> ListSourcesAsync(CancellationToken ct = default);
    Task<IReadOnlyList<SourceDto>> ListBITablesAsync(CancellationToken ct = default);
    Task<TableDataDto?> GetTableDataAsync(string sourceName, string sourceType, CancellationToken ct = default);
    Task<AggregateResultDto?> GetAggregateAsync(AggregateRequestDto request, CancellationToken ct = default);
    Task<TableDataDto?> GetFilteredChartDataAsync(ChartFilteredDataRequest request, CancellationToken ct = default);
    Task<IReadOnlyList<PlantFilterDto>> GetPlantFiltersAsync(CancellationToken ct = default);
    Task<AdvancedFilterDataDto> GetAdvancedFilterDataAsync(CancellationToken ct = default);
}
