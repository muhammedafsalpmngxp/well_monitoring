using MediatR;
using SmartOps.Wells.Application.Abstractions;
using SmartOps.Wells.Contracts;

namespace SmartOps.Wells.Application.Features.Dashboard;

public record GetCrewsDeployedKpiQuery(
    string? CrewGroup,
    string? Cluster,
    string? WellId,
    DateOnly? From,
    DateOnly? To)
    : IRequest<CrewsDeployedKpiDto>;

public sealed class GetCrewsDeployedKpiQueryHandler(IDashboardRepository repo)
    : IRequestHandler<GetCrewsDeployedKpiQuery, CrewsDeployedKpiDto>
{
    public Task<CrewsDeployedKpiDto> Handle(GetCrewsDeployedKpiQuery request, CancellationToken ct)
        => repo.GetCrewsDeployedKpiAsync(
            request.CrewGroup,
            request.Cluster,
            request.WellId,
            request.From,
            request.To,
            ct);
}

public record GetActivitiesProgressQuery(
    string Odc,
    string? Cluster,
    string? ProjectId,
    string? ScheduleId,
    string? WellId,
    DateTime? StartDate,
    DateTime? EndDate)
    : IRequest<ActivitiesProgressDto>;

public sealed class GetActivitiesProgressQueryHandler(IDashboardRepository repo)
    : IRequestHandler<GetActivitiesProgressQuery, ActivitiesProgressDto>
{
    public Task<ActivitiesProgressDto> Handle(GetActivitiesProgressQuery request, CancellationToken ct)
        => repo.GetActivitiesProgressAsync(
            request.Odc,
            request.Cluster,
            request.ProjectId,
            request.ScheduleId,
            request.WellId,
            request.StartDate,
            request.EndDate,
            ct);
}

public record GetActivitiesListQuery(
    string Odc,
    string? Cluster,
    string? WellId,
    DateTime? StartDate,
    DateTime? EndDate,
    int Page,
    int PageSize)
    : IRequest<ActivitiesListResponse>;

public sealed class GetActivitiesListQueryHandler(IDashboardRepository repo)
    : IRequestHandler<GetActivitiesListQuery, ActivitiesListResponse>
{
    public Task<ActivitiesListResponse> Handle(GetActivitiesListQuery request, CancellationToken ct)
        => repo.GetActivitiesListAsync(
            request.Odc,
            request.Cluster,
            request.WellId,
            request.StartDate,
            request.EndDate,
            request.Page,
            request.PageSize,
            ct);
}

public record GetActiveWellsKpiQuery(
    string? Cluster,
    string? Site,
    string? WellType,
    string? Project,
    string? WellId,
    DateOnly? From,
    DateOnly? To,
    bool ThisMonth = false)
    : IRequest<ActiveWellsKpiDto>;

public sealed class GetActiveWellsKpiQueryHandler(IDashboardRepository repo)
    : IRequestHandler<GetActiveWellsKpiQuery, ActiveWellsKpiDto>
{
    public Task<ActiveWellsKpiDto> Handle(GetActiveWellsKpiQuery request, CancellationToken ct)
        => repo.GetActiveWellsKpiAsync(
            request.Cluster,
            request.Site,
            request.WellType,
            request.Project,
            request.WellId,
            request.From,
            request.To,
            request.ThisMonth,
            ct);
}

public record GetWmrWellsQuery(
    string? Cluster,
    string? WellId,
    string? Status,
    DateOnly? From,
    DateOnly? To,
    bool ThisMonth = false,
    string? WrFilter = null,
    int? PlanYear = null,
    DateOnly? AsOfDate = null,
    string? CommStatus = null,
    string? WellType = null,
    string? Project = null)
    : IRequest<IReadOnlyList<WmrWellDto>>;

public sealed class GetWmrWellsQueryHandler(IDashboardRepository repo)
    : IRequestHandler<GetWmrWellsQuery, IReadOnlyList<WmrWellDto>>
{
    public Task<IReadOnlyList<WmrWellDto>> Handle(GetWmrWellsQuery request, CancellationToken ct)
        => repo.GetWmrWellsAsync(
            request.Cluster,
            request.WellId,
            request.Status,
            request.From,
            request.To,
            request.ThisMonth,
            request.WrFilter,
            request.PlanYear,
            request.AsOfDate,
            request.CommStatus,
            request.WellType,
            request.Project,
            ct);
}

