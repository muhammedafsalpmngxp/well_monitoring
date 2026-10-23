using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Infrastructure.Services;

public sealed class SourceService(ISourceRepository repo) : ISourceService
{
    public Task<IReadOnlyList<SourceDto>> ListSourcesAsync(CancellationToken ct = default)
        => repo.ListSourcesAsync(ct);

    public Task<IReadOnlyList<SourceDto>> ListBITablesAsync(CancellationToken ct = default)
        => repo.ListBITablesAsync(ct);

    public Task<SyncTimeResponse?> GetSyncTimeAsync(CancellationToken ct = default)
        => repo.GetSyncTimeAsync(ct);

    public Task<TableDataDto?> GetTableDataAsync(string sourceName, string sourceType, CancellationToken ct = default)
        => repo.GetTableDataAsync(sourceName, sourceType, ct);

    public Task<AggregateResultDto?> GetAggregateAsync(AggregateRequestDto request, CancellationToken ct = default)
        => repo.GetAggregateAsync(request, ct);

    public Task<TableDataDto?> GetFilteredChartDataAsync(ChartFilteredDataRequest request, CancellationToken ct = default)
        => repo.GetFilteredChartDataAsync(request, ct);

    public Task<IReadOnlyList<PlantFilterDto>> GetPlantFiltersAsync(CancellationToken ct = default)
        => repo.GetPlantFiltersAsync(ct);

    public Task<AdvancedFilterDataDto> GetAdvancedFilterDataAsync(CancellationToken ct = default)
        => repo.GetAdvancedFilterDataAsync(ct);
}
