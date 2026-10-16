using Cronos;

namespace TWise.Tenant.Application.Features.Delivery;

/// <summary>
/// When a schedule runs: a five-field cron read in an IANA time zone, or once at RunOnceAt. StartAt and EndAt bound a
/// cron. Every time is UTC; a time of another kind is read as UTC.
/// </summary>
public sealed record RecurrenceSpec(string? Cron, DateTime? RunOnceAt, string TimeZone, DateTime? StartAt, DateTime? EndAt);

public static class Recurrence
{
    /// <summary>Why the spec cannot be run, or null when it can.</summary>
    public static string? Problem(RecurrenceSpec spec)
    {
        if (Zone(spec.TimeZone) is null) return $"The time zone \"{spec.TimeZone}\" is not known. Use an IANA name such as Asia/Muscat.";
        if (string.IsNullOrWhiteSpace(spec.Cron)) return spec.RunOnceAt is null ? "Choose when the schedule runs." : null;
        try
        {
            CronExpression.Parse(spec.Cron.Trim(), CronFormat.Standard);
            return null;
        }
        catch (CronFormatException ex)
        {
            return $"The cron expression is not valid: {ex.Message}";
        }
    }

    /// <summary>The first run after fromUtc, or null when none is left. The spec must have no Problem.</summary>
    public static DateTime? Next(RecurrenceSpec spec, DateTime fromUtc) => Upcoming(spec, fromUtc).FirstOrDefault();

    /// <summary>Up to five runs after fromUtc, for the dialog's preview.</summary>
    public static IReadOnlyList<DateTime> NextFive(RecurrenceSpec spec, DateTime fromUtc)
        => Upcoming(spec, fromUtc).Take(5).Select(t => t!.Value).ToList();

    private static IEnumerable<DateTime?> Upcoming(RecurrenceSpec spec, DateTime fromUtc)
    {
        var from = AsUtc(fromUtc);
        var end = spec.EndAt is { } e ? AsUtc(e) : (DateTime?)null;
        if (string.IsNullOrWhiteSpace(spec.Cron))
        {
            if (spec.RunOnceAt is { } once && AsUtc(once) > from && (end is null || AsUtc(once) <= end)) yield return AsUtc(once);
            yield break;
        }

        var cron = CronExpression.Parse(spec.Cron.Trim(), CronFormat.Standard);
        var zone = Zone(spec.TimeZone)!;
        // The start itself may be a run; any other from is exclusive, so a run just made is not made again.
        var inclusive = spec.StartAt is { } s && AsUtc(s) > from;
        var cursor = inclusive ? AsUtc(spec.StartAt!.Value) : from;
        while (cron.GetNextOccurrence(cursor, zone, inclusive) is { } next && (end is null || next <= end))
        {
            yield return next;
            cursor = next;
            inclusive = false;
        }
    }

    private static TimeZoneInfo? Zone(string? id)
        => !string.IsNullOrWhiteSpace(id) && TimeZoneInfo.TryFindSystemTimeZoneById(id.Trim(), out var zone) ? zone : null;

    /// <summary>A local time converted to UTC; a time without a kind (as SQL Server returns it) read as UTC.</summary>
    public static DateTime AsUtc(DateTime value) => value.Kind switch
    {
        DateTimeKind.Utc => value,
        DateTimeKind.Local => value.ToUniversalTime(),
        _ => DateTime.SpecifyKind(value, DateTimeKind.Utc),
    };
}