public record GetWellStatusListQuery(
    string? Cluster,
    string? Site,
    string? WellType,
    string? Project,
    DateOnly? From,
    DateOnly? To,
    string? CommStatus = null,
    DateOnly? CommFrom = null,
    DateOnly? CommTo = null,
    bool BufferReady = false,
    string? PeggingBucket = null,
    bool WlaMode = false)
    : IRequest<IReadOnlyList<WellStatusListDto>>;

public sealed class GetWellStatusListQueryHandler(IDashboardRepository repo)
    : IRequestHandler<GetWellStatusListQuery, IReadOnlyList<WellStatusListDto>>
{
    public Task<IReadOnlyList<WellStatusListDto>> Handle(GetWellStatusListQuery request, CancellationToken ct)
        => repo.GetWellStatusListAsync(
            request.Cluster, request.Site, request.WellType, request.Project, request.From, request.To, request.CommStatus, request.CommFrom, request.CommTo, request.BufferReady, request.PeggingBucket, request.WlaMode, ct);
}

public record GetWellProgressQuery(
    string? Cluster,
    string? WellId,
    string? Status,
    DateOnly? From,
    DateOnly? To,
    bool ThisMonth = false,
    int Page = 1,
    int PageSize = 20)
    : IRequest<WellProgressPageDto>;

public sealed class GetWellProgressQueryHandler(IDashboardRepository repo)
    : IRequestHandler<GetWellProgressQuery, WellProgressPageDto>
{
    public Task<WellProgressPageDto> Handle(GetWellProgressQuery request, CancellationToken ct)
        => repo.GetWellProgressAsync(
            request.Cluster,
            request.WellId,
            request.Status,
            request.From,
            request.To,
            request.ThisMonth,
            request.Page,
            request.PageSize,
            ct);
}

public record GetWellProgressKpiQuery(
    string? Cluster = null,
    string? WellId = null,
    string? WellType = null,
    DateOnly? From = null,
    DateOnly? To = null)
    : IRequest<WellProgressKpiDto>;

public sealed class GetWellProgressKpiQueryHandler(IDashboardRepository repo)
    : IRequestHandler<GetWellProgressKpiQuery, WellProgressKpiDto>
{
    public Task<WellProgressKpiDto> Handle(GetWellProgressKpiQuery request, CancellationToken ct)
        => repo.GetWellProgressKpiAsync(request.Cluster, request.WellId, request.WellType, request.From, request.To, ct);
}
// ─── Drilled Wells Completion ─────────────────────────────────────────────────

public record GetDrilledWellsCompletionQuery(
    string? Cluster = null,
    string? WellId = null,
    string? WellType = null,
    string? Site = null,
    string? Project = null,
    DateOnly? From = null,
    DateOnly? To = null)
    : IRequest<DrilledWellsCompletionDto>;

public sealed class GetDrilledWellsCompletionQueryHandler(IDashboardRepository repo)
    : IRequestHandler<GetDrilledWellsCompletionQuery, DrilledWellsCompletionDto>
{
    public Task<DrilledWellsCompletionDto> Handle(GetDrilledWellsCompletionQuery request, CancellationToken ct)
        => repo.GetDrilledWellsCompletionAsync(request.Cluster, request.WellId, request.WellType, request.Site, request.Project, request.From, request.To, ct);
}

// ─── Drilled Wells Breakdown (Commissioning) ──────────────────────────────────

public record GetDrilledWellsBreakdownQuery(
    string? Cluster = null,
    string? WellId = null,
    string? Project = null,
    DateOnly? From = null,
    DateOnly? To = null)
    : IRequest<DrilledWellsBreakdownDto>;

public sealed class GetDrilledWellsBreakdownQueryHandler(IDashboardRepository repo)
    : IRequestHandler<GetDrilledWellsBreakdownQuery, DrilledWellsBreakdownDto>
{
    public Task<DrilledWellsBreakdownDto> Handle(GetDrilledWellsBreakdownQuery request, CancellationToken ct)
        => repo.GetDrilledWellsBreakdownAsync(request.Cluster, request.WellId, request.Project, request.From, request.To, ct);
}

// ─── Drilled Wells YTD Completion (Year-over-Year) ────────────────────────────

public record GetDrilledWellsYtdCompletionQuery(
    DateOnly? From = null,
    DateOnly? To = null,
    int? Year = null,
    DateOnly? AsOfDate = null,
    string? Cluster = null,
    string? WellId = null,
    string? Project = null,
    string? WellType = null,
    string? Site = null)
    : IRequest<DrilledWellsYtdCompletionDto>;

