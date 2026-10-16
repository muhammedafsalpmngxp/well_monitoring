using System.ComponentModel.DataAnnotations;

namespace SmartOps.Wells.Contracts;

// ─── Cluster ────────────────────────────────────────────────────────────────

public record ClusterDto(int Id, string Key, string Name, string? Color,
                         int Total, int Ready, double Pct);

// ─── Well ────────────────────────────────────────────────────────────────────

public record WellDto(int Id, string WellId, string Cluster, string? Location, string? WellType,
                      string? ActivityCode, string? Activity, string? CrewGroup, string? Crew,
                      double Progress, double Planned, double RateDay, double AskRate,
                      string? RigOn, string? Status, double? Spi, double? Cpi);

public record WellCreateRequest(
    [Required] string WellId,
    [Required] string Cluster,
    string? Location, string? WellType, string? ActivityCode, string? Activity,
    string? CrewGroup, string? Crew,
    double Progress = 0, double Planned = 0, double RateDay = 0, double AskRate = 0,
    string? RigOn = null, string? Status = "On Track",
    double? Spi = null, double? Cpi = null);

public record WellUpdateRequest(string? Activity, double? Progress, double? Planned,
                                string? Status, double? Spi, double? Cpi);

// ─── Milestone ───────────────────────────────────────────────────────────────

public record MilestoneDto(int Id, string WellId, string Name, string? Owner,
                           DateOnly? Planned, DateOnly? Forecast, DateOnly? Actual,
                           int VarDays, string Status);

// ─── Watchlist ───────────────────────────────────────────────────────────────

public record WatchlistEntryDto(int Id, int UserId, string WellId, string? Reason, DateTime CreatedAt);

public record WatchlistAddRequest([Required] string WellId, string? Reason);

// ─── Critical Dates ───────────────────────────────────────────────────────────

public record CriticalDateDto(int Id, string WellId, string Label, DateOnly Target,
                              string Status, string? Notes);

public record CriticalDateCreateRequest(
    [Required] string WellId,
    [Required] string Label,
    DateOnly Target,
    string Status = "upcoming",
    string? Notes = null);

// ─── Dashboard / KPI ─────────────────────────────────────────────────────────


public record CrewsDeployedKpiDto(
    int TotalCrews,
    int Deployed,
    int RestRotation,
    double UtilizationPct,
    IReadOnlyList<CrewGroupBreakdownDto> ByCrewGroup);

public record CrewGroupBreakdownDto(string CrewGroup, int Deployed, int Standby, int RestRotation);

// ─── Activities Progress ─────────────────────────────────────────────────────

public record ActivitiesProgressDto(
    double Progress,
    int Completed,
    int InProgress,
    int NotStarted,
    int Total);

public record ActivitiesProgressResponse(
    ActivitiesProgressDto Data,
    ActivitiesProgressFilters Filters);

public record ActivitiesProgressFilters(
    string Odc,
    string? Cluster,
    string? ProjectId,
    string? ScheduleId,
    string? WellId,
    DateTime? StartDate,
    DateTime? EndDate);

// ─── Activities List (detail rows) ───────────────────────────────────────────

public record ActivitiesListResponse(
    ActivitiesProgressDto Summary,
    IReadOnlyList<ActivityRowDto> Items,
    int Page,
    int PageSize,
    int TotalRows,
    int TotalPages);

public record ActivityRowDto(
    string Code,
    string Description,
    string WellId,
    string Cluster,
    string Status,
    int ProgressPct,
    string? StartDate,
    string? EndDate,
    string? Assignee);

public record ActiveWellsKpiDto(
    int ActiveToday,
    int TotalThisMonth,
    int InProgress,
    int Early,
    int Planned,
    int OnHold,
    int DueWells,
    int NotDueWells,
    int Critical        = 0,
    int AtRisk          = 0,
    int Completed       = 0,
    int BonusPotential  = 0,
    int HighPerformers  = 0);

public record WmrWellDto(
    string WellId,
    string? Rig,
    string? Field,
    string? Location,
    string? WellType,
    double ProgressPct,
    string Status,
    string? LocPrepStatus,
    string? FlStatus,
    string? CommStatus,
    double? LocPrepPct,
    double? FlConstructionPct,
    double? CommPct,
    double? OhlPct,
    string? RigOnDate,
    string? RigOffDate,
    double? PlannedPct          = null,
    bool   PdoIssue            = false,
    bool   DrilledNotCompleted = false,
    bool   FlafScr             = false,
    double? Spi                = null,
    double? RatePerDay         = null,
    double? AskRate            = null,
    string? DrillingBufferStatus = null);

/// <summary>Paginated wrapper for WmrWellDto used by wells-readiness-overview endpoint.</summary>
public record WmrWellsPageDto(
    IReadOnlyList<WmrWellDto> Items,
    int Page,
    int PageSize,
    int TotalCount);

/// <summary>Extended well-status-list row with computed metrics (SPI, CPI, rate, etc.).</summary>
public record WellStatusListDto(
    string  WellId,
    string? WellName,
    string  Status,
    string? Field,
    string? Rig,
    double  ProgressPct,
    double? PlannedPct,
    double? Variance,
    double? RatePerDay,
    double  AskRate,
    double? GapPerDay,
    double? Spi,
    double? Cpi,
    string? Tags,
    string? WellType,
    string? LocPrepStatus,
    double? DrillingPct,
    string? CommStatus,
    string? ConstrStatus,
    double? ConstrPct,
    double? ComplePct,
    string? RigBy,
    string? RigTo,
    string? PeggedDate = null,
    string? CommStartDate = null,
    string? CommFinishDate = null,
    double? CommProgressPct = null,
    string? EngCompletionDate = null,
    string? CompletionType = null,
    bool IsActiveKpi = false,
    bool IsInactiveKpi = false,
    bool IsBonusPotential = false,
    bool IsPenaltyExposure = false);

