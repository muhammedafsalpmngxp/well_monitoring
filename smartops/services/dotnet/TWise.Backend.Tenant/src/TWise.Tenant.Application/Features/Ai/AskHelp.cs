using System.Text.RegularExpressions;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Features.Ai;

/// <summary>
/// What to tell a user when a question fails or finds nothing: a plain reason instead of the
/// validator's or the database's wording, and questions that work on this dataset (SuperSonic's
/// "rewrite the error to teach the user how to ask" plus similar-question suggestions).
/// </summary>
public static partial class AskHelp
{
    public const int MaxSuggestions = 3;

    [GeneratedRegex(@"unknown column '([^']*)'", RegexOptions.IgnoreCase)]
    private static partial Regex UnknownColumn();

    /// <summary>A plain explanation of why no query could be built or run.</summary>
    public static string Friendly(string? error, IReadOnlyList<string> columns)
    {
        var e = error ?? "";
        var m = UnknownColumn().Match(e);
        if (m.Success)
        {
            var close = Closest(m.Groups[1].Value, columns);
            return $"This dataset has no column called \"{m.Groups[1].Value}\"."
                + (close.Count > 0 ? $" Did you mean {string.Join(", ", close.Select(c => $"\"{c}\""))}?" : "")
                + " Try naming one of its columns.";
        }
        if (e.Contains("unknown agg", StringComparison.OrdinalIgnoreCase))
            return "That calculation is not available here. You can ask for a count, a distinct count, a total, an average, a minimum or a maximum.";
        if (e.Contains("unknown op", StringComparison.OrdinalIgnoreCase))
            return "That kind of condition is not available here. Use equals, not equals, greater or less than, contains, one of a list, or empty / not empty.";
        if (e.Contains("groupBy needs", StringComparison.OrdinalIgnoreCase) || e.Contains("either select", StringComparison.OrdinalIgnoreCase))
            return "The question mixed a list of rows with totals. Ask for one: a list (\"show the wells in Marmul\") or a total (\"how many wells per cluster\").";
        if (e.Contains("took too long", StringComparison.OrdinalIgnoreCase))
            return "The question took too long on this dataset. Ask for fewer groups, or add a filter such as a cluster or a period.";
        if (e.Contains("not an output column", StringComparison.OrdinalIgnoreCase))
            return "The question asked to sort by something that is not in the answer. Sort by one of the grouped columns or by the total.";
        if (e.Contains("could not connect", StringComparison.OrdinalIgnoreCase))
            return "The dataset's database could not be reached right now. Try again in a moment.";
        return "The AI could not turn that question into a query on this dataset. Try naming a column and what to calculate, as in the suggestions below.";
    }

    /// <summary>
    /// Nothing matched: no rows, or a single total (no grouping) that is 0 or empty. A count always
    /// returns one row, so "how many in cluster Fahud?" gives one row with 0 – that is still nothing.
    /// </summary>
    public static bool FoundNothing(AiQuerySpec spec, AiQueryResult result)
    {
        if (result.Rows.Count == 0) return true;
        if (result.Rows.Count > 1 || spec.GroupBy is { Count: > 0 } || spec.Measures is not { Count: > 0 } measures) return false;
        return measures.All(m => QuerySpecEngine.Num(result.Rows[0].GetValueOrDefault(m.Alias ?? m.Agg)) is null or 0);
    }

    /// <summary>
    /// Up to three questions to try: this dataset's liked or approved examples that share words with
    /// the question, then simple questions built from its real columns.
    /// </summary>
    public static IReadOnlyList<string> Suggestions(string question, IReadOnlyList<AiExample> examples, IReadOnlyList<AiColumnStats> profiles)
    {
        var list = ExamplePicker.Pick(examples, question, MaxSuggestions + 1)
            .Select(e => e.Question.Trim())
            .Where(q => !string.Equals(q, question.Trim(), StringComparison.OrdinalIgnoreCase))
            .Distinct(StringComparer.OrdinalIgnoreCase).Take(MaxSuggestions).ToList();

        // A category to group by (few values) and a number to total, from the column profiles.
        var category = profiles.FirstOrDefault(p => p.Type == "text" && p.Distinct is >= 2 and <= ColumnProfiler.LowCardinality && p.TopValues.Count > 0);
        var number = profiles.FirstOrDefault(p => p.Type == "number" && p.Distinct > 1 && !LooksLikeId(p.Column));
        var templates = new List<string>();
        if (category is not null)
        {
            templates.Add($"How many rows per {Wording.Words(category.Column)}?");
            templates.Add($"How many rows where {Wording.Words(category.Column)} is {category.TopValues[0].Value}?");
        }
        if (category is not null && number is not null)
            templates.Insert(1, $"Total {Wording.Words(number.Column)} by {Wording.Words(category.Column)}");
        else if (number is not null)
            templates.Add($"What is the average {Wording.Words(number.Column)}?");

        foreach (var t in templates)
            if (list.Count < MaxSuggestions && !list.Contains(t, StringComparer.OrdinalIgnoreCase)) list.Add(t);
        return list;
    }

    /// <summary>Columns sharing a word with the name, or containing it, best first.</summary>
    private static List<string> Closest(string name, IReadOnlyList<string> columns)
    {
        static string[] Parts(string s) => Regex.Split(s.ToLowerInvariant(), @"[^\p{L}\p{N}]+").Where(w => w.Length > 1).ToArray();
        var wanted = Parts(name);
        return columns
            .Select(c => (c, score: Parts(c).Count(p => wanted.Any(w => w.Contains(p) || p.Contains(w)))))
            .Where(x => x.score > 0)
            .OrderByDescending(x => x.score).ThenBy(x => x.c.Length)
            .Take(3).Select(x => x.c).ToList();
    }

    private static bool LooksLikeId(string column) =>
        Regex.IsMatch(column, @"(^|[\s_.])(id|no|code|seq|number|key)$|^(sl|s)\.?\s*no$", RegexOptions.IgnoreCase);
}