public sealed class GetDrilledWellsYtdCompletionQueryHandler(IDashboardRepository repo)
    : IRequestHandler<GetDrilledWellsYtdCompletionQuery, DrilledWellsYtdCompletionDto>
{
    public Task<DrilledWellsYtdCompletionDto> Handle(GetDrilledWellsYtdCompletionQuery request, CancellationToken ct)
        => repo.GetDrilledWellsYtdCompletionAsync(request.From, request.To, request.Year, request.AsOfDate, request.Cluster, request.WellId, request.Project, request.WellType, request.Site, ct);
}

// ─── Due Wells Completion ─────────────────────────────────────────────────────
public record GetDueWellsCompletionQuery(
    string? Cluster = null,
    string? Location = null,
    string? Site = null,
    string? Project = null,
    string? WellId = null,
    DateOnly? From = null,
    DateOnly? To = null)
    : IRequest<DueWellsCompletionDto>;

public sealed class GetDueWellsCompletionQueryHandler(IDashboardRepository repo)
    : IRequestHandler<GetDueWellsCompletionQuery, DueWellsCompletionDto>
{
    public Task<DueWellsCompletionDto> Handle(GetDueWellsCompletionQuery request, CancellationToken ct)
        => repo.GetDueWellsCompletionAsync(request.Cluster, request.Location, request.Site, request.Project, request.WellId, request.From, request.To, ct);
}

// ─── Due Wells Completion Trend (by completion date) ──────────────────────────
public record GetDueWellsCompletionTrendQuery(
    string? Cluster = null,
    string? Location = null,
    string? Site = null,
    string? Project = null,
    string? WellId = null,
    DateOnly? From = null,
    DateOnly? To = null)
    : IRequest<DueWellsCompletionTrendDto>;

public sealed class GetDueWellsCompletionTrendQueryHandler(IDashboardRepository repo)
    : IRequestHandler<GetDueWellsCompletionTrendQuery, DueWellsCompletionTrendDto>
{
    public Task<DueWellsCompletionTrendDto> Handle(GetDueWellsCompletionTrendQuery request, CancellationToken ct)
        => repo.GetDueWellsCompletionTrendAsync(request.Cluster, request.Location, request.Site, request.Project, request.WellId, request.From, request.To, ct);
}
// â”€â”€â”€ Critical Dates Timeline â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

public record GetCriticalDatesTimelineQuery(int Page, int PageSize, string? Cluster = null, string? Site = null, string? WellId = null, DateOnly? From = null, DateOnly? To = null, string? WellType = null)
    : IRequest<CriticalDatesTimelinePageDto>;

public sealed class GetCriticalDatesTimelineQueryHandler(IDashboardRepository repo)
    : IRequestHandler<GetCriticalDatesTimelineQuery, CriticalDatesTimelinePageDto>
{
    public Task<CriticalDatesTimelinePageDto> Handle(
        GetCriticalDatesTimelineQuery request, CancellationToken ct)
        => repo.GetCriticalDatesTimelineAsync(request.Page, request.PageSize, request.Cluster, request.Site, request.WellId, request.From, request.To, request.WellType, ct);
}

// ─── Target Finish Timeline ───────────────────────────────────────────────────

public record GetTargetFinishTimelineQuery(string? Cluster = null, string? Site = null, string? WellType = null, string? WellId = null, DateOnly? From = null, DateOnly? To = null, int Take = 50)
    : IRequest<TargetFinishTimelineDto>;

public sealed class GetTargetFinishTimelineQueryHandler(IDashboardRepository repo)
    : IRequestHandler<GetTargetFinishTimelineQuery, TargetFinishTimelineDto>
{
    public Task<TargetFinishTimelineDto> Handle(
        GetTargetFinishTimelineQuery request, CancellationToken ct)
        => repo.GetTargetFinishTimelineAsync(request.Cluster, request.Site, request.WellType, request.WellId, request.From, request.To, request.Take, ct);
}

// â”€â”€â”€ Workload Analysis â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

public record GetWorkloadAnalysisQuery(DateOnly From, DateOnly To, string? Cluster = null, string? WellId = null, string? Project = null)
    : IRequest<WorkloadAnalysisResponse>;

public sealed class GetWorkloadAnalysisQueryHandler(IDashboardRepository repo)
    : IRequestHandler<GetWorkloadAnalysisQuery, WorkloadAnalysisResponse>
{
    public Task<WorkloadAnalysisResponse> Handle(
        GetWorkloadAnalysisQuery request, CancellationToken ct)
        => repo.GetWorkloadAnalysisAsync(request.From, request.To, request.Cluster, request.WellId, request.Project, ct);
}