public record WellProgressDto(
    string  WellId,
    string  Cluster,
    string? CurrentActivity,
    string? CrewGroup,
    double  Progress,
    double  Variance,
    double  Planned,
    double? Rate,
    double? AskRate,
    double? GapPerDay,
    string? RigOn,
    double? Spi,
    double? Cpi,
    string? Status);

/// <summary>Paginated well-progress response.</summary>
public record WellProgressPageDto(
    IReadOnlyList<WellProgressDto> Items,
    int Page,
    int PageSize,
    int TotalCount);

/// <summary>Lightweight KPI tile counts for Well Progress card.</summary>
public record WellProgressKpiDto(
    int Ahead,
    int OnTrack,
    int AtRisk,
    int DueWells,
    int Total,
    int Critical,
    int BonusPotential);

/// <summary>One month point in the Drilled Wells completion trend.</summary>
public record DrilledWellsMonthlyPointDto(string Month, double CumulativePct, int CumulativeCompleted, int MonthlyCompleted = 0, int MonthlyTotal = 0);

/// <summary>Drilled Wells Completion KPI tile counts.</summary>
public record DrilledWellsCompletionDto(
    int TotalWells,
    int Completed,
    int Hold,
    int InProgress,
    int Suspended,
    double CompletionRatePct,
    IReadOnlyList<DrilledWellsMonthlyPointDto> MonthlyTrend);

// ─── Drilled Wells YTD Completion (Year-over-Year) ────────────────────────────

/// <summary>
/// Completed-wells % for the current fiscal year versus the previous fiscal year.
/// Completed = wells whose latest WMR progress ≥ 99 %.
/// </summary>
public record DrilledWellsYtdCompletionDto(
    int    CurrentYear,
    double CurrentPct,
    int    PreviousYear,
    double PreviousPct,
    double DeltaPct,
    int    TotalDrilled  = 0,
    int    Completed     = 0,
    int    InProgress    = 0,
    int    Suspended     = 0);

/// <summary>Response for GET /dashboard/drilled-wells-breakdown — same breakdown logic as Due Wells tab.
/// BacklogWells  = active wells (inprogress/critical/atrisk) whose rig arrived &gt; 21 days ago.
/// AcceleratedWells = wells whose rig has not arrived yet but have already started (status = early).
/// </summary>
public record DrilledWellsBreakdownDto(
    int BacklogWells,
    int AcceleratedWells);

/// <summary>One month point in the Due Wells completion trend.</summary>
public record DueWellsMonthlyPointDto(string Month, double CumulativePct);

/// <summary>One monthly data point in the Due Wells completion-by-completion-date trend.</summary>
public record DueWellsCompletionTrendPointDto(string Month, int CompletedThisMonth, double CumulativeRate);

/// <summary>Response for GET /dashboard/due-wells-completion-trend.</summary>
public record DueWellsCompletionTrendDto(
    int TotalDueWells,
    int TotalCompleted,
    IReadOnlyList<DueWellsCompletionTrendPointDto> Points);

/// <summary>Response for GET /dashboard/due-wells-completion.</summary>
public record DueWellsCompletionDto(
    int TotalDueWells,
    int Completed,
    int InProgress,
    int Pending,
    double CompletionRatePct,
    int Commissioned,
    int BacklogInCommissioning,
    int SuspendedWells,
    int TotalWellsForBreakdown,
    double CommissioningPct,
    IReadOnlyList<DueWellsMonthlyPointDto> MonthlyTrend);

// ─── Critical Dates Timeline ──────────────────────────────────────────────────

/// <summary>One row in the Critical Dates Timeline grid.</summary>
public record CriticalDateTimelineItemDto(
    string  WellId,
    string  StageItem,
    string? Assignee,
    string  DateLabel,
    string  DateType,
    string  Type,
    string  Status,
    double  ProgressPct,
    int?    VarianceDays,
    string? Blockers,
    string? Predecessor
);

/// <summary>Paginated response for Critical Dates Timeline.</summary>
public record CriticalDatesTimelinePageDto(
    IReadOnlyList<CriticalDateTimelineItemDto> Items,
    int Page,
    int PageSize,
    bool HasMore
);

// ─── Target Finish Timeline ────────────────────────────────────────────────────

/// <summary>One well row in the Target Finish Timeline widget.</summary>
public record TargetFinishTimelineItemDto(
    string  WellId,
    string? WellName,
    string  Cluster,
    string  WellType,
    string  Category,
    double  ProgressPct,
    string? TargetFinishDate,   // ISO yyyy-MM-dd; null if no target activity end exists
    int?    DaysRemaining,      // negative = overdue
    string  TimelineStatus      // Overdue | Due Within 30 Days | Due In 31-60 Days | Due After 60 Days
);

/// <summary>Response for the Target Finish Timeline widget.</summary>
public record TargetFinishTimelineDto(
    IReadOnlyList<TargetFinishTimelineItemDto> Items
);

// ─── Crew List ───────────────────────────────────────────────────────────────

public record CrewListItemDto(
    string CrewId,
    string? CrewName,
    string? Discipline,
    string? Activity,
    string? Leader,
    string? Cluster,
    int? Size,
    string? PRating,
    double? Productivity,
    string Status,
    string? DeployedOn,
    string? Formation);

