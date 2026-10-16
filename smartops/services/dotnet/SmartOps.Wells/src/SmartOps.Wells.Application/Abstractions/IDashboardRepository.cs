using SmartOps.Wells.Contracts;

namespace SmartOps.Wells.Application.Abstractions;

/// <summary>
/// Data-access contract for Dashboard / KPI aggregations.
/// Implemented in Infrastructure; consumed by Application CQRS handlers.
/// </summary>
public interface IDashboardRepository
{
    Task<CrewsDeployedKpiDto> GetCrewsDeployedKpiAsync(
        string? crewGroup,
        string? cluster,
        string? wellId,
        DateOnly? from,
        DateOnly? to,
        CancellationToken ct = default);

    Task<ActiveWellsKpiDto> GetActiveWellsKpiAsync(
        string? cluster,
        string? site,
        string? wellType,
        string? project,
        string? wellId,
        DateOnly? from,
        DateOnly? to,
        bool thisMonth = false,
        CancellationToken ct = default);

    Task<IReadOnlyList<WmrWellDto>> GetWmrWellsAsync(
        string? cluster,
        string? wellId,
        string? status,
        DateOnly? from,
        DateOnly? to,
        bool thisMonth = false,
        string? wrFilter = null,
        int? planYear = null,
        DateOnly? asOfDate = null,
        string? commStatus = null,
        string? wellType = null,
        string? project = null,
        CancellationToken ct = default);

    Task<WellProgressPageDto> GetWellProgressAsync(
        string? cluster,
        string? wellId,
        string? status,
        DateOnly? from,
        DateOnly? to,
        bool thisMonth = false,
        int page = 1,
        int pageSize = 20,
        CancellationToken ct = default);

    Task<IReadOnlyList<WellStatusListDto>> GetWellStatusListAsync(
        string? cluster,
        string? site,
        string? wellType,
        string? project,
        DateOnly? from,
        DateOnly? to,
        string? commStatus = null,
        DateOnly? commFrom = null,
        DateOnly? commTo = null,
        bool bufferReady = false,
        string? peggingBucket = null,
        bool wlaMode = false,
        CancellationToken ct = default);

    Task<WellProgressKpiDto> GetWellProgressKpiAsync(
        string? cluster = null, string? wellId = null, string? wellType = null,
        DateOnly? from = null, DateOnly? to = null,
        CancellationToken ct = default);

    Task<ActivitiesProgressDto> GetActivitiesProgressAsync(
        string odc,
        string? cluster,
        string? projectId,
        string? scheduleId,
        string? wellId,
        DateTime? startDate,
        DateTime? endDate,
        CancellationToken ct = default);

    Task<ActivitiesListResponse> GetActivitiesListAsync(
        string odc,
        string? cluster,
        string? wellId,
        DateTime? startDate,
        DateTime? endDate,
        int page,
        int pageSize,
        CancellationToken ct = default);

    Task<CriticalDatesTimelinePageDto> GetCriticalDatesTimelineAsync(
        int page,
        int pageSize,
        string? cluster  = null,
        string? site     = null,
        string? wellId   = null,
        DateOnly? from   = null,
        DateOnly? to     = null,
        string? wellType = null,
        CancellationToken ct = default);

    Task<TargetFinishTimelineDto> GetTargetFinishTimelineAsync(
        string? cluster  = null,
        string? site     = null,
        string? wellType = null,
        string? wellId   = null,
        DateOnly? from   = null,
        DateOnly? to     = null,
        int     take     = 50,
        CancellationToken ct = default);

    Task<WellDetailDto?> GetWellDetailAsync(
        string wellId,
        CancellationToken ct = default);

    Task<WellPlannerResponseDto> GetWellPlannerAsync(
        string? cluster,
        string? wellId,
        DateOnly? from,
        DateOnly? to,
        CancellationToken ct = default);

    Task<WorkloadAnalysisResponse> GetWorkloadAnalysisAsync(
        DateOnly from,
        DateOnly to,
        string? cluster = null,
        string? wellId = null,
        string? project = null,
        CancellationToken ct = default);

    Task<IReadOnlyList<CrewPRatingDistributionDto>> GetCrewPRatingDistributionAsync(
        string? cluster = null,
        string? wellType = null,
        string? site = null,
        string? project = null,
        DateOnly? from = null,
        DateOnly? to = null,
        CancellationToken ct = default);

