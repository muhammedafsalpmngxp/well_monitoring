namespace TWise.Tenant.Domain.Entities.Delivery;

/// <summary>
/// One run of a schedule, as the Delivery Log shows it. It copies the schedule's name and target, so it outlives a
/// deleted schedule. Trigger is Schedule, RunNow or Test; Status is Sent, Skipped or Failed. Maps to [delivery].[ScheduleRun].
/// </summary>
public class ScheduleRun
{
    public long Id { get; set; }
    public long TenantId { get; set; }
    public long? ScheduleId { get; set; }
    public string ScheduleName { get; set; } = string.Empty;
    public string TargetType { get; set; } = string.Empty;
    public long TargetId { get; set; }
    public string? TargetName { get; set; }
    public string Trigger { get; set; } = "Schedule";
    public string Status { get; set; } = "Failed";
    public DateTime StartedAt { get; set; }
    public DateTime? FinishedAt { get; set; }
    public int RecipientCount { get; set; }
    public long AttachmentBytes { get; set; }
    public int Attempt { get; set; }
    public string? Error { get; set; }
}