public record CrewListResponse(
    int TotalCount,
    int Deployed,
    int Standby,
    int RestRotation,
    int Page,
    int PageSize,
    List<CrewListItemDto> Crews);

// ─── Workload Analysis ───────────────────────────────────────────────────────

public record WorkloadMetadataDto(
    DateOnly From,
    DateOnly To,
    DateTime GeneratedAt,
    int TotalMonths,
    IReadOnlyList<string> Assets);

public record WorkloadAssetDto(string Name, int WellsCompleted);

public record WorkloadMonthDto(
    string Label,
    bool IsForecast,
    IReadOnlyList<WorkloadAssetDto> Assets,
    int TotalDrilled,
    string? PeriodStart = null,
    string? PeriodEnd = null);

public record WorkloadSummaryDto(
    Dictionary<string, int> AveragePerAsset,
    int AverageTotalDrilled,
    int GrandTotalDrilled);

public record WorkloadAnalysisResponse(
    WorkloadMetadataDto Metadata,
    IReadOnlyList<WorkloadMonthDto> Months,
    WorkloadSummaryDto Summary);

// ─── Well Detail ─────────────────────────────────────────────────────────────

/// <summary>One weekly progress snapshot for the timeline chart.</summary>
public record WellProgressSnapshotDto(string Week, double ProgressPct);

/// <summary>Full detail view for a single well, populated from WMR rows.</summary>
public record WellDetailDto(
    string  WellId,
    string? WellName,
    string? PdoWellId,
    string? WellType,
    string? RigNo,
    string? ClusterId,
    string? WellFunction,
    string? WellCategory,
    string? PcapCategory,
    string? PdoWellType,
    string? SapPlannedStart,
    string? SapPlannedEnd,
    string? WellLocation,
    string? ProjectId,
    string? WeekNumber,
    string? Northing,
    string? Easting,
    string? LocationDd,
    double  OverallProgressPct,
    double  LocPrepPct,
    double  ConstructionPct,
    double  CommissioningPct,
    double  OhlPct,
    string? LocPrepStatus,
    string? FlConstructionStatus,
    string? FlCommissioningStatus,
    string? FlowLineDl,
    string? StationName,
    string? RigOnDate,
    string? RigOffDate,
    string? WellYear,
    string? BufferStatus,
    bool    IsDelayed,
    string? DelayReason,
    bool    InfraReadyFlag,
    string? Remarks,
    string  Status,
    IReadOnlyList<WellProgressSnapshotDto> Timeline,
    /// <summary>Variance = actual_progress% - planned_pct% (linear interpolation of SAP schedule).</summary>
    double? Variance = null,
    /// <summary>Rate/Day = avg current rate across activities (qtyactual / days_completed).</summary>
    double? RatePerDay = null,
    /// <summary>Ask Rate = avg asking rate across activities (qty_remaining / days_remaining).</summary>
    double? AskRate = null,
    /// <summary>Norms Rate = avg planned rate across activities (qty / (manhours/8)).</summary>
    double? NormsRate = null,
    /// <summary>Planned progress % based on linear interpolation of SAP schedule (0-100).</summary>
    double? PlannedPct = null,
    /// <summary>For completed wells only: "Due Completed" or "Not Due Accelerated"
    /// (accelerated = finished before its SAP planned start). Null otherwise.</summary>
    string? CompletionCategory = null
);
// ─── Well Report Data (supplementary tables) ──────────────────────────────────

/// <summary>One row from SAP_DRILLING_SEQUENCE_History.</summary>
public record DrillingSequenceItemDto(
    string? WorkCenter,
    string? OperationShort,
    string? Activity,
    string? SystemStatus,
    string? PlannedStart,
    string? PlannedEnd,
    string? Duration,
    string? DurationUnit
);

/// <summary>One row from ActivityTaskPlan for the well.</summary>
public record ActivityTaskItemDto(
    string? Code,
    string? Text,
    string? Type,
    int     ProgressPct,
    string? PlannedStart,
    string? PlannedEnd,
    string? ActualStart,
    string? ActualEnd,
    string? CrewType,
    string? Parent
);

public record CrewPRatingDistributionDto(string Rating, int CrewCount);


/// <summary>One row from task_daily (most recent entries) for the well.</summary>
public record TaskDailyItemDto(
    string?  TaskCode,
    string?  ActionOn,
    int      ProgressPct,
    string?  ActualStart,
    string?  ActualEnd,
    string?  CrewType,
    string?  CrewCode,
    string?  TaskUom,
    decimal? ActualQuantity,
    decimal? ActualHours,
    bool     DailyCompleted
);

/// <summary>Combined supplementary report data for a single well.</summary>
public record WellReportDataDto(
    string WellId,
    IReadOnlyList<DrillingSequenceItemDto> DrillingSequence,
    IReadOnlyList<ActivityTaskItemDto>     ActivityTasks,
    IReadOnlyList<TaskDailyItemDto>        DailyTasks
);

// ─── Well Planner (Gantt Calendar) ───────────────────────────────────────────

/// <summary>Single activity bar in the Well Planner Gantt.</summary>
public record WellPlannerActivityDto(
    string  Name,
    string  Cat,      // welding | civil | rigging | other
    string? From,     // yyyy-MM-dd
    string? To,       // yyyy-MM-dd
    string? Crew,
    string  Status    // completed | inprogress | planned | unassigned
);

