using System.Globalization;
using System.Text.RegularExpressions;

namespace TWise.Tenant.Application.Features.Delivery;

/// <summary>
/// The tokens a subject and message may hold: {{name}}, {{item}}, {{run_date}}, {{run_time}}, {{link}} and {{owner}}.
/// Unknown tokens stay as typed.
/// </summary>
public static partial class MessageTokens
{
    [GeneratedRegex(@"\{\{(\w+)\}\}")]
    private static partial Regex Token();

    public static string Apply(string text, IReadOnlyDictionary<string, string> values)
        => Token().Replace(text, m => values.TryGetValue(m.Groups[1].Value, out var value) ? value : m.Value);

    /// <summary>The token values of one run. The run date and time are read in the schedule's time zone.</summary>
    public static IReadOnlyDictionary<string, string> Values(
        string scheduleName, string? item, DateTime runAtUtc, string timeZone, string link, string? owner)
    {
        var local = TimeZoneInfo.TryFindSystemTimeZoneById(timeZone, out var zone)
            ? TimeZoneInfo.ConvertTimeFromUtc(Recurrence.AsUtc(runAtUtc), zone)
            : runAtUtc;
        return new Dictionary<string, string>
        {
            ["name"] = scheduleName,
            ["item"] = item ?? string.Empty,
            ["run_date"] = local.ToString("dd MMM yyyy", CultureInfo.InvariantCulture),
            ["run_time"] = local.ToString("HH:mm", CultureInfo.InvariantCulture),
            ["link"] = link,
            ["owner"] = owner ?? string.Empty,
        };
    }
}
