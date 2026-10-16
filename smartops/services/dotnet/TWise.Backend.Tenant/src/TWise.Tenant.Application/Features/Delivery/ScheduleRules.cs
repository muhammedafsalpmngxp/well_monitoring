using System.Net.Mail;
using TWise.Tenant.Application.Common;

namespace TWise.Tenant.Application.Features.Delivery;

/// <summary>What a schedule must be before it is saved or tested.</summary>
public static class ScheduleRules
{
    public const int MaxName = 120;
    public const int MaxSubject = 200;
    public const int MaxBody = 8000;
    public const int MaxRecipients = 100;
    public const int MaxRecipientValue = 320;
    public const int MaxCron = 100;

    /// <summary>The page modules that let a user view each kind of item; view on any one of them is enough.</summary>
    public static readonly IReadOnlyDictionary<string, string[]> ViewModules = new Dictionary<string, string[]>
    {
        [DeliveryTerms.Report] = ["reports.standard-reports", "reports.my-reports"],
        [DeliveryTerms.Dashboard] = ["dashboard.standard-boards", "dashboard.wip-boards"],
        [DeliveryTerms.Canvas] = [ModulePermission.Canvas, ModulePermission.StandardCanvases],
    };

    /// <summary>The formats each kind of item can be sent in. Dashboards go as a link until they can be drawn on the server.</summary>
    public static readonly IReadOnlyDictionary<string, string[]> Formats = new Dictionary<string, string[]>
    {
        [DeliveryTerms.Report] = [DeliveryTerms.Link, DeliveryTerms.Xlsx, DeliveryTerms.Csv],
        [DeliveryTerms.Canvas] = [DeliveryTerms.Link, DeliveryTerms.Xlsx],
        [DeliveryTerms.Dashboard] = [DeliveryTerms.Link],
    };

    private static readonly string[] Kinds = ["To", "Cc", "Bcc"];

    /// <summary>Why the request cannot be saved, or null when it can.</summary>
    public static string? Problem(ScheduleRequest r, DateTime nowUtc)
    {
        var name = r.Name?.Trim() ?? string.Empty;
        if (name.Length == 0) return "Give the schedule a name.";
        if (name.Length > MaxName) return $"A schedule name has at most {MaxName} characters.";
        if (r.TargetType is null || !Formats.TryGetValue(r.TargetType, out var formats)) return "The item must be a Report, Dashboard or Canvas.";
        if (r.TargetId <= 0) return "Choose the item to send.";
        if (r.Format is null || !formats.Contains(r.Format))
            return $"A {r.TargetType.ToLowerInvariant()} can be sent as {string.Join(" or ", formats)}.";

        if ((r.Cron?.Trim().Length ?? 0) > MaxCron) return $"A cron expression has at most {MaxCron} characters.";
        var spec = new RecurrenceSpec(r.Cron, r.RunOnceAt, r.TimeZone ?? string.Empty, r.StartAt, r.EndAt);
        if (Recurrence.Problem(spec) is { } when) return when;
        if (string.IsNullOrWhiteSpace(r.Cron) && Recurrence.AsUtc(r.RunOnceAt!.Value) <= nowUtc) return "The run time must be in the future.";
        if (r.StartAt is { } start && r.EndAt is { } end && end <= start) return "The end must be after the start.";
        if (Recurrence.Next(spec, nowUtc) is null) return "The schedule has no run left. Check the end date.";

        var subject = r.Subject?.Trim() ?? string.Empty;
        if (subject.Length == 0) return "Write a subject.";
        if (subject.Length > MaxSubject) return $"A subject has at most {MaxSubject} characters.";
        if (subject.IndexOfAny(['\r', '\n']) >= 0) return "The subject must be one line.";
        if ((r.Body?.Length ?? 0) > MaxBody) return $"The message has at most {MaxBody} characters.";

        return RecipientProblem(r.Recipients ?? []);
    }

    public const int MaxGroupDescription = 400;
    public const int MaxGroupMembers = 500;

    /// <summary>Why the mail group cannot be saved, or null when it can; members are its addresses, trimmed and once each.</summary>
    public static string? MailGroupProblem(MailGroupRequest r, out List<string> members)
    {
        members = (r.Members ?? []).Select(m => m?.Trim() ?? string.Empty).Where(m => m.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        var name = r.Name?.Trim() ?? string.Empty;
        if (name.Length == 0) return "Give the mail group a name.";
        if (name.Length > MaxName) return $"A mail group name has at most {MaxName} characters.";
        if ((r.Description?.Length ?? 0) > MaxGroupDescription) return $"A description has at most {MaxGroupDescription} characters.";
        if (members.Count == 0) return "Add at least one address.";
        if (members.Count > MaxGroupMembers) return $"A mail group has at most {MaxGroupMembers} addresses.";
        var wrong = members.FirstOrDefault(m => m.Length > MaxRecipientValue || !MailAddress.TryCreate(m, out _));
        return wrong is null ? null : $"\"{wrong}\" is not a valid address.";
    }

    private static string? RecipientProblem(IReadOnlyList<RecipientDto> recipients)
    {
        if (recipients.Count > MaxRecipients) return $"A schedule has at most {MaxRecipients} recipients.";
        foreach (var recipient in recipients)
        {
            if (!Kinds.Contains(recipient.Kind)) return "A recipient goes in To, Cc or Bcc.";
            var value = recipient.Value?.Trim() ?? string.Empty;
            var ok = value.Length is > 0 and <= MaxRecipientValue && recipient.Type switch
            {
                "User" or "Group" => long.TryParse(value, out var id) && id > 0,
                "Role" => true,
                "Email" => MailAddress.TryCreate(value, out _),
                _ => false,
            };
            if (!ok) return $"\"{recipient.Label ?? recipient.Value}\" is not a valid recipient.";
        }
        return recipients.Any(r => r.Kind == "To") ? null : "Add at least one recipient in To.";
    }
}