public record GetCrewPRatingDistributionQuery(string? Cluster, string? WellType, string? Site, string? Project, DateOnly? From, DateOnly? To)
    : IRequest<IReadOnlyList<CrewPRatingDistributionDto>>;

public sealed class GetCrewPRatingDistributionQueryHandler(IDashboardRepository repo)
    : IRequestHandler<GetCrewPRatingDistributionQuery, IReadOnlyList<CrewPRatingDistributionDto>>
{
    public Task<IReadOnlyList<CrewPRatingDistributionDto>> Handle(
        GetCrewPRatingDistributionQuery request, CancellationToken ct)
        => repo.GetCrewPRatingDistributionAsync(request.Cluster, request.WellType, request.Site, request.Project, request.From, request.To, ct);
}

public record GetWellDetailQuery(string WellId) : IRequest<WellDetailDto?>;

public sealed class GetWellDetailQueryHandler(IDashboardRepository repo)
    : IRequestHandler<GetWellDetailQuery, WellDetailDto?>
{
    public Task<WellDetailDto?> Handle(
        GetWellDetailQuery request, CancellationToken ct)
        => repo.GetWellDetailAsync(request.WellId, ct);
}

public record GetWellPlannerQuery(
    string?  Cluster,
    string?  WellId,
    DateOnly? From,
    DateOnly? To)
    : IRequest<WellPlannerResponseDto>;

public sealed class GetWellPlannerQueryHandler(IDashboardRepository repo)
    : IRequestHandler<GetWellPlannerQuery, WellPlannerResponseDto>
{
    public Task<WellPlannerResponseDto> Handle(
        GetWellPlannerQuery request, CancellationToken ct)
        => repo.GetWellPlannerAsync(request.Cluster, request.WellId, request.From, request.To, ct);
}

public record GetClusterWellsQuery() : IRequest<IReadOnlyList<ClusterWellsDto>>;

public sealed class GetClusterWellsQueryHandler(IDashboardRepository repo)
    : IRequestHandler<GetClusterWellsQuery, IReadOnlyList<ClusterWellsDto>>
{
    public Task<IReadOnlyList<ClusterWellsDto>> Handle(GetClusterWellsQuery request, CancellationToken ct)
        => repo.GetClusterWellsAsync(ct);
}

public record GetClusterHealthQuery(DateOnly? From = null, DateOnly? To = null, string? WellType = null, string? Cluster = null, string? Site = null, string? Project = null) : IRequest<ClusterHealthDto>;

public sealed class GetClusterHealthQueryHandler(IDashboardRepository repo)
    : IRequestHandler<GetClusterHealthQuery, ClusterHealthDto>
{
    public Task<ClusterHealthDto> Handle(GetClusterHealthQuery request, CancellationToken ct)
        => repo.GetClusterHealthAsync(request.From, request.To, request.WellType, request.Cluster, request.Site, request.Project, ct);
}

public record GetWellStagesQuery(string WellId, DateOnly? From = null, DateOnly? To = null) : IRequest<WellStagesDto>;

public sealed class GetWellStagesQueryHandler(IDashboardRepository repo)
    : IRequestHandler<GetWellStagesQuery, WellStagesDto>
{
    public Task<WellStagesDto> Handle(GetWellStagesQuery request, CancellationToken ct)
        => repo.GetWellStagesAsync(request.WellId, request.From, request.To, ct);
}

public record GetWellWorkgroupsQuery(string WellId, string? ProjectId = null) : IRequest<WellWorkgroupsDto>;

public sealed class GetWellWorkgroupsQueryHandler(IDashboardRepository repo)
    : IRequestHandler<GetWellWorkgroupsQuery, WellWorkgroupsDto>
{
    public Task<WellWorkgroupsDto> Handle(GetWellWorkgroupsQuery request, CancellationToken ct)
        => repo.GetWellWorkgroupsAsync(request.WellId, ct, request.ProjectId);
}

public record GetWellProjectsQuery(string WellId) : IRequest<IReadOnlyList<WellProjectDto>>;

public sealed class GetWellProjectsQueryHandler(IDashboardRepository repo)
    : IRequestHandler<GetWellProjectsQuery, IReadOnlyList<WellProjectDto>>
{
    public Task<IReadOnlyList<WellProjectDto>> Handle(GetWellProjectsQuery request, CancellationToken ct)
        => repo.GetWellProjectsAsync(request.WellId, ct);
}

public record GetActivityGanttQuery() : IRequest<IReadOnlyList<ActivityGanttRowDto>>;