    Task<IReadOnlyList<ClusterWellsDto>> GetClusterWellsAsync(CancellationToken ct = default);

    Task<IReadOnlyList<ClusterWellsProgressDto>> GetClusterWellsProgressAsync(DateOnly? from = null, DateOnly? to = null, string? wellType = null, string? project = null, CancellationToken ct = default);

    Task<WellStagesDto> GetWellStagesAsync(string wellId, DateOnly? from = null, DateOnly? to = null, CancellationToken ct = default);

    /// <summary>
    /// Returns the workgroups (type 'W') for a well from WMR_TaskPlan_csv_imported, each with
    /// its child activities (type 'A', joined on parent_WBS = workgroup text) and a progress
    /// value that is the average of the child activities' progress.
    /// </summary>
    Task<WellWorkgroupsDto> GetWellWorkgroupsAsync(string wellId, CancellationToken ct = default, string? projectId = null);

    /// <summary>Returns distinct projects for a well from WMR_TaskPlan_csv_imported.</summary>
    Task<IReadOnlyList<WellProjectDto>> GetWellProjectsAsync(string wellId, CancellationToken ct = default);

    /// <summary>
    /// Returns ActivityTaskPlan rows where type is 'A' or 'M' — the source rows
    /// for the Activity Gantt on the Well Execution Dashboard.
    /// </summary>
    Task<IReadOnlyList<ActivityGanttRowDto>> GetActivityGanttAsync(CancellationToken ct = default);

    Task<ClusterHealthDto> GetClusterHealthAsync(DateOnly? from = null, DateOnly? to = null, string? wellType = null, string? cluster = null, string? site = null, string? project = null, CancellationToken ct = default);

    /// <summary>
    /// Returns the Wells Readiness funnel: plan â†’ FLAF/SCR-cleaned â†’ PDO-cleaned â†’ actual completions.
    /// <paramref name="planYear"/> defaults to the current year when null.
    /// </summary>
    Task<WellsReadinessDto> GetWellsReadinessAsync(int? planYear = null, DateOnly? asOfDate = null, string? cluster = null, DateOnly? fromDate = null, DateOnly? toDate = null, string? wellType = null, string? project = null, CancellationToken ct = default);

    /// <summary>
    /// Returns wells readiness breakdown by well type in a single call (avoids N+1 queries).
    /// </summary>
    Task<WellsReadinessByTypeDto> GetWellsReadinessByTypeAsync(DateOnly fromDate, DateOnly toDate, DateOnly? asOfDate = null, string? cluster = null, string? project = null, CancellationToken ct = default);

    Task<CommissioningStatusDto> GetCommissioningStatusAsync(string? cluster = null, string? wellId = null, DateOnly? startDate = null, DateOnly? endDate = null, string? wellType = null, string? project = null, CancellationToken ct = default);

    /// <summary>
    /// Returns monthly commissioning completion % vs 100% plan target
    /// for the PDO fiscal year (Oct – Sep).
    /// </summary>
    Task<CommissioningProgressResponse> GetCommissioningProgressAsync(int? fiscalYear = null, DateOnly? asOfDate = null, CancellationToken ct = default);

    Task<BufferFlowlinesReadyDto> GetBufferFlowlinesReadyAsync(string? cluster = null, string? wellId = null, DateOnly? startDate = null, DateOnly? endDate = null, string? wellType = null, string? project = null, CancellationToken ct = default);

    /// <summary>
    /// Returns the Construction Well Delivery Flowline &amp; OHL Progress data:
    /// KPI summary cards + monthly cumulative trend (Jan–Dec).
    /// </summary>
    Task<ConstructionProgressResponse> GetConstructionProgressAsync(int? planYear = null, DateOnly? asOfDate = null, string? cluster = null, string? wellId = null, DateOnly? fromDate = null, DateOnly? toDate = null, string? wellType = null, string? site = null, string? project = null, CancellationToken ct = default);

    /// <summary>
    /// Returns well details for the Construction Progress drilldown, filtered by KPI category.
    /// </summary>
    Task<IReadOnlyList<WmrWellDto>> GetConstructionProgressWellsAsync(string filter, int? planYear = null, DateOnly? asOfDate = null, string? cluster = null, string? wellId = null, DateOnly? fromDate = null, DateOnly? toDate = null, string? wellType = null, string? project = null, CancellationToken ct = default);

