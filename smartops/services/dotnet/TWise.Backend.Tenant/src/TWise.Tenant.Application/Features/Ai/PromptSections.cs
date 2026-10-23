using System.Text.RegularExpressions;

namespace TWise.Tenant.Application.Features.Ai;

/// <summary>
/// A merged prompt: one prompt that replaced several earlier ones, written as a "## name" heading per earlier prompt
/// followed by that prompt's text (the name is its key without the feature prefix, e.g. "tool_milestones"). The agent
/// runtime reads each section by name (app/features/dailyreport/texts.py, the same heading rule); the Tenant API keeps
/// the headings on every save and, when a tenant first gets a merged prompt, carries the tenant's saved edit of each
/// earlier prompt into its section so no edit is lost.
/// </summary>
public static partial class PromptSections
{
    /// <summary>The sections of a text in order: (name, text trimmed). Text before the first heading belongs to none.</summary>
    public static IReadOnlyList<(string Name, string Body)> Parse(string? text)
    {
        var sections = new List<(string Name, List<string> Lines)>();
        foreach (var line in (text ?? "").Replace("\r\n", "\n").Split('\n'))
        {
            var heading = Heading().Match(line);
            if (heading.Success) sections.Add((heading.Groups[1].Value, []));
            else if (sections.Count > 0) sections[^1].Lines.Add(line);
        }
        return sections.Select(s => (s.Name, string.Join("\n", s.Lines).Trim())).ToList();
    }

    /// <summary>The headings of a text, in order.</summary>
    public static IReadOnlyList<string> Headings(string? text) => Parse(text).Select(s => s.Name).ToList();

    /// <summary>The text for sections in order (the inverse of Parse for trimmed, non-empty bodies).</summary>
    public static string Serialize(IEnumerable<(string Name, string Body)> sections) =>
        string.Join("\n\n", sections.Select(s => $"## {s.Name}\n{s.Body}"));

    /// <summary>
    /// The merged prompt as a tenant should start with it: the seed, with each section replaced by the tenant's own
    /// live text of the earlier prompt it came from when that differs from the seed's. <paramref name="liveOf"/> gives
    /// a tenant's live text for an earlier key (null when it has none). Null when nothing differs (the seed stands).
    /// </summary>
    public static string? Carry(string mergedSeed, IEnumerable<string> earlierKeys, Func<string, string?> liveOf)
    {
        var sections = Parse(mergedSeed).Select(s => (s.Name, s.Body)).ToList();
        var changed = false;
        foreach (var key in earlierKeys)
        {
            var name = key[(key.IndexOf('.') + 1)..];
            var at = sections.FindIndex(s => s.Name == name);
            if (at < 0 || liveOf(key) is not { } own) continue;
            own = own.Trim();
            if (own.Length == 0 || own == sections[at].Body) continue;
            sections[at] = (name, own);
            changed = true;
        }
        return changed ? Serialize(sections) : null;
    }

    [GeneratedRegex(@"^##[ \t]+([a-z][a-z0-9_]*)[ \t]*$")]
    private static partial Regex Heading();
}