public sealed class GetActivityGanttQueryHandler(IDashboardRepository repo)
    : IRequestHandler<GetActivityGanttQuery, IReadOnlyList<ActivityGanttRowDto>>
{
    public Task<IReadOnlyList<ActivityGanttRowDto>> Handle(GetActivityGanttQuery request, CancellationToken ct)
        => repo.GetActivityGanttAsync(ct);
}

public record GetClusterWellsProgressQuery(DateOnly? From = null, DateOnly? To = null, string? WellType = null, string? Project = null) : IRequest<IReadOnlyList<ClusterWellsProgressDto>>;

public sealed class GetClusterWellsProgressQueryHandler(IDashboardRepository repo)
    : IRequestHandler<GetClusterWellsProgressQuery, IReadOnlyList<ClusterWellsProgressDto>>
{
    public Task<IReadOnlyList<ClusterWellsProgressDto>> Handle(GetClusterWellsProgressQuery request, CancellationToken ct)
        => repo.GetClusterWellsProgressAsync(request.From, request.To, request.WellType, request.Project, ct);
}

//Wells Readiness Overall Status 

public record GetWellsReadinessQuery(int? PlanYear = null, DateOnly? AsOfDate = null, string? Cluster = null, DateOnly? FromDate = null, DateOnly? ToDate = null, string? WellType = null, string? Project = null) : IRequest<WellsReadinessDto>;

public sealed class GetWellsReadinessQueryHandler(IDashboardRepository repo)
    : IRequestHandler<GetWellsReadinessQuery, WellsReadinessDto>
{
    public Task<WellsReadinessDto> Handle(GetWellsReadinessQuery request, CancellationToken ct)
        => repo.GetWellsReadinessAsync(request.PlanYear, request.AsOfDate, request.Cluster, request.FromDate, request.ToDate, request.WellType, request.Project, ct);
}

// --- Wells Readiness By Type (bulk — avoids N+1) ----------------------------

public record GetWellsReadinessByTypeQuery(DateOnly FromDate, DateOnly ToDate, DateOnly? AsOfDate = null, string? Cluster = null, string? Project = null) : IRequest<WellsReadinessByTypeDto>;

public sealed class GetWellsReadinessByTypeQueryHandler(IDashboardRepository repo)
    : IRequestHandler<GetWellsReadinessByTypeQuery, WellsReadinessByTypeDto>
{
    public Task<WellsReadinessByTypeDto> Handle(GetWellsReadinessByTypeQuery request, CancellationToken ct)
        => repo.GetWellsReadinessByTypeAsync(request.FromDate, request.ToDate, request.AsOfDate, request.Cluster, request.Project, ct);
}

// --- PDO Commissioning Status -----------------------------------------------

public record GetCommissioningStatusQuery(string? Cluster = null, string? WellId = null, DateOnly? StartDate = null, DateOnly? EndDate = null, string? WellType = null, string? Project = null) : IRequest<CommissioningStatusDto>;

public sealed class GetCommissioningStatusQueryHandler(IDashboardRepository repo)
    : IRequestHandler<GetCommissioningStatusQuery, CommissioningStatusDto>
{
    public Task<CommissioningStatusDto> Handle(GetCommissioningStatusQuery request, CancellationToken ct)
        => repo.GetCommissioningStatusAsync(request.Cluster, request.WellId, request.StartDate, request.EndDate, request.WellType, request.Project, ct);
}

// --- Buffer Flowlines Ready --------------------------------------------------

public record GetBufferFlowlinesReadyQuery(string? Cluster = null, string? WellId = null, DateOnly? StartDate = null, DateOnly? EndDate = null, string? WellType = null, string? Project = null) : IRequest<BufferFlowlinesReadyDto>;

public sealed class GetBufferFlowlinesReadyQueryHandler(IDashboardRepository repo)
    : IRequestHandler<GetBufferFlowlinesReadyQuery, BufferFlowlinesReadyDto>
{
    public Task<BufferFlowlinesReadyDto> Handle(GetBufferFlowlinesReadyQuery request, CancellationToken ct)
        => repo.GetBufferFlowlinesReadyAsync(request.Cluster, request.WellId, request.StartDate, request.EndDate, request.WellType, request.Project, ct);
}

// ─── Construction Progress (Flowline & OHL) ──────────────────────────────────

public record GetConstructionProgressQuery(int? PlanYear = null, DateOnly? AsOfDate = null, string? Cluster = null, string? WellId = null, DateOnly? FromDate = null, DateOnly? ToDate = null, string? WellType = null, string? Site = null, string? Project = null) : IRequest<ConstructionProgressResponse>;