    /// <summary>
    /// Returns the Wells Readiness Flowline funnel widget data:
    /// Original plan, FLAF/SCR adjusted, PDO clean target, actual completed.
    /// </summary>
    Task<FlowlineReadinessResponse> GetFlowlineReadinessAsync(int? planYear = null, DateOnly? asOfDate = null, string? cluster = null, string? wellId = null, DateOnly? fromDate = null, DateOnly? toDate = null, string? wellType = null, string? project = null, CancellationToken ct = default);

    /// <summary>
    /// Returns the Wells Readiness OHL funnel widget data:
    /// Original plan, FLAF/SCR adjusted, PDO clean target, actual OHL completed.
    /// </summary>
    Task<OhlReadinessResponse> GetOhlReadinessAsync(int? planYear = null, DateOnly? asOfDate = null, string? cluster = null, string? wellId = null, DateOnly? fromDate = null, DateOnly? toDate = null, string? wellType = null, string? project = null, CancellationToken ct = default);

    /// <summary>
    /// Returns daily actual vs asking output rate (m/day) from task_daily,
    /// grouped by date and optionally filtered by cluster and/or well.
    /// </summary>
    Task<DailyOutputRateDto> GetDailyOutputRateAsync(
        string? cluster,
        string? site,
        string? wellId,
        string? location,
        string? project,
        DateOnly? from,
        DateOnly? to,
        CancellationToken ct = default);

    Task<DrilledWellsCompletionDto> GetDrilledWellsCompletionAsync(
        string? cluster = null, string? wellId = null, string? wellType = null,
        string? site = null, string? project = null,
        DateOnly? from = null, DateOnly? to = null,
        CancellationToken ct = default);

    Task<DrilledWellsBreakdownDto> GetDrilledWellsBreakdownAsync(
        string? cluster = null, string? wellId = null, string? project = null,
        DateOnly? from = null, DateOnly? to = null,
        CancellationToken ct = default);

    Task<DrilledWellsYtdCompletionDto> GetDrilledWellsYtdCompletionAsync(
        DateOnly? from = null,
        DateOnly? to = null,
        int? year = null,
        DateOnly? asOfDate = null,
        string? cluster = null,
        string? wellId = null,
        string? project = null,
        string? wellType = null,
        string? site = null,
        CancellationToken ct = default);

    /// <summary>
    /// Returns KPI tiles + summary for the Buffer Location Construction Progress – YTD widget.
    /// Uses pegging delay (actual_pegged_date, 90 d) and SCR threshold of 60 d.
    /// </summary>
    Task<BufferLocationProgressResponse> GetBufferLocationProgressAsync(
        int? planYear = null,
        DateOnly? asOfDate = null,
        string? cluster = null,
        string? wellType = null,
        DateOnly? fromDate = null,
        DateOnly? toDate = null,
        string? project = null,
        CancellationToken ct = default);

    Task<DueWellsCompletionDto> GetDueWellsCompletionAsync(
        string? cluster = null, string? location = null, string? site = null, string? project = null,
        string? wellId = null, DateOnly? from = null, DateOnly? to = null,
        CancellationToken ct = default);

    Task<DueWellsCompletionTrendDto> GetDueWellsCompletionTrendAsync(
        string? cluster = null, string? location = null, string? site = null, string? project = null,
        string? wellId = null, DateOnly? from = null, DateOnly? to = null,
        CancellationToken ct = default);

    /// <summary>
    /// Returns the Construction Well Delivery – Pegging Status:
    /// KPI tiles, backlog responsibility, risk gauge, and monthly stacked area chart.
    /// </summary>
    Task<PeggingStatusResponse> GetPeggingStatusAsync(
        int? planYear = null,
        DateOnly? asOfDate = null,
        string? cluster = null,
        string? site = null,
        string? project = null,
        string? wellType = null,
        string? wellId = null,
        CancellationToken ct = default);

