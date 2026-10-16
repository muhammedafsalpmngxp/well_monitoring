namespace SmartOps.Wells.Domain.Entities;

/// <summary>
/// Read-only projection from the remote AppMasterDB — no key, no EF tracking.
/// Maps to [dbo].[ActivityTaskPlan].
/// </summary>
public class ActivityTaskPlan
{
    public string? CrewType { get; set; }
    public string? CrewCode { get; set; }
    public string? WellId { get; set; }
    public DateTime? StartDate { get; set; }
    public DateTime? EndDate { get; set; }
    public string? ProjectId { get; set; }
    public string? Type { get; set; }
    public string? Progress { get; set; }
}

/// <summary>
/// Read-only projection from the remote AppMasterDB — no key, no EF tracking.
/// Maps to [dbo].[task_daily].
/// </summary>
public class TaskDaily
{
    public string? CrewType { get; set; }
    public string? CrewCode { get; set; }
    public string? WellId { get; set; }
    public DateTime ActionOn { get; set; }
}

/// <summary>
/// Read-only projection from [dbo].[WMR] (Well Monthly Report).
/// Contains one row per well per week snapshot.
/// </summary>
public class WmrEntry
{
    public string? PdoWellId { get; set; }
    public DateTime? ActualRigOnDate { get; set; }
    public DateTime? ActualRigOffDate { get; set; }
    public double? OverAllProgressPercentages { get; set; }
    public string? FlowLineConstStatus { get; set; }
    public DateTime? WeekNumber { get; set; }
}
