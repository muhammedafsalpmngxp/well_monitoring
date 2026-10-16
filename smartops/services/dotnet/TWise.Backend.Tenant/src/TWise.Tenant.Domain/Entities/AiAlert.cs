namespace TWise.Tenant.Domain.Entities;

/// <summary>
/// A watched Ask AI answer: its query runs again every EveryHours and the owner is notified when it
/// starts crossing the limit or looking unusual. Maps to core.AiAlerts.
/// </summary>
public class AiAlert
{
    public long Id { get; set; }
    public long TenantId { get; set; }
    public string UserId { get; set; } = "";
    public string SourceType { get; set; } = "";
    public long SourceId { get; set; }
    public string SourceName { get; set; } = "";
    public string Question { get; set; } = "";
    public string QuerySpecJson { get; set; } = "";
    /// <summary>above | below | unusual | change</summary>
    public string Kind { get; set; } = "";
    /// <summary>The limit for above / below, or the allowed percent for change.</summary>
    public double? Threshold { get; set; }
    public int EveryHours { get; set; } = 24;
    /// <summary>Comma-separated addresses also mailed when the alert starts firing; null for in-app only.</summary>
    public string? NotifyEmails { get; set; }
    /// <summary>Whether the last check fired; a notification goes out only when this turns true.</summary>
    public bool IsTriggered { get; set; }
    public string? LastMessage { get; set; }
    /// <summary>Last single values (JSON array, newest last), the baseline for "unusual".</summary>
    public string? HistoryJson { get; set; }
    public DateTime? LastCheckedAt { get; set; }
    public DateTime NextCheckAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