/// <summary>Milestone / phase block containing child activities.</summary>
public record WellPlannerMilestoneDto(
    string  Name,
    string  Phase,    // flowline-start | flowline-finish | hookup | handover | other
    string? From,     // yyyy-MM-dd
    string? To,       // yyyy-MM-dd
    IReadOnlyList<WellPlannerActivityDto> Activities
);

/// <summary>One well row in the Well Planner.</summary>
public record WellPlannerWellDto(
    string  Id,
    string? Project,  // cluster / station name
    string? RigOn,    // yyyy-MM-dd
    string? RigOff,   // yyyy-MM-dd
    string  Status,   // inprogress | completed | planned | onhold
    IReadOnlyList<WellPlannerMilestoneDto> Milestones
);

/// <summary>Response payload for GET /dashboard/well-planner.</summary>
public record WellPlannerResponseDto(
    IReadOnlyList<WellPlannerWellDto> Wells
);

/// <summary>A single well within a cluster.</summary>
public record ClusterWellItemDto(string Id, string? WellName, string? WellType, string? Site = null, string? Project = null);

/// <summary>One well-type entry under a cluster — includes all ProjectIDs.ID values that share this type.</summary>
public record ClusterWellTypeDto(string WellType, IReadOnlyList<string> ProjectIds);

/// <summary>One site entry under a cluster.</summary>
public record ClusterSiteDto(string Site);

/// <summary>One project entry under a cluster (from ProjectIDs.[Project] column), tagged with the well type it belongs to.</summary>
public record ClusterProjectDto(string Project, string WellType);

/// <summary>One cluster with its associated sites, well types, projects and wells.</summary>
public record ClusterWellsDto(string Cluster, IReadOnlyList<ClusterSiteDto> Sites, IReadOnlyList<ClusterWellTypeDto> WellTypes, IReadOnlyList<ClusterProjectDto> Projects, IReadOnlyList<ClusterWellItemDto> Wells);

/// <summary>One well's latest progress inside a cluster (from WMR).</summary>
public record ClusterWellProgressItemDto(string WellId, string? WellName, double Progress, string? WellType = null);

/// <summary>Response item for GET /dashboard/cluster-wells-progress.</summary>
public record ClusterWellsProgressDto(string Cluster, IReadOnlyList<ClusterWellProgressItemDto> Wells);

/// <summary>
/// A single stage/task row returned for GET /dashboard/well-stages/{wellId}.
/// Dates are ISO yyyy-MM-dd strings (or null if not set / sentinel).
/// </summary>
public record WellStageItemDto(
    string  StageName,
    double  Progress,
    string  StageType,
    string? TargetStart = null,
    string? TargetEnd   = null,
    string? ActualStart = null,
    string? ActualEnd   = null,
    string? Code        = null);

/// <summary>Response for GET /dashboard/well-stages/{wellId}.</summary>
public record WellStagesDto(string WellId, IReadOnlyList<WellStageItemDto> Stages);

/// <summary>
/// One activity (type 'A') belonging to a workgroup, for GET /dashboard/well-workgroups/{wellId}.
/// Progress is 0–100. Dates are ISO yyyy-MM-dd strings (or null when sentinel/empty).
/// </summary>
public record WellWorkgroupActivityDto(
    string? Code,
    string  Name,
    double  Progress,
    string  Status,
    string? TargetStart      = null,
    string? TargetEnd        = null,
    string? ActualStart      = null,
    string? ActualEnd        = null,
    string? Assignee         = null,
    string? ActivityCode     = null,
    double? Weightage        = null,
    double? ManhoursActual   = null,
    double? ManhourForecast  = null,
    int?    DaysRemaining    = null,
    double? AskingRatePerDay = null,
    string? AskingRateType   = null,
    int?    UrgencyScore     = null,
    int?    WorkersRequired  = null,
    double? Qty              = null,
    double? QtyCompleted     = null,
    double? ManhoursPlanned  = null,
    double? Duration         = null,
    string? StartDate        = null,
    string? EndDate          = null,
    double? Norm             = null,
    double? DaysRequired     = null,
    double? NormsRate        = null,
    string? AsperNormEnd     = null,
    int?    DaysCompleted    = null,
    double? CurrentProgress  = null,
    double? QtyRemaining     = null,
    double? CurrentRate      = null,
    double? AskingRateQty    = null,
    string? CanCompleteWithActualRate    = null,
    double? DaysCanBeSavedWithActualRate = null);

/// <summary>
/// One workgroup (type 'W') with its child activities, for GET /dashboard/well-workgroups/{wellId}.
/// Progress is the simple average of the child activities' progress (0–100). Status is
/// "Completed" when every activity is completed, "Not Started" when none have started,
/// else "In Progress".
/// </summary>
public record WellWorkgroupDto(
    string? Code,
    string  Name,
    double  Progress,
    string  Status,
    int     ActivityCount,
    int     CompletedCount,
    string? TargetStart,
    string? TargetEnd,
    IReadOnlyList<WellWorkgroupActivityDto> Activities,
    double? Weightage = null);

/// <summary>Response for GET /dashboard/well-workgroups/{wellId}.</summary>
public record WellWorkgroupsDto(
    string WellId,
    IReadOnlyList<WellWorkgroupDto> Workgroups,
    string? WellStatus = null,
    string? RigOnDate = null,
    string? ForecastEnd = null,
    string? WellEndDate = null);

/// <summary>One project associated with a well, for GET /dashboard/wells/{wellId}/projects.</summary>
public record WellProjectDto(string ProjectId, string ProjectName, string? ProjectCode, string? ProjectType, int ActivityCount);

