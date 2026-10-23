using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Infrastructure.Services;

public sealed class SourceService(ISourceRepository repo, IViewRunRecorder runs, ICurrentUserService user) : ISourceService
{
    public Task<IReadOnlyList<SourceDto>> ListSourcesAsync(CancellationToken ct = default)
        => repo.ListSourcesAsync(ct);

    public Task<IReadOnlyList<SourceDto>> ListBITablesAsync(CancellationToken ct = default)
        => repo.ListBITablesAsync(ct);

    public Task<SyncTimeResponse?> GetSyncTimeAsync(CancellationToken ct = default)
        => repo.GetSyncTimeAsync(ct);

    public Task<TableDataDto?> GetTableDataAsync(string sourceName, string sourceType, CancellationToken ct = default)
        => runs.TimeAsync(Run(null, sourceName, sourceType), () => repo.GetTableDataAsync(sourceName, sourceType, ct),
            data => data is null ? (null, ViewRunTiming.NoResult) : (data.Rows.Count, null));

    /// <summary>Tile values (count, total, average, DAX measure).</summary>
    public Task<AggregateResultDto?> GetAggregateAsync(AggregateRequestDto request, CancellationToken ct = default)
        => runs.TimeAsync(Run(null, request.SourceName, request.SourceType), () => repo.GetAggregateAsync(request, ct),
            value => value is null ? (null, ViewRunTiming.NoResult) : (1, null));

    /// <summary>Every chart, tile, dashboard and Ask AI load goes through here, so each one is timed for the run log.</summary>
    public Task<TableDataDto?> GetFilteredChartDataAsync(ChartFilteredDataRequest request, CancellationToken ct = default)
        => runs.TimeAsync(Run(request.ViewId, request.ChartSource, request.ChartSourceType),
            () => repo.GetFilteredChartDataAsync(request, ct),
            data => data is null ? (null, ViewRunTiming.NoResult) : (data.Rows.Count, null));

    private ViewRun Run(long? viewId, string source, string type) =>
        new() { ViewId = viewId, SourceName = source, SourceType = type, Caller = ViewRunCallers.Chart, UserId = ViewRunTiming.UserIdOf(user) };

    public Task<IReadOnlyList<PlantFilterDto>> GetPlantFiltersAsync(CancellationToken ct = default)
        => repo.GetPlantFiltersAsync(ct);

    public Task<AdvancedFilterDataDto> GetAdvancedFilterDataAsync(CancellationToken ct = default)
        => repo.GetAdvancedFilterDataAsync(ct);
}
