using SmartOps.Wells.Contracts;

namespace SmartOps.Wells.Application.Abstractions;

/// <summary>
/// Data-access contract for well aggregates.
/// Implemented in Infrastructure; consumed by Application CQRS handlers.
/// </summary>
public interface IWellsRepository
{
    Task<List<ClusterDto>> ListClustersAsync(CancellationToken ct = default);

    Task<List<WellDto>> ListWellsAsync(
        string? cluster, string? status, string? search, CancellationToken ct = default);

    Task<WellDto?> GetWellAsync(string wellId, CancellationToken ct = default);

    Task<WellDto> CreateWellAsync(WellCreateRequest request, CancellationToken ct = default);

    Task<WellDto?> UpdateWellAsync(
        string wellId, WellUpdateRequest request, CancellationToken ct = default);

    Task<bool> DeleteWellAsync(string wellId, CancellationToken ct = default);

    Task<List<MilestoneDto>> ListMilestonesAsync(
        string? wellId, string? status, CancellationToken ct = default);

    Task<List<WatchlistEntryDto>> ListWatchlistAsync(int userId, CancellationToken ct = default);

    Task<WatchlistEntryDto> AddWatchlistAsync(
        int userId, WatchlistAddRequest request, CancellationToken ct = default);

    Task<bool> RemoveWatchlistAsync(int userId, string wellId, CancellationToken ct = default);

    Task<List<CriticalDateDto>> ListCriticalDatesAsync(
        string? wellId, CancellationToken ct = default);

    Task<CriticalDateDto> CreateCriticalDateAsync(
        CriticalDateCreateRequest request, CancellationToken ct = default);

    /// <summary>
    /// Returns supplementary report data for a single well from
    /// SAP_DRILLING_SEQUENCE_History, ActivityTaskPlan, and task_daily.
    /// </summary>
    Task<WellReportDataDto> GetWellReportDataAsync(string wellId, CancellationToken ct = default);

    /// <summary>
    /// Returns week-wise overall progress percentage from the WMR table
    /// for a given well and project within the specified date range.
    /// </summary>
    Task<List<WeeklyProgressPointDto>> GetWeeklyProgressAsync(
        string projectId, string wellId,
        DateTime? from, DateTime? to,
        TimelineViewType viewType = TimelineViewType.Week,
        CancellationToken ct = default);
}