/// <summary>
/// One ActivityTaskPlan row (type 'A' or 'M') for the Activity Gantt on the
/// Well Execution Dashboard. Dates are ISO yyyy-MM-dd strings (or null when sentinel/empty).
/// </summary>
public record ActivityGanttRowDto(
    string  WellId,
    string  Code,
    string  Text,
    string  Type,
    string? TargetStart,
    string? TargetEnd,
    string? ActualStart,
    string? ActualEnd,
    double  Progress);

// ─── Wells Readiness Overall Status (Funnel) ─────────────────────────────────

/// <summary>
/// Plan-to-actual funnel for Wells Readiness Overall Status.
/// Logic: OriginalPlan → remove FLAF/SCR-blocked wells → remove PDO-issue wells
///        → compare against actual completions from WMR buffer_status.
/// </summary>
public record WellsReadinessDto(
    /// <summary>Snapshot date (latest WMR week available).</summary>
    string  AsOfDate,
    /// <summary>Plan year (e.g. 2026).</summary>
    int     PlanYear,
    /// <summary>Total distinct wells in the SAP rig sequence for PlanYear.</summary>
    int     OriginalPlan,
    /// <summary>Wells blocked by FLAF/SCR approval issues (buffer_status = 'FLAF/SCR &amp; Other').</summary>
    int     FlafScrExcluded,
    /// <summary>Balance after removing FLAF/SCR-blocked wells.</summary>
    int     AfterFlafScr,
    /// <summary>Wells blocked by PDO corporate issues (buffer_status = 'PDO Issues').</summary>
    int     PdoIssuesExcluded,
    /// <summary>Clean target: AfterFlafScr minus PDO-issue wells.</summary>
    int     CleanTarget,
    /// <summary>Wells actually completed on time (buffer_status = 'Due Completed').</summary>
    int     DueCompleted,
    /// <summary>Wells completed ahead of schedule (buffer_status = 'Not Due Accelerated').</summary>
    int     NotDueAccelerated,
    /// <summary>Total actual completions: DueCompleted + NotDueAccelerated.</summary>
    int     ActualCompleted,
    /// <summary>Wells completed ahead of schedule (rig-off before planned start). = NotDueAccelerated.</summary>
    int     WellsAccelerated,
    /// <summary>Wells still needed to hit the clean target: CleanTarget − ActualCompleted.</summary>
    int     Remaining,
    /// <summary>ATNM performance = ActualCompleted / CleanTarget * 100.</summary>
    double  AtnmPerformancePct,
    /// <summary>Overall completion = ActualCompleted / AfterFlafScr * 100.</summary>
    double  OverallCompletionPct,
    /// <summary>Wells with OHL (overhead line) completed on or before asOfDate.</summary>
    int     OhlCompleted
);

/// <summary>
/// Bulk response: wells readiness broken down by well type in a single response.
/// Eliminates N+1 frontend calls (one per well type).
/// </summary>
public record WellsReadinessByTypeDto(
    /// <summary>Overall totals (wellType = null).</summary>
    WellsReadinessDto Overall,
    /// <summary>Per well-type breakdown.</summary>
    IReadOnlyList<WellsReadinessTypeBreakdownDto> ByType
);

/// <summary>One entry in the by-type breakdown.</summary>
public record WellsReadinessTypeBreakdownDto(
    string WellType,
    int OriginalPlan,
    int FlafScrExcluded,
    int AfterFlafScr,
    int CleanTarget,
    int ActualCompleted,
    int Remaining,
    double AtnmPerformancePct
);

// ─── Daily Output Rate Trend ─────────────────────────────────────────────────

/// <summary>One data point in the Daily Output Rate trend chart.</summary>
public record DailyOutputRatePointDto(
    /// <summary>Date in yyyy-MM-dd format.</summary>
    string Date,
    /// <summary>Sum of daily_actual_quantity across matched wells (m/day).</summary>
    double ActualRate,
    /// <summary>Sum of required (asking/target rate) across matched wells (m/day).</summary>
    double AskingRate);

/// <summary>Response for GET /dashboard/daily-output-rate.</summary>
public record DailyOutputRateDto(
    IReadOnlyList<DailyOutputRatePointDto> Points,
    /// <summary>Human-readable subtitle for the chart card (e.g. "Actual vs Asking Rate · 30 days").</summary>
    string Subtitle);

/// <summary>Health summary for a single cluster (derived from WMR.over_all_progress_percentages).</summary>
public record ClusterHealthItemDto(
    string Cluster,
    int    WellCount,
    double HealthPercentage,  // average over_all_progress_percentages across cluster wells
    int    AtRisk,
    int    Critical,
    string Status,            // "OnTrack" | "AtRisk" | "Critical"
    double PlannedPct,        // time-based planned progress % from ActivityTaskPlan
    double ActualPct);        // weighted-average actual progress % from ActivityTaskPlan

/// <summary>Response for GET /dashboard/cluster-health.</summary>
public record ClusterHealthDto(
    int TotalClusters,
    int AtRisk,
    int Critical,
    IReadOnlyList<ClusterHealthItemDto> Clusters);

/// <summary>Response for GET /dashboard/commissioning-status. PDO Commissioning Status widget.</summary>
public record CommissioningStatusDto(
    int     TotalReady,
    int     Commissioned,
    int     NotCommissioned,
    int     BacklogInCommissioning,
    int     AtRisk,
    int     Due,
    int     SuspendedWells,
    double  ReadinessPct,
    double? LastYearPct,
    string  Status,
    string  AsOfDate);

/// <summary>A single area row for the Buffer Flowlines Ready widget.</summary>
public record BufferFlowlineAreaDto(
    string Area,
    int    Count,
    double Pct);

