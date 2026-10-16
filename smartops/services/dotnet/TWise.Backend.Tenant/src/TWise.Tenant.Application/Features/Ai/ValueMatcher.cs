using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace TWise.Tenant.Application.Features.Ai;

/// <summary>A stored value that contains one of the question's search words.</summary>
public sealed record AiValueMatch(string Term, string Column, string Value, long Count);

/// <summary>
/// Links words in a question to real values before the model is asked, so "wells in marmul" can
/// become cluster_name = 'Marmul' and not a guessed spelling (SuperSonic does the same "schema
/// mapping"). Only finds candidates; the model still decides which one the question means.
/// </summary>
public static partial class ValueMatcher
{
    public const int MaxTerms = 8;
    public const int MaxMatchesPerTerm = 5;

    private static readonly HashSet<string> StopWords = new(StringComparer.OrdinalIgnoreCase)
    {
        "the","and","for","with","from","that","this","what","which","who","whom","whose","where","when","how","why",
        "are","was","were","is","be","been","has","have","had","does","did","do","can","could","should","would","will",
        "show","list","give","tell","find","get","display","me","us","our","all","any","each","every","per","by","of","in","on",
        "at","to","as","or","not","no","than","then","there","their","its","into","over","under","between","about","only",
        "total","sum","count","number","many","much","average","avg","mean","max","maximum","min","minimum","highest","lowest",
        "top","bottom","most","least","more","less","greater","smaller","rows","row","records","record","value","values",
        "year","month","week","day","date","today","last","first","next","previous","current","this","those","these",
        "group","grouped","breakdown","split","trend","compare","comparison","percent","percentage","ratio","rate",
    };

