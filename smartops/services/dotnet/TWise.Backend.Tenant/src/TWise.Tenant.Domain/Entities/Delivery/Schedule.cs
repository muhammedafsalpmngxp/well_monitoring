namespace TWise.Tenant.Domain.Entities.Delivery;

/// <summary>
/// A scheduled delivery: a report, dashboard or canvas (TargetType, TargetId) mailed on a recurrence (Cron in
/// TimeZone, or once at RunOnceAt) to its recipients. Times are UTC. NextRunAt is null when nothing is left to run.
/// Maps to [delivery].[Schedule].
/// </summary>
public class Schedule
{
    public long Id { get; set; }
    public long TenantId { get; set; }
    public string Name { get; set; } = string.Empty;
    /// <summary>Report, Dashboard or Canvas.</summary>
    public string TargetType { get; set; } = string.Empty;
    public long TargetId { get; set; }
    /// <summary>Link, Xlsx or Csv.</summary>
    public string Format { get; set; } = "Link";
    public string? Cron { get; set; }
    public DateTime? RunOnceAt { get; set; }
    public string TimeZone { get; set; } = "UTC";
    public DateTime? StartAt { get; set; }
    public DateTime? EndAt { get; set; }
    public bool SkipIfEmpty { get; set; }
    public string Subject { get; set; } = string.Empty;
    public string Body { get; set; } = string.Empty;
    public bool IsActive { get; set; } = true;
    public long OwnerUserId { get; set; }
    public DateTime? NextRunAt { get; set; }
    public DateTime? LastRunAt { get; set; }
    /// <summary>Sent, Skipped or Failed.</summary>
    public string? LastStatus { get; set; }
    public long CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; }
    public long? ModifiedBy { get; set; }
    public DateTime ModifiedAt { get; set; }
    public bool IsDeleted { get; set; }

    public List<ScheduleRecipient> Recipients { get; set; } = [];
}