/// <summary>Response for GET /dashboard/buffer-flowlines-ready.</summary>
public record BufferFlowlinesReadyDto(
    int    TotalReady,
    string Status,
    string AsOfDate,
    IReadOnlyList<BufferFlowlineAreaDto> Areas);

// ─── Construction Progress (Flowline & OHL) ──────────────────────────────────

/// <summary>KPI summary cards for the Construction Well Delivery widget.</summary>
public record ConstructionProgressKpiDto(
    int PlanPdoRigSequence,
    int PlanFlafScrAdjusted,
    int PlanPdoIssuesRemoved,
    int ActualDueWellsCompleted,
    int ActualAcceleratedWells,
    int BacklogsAgainstPlan,
    int TotalCompleted);

/// <summary>One month row in the cumulative trend chart.</summary>
public record ConstructionProgressMonthDto(
    string MonthLabel,
    int    MonthNum,
    bool   IsForecast,
    int    PlanPdoRigSequenceCumulative,
    int    PlanFlafScrAdjustedCumulative,
    int    PlanPdoIssuesRemovedCumulative,
    int    ActualDueCompletedCumulative,
    int    ActualNotDueAcceleratedCumulative,
    int    Backlog);

/// <summary>Combined response for the Construction Well Delivery Flowline &amp; OHL Progress widget.</summary>
public record ConstructionProgressResponse(
    string AsOfDate,
    int    PlanYear,
    ConstructionProgressKpiDto Kpi,
    IReadOnlyList<ConstructionProgressMonthDto> MonthlyTrend);

// ─── Flowline Readiness (Funnel Widget) ───────────────────────────────────────

/// <summary>Response for the Wells Readiness Flowline funnel widget.</summary>
public record FlowlineReadinessResponse(
    string AsOfDate,
    int    PlanYear,
    int    TotalWells,
    int    OriginalPlan,
    int    FlafScrExcluded,
    int    AfterFlafScr,
    int    PdoIssuesExcluded,
    int    AfterPdoIssues,
    int    ActualCompleted,
    int    Backlog);

// ─── OHL Readiness (Funnel Widget) ────────────────────────────────────────────

/// <summary>Response for the Wells Readiness OHL funnel widget.</summary>
public record OhlReadinessResponse(
    string AsOfDate,
    int    PlanYear,
    int    TotalWells,
    int    OriginalPlan,
    int    FlafScrExcluded,
    int    AfterFlafScr,
    int    PdoIssuesExcluded,
    int    AfterPdoIssues,
    int    ActualCompleted,
    int    Backlog);

// ─── Commissioning Progress ───────────────────────────────────────────────────

/// <summary>One month row in the commissioning completion % trend.</summary>
public record CommissioningProgressMonthDto(
    string MonthLabel,
    int    MonthNum,
    bool   IsForecast,
    double ActualCompletionPct,
    double PlanTargetPct);

/// <summary>KPI summary for the commissioning progress chart.</summary>
public record CommissioningProgressKpiDto(
    int    TotalPlanned,
    int    TotalCommissioned,
    double CompletionPct,
    double PlanTargetPct);

/// <summary>Response for GET /dashboard/commissioning-progress.</summary>
public record CommissioningProgressResponse(
    string AsOfDate,
    int    FiscalYear,
    CommissioningProgressKpiDto Kpi,
    IReadOnlyList<CommissioningProgressMonthDto> MonthlyTrend);
// ─── Buffer Location Construction Progress ───────────────────────────────────

/// <summary>
/// KPI data for the Buffer Location Construction Progress – YTD widget.
/// Buffer wells use PEGGING delay (actual_pegged_date, 90-day threshold)
/// and SCR threshold of 60 days (not 90).
/// </summary>
public record BufferLocationProgressKpiDto(
    int     RigSequencePlan,
    int     AfterPeggingScr,
    int     PeggingScrExcluded,
    int     CleanTarget,
    int     DueWellsCompleted,
    int     ActualCompleted,
    int     Accelerated,
    int     Backlog,
    int     NetAcceleration,
    int     ScheduleVariance,
    decimal OverallPct,
    decimal AtnmPct);

/// <summary>Combined response for the Buffer Location Construction Progress widget.</summary>
public record BufferLocationProgressResponse(
    string AsOfDate,
    int    PlanYear,
    BufferLocationProgressKpiDto Kpi);


// ─── Pegging Status (Construction Well Delivery) ─────────────────────────────

/// <summary>KPI tiles for the Pegging Status widget.</summary>
public record PeggingStatusKpiDto(
    int    PlanRigSequence,
    int    ActualIssued,
    double PeggingPerformancePct,
    double PeggingReadiness4mPct,
    double TrendVsPlanPct);

/// <summary>Backlog responsibility breakdown.</summary>
public record PeggingBacklogDto(
    int    TotalBacklog,
    int    AtnmBacklog,
    double AtnmPct,
    int    PdoBacklog,
    double PdoPct);

/// <summary>Risk level gauge for next 4 months.</summary>
public record PeggingRiskDto(
    int    ProjectedGap,
    string RiskLevel,
    int    GaugeMax);

/// <summary>One month row in the pegging stacked area chart.</summary>
public record PeggingMonthDto(
    string MonthLabel,
    int    MonthNum,
    bool   IsForecast,
    int    PlanCumulative,
    int    ActualCumulative,
    int    BacklogCumulative);

