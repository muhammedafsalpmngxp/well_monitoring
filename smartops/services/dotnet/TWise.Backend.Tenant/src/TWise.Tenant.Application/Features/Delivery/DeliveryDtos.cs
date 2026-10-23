using TWise.Tenant.Domain.Entities.Delivery;

namespace TWise.Tenant.Application.Features.Delivery;

/// <summary>Kind is To, Cc or Bcc. Type is User (Value is the user id), Role (role code), Group (mail group id) or Email.</summary>
public sealed record RecipientDto(string Kind, string Type, string Value, string? Label = null);

/// <summary>A schedule as the dialog sends it. Times are UTC. Cron null means run once at RunOnceAt.</summary>
public sealed record ScheduleRequest(
    string? Name, string? TargetType, long TargetId, string? Format, string? Cron, DateTime? RunOnceAt, string? TimeZone,
    DateTime? StartAt, DateTime? EndAt, bool SkipIfEmpty, string? Subject, string? Body, IReadOnlyList<RecipientDto>? Recipients);

public sealed record ScheduleDto(
    long Id, string Name, string TargetType, long TargetId, string Format, string? Cron, DateTime? RunOnceAt, string TimeZone,
    DateTime? StartAt, DateTime? EndAt, bool SkipIfEmpty, string Subject, string Body, IReadOnlyList<RecipientDto> Recipients,
    bool IsActive, long OwnerUserId, string? OwnerName, string? TargetName, DateTime? NextRunAt, DateTime? LastRunAt,
    string? LastStatus, DateTime CreatedAt, DateTime ModifiedAt)
{
    public static ScheduleDto From(Schedule s, string? ownerName, string? targetName) => new(
        s.Id, s.Name, s.TargetType, s.TargetId, s.Format, s.Cron, Utc(s.RunOnceAt), s.TimeZone, Utc(s.StartAt), Utc(s.EndAt),
        s.SkipIfEmpty, s.Subject, s.Body,
        s.Recipients.OrderBy(r => r.Id).Select(r => new RecipientDto(r.Kind, r.RecipientType, r.Value, r.Label)).ToList(),
        s.IsActive, s.OwnerUserId, ownerName, targetName, Utc(s.NextRunAt), Utc(s.LastRunAt), s.LastStatus,
        Utc(s.CreatedAt), Utc(s.ModifiedAt));

    // SQL Server hands datetime2 back without a kind; marking it UTC makes the JSON end in Z.
    internal static DateTime? Utc(DateTime? value) => value is { } v ? Recurrence.AsUtc(v) : null;
    internal static DateTime Utc(DateTime value) => Recurrence.AsUtc(value);
}

public sealed record ScheduleRunDto(
    long Id, long? ScheduleId, string ScheduleName, string TargetType, string? TargetName, string Trigger, string Status,
    DateTime StartedAt, DateTime? FinishedAt, int RecipientCount, long AttachmentBytes, int Attempt, string? Error)
{
    public static ScheduleRunDto From(ScheduleRun r) => new(
        r.Id, r.ScheduleId, r.ScheduleName, r.TargetType, r.TargetName, r.Trigger, r.Status, ScheduleDto.Utc(r.StartedAt),
        ScheduleDto.Utc(r.FinishedAt), r.RecipientCount, r.AttachmentBytes, r.Attempt, r.Error);
}

public sealed record ScheduleRunPage(IReadOnlyList<ScheduleRunDto> Items, int Total);

public sealed record PreviewRunsRequest(string? Cron, string? TimeZone, DateTime? StartAt, DateTime? EndAt, DateTime? RunOnceAt);

public sealed record MailGroupRequest(string? Name, string? Description, IReadOnlyList<string>? Members);

public sealed record MailGroupDto(long Id, string Name, string? Description, IReadOnlyList<string> Members, DateTime CreatedAt, DateTime ModifiedAt)
{
    public static MailGroupDto From(MailGroup g) => new(
        g.Id, g.Name, g.Description, g.Members.OrderBy(m => m.Id).Select(m => m.Email).ToList(),
        ScheduleDto.Utc(g.CreatedAt), ScheduleDto.Utc(g.ModifiedAt));
}

/// <summary>The fixed words of schedules and runs, as stored and as the API sends them.</summary>
public static class DeliveryTerms
{
    public const string Report = "Report";
    public const string Dashboard = "Dashboard";
    public const string Canvas = "Canvas";
    /// <summary>An Ask AI answer's insight report (TargetId = the assistant message), written into the mail.</summary>
    public const string Insight = "Insight";

    public const string Link = "Link";
    public const string Xlsx = "Xlsx";
    public const string Csv = "Csv";

    public const string Sent = "Sent";
    public const string Skipped = "Skipped";
    public const string Failed = "Failed";

    public const string OnSchedule = "Schedule";
    public const string RunNow = "RunNow";
    public const string Test = "Test";
}
