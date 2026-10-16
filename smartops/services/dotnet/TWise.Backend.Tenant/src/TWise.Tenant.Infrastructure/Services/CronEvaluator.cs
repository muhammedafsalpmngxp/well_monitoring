using Cronos;
using TWise.Tenant.Application.Abstractions.Services;

namespace TWise.Tenant.Infrastructure.Services;

/// <summary>
/// Cron evaluation via Cronos, which resolves fire times against a real time zone rather
/// than naive interval arithmetic — so a "daily at 02:00" schedule stays at 02:00 local
/// across a DST transition instead of drifting by an hour twice a year.
///
/// Expressions are standard 5-field cron (minute hour day-of-month month day-of-week).
/// </summary>
public sealed class CronEvaluator : ICronEvaluator
{
    /// <summary>Guards against an expression that fires far in the future or never again.</summary>
    private const int MaxLookaheadOccurrences = 100;

    public DateTime? GetNextOccurrence(string cronExpression, string timeZoneId, DateTime fromUtc)
    {
        if (!TryParse(cronExpression, timeZoneId, out var expression, out var timeZone, out _))
            return null;

        // Cronos requires a UTC-kinded instant; a DateTime read back from SQL Server is
        // Unspecified, which would otherwise throw.
        var from = DateTime.SpecifyKind(fromUtc, DateTimeKind.Utc);

        // This overload already returns a UTC DateTime.
        return expression!.GetNextOccurrence(from, timeZone!, inclusive: false);
    }

    public string? Validate(string cronExpression, string timeZoneId)
    {
        TryParse(cronExpression, timeZoneId, out _, out _, out var error);
        return error;
    }

    public IReadOnlyList<DateTime> GetNextOccurrences(string cronExpression, string timeZoneId, DateTime fromUtc, int count)
    {
        if (!TryParse(cronExpression, timeZoneId, out var expression, out var timeZone, out _))
            return [];

        var results = new List<DateTime>();
        var cursor = DateTime.SpecifyKind(fromUtc, DateTimeKind.Utc);
        var safetyLimit = Math.Min(count, MaxLookaheadOccurrences);

        for (var i = 0; i < safetyLimit; i++)
        {
            var next = expression!.GetNextOccurrence(cursor, timeZone!, inclusive: false);
            if (next is null) break;

            results.Add(next.Value);
            cursor = next.Value;
        }

        return results;
    }

    private static bool TryParse(
        string cronExpression, string timeZoneId,
        out CronExpression? expression, out TimeZoneInfo? timeZone, out string? error)
    {
        expression = null;
        timeZone = null;
        error = null;

        if (string.IsNullOrWhiteSpace(cronExpression))
        {
            error = "A cron expression is required.";
            return false;
        }

        try
        {
            expression = CronExpression.Parse(cronExpression.Trim(), CronFormat.Standard);
        }
        catch (CronFormatException ex)
        {
            error = $"'{cronExpression}' is not a valid cron expression. {ex.Message}";
            return false;
        }

        try
        {
            timeZone = string.IsNullOrWhiteSpace(timeZoneId)
                ? TimeZoneInfo.Utc
                : TimeZoneInfo.FindSystemTimeZoneById(timeZoneId.Trim());
        }
        catch (Exception ex) when (ex is TimeZoneNotFoundException or InvalidTimeZoneException)
        {
            error = $"'{timeZoneId}' is not a recognised time zone on this server.";
            return false;
        }

        return true;
    }
}