/// <summary>Combined response for the Construction Well Delivery – Pegging Status widget.</summary>
public record PeggingStatusResponse(
    string AsOfDate,
    int    PlanYear,
    PeggingStatusKpiDto Kpi,
    PeggingBacklogDto Backlog,
    PeggingRiskDto Risk,
    IReadOnlyList<PeggingMonthDto> MonthlyTrend);

/// <summary>
/// Overall Pegging Status pie: splits wells whose pegging is complete (both an
/// actual pegged date and an actual rig-on date exist) by how long before rig
/// arrival the pegging was completed.
/// • Within90Days  → pegged ≤ 90 days before actual rig-on (pegging completed &lt; 90 days)
/// • After90Days   → pegged &gt; 90 days before actual rig-on (pegging completed &gt; 90 days)
/// </summary>
public record OverallPeggingStatusResponse(
    int CompletedWithin90Days,
    int CompletedAfter90Days,
    int Total,
    /// <summary>Locations not yet pegged where scheduled rig-on is within 0–90 days (at risk).</summary>
    int NotPeggedWithin90Days,
    /// <summary>FLAFs not yet issued where scheduled rig-on is within 0–90 days (at risk).</summary>
    int FlafPendingWithin90Days,
    /// <summary>FLAFs issued but less than 90 days before scheduled rig-on (breach of lead-time rule).</summary>
    int FlafIssuedLateWithin90Days);

// ─── Well Delivery Cycle Time ─────────────────────────────────────────────────

/// <summary>One month point in the cycle-time trend (avg + median days).</summary>
public record CycleTimeTrendPointDto(string Month, double AvgDays, double MedianDays);

/// <summary>One phase segment of the delivery cycle (avg days + % of total).</summary>
public record CycleTimePhaseDto(string Name, double Days, double Pct);

/// <summary>
/// Well Delivery Cycle Time: days from rig-on to delivery (commissioning finish, else
/// engineering completion) across completed wells, with a monthly trend and a phase
/// breakdown (Drilling → Construction → Commissioning). Computed from WMR actual dates.
/// </summary>
public record WellDeliveryCycleTimeResponse(
    double AvgDays,
    double AvgDelta,
    double AvgDeltaPct,
    double MedianDays,
    double MedianDelta,
    double MedianDeltaPct,
    double MinDays,
    string? MinWell,
    double MaxDays,
    string? MaxWell,
    int WellsCompleted,
    int WellsDelta,
    IReadOnlyList<CycleTimeTrendPointDto> Trend,
    IReadOnlyList<CycleTimePhaseDto> Phases);

// ─── FLAF Status (Construction Well Delivery) ────────────────────────────────

/// <summary>KPI tiles for the FLAF Status widget.</summary>
public record FlafStatusKpiDto(
    int    PlanFlafSubmissions,
    int    ActualSubmitted,
    double ApprovalRatePct,
    double AvgCycleTimeDays,
    int    FlafBacklog);

/// <summary>FLAF Backlog responsibility breakdown.</summary>
public record FlafBacklogDto(
    int    TotalBacklog,
    int    AtnmBacklog,
    double AtnmPct,
    int    PdoBacklog,
    double PdoPct);

/// <summary>FLAF Risk level gauge for next 4 months.</summary>
public record FlafRiskDto(
    int    ProjectedGap,
    string RiskLevel,
    int    GaugeMax);

/// <summary>One month row in the FLAF stacked area chart.</summary>
public record FlafMonthDto(
    string MonthLabel,
    int    MonthNum,
    bool   IsForecast,
    int    PlanCumulative,
    int    ActualCumulative,
    int    GapCumulative);

/// <summary>Combined response for the Construction Well Delivery – FLAF Status widget.</summary>
public record FlafStatusResponse(
    string AsOfDate,
    int    PlanYear,
    FlafStatusKpiDto Kpi,
    FlafBacklogDto Backlog,
    FlafRiskDto Risk,
    IReadOnlyList<FlafMonthDto> MonthlyTrend);

// ─── Well Execution Dashboard ─────────────────────────────────────────────────

/// <summary>Job count breakdown by status for the Well Execution Dashboard.</summary>
public record WellExecJobCountsDto(int Total, int Completed, int InProgress, int NotStarted);

/// <summary>Overall progress KPI — actual %, planned %, and variance.</summary>
public record WellExecProgressDto(double ActualPct, double PlannedPct, double VariancePct);

/// <summary>Delayed jobs count and percentage of total.</summary>
public record WellExecDelayedDto(int Count, double PctOfTotal);

/// <summary>Revenue achievement — actual and planned in USD millions.</summary>
public record WellExecRevenueDto(double ActualM, double PlannedM, double PctAchieved);

/// <summary>One time-series point for the Planned vs Actual Progress &amp; Revenue chart.</summary>
public record WellExecChartPointDto(
    string   Label,
    double?  PlannedPct,
    double?  ActualPct,
    double?  PlannedRevM,
    double?  ActualRevM);

/// <summary>A milestone marker for the chart (Rig Move In, FLAF, Flowline Complete, etc.).</summary>
public record WellExecMilestoneDto(string Name, string? Date);

/// <summary>Full response for GET /dashboard/well-execution-kpi.</summary>
public record WellExecKpiDto(
    WellExecJobCountsDto             JobCounts,
    WellExecProgressDto              Progress,
    WellExecDelayedDto               Delayed,
    WellExecRevenueDto               Revenue,
    int                              UpcomingTargetEnds,
    IReadOnlyList<WellExecChartPointDto> ChartSeries,
    IReadOnlyList<WellExecMilestoneDto>  Milestones);

