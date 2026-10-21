using System.Text.RegularExpressions;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai;

/// <summary>
/// Key findings and the insight report for Ask Data answers, which are SQL with no query spec: the spec
/// <see cref="Insights"/> needs is read from the answer itself. Columns holding text or dates (and number columns named
/// like a period, e.g. "year") are the groups; the first number column whose value varies is the measure. It adds up
/// (totals and shares make sense) only when the SQL computes it with COUNT or SUM.
/// </summary>
public static partial class AskDataInsights
{
    private const string Rejected = "(rejected, not used for the answer)";

    [GeneratedRegex(@"^(year|yr|month|quarter|qtr|week|period)(_?(no|num|number))?$|_(year|month|quarter|week)$", RegexOptions.IgnoreCase)]
    private static partial Regex PeriodColumn();

    /// <summary>The spec of a grouped answer with a number per group (at least 3 rows), else null.</summary>
    public static AiQuerySpec? Spec(string? sql, AiQueryResult result)
    {
        if (result.Rows.Count < 3) return null;
        var groups = result.Columns.Where(c => !IsNumber(result, c) || PeriodColumn().IsMatch(c)).ToList();
        // A number that is the same in every row (e.g. COUNT(*) OVER () as a total) says nothing per group.
        var measure = result.Columns.FirstOrDefault(c => IsNumber(result, c) && !groups.Contains(c)
            && result.Rows.Select(r => QuerySpecEngine.Num(r.GetValueOrDefault(c))).Distinct().Count() > 1);
        if (groups.Count == 0 || measure is null) return null;
        return new AiQuerySpec(null, groups, [new AiMeasure(Agg(sql, measure), measure, measure)], null, null, null);
    }

    /// <summary>The SQL the answer was built from, from its saved trace: the last query step not marked rejected
    /// (AiAskService.AskDataAsync writes them as "sql\n42 rows").</summary>
    public static string? AcceptedSql(IReadOnlyList<AiTraceStep>? trace)
    {
        var detail = trace?.LastOrDefault(s => s.Step == "query" && s.Detail is { } d && !d.EndsWith(Rejected, StringComparison.Ordinal))?.Detail;
        var cut = detail?.LastIndexOf('\n') ?? -1;
        return cut > 0 ? detail![..cut].Trim() : null;
    }

    private static bool IsNumber(AiQueryResult result, string column)
    {
        var values = result.Rows.Select(r => r.GetValueOrDefault(column)).Where(v => v is not null).ToList();
        return values.Count > 0 && values.All(v => v is long or int or short or double or float or decimal);
    }

    /// <summary>count or sum when the SQL computes the column that way, else avg (no totals or shares).</summary>
    private static string Agg(string? sql, string alias)
    {
        var m = Regex.Match(sql ?? "", $@"\b(count_big|count|sum|avg|min|max)\s*\((?:(?!\bas\b).)*?\)\s*(?:as\s+)?\[?{Regex.Escape(alias)}\]?(?!\w)",
            RegexOptions.IgnoreCase | RegexOptions.Singleline);
        if (!m.Success) return "avg";
        var agg = m.Groups[1].Value.ToLowerInvariant();
        return agg == "count_big" ? "count" : agg;
    }
}
