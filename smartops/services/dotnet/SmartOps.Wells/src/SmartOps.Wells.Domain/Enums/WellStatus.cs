namespace SmartOps.Wells.Domain.Enums;

/// <summary>Canonical well status values used across the domain.</summary>
public static class WellStatus
{
    public const string OnTrack = "On Track";
    public const string Ahead = "Ahead";
    public const string AtRisk = "At Risk";
    public const string Critical = "Critical";
}

/// <summary>Canonical milestone status values.</summary>
public static class MilestoneStatus
{
    public const string Upcoming = "upcoming";
    public const string Critical = "critical";
    public const string Overdue = "overdue";
    public const string Done = "done";
}

/// <summary>Canonical critical-date status values.</summary>
public static class CriticalDateStatus
{
    public const string Upcoming = "upcoming";
    public const string Passed = "passed";
    public const string Missed = "missed";
}