public sealed class GetConstructionProgressQueryHandler(IDashboardRepository repo)
    : IRequestHandler<GetConstructionProgressQuery, ConstructionProgressResponse>
{
    public Task<ConstructionProgressResponse> Handle(GetConstructionProgressQuery request, CancellationToken ct)
        => repo.GetConstructionProgressAsync(request.PlanYear, request.AsOfDate, request.Cluster, request.WellId, request.FromDate, request.ToDate, request.WellType, request.Site, request.Project, ct);
}

// ─── Construction Progress Wells Drilldown ────────────────────────────────────

public record GetConstructionProgressWellsQuery(string Filter, int? PlanYear = null, DateOnly? AsOfDate = null, string? Cluster = null, string? WellId = null, int Page = 1, int PageSize = 50, DateOnly? FromDate = null, DateOnly? ToDate = null, string? WellType = null, string? Project = null) : IRequest<WmrWellsPageDto>;

public sealed class GetConstructionProgressWellsQueryHandler(IDashboardRepository repo)
    : IRequestHandler<GetConstructionProgressWellsQuery, WmrWellsPageDto>
{
    public async Task<WmrWellsPageDto> Handle(GetConstructionProgressWellsQuery request, CancellationToken ct)
    {
        var wells = await repo.GetConstructionProgressWellsAsync(request.Filter, request.PlanYear, request.AsOfDate, request.Cluster, request.WellId, request.FromDate, request.ToDate, request.WellType, request.Project, ct);
        var total = wells.Count;
        var paged = wells.Skip((request.Page - 1) * request.PageSize).Take(request.PageSize).ToList();
        return new WmrWellsPageDto(paged, request.Page, request.PageSize, total);
    }
}

// ─── Flowline Readiness (Funnel Widget) ──────────────────────────────────────

public record GetFlowlineReadinessQuery(int? PlanYear = null, DateOnly? AsOfDate = null, string? Cluster = null, string? WellId = null, DateOnly? FromDate = null, DateOnly? ToDate = null, string? WellType = null, string? Project = null) : IRequest<FlowlineReadinessResponse>;

public sealed class GetFlowlineReadinessQueryHandler(IDashboardRepository repo)
    : IRequestHandler<GetFlowlineReadinessQuery, FlowlineReadinessResponse>
{
    public Task<FlowlineReadinessResponse> Handle(GetFlowlineReadinessQuery request, CancellationToken ct)
        => repo.GetFlowlineReadinessAsync(request.PlanYear, request.AsOfDate, request.Cluster, request.WellId, request.FromDate, request.ToDate, request.WellType, request.Project, ct);
}

// ─── OHL Readiness (Funnel Widget) ───────────────────────────────────────────

public record GetOhlReadinessQuery(int? PlanYear = null, DateOnly? AsOfDate = null, string? Cluster = null, string? WellId = null, DateOnly? FromDate = null, DateOnly? ToDate = null, string? WellType = null, string? Project = null) : IRequest<OhlReadinessResponse>;

public sealed class GetOhlReadinessQueryHandler(IDashboardRepository repo)
    : IRequestHandler<GetOhlReadinessQuery, OhlReadinessResponse>
{
    public Task<OhlReadinessResponse> Handle(GetOhlReadinessQuery request, CancellationToken ct)
        => repo.GetOhlReadinessAsync(request.PlanYear, request.AsOfDate, request.Cluster, request.WellId, request.FromDate, request.ToDate, request.WellType, request.Project, ct);
}

// ─── Commissioning Progress ───────────────────────────────────────────────────

public record GetCommissioningProgressQuery(int? FiscalYear = null, DateOnly? AsOfDate = null) : IRequest<CommissioningProgressResponse>;

public sealed class GetCommissioningProgressQueryHandler(IDashboardRepository repo)
    : IRequestHandler<GetCommissioningProgressQuery, CommissioningProgressResponse>
{
    public Task<CommissioningProgressResponse> Handle(GetCommissioningProgressQuery request, CancellationToken ct)
        => repo.GetCommissioningProgressAsync(request.FiscalYear, request.AsOfDate, ct);
}

// --- Daily Output Rate Trend -------------------------------------------------

public record GetDailyOutputRateQuery(
    string?   Cluster   = null,
    string?   Site      = null,
    string?   WellId    = null,
    string?   Location  = null,
    string?   Project   = null,
    DateOnly? From      = null,
    DateOnly? To        = null) : IRequest<DailyOutputRateDto>;