    /// <summary>
    /// Returns the Overall Pegging Status pie: wells with completed pegging split by
    /// whether pegging finished ≤ 90 days (within) or &gt; 90 days before actual rig-on.
    /// </summary>
    Task<OverallPeggingStatusResponse> GetOverallPeggingStatusAsync(
        string? cluster = null,
        string? site = null,
        string? project = null,
        string? wellType = null,
        string? wellId = null,
        CancellationToken ct = default);

    /// <summary>
    /// Well Delivery Cycle Time KPIs, monthly trend, and phase breakdown — computed from
    /// WMR actual dates (rig-on → delivery) across completed wells.
    /// </summary>
    Task<WellDeliveryCycleTimeResponse> GetWellDeliveryCycleTimeAsync(
        string? cluster = null,
        CancellationToken ct = default,
        string? site = null, string? project = null, string? wellType = null,
        DateOnly? from = null, DateOnly? to = null);

    /// <summary>
    /// Returns the Construction Well Delivery – FLAF Status:
    /// KPI tiles, backlog responsibility, risk gauge, and monthly stacked area chart.
    /// </summary>
    Task<FlafStatusResponse> GetFlafStatusAsync(
        int? planYear = null,
        DateOnly? asOfDate = null,
        string? cluster = null,
        string? site = null,
        string? project = null,
        string? wellType = null,
        string? wellId = null,
        CancellationToken ct = default);

    /// <summary>
    /// Returns the complete Well Execution Dashboard KPI payload:
    /// job counts, overall progress, delayed jobs, revenue, chart series, and milestones.
    /// Sources: WellMonitoringReport_Latest, Job_Progress_Report_GB, vw_SchedulePerformance_WellLevel.
    /// </summary>
    Task<WellExecKpiDto> GetWellExecKpiAsync(
        string?   cluster   = null,
        string?   wellType  = null,
        string    period    = "week",
        DateOnly? from      = null,
        DateOnly? to        = null,
        string?   wellId    = null,
        bool      chartOnly = false,
        CancellationToken ct = default);

    /// <summary>
    /// Returns the 5-KPI hookup summary for a given well type tab
    /// (conventional, nonstandard, or conversions), plus last-year comparisons.
    /// </summary>
    Task<WellHookupKpiDto> GetWellHookupKpiAsync(
        string?   cluster   = null,
        DateOnly? from      = null,
        DateOnly? to        = null,
        CancellationToken ct = default);

    /// <summary>Waterfall (plan-to-actual) data for the Non Standard hookup tab.</summary>
    Task<NsHookupWaterfallDto> GetNsHookupWaterfallAsync(
        string?   cluster = null,
        DateOnly? from    = null,
        DateOnly? to      = null,
        CancellationToken ct = default);

    /// <summary>Overall completion % + LY delta for the Non Standard hookup donut.</summary>
    Task<NsHookupCompletionDto> GetNsHookupCompletionAsync(
        string?   cluster = null,
        DateOnly? from    = null,
        DateOnly? to      = null,
        CancellationToken ct = default);

    /// <summary>Breakdown counts (hooked-up, backlog, suspended) for the Non Standard hookup tab.</summary>
    Task<NsHookupBreakdownDto> GetNsHookupBreakdownAsync(
        string?   cluster = null,
        DateOnly? from    = null,
        DateOnly? to      = null,
        CancellationToken ct = default);

    /// <summary>
    /// Returns the Well Hookup Progress Overview payload (KPI tiles, waterfall steps, overall %).
    /// wellType: "conventional" | "non-standard" | "well-conversions"
    /// </summary>
    Task<HookupProgressDto> GetHookupProgressAsync(
        string    wellType = "conventional",
        string?   cluster  = null,
        string?   location = null,
        DateOnly? from     = null,
        DateOnly? to       = null,
        CancellationToken ct = default,
        string?   site     = null,
        string?   project  = null);

    /// <summary>
    /// Returns the Crew PI Rating heatmap payload (KPI tiles + Day/Week/Month grids + insights)
    /// sourced from dbo.CrewPerformanceRating. All three periods are returned in one call so the
    /// Day/Week/Month toggle is instant on the client.
    /// </summary>
    Task<CrewPiHeatmapResponse> GetCrewPiHeatmapAsync(
        string?   cluster  = null,
        string?   wellType = null,
        string?   wellId   = null,
        DateOnly? from     = null,
        DateOnly? to       = null,
        CancellationToken ct = default);
}