/// <summary>KPI summary for GET /dashboard/well-hookup-kpi (one tab: conventional, nonstandard, or conversions).</summary>
public record WellHookupKpiDto(
    int ActualCompleted,
    int SuspendedCount,
    int TotalPlanned,
    int AheadOfPlan,
    int AtRiskOfDelay,
    int LyActualCompleted,
    int LySuspendedCount,
    int LyTotalPlanned,
    int LyAheadOfPlan,
    int LyAtRiskOfDelay);

// ─── Non-Standard Hookup APIs ─────────────────────────────────────────────────

/// <summary>Plan-to-actual waterfall data for the Non Standard hookup tab.</summary>
public record NsHookupWaterfallDto(
    int    PdoPlan,
    int    FlafScrRemoved,
    int    AfterFlafScr,
    int    PdoIssuesRemoved,
    int    CleanTarget,
    int    ActualCompleted,
    string AsOfDate);

/// <summary>Overall hook-up completion % for the Non Standard tab (donut centre value + LY delta).</summary>
public record NsHookupCompletionDto(
    double CompletionPct,
    double LyCompletionPct,
    double DeltaPct,
    string AsOfDate);

/// <summary>Breakdown counts for the Non Standard hookup breakdown bar.</summary>
public record NsHookupBreakdownDto(
    int    HookedUp,
    double HookedUpPct,
    int    Backlog,
    double BacklogPct,
    int    Suspended,
    double SuspendedPct,
    int    Total,
    string AsOfDate);

// ─── Well Hookup Progress ─────────────────────────────────────────────────────

/// <summary>One step in the Plan-to-Actual waterfall chart.</summary>
public record HookupWaterfallStepDto(string Label, int Value);

/// <summary>Top KPI tiles for the hookup progress widget.</summary>
public record HookupProgressKpiDto(
    int ActualCompleted,
    int ActualCompletedLy,
    int SuspendedHookups,
    int TotalPlannedYtd,
    int AheadOfPlan,
    int AheadOfPlanLy,
    int AtRiskOfDelay,
    int AtRiskOfDelayLy);

/// <summary>Overall hook-up % and breakdown counts.</summary>
public record HookupOverallDto(
    double OverallPct,
    double LastYearPct,
    int    HookedUp,
    int    BacklogInHookup,
    int    SuspendedInBreakdown,
    int    TotalWells);

/// <summary>Full response for GET /dashboard/hookup-progress.</summary>
public record HookupProgressDto(
    string                              WellType,
    HookupProgressKpiDto                Kpi,
    IReadOnlyList<HookupWaterfallStepDto> WaterfallSteps,
    HookupOverallDto                    Overall);

// ─── Crew PI Rating Heatmap (well-execution page) ────────────────────────────

/// <summary>Headline KPI tiles above the Crew PI Rating heatmap.</summary>
public record CrewPiKpisDto(
    int    TotalCrews,
    string AvgRating,
    string AvgDelta,
    string TopCrew,
    string TopRating,
    string LowCrew,
    string LowRating,
    int    BelowP3,
    int    BelowP3Pct);

/// <summary>One crew's row in the heatmap: per-column P-rating values (null = no data that period) plus its average.</summary>
public record CrewPiRowDto(
    string              Crew,
    double              Avg,
    IReadOnlyList<int?> Vals);

/// <summary>One P-rating distribution bucket for the selected period.</summary>
public record CrewPiDistributionDto(
    string Range,
    int    Count,
    int    Pct,
    string Color);

/// <summary>A single period view (Day / Week / Month): column headers, crew rows, and distribution.</summary>
public record CrewPiPeriodDto(
    IReadOnlyList<string>               Columns,
    IReadOnlyList<CrewPiRowDto>         Rows,
    IReadOnlyList<CrewPiDistributionDto> Distribution);

/// <summary>Full response for GET /dashboard/crew-pi-heatmap — all three periods in one payload.</summary>
public record CrewPiHeatmapResponse(
    CrewPiKpisDto         Kpis,
    CrewPiPeriodDto       Day,
    CrewPiPeriodDto       Week,
    CrewPiPeriodDto       Month,
    IReadOnlyList<string> Insights);

// ─── Weekly Progress Timeline ────────────────────────────────────────────────

public enum TimelineViewType
{
    Day = 1,
    Week = 2,
    Month = 3
}

public class WeeklyProgressRequest
{
    public string ProjectId { get; set; } = string.Empty;
    public string WellId { get; set; } = string.Empty;
    public DateTime? FromDate { get; set; }
    public DateTime? ToDate { get; set; }
    public TimelineViewType ViewType { get; set; } = TimelineViewType.Week;
}

public record WeeklyProgressPointDto(
    DateTime ProgressDate,
    decimal  ProgressPercentage,
    string?  Label = null);

public record WeeklyProgressTimelineResponse(
    IReadOnlyList<WeeklyProgressPointDto> DataPoints,
    decimal? ProgressVelocityPerWeek,
    TimelineViewType ViewType = TimelineViewType.Week);

// ─── Crew Master ─────────────────────────────────────────────────────────────

public record CrewMasterItemDto(
    string? Code,
    string? Name,
    // Reserved for future columns — kept empty for now
    string? Category,
    string? Discipline,
    string? Activity,
    string? Formation);

// ─── Activity Master ────────────────────────────────────────────────────────

public record ActivityMasterAllActivitiesItemDto(
    string? ActivityCode,
    string? Description,
    string? Discipline,
    string? ActivityGroup,
    string? CrewGroupCode,
    string? CrewGroupName,
    string? Application,
    string? Uom,
    decimal? QtyHrNorm);
