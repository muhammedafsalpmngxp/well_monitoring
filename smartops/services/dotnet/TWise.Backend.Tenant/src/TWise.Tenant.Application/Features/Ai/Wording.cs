using System.Text.RegularExpressions;

namespace TWise.Tenant.Application.Features.Ai;

/// <summary>
/// Text shown to people reads as plain English: sentences start with a capital and end with a stop,
/// and database names become words (plant_description → plant description).
/// </summary>
public static partial class Wording
{
    [GeneratedRegex(@"(?<=[a-z\d])(?=[A-Z])|[_.\-]+")]
    private static partial Regex WordBreak();

    /// <summary>A column or measure name as words; names that already contain spaces are kept.</summary>
    public static string Words(string name) =>
        string.IsNullOrWhiteSpace(name) || name.Contains(' ') ? name : string.Join(' ', WordBreak().Split(name).Where(w => w.Length > 0));

    /// <summary>First letter upper case; no stop added (for labels).</summary>
    public static string Capitalize(string text)
    {
        var t = (text ?? "").Trim();
        return t.Length == 0 ? t : char.ToUpperInvariant(t[0]) + t[1..];
    }

    /// <summary>Capitalized and ending with a stop (or the given mark) unless it already ends with one.</summary>
    public static string Sentence(string text, char end = '.')
    {
        var t = Capitalize(text);
        return t.Length == 0 || t[^1] is '.' or '?' or '!' ? t : t + end;
    }
}