public sealed class GetDailyOutputRateQueryHandler(IDashboardRepository repo)
    : IRequestHandler<GetDailyOutputRateQuery, DailyOutputRateDto>
{
    public Task<DailyOutputRateDto> Handle(GetDailyOutputRateQuery request, CancellationToken ct)
        => repo.GetDailyOutputRateAsync(request.Cluster, request.Site, request.WellId, request.Location, request.Project, request.From, request.To, ct);
}

// ─── Buffer Location Construction Progress ───────────────────────────────────

public record GetBufferLocationProgressQuery(
    int?      PlanYear  = null,
    DateOnly? AsOfDate  = null,
    string?   Cluster   = null,
    string?   WellType  = null,
    DateOnly? FromDate  = null,
    DateOnly? ToDate    = null,
    string?   Project   = null) : IRequest<BufferLocationProgressResponse>;

public sealed class GetBufferLocationProgressQueryHandler(IDashboardRepository repo)
    : IRequestHandler<GetBufferLocationProgressQuery, BufferLocationProgressResponse>
{
    public Task<BufferLocationProgressResponse> Handle(GetBufferLocationProgressQuery request, CancellationToken ct)
        => repo.GetBufferLocationProgressAsync(request.PlanYear, request.AsOfDate, request.Cluster, request.WellType, request.FromDate, request.ToDate, request.Project, ct);
}

// --- Pegging Status (Construction Well Delivery) -----------------------------

public record GetPeggingStatusQuery(
    int? PlanYear = null,
    DateOnly? AsOfDate = null,
    string? Cluster = null,
    string? Site = null,
    string? Project = null,
    string? WellType = null,
    string? WellId = null) : IRequest<PeggingStatusResponse>;

public sealed class GetPeggingStatusQueryHandler(IDashboardRepository repo)
    : IRequestHandler<GetPeggingStatusQuery, PeggingStatusResponse>
{
    public Task<PeggingStatusResponse> Handle(GetPeggingStatusQuery request, CancellationToken ct)
        => repo.GetPeggingStatusAsync(request.PlanYear, request.AsOfDate, request.Cluster, request.Site, request.Project, request.WellType, request.WellId, ct);
}

// --- Overall Pegging Status (pie: pegging completed <90d / >90d before rig-on) ---

public record GetOverallPeggingStatusQuery(
    string? Cluster = null,
    string? Site = null,
    string? Project = null,
    string? WellType = null,
    string? WellId = null) : IRequest<OverallPeggingStatusResponse>;

public sealed class GetOverallPeggingStatusQueryHandler(IDashboardRepository repo)
    : IRequestHandler<GetOverallPeggingStatusQuery, OverallPeggingStatusResponse>
{
    public Task<OverallPeggingStatusResponse> Handle(GetOverallPeggingStatusQuery request, CancellationToken ct)
        => repo.GetOverallPeggingStatusAsync(request.Cluster, request.Site, request.Project, request.WellType, request.WellId, ct);
}

// --- Well Delivery Cycle Time ------------------------------------------------

public record GetWellDeliveryCycleTimeQuery(
    string?   Cluster  = null,
    string?   Site     = null,
    string?   Project  = null,
    string?   WellType = null,
    DateOnly? From     = null,
    DateOnly? To       = null)
    : IRequest<WellDeliveryCycleTimeResponse>;

public sealed class GetWellDeliveryCycleTimeQueryHandler(IDashboardRepository repo)
    : IRequestHandler<GetWellDeliveryCycleTimeQuery, WellDeliveryCycleTimeResponse>
{
    public Task<WellDeliveryCycleTimeResponse> Handle(GetWellDeliveryCycleTimeQuery request, CancellationToken ct)
        => repo.GetWellDeliveryCycleTimeAsync(request.Cluster, ct, request.Site, request.Project, request.WellType, request.From, request.To);
}

// ─── FLAF Status (Construction Well Delivery) ─────────────────────────────────

public record GetFlafStatusQuery(
    int? PlanYear = null,
    DateOnly? AsOfDate = null,
    string? Cluster = null,
    string? Site = null,
    string? Project = null,
    string? WellType = null,
    string? WellId = null) : IRequest<FlafStatusResponse>;

public sealed class GetFlafStatusQueryHandler(IDashboardRepository repo)
    : IRequestHandler<GetFlafStatusQuery, FlafStatusResponse>
{
    public Task<FlafStatusResponse> Handle(GetFlafStatusQuery request, CancellationToken ct)
        => repo.GetFlafStatusAsync(request.PlanYear, request.AsOfDate, request.Cluster, request.Site, request.Project, request.WellType, request.WellId, ct);
}