    [GeneratedRegex(@"""([^""]{2,60})""|'([^']{2,60})'")]
    private static partial Regex Quoted();

    [GeneratedRegex(@"[\p{L}\p{N}][\p{L}\p{N}\-/&.]*")]
    private static partial Regex Word();

    /// <summary>
    /// Search words: quoted phrases first, then words of 3+ characters that are not common words
    /// or column names, then two-word phrases of those words. Pure numbers under 4 digits are
    /// skipped (they match too much: "top 10").
    /// </summary>
    public static IReadOnlyList<string> Terms(string question, IReadOnlyList<string> columns)
    {
        var columnWords = new HashSet<string>(columns.SelectMany(c => Word().Matches(c.Replace('_', ' ')).Select(m => m.Value)), StringComparer.OrdinalIgnoreCase);
        var terms = new List<string>();
        void Add(string t)
        {
            t = t.Trim().Trim('.', ',', '?', '!');
            if (t.Length >= 2 && !terms.Contains(t, StringComparer.OrdinalIgnoreCase)) terms.Add(t);
        }

        foreach (Match m in Quoted().Matches(question)) Add(m.Groups[1].Success ? m.Groups[1].Value : m.Groups[2].Value);
        var rest = Quoted().Replace(question, " ");

        var words = Word().Matches(rest).Select(m => m.Value.Trim('.', '-', '/'))
            .Where(w => w.Length >= 3 && !StopWords.Contains(w) && !columnWords.Contains(w)
                        && !(w.All(char.IsDigit) && w.Length < 4))
            .ToList();
        // Words first so none is crowded out; two-word phrases fill the remaining slots. A value that
        // contains a phrase is credited to the phrase (Assign prefers the longest term).
        foreach (var w in words) if (terms.Count < MaxTerms) Add(w);
        for (var i = 0; i + 1 < words.Count && terms.Count < MaxTerms; i++) Add($"{words[i]} {words[i + 1]}");
        return terms;
    }

    /// <summary>Matches in rows held in memory (imports, small views, batch views).</summary>
    public static IReadOnlyList<AiValueMatch> FindInRows(IReadOnlyList<string> terms, IEnumerable<IReadOnlyDictionary<string, object?>> rows, IReadOnlyList<string> textColumns)
    {
        if (terms.Count == 0 || textColumns.Count == 0) return [];
        var counts = new Dictionary<(string Column, string Value), long>();
        foreach (var row in rows)
            foreach (var c in textColumns)
            {
                if (!row.TryGetValue(c, out var raw)) continue;
                var v = raw is JsonElement e ? (e.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined ? null : e.ToString()) : raw?.ToString();
                if (string.IsNullOrEmpty(v) || v.Length > 200) continue;
                if (!terms.Any(t => v.Contains(t, StringComparison.OrdinalIgnoreCase))) continue;
                counts[(c, v)] = counts.GetValueOrDefault((c, v)) + 1;
            }
        return Assign(terms, counts.Select(kv => (kv.Key.Column, kv.Key.Value, kv.Value)));
    }

    /// <summary>Gives each found value to the most specific search word it contains, best first.</summary>
    public static IReadOnlyList<AiValueMatch> Assign(IReadOnlyList<string> terms, IEnumerable<(string Column, string Value, long Count)> found)
    {
        var result = new List<AiValueMatch>();
        foreach (var (column, value, count) in found)
        {
            var contained = terms.Where(t => value.Contains(t, StringComparison.OrdinalIgnoreCase)).ToList();
            if (contained.Count == 0) continue;
            // A value holding several of the question's words ("Marmul Flowline" for "marmul ... flowline")
            // is the strongest candidate, so it is listed under those words together.
            var words = contained.Where(t => !t.Contains(' ')).ToList();
            var term = words.Count > 1 ? string.Join(" ", words) : contained.OrderByDescending(t => t.Length).First();
            result.Add(new AiValueMatch(term, column, value, count));
        }
        return result
            .GroupBy(m => m.Term, StringComparer.OrdinalIgnoreCase)
            // Exact matches first, then the most common values.
            .SelectMany(g => g.OrderByDescending(m => string.Equals(m.Value, m.Term, StringComparison.OrdinalIgnoreCase))
                              .ThenByDescending(m => m.Count).ThenBy(m => m.Value).Take(MaxMatchesPerTerm))
            .ToList();
    }

    /// <summary>Single words and quoted phrases with no match, unless a matched phrase already covers them.</summary>
    public static IReadOnlyList<string> Unmatched(IReadOnlyList<string> terms, IReadOnlyList<AiValueMatch> matches, string question)
    {
        var matched = matches.SelectMany(m => m.Term.Split(' ').Append(m.Term)).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var quoted = Quoted().Matches(question).Select(m => m.Groups[1].Success ? m.Groups[1].Value : m.Groups[2].Value).ToHashSet(StringComparer.OrdinalIgnoreCase);
        return terms.Where(t => !matched.Contains(t)
                && (quoted.Contains(t) || !t.Contains(' '))
                && !matched.Any(m => m.Contains(t, StringComparison.OrdinalIgnoreCase)))
            .ToList();
    }

    /// <summary>Prompt block: "- "marmul": cluster_name = 'Marmul' (1,427 rows); plant_description = 'Marmul ODC' (935 rows)".</summary>
    public static string Describe(IReadOnlyList<AiValueMatch> matches, IReadOnlyList<string> unmatchedTerms)
    {
        if (matches.Count == 0 && unmatchedTerms.Count == 0) return "";
        var sb = new StringBuilder();
        if (matches.Count > 0)
        {
            sb.Append("Values in this dataset that match words in the question (filter on these exact values; pick the column that fits the question):\n");
            foreach (var g in matches.GroupBy(m => m.Term, StringComparer.OrdinalIgnoreCase))
                sb.Append("- \"").Append(g.Key).Append("\": ")
                  .Append(string.Join("; ", g.Select(m => $"{m.Column} = '{m.Value}' ({m.Count.ToString("N0", CultureInfo.InvariantCulture)} {(m.Count == 1 ? "row" : "rows")})")))
                  .Append('\n');
        }
        if (unmatchedTerms.Count > 0)
            sb.Append("No stored value contains: ").Append(string.Join(", ", unmatchedTerms.Select(t => $"\"{t}\""))).Append(" (not a filter value; it may describe a column or a measure).\n");
        return sb.ToString();
    }
}
