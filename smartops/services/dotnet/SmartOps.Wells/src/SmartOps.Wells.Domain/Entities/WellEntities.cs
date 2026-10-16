using SmartOps.Shared.Db;

namespace SmartOps.Wells.Domain.Entities;

/// <summary>Core well entity — represents a single well on an active flowline project.</summary>
public class Well : AuditableEntity
{
    public string WellId { get; set; } = string.Empty;
    public string Cluster { get; set; } = string.Empty;
    public string? Location { get; set; }
    public string? WellType { get; set; }
    public string? ActivityCode { get; set; }
    public string? Activity { get; set; }
    public string? CrewGroup { get; set; }
    public string? Crew { get; set; }
    public double Progress { get; set; }
    public double Planned { get; set; }
    public double RateDay { get; set; }
    public double AskRate { get; set; }
    public string? RigOn { get; set; }
    public string? Status { get; set; }
    public double? Spi { get; set; }
    public double? Cpi { get; set; }

    /// <summary>Computed variance: positive = ahead, negative = behind.</summary>
    public double ProgressVariance => Progress - Planned;
}

/// <summary>Project milestone linked to a well.</summary>
public class Milestone : AuditableEntity
{
    public string WellId { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? Owner { get; set; }
    public DateOnly? Planned { get; set; }
    public DateOnly? Forecast { get; set; }
    public DateOnly? Actual { get; set; }
    public int VarDays { get; set; }
    public string Status { get; set; } = "upcoming"; // overdue | critical | upcoming | done
}

/// <summary>User-specific well watchlist entry.</summary>
public class WatchlistEntry : AuditableEntity
{
    public int UserId { get; set; }
    public string WellId { get; set; } = string.Empty;
    public string? Reason { get; set; }
}

/// <summary>Critical date tied to a well with a target deadline.</summary>
public class CriticalDate : AuditableEntity
{
    public string WellId { get; set; } = string.Empty;
    public string Label { get; set; } = string.Empty;
    public DateOnly Target { get; set; }
    public string Status { get; set; } = "upcoming";
    public string? Notes { get; set; }
}