// ─── Well Execution Dashboard ─────────────────────────────────────────────────

public record GetWellExecKpiQuery(
    string?   Cluster   = null,
    string?   WellType  = null,
    string    Period    = "week",
    DateOnly? From      = null,
    DateOnly? To        = null,
    string?   WellId    = null,
    bool      ChartOnly = false)
    : IRequest<WellExecKpiDto>;

public sealed class GetWellExecKpiQueryHandler(IDashboardRepository repo)
    : IRequestHandler<GetWellExecKpiQuery, WellExecKpiDto>
{
    public Task<WellExecKpiDto> Handle(GetWellExecKpiQuery request, CancellationToken ct)
        => repo.GetWellExecKpiAsync(request.Cluster, request.WellType, request.Period, request.From, request.To, request.WellId, request.ChartOnly, ct);
}

public record GetWellHookupKpiQuery(
    string?   Cluster  = null,
    DateOnly? From     = null,
    DateOnly? To       = null)
    : IRequest<WellHookupKpiDto>;

public sealed class GetWellHookupKpiQueryHandler(IDashboardRepository repo)
    : IRequestHandler<GetWellHookupKpiQuery, WellHookupKpiDto>
{
    public Task<WellHookupKpiDto> Handle(GetWellHookupKpiQuery request, CancellationToken ct)
        => repo.GetWellHookupKpiAsync(request.Cluster, request.From, request.To, ct);
}

public record GetNsHookupWaterfallQuery(string? Cluster, DateOnly? From, DateOnly? To)
    : IRequest<NsHookupWaterfallDto>;

public sealed class GetNsHookupWaterfallQueryHandler(IDashboardRepository repo)
    : IRequestHandler<GetNsHookupWaterfallQuery, NsHookupWaterfallDto>
{
    public Task<NsHookupWaterfallDto> Handle(GetNsHookupWaterfallQuery q, CancellationToken ct)
        => repo.GetNsHookupWaterfallAsync(q.Cluster, q.From, q.To, ct);
}

public record GetNsHookupCompletionQuery(string? Cluster, DateOnly? From, DateOnly? To)
    : IRequest<NsHookupCompletionDto>;

public sealed class GetNsHookupCompletionQueryHandler(IDashboardRepository repo)
    : IRequestHandler<GetNsHookupCompletionQuery, NsHookupCompletionDto>
{
    public Task<NsHookupCompletionDto> Handle(GetNsHookupCompletionQuery q, CancellationToken ct)
        => repo.GetNsHookupCompletionAsync(q.Cluster, q.From, q.To, ct);
}

public record GetNsHookupBreakdownQuery(string? Cluster, DateOnly? From, DateOnly? To)
    : IRequest<NsHookupBreakdownDto>;

public sealed class GetNsHookupBreakdownQueryHandler(IDashboardRepository repo)
    : IRequestHandler<GetNsHookupBreakdownQuery, NsHookupBreakdownDto>
{
    public Task<NsHookupBreakdownDto> Handle(GetNsHookupBreakdownQuery q, CancellationToken ct)
        => repo.GetNsHookupBreakdownAsync(q.Cluster, q.From, q.To, ct);
}

public record GetHookupProgressQuery(
    string    WellType = "conventional",
    string?   Cluster  = null,
    string?   Location = null,
    DateOnly? From     = null,
    DateOnly? To       = null,
    string?   Site     = null,
    string?   Project  = null)
    : IRequest<HookupProgressDto>;

public sealed class GetHookupProgressQueryHandler(IDashboardRepository repo)
    : IRequestHandler<GetHookupProgressQuery, HookupProgressDto>
{
    public Task<HookupProgressDto> Handle(GetHookupProgressQuery request, CancellationToken ct)
        => repo.GetHookupProgressAsync(request.WellType, request.Cluster, request.Location, request.From, request.To, ct, request.Site, request.Project);
}

public record GetCrewPiHeatmapQuery(
    string?   Cluster  = null,
    string?   WellType = null,
    string?   WellId   = null,
    DateOnly? From     = null,
    DateOnly? To       = null)
    : IRequest<CrewPiHeatmapResponse>;

public sealed class GetCrewPiHeatmapQueryHandler(IDashboardRepository repo)
    : IRequestHandler<GetCrewPiHeatmapQuery, CrewPiHeatmapResponse>
{
    public Task<CrewPiHeatmapResponse> Handle(GetCrewPiHeatmapQuery request, CancellationToken ct)
        => repo.GetCrewPiHeatmapAsync(request.Cluster, request.WellType, request.WellId, request.From, request.To, ct);
}
