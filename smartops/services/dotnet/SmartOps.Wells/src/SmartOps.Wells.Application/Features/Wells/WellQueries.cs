using MediatR;
using SmartOps.Wells.Application.Abstractions;
using SmartOps.Wells.Contracts;

namespace SmartOps.Wells.Application.Features.Wells;

// ─── Cluster Queries ────────────────────────────────────────────────────────

public record ListClustersQuery : IRequest<List<ClusterDto>>;

public sealed class ListClustersQueryHandler(IWellsRepository repo)
    : IRequestHandler<ListClustersQuery, List<ClusterDto>>
{
    public Task<List<ClusterDto>> Handle(ListClustersQuery request, CancellationToken ct)
        => repo.ListClustersAsync(ct);
}

// ─── Well Queries ────────────────────────────────────────────────────────────

public record ListWellsQuery(string? Cluster, string? Status, string? Search)
    : IRequest<List<WellDto>>;

public sealed class ListWellsQueryHandler(IWellsRepository repo)
    : IRequestHandler<ListWellsQuery, List<WellDto>>
{
    public Task<List<WellDto>> Handle(ListWellsQuery request, CancellationToken ct)
        => repo.ListWellsAsync(request.Cluster, request.Status, request.Search, ct);
}

public record GetWellQuery(string WellId) : IRequest<WellDto?>;

public sealed class GetWellQueryHandler(IWellsRepository repo)
    : IRequestHandler<GetWellQuery, WellDto?>
{
    public Task<WellDto?> Handle(GetWellQuery request, CancellationToken ct)
        => repo.GetWellAsync(request.WellId, ct);
}

// ─── Milestone Queries ───────────────────────────────────────────────────────

public record ListMilestonesQuery(string? WellId, string? Status)
    : IRequest<List<MilestoneDto>>;

public sealed class ListMilestonesQueryHandler(IWellsRepository repo)
    : IRequestHandler<ListMilestonesQuery, List<MilestoneDto>>
{
    public Task<List<MilestoneDto>> Handle(ListMilestonesQuery request, CancellationToken ct)
        => repo.ListMilestonesAsync(request.WellId, request.Status, ct);
}

// ─── Watchlist Queries ───────────────────────────────────────────────────────

public record ListWatchlistQuery(int UserId) : IRequest<List<WatchlistEntryDto>>;

public sealed class ListWatchlistQueryHandler(IWellsRepository repo)
    : IRequestHandler<ListWatchlistQuery, List<WatchlistEntryDto>>
{
    public Task<List<WatchlistEntryDto>> Handle(ListWatchlistQuery request, CancellationToken ct)
        => repo.ListWatchlistAsync(request.UserId, ct);
}

// ─── Critical Date Queries ───────────────────────────────────────────────────

public record ListCriticalDatesQuery(string? WellId) : IRequest<List<CriticalDateDto>>;

public sealed class ListCriticalDatesQueryHandler(IWellsRepository repo)
    : IRequestHandler<ListCriticalDatesQuery, List<CriticalDateDto>>
{
    public Task<List<CriticalDateDto>> Handle(ListCriticalDatesQuery request, CancellationToken ct)
        => repo.ListCriticalDatesAsync(request.WellId, ct);
}

// ─── Well Report Data Query ──────────────────────────────────────────────────

public record GetWellReportDataQuery(string WellId) : IRequest<WellReportDataDto>;

public sealed class GetWellReportDataQueryHandler(IWellsRepository repo)
    : IRequestHandler<GetWellReportDataQuery, WellReportDataDto>
{
    public Task<WellReportDataDto> Handle(GetWellReportDataQuery request, CancellationToken ct)
        => repo.GetWellReportDataAsync(request.WellId, ct);
}

// ─── Weekly Progress Timeline Query ──────────────────────────────────────────

public record GetWeeklyProgressQuery(
    string ProjectId, string WellId, DateTime? From, DateTime? To,
    TimelineViewType ViewType = TimelineViewType.Week)
    : IRequest<WeeklyProgressTimelineResponse>;

public sealed class GetWeeklyProgressQueryHandler(IWellsRepository repo)
    : IRequestHandler<GetWeeklyProgressQuery, WeeklyProgressTimelineResponse>
{
    public async Task<WeeklyProgressTimelineResponse> Handle(
        GetWeeklyProgressQuery request, CancellationToken ct)
    {
        var data = await repo.GetWeeklyProgressAsync(
            request.ProjectId, request.WellId, request.From, request.To, request.ViewType, ct);

        decimal? velocity = null;
        if (data.Count >= 2)
        {
            var weeks = (decimal)(data[^1].ProgressDate - data[0].ProgressDate).TotalDays / 7m;
            if (weeks > 0)
                velocity = Math.Round(
                    (data[^1].ProgressPercentage - data[0].ProgressPercentage) / weeks, 2);
        }

        return new WeeklyProgressTimelineResponse(data, velocity, request.ViewType);
    }
}
