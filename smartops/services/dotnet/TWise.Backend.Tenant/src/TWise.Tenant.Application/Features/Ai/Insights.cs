using System.Globalization;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai;

/// <summary>
/// Findings worked out in code from a grouped answer (SuperSonic's insight report): the trend over
/// time, the highest and lowest groups, their share of the total and outliers. The model then writes
/// the answer from these checked numbers instead of doing the arithmetic itself.
/// </summary>
public record InsightReport(IReadOnlyList<string> Trend, IReadOnlyList<string> Findings, IReadOnlyList<string> Anomalies);

public static class Insights
{
    public const int MaxOutliers = 3;
    private static readonly string[] MonthFormats = ["yyyy-MM", "yyyy-M", "MMM yyyy", "MMMM yyyy", "MMM-yy", "MMM-yyyy"];

    /// <summary>Empty unless the answer groups rows and has a number per group (at least 3 groups).</summary>
    public static IReadOnlyList<string> Find(AiQuerySpec spec, AiQueryResult result) => Collect(spec, result).Select(f => f.text).ToList();

    /// <summary>The same facts split for the insight report: trend over time, other findings, anomalies (outliers, missing data).</summary>
    public static InsightReport Report(AiQuerySpec spec, AiQueryResult result)
    {
        var facts = Collect(spec, result);
        return new(facts.Where(f => f.kind == Kind.Trend).Select(f => f.text).ToList(),
                   facts.Where(f => f.kind == Kind.Finding).Select(f => f.text).ToList(),
                   facts.Where(f => f.kind == Kind.Anomaly).Select(f => f.text).ToList());
    }

    private enum Kind { Finding, Trend, Anomaly }

    private static List<(string text, Kind kind)> Collect(AiQuerySpec spec, AiQueryResult result)
    {
        if (spec.GroupBy is not { Count: > 0 } groups || spec.Measures is not { Count: > 0 } measures) return [];
        var m = measures[0];
        var key = m.Alias ?? m.Agg;
        var name = Wording.Words(key);
        var points = result.Rows
            .Select(r => (label: string.Join(" / ", groups.Select(g => Label(r.GetValueOrDefault(g)))),
                          key: r.GetValueOrDefault(groups[0]), value: QuerySpecEngine.Num(r.GetValueOrDefault(key))))
            .Where(p => p.value is not null)
            .Select(p => (p.label, p.key, value: p.value!.Value)).ToList();
        if (points.Count < 3) return [];

        var facts = new List<(string text, Kind kind)>();
        void Add(string text, Kind kind = Kind.Finding) => facts.Add((Wording.Sentence(text), kind));
        if (result.TotalRows > result.Rows.Count) Add($"Only the first {result.Rows.Count} of {result.TotalRows} groups were checked.");
        var additive = m.Agg is "count" or "sum";
        var total = points.Sum(p => p.value);
        // A large group with no value is usually the real story (missing data), so say so — even when
        // it is the highest group, because "Highest: (blank)" alone does not tell the reader why.
        var blank = points.FirstOrDefault(p => p.label == Blank);
        if (blank.label is not null && blank.value > 0)
        {
            if (additive && total > 0 && blank.value / total >= 0.1)
                Add($"{N(blank.value)} ({P(blank.value / total)}) have no {Wording.Words(groups[0])}.", Kind.Anomaly);
            else if (!additive && blank.value >= Median(points.Select(p => p.value)))
                Add($"{N(blank.value)} have no {Wording.Words(groups[0])}; missing data, not a real group.", Kind.Anomaly);
        }

        // Highest and lowest are meaningless when every group has the same value.
        if (points.All(p => p.value == points[0].value))
        {
            Add($"All {points.Count} groups have the same {name}: {N(points[0].value)}.");
            if (additive) Add($"{TotalOf(name)} across {points.Count} groups: {N(total)}.");
            return facts;
        }

        var times = groups.Count == 1 ? points.Select(p => Time(p.key, groups[0])).ToList() : [];
        if (times.Count > 0 && times.All(t => t is not null))
        {
            var series = points.Zip(times, (p, t) => (p.label, p.value, time: t!.Value)).OrderBy(x => x.time).ToList();
            var (first, last) = (series[0], series[^1]);
            Add($"{name} went from {N(first.value)} in {first.label} to {N(last.value)} in {last.label}{Change(first.value, last.value)}.", Kind.Trend);
            var peak = series.MaxBy(x => x.value); var low = series.MinBy(x => x.value);
            Add($"Highest in {peak.label} ({N(peak.value)}), lowest in {low.label} ({N(low.value)}).", Kind.Trend);
            var jump = series.Zip(series.Skip(1)).MaxBy(x => Math.Abs(x.Second.value - x.First.value));
            Add($"Biggest change between periods: {jump.First.label} to {jump.Second.label}{Change(jump.First.value, jump.Second.value)}.", Kind.Trend);
        }
        else
        {
            var max = points.Max(p => p.value); var min = points.Min(p => p.value);
            Add($"Highest {name}: {Tied(points, max)}{Share(max, total, additive)}.");
            Add($"Lowest {name}: {Tied(points, min)}{Share(min, total, additive)}.");
            if (additive) Add($"{TotalOf(name)} across {points.Count} groups: {N(total)}.");
            if (additive && points.Count >= 6 && total > 0)
                Add($"The top 3 groups make up {P(points.OrderByDescending(p => p.value).Take(3).Sum(p => p.value) / total)} of the total.");
        }

        // Robust outliers: far from the median in units of the median absolute deviation.
        if (points.Count >= 5)
        {
            var median = Median(points.Select(p => p.value));
            var mad = Median(points.Select(p => Math.Abs(p.value - median)));
            foreach (var p in points.Where(p => IsUnusual(p.value, median, mad)).OrderByDescending(p => Math.Abs(p.value - median)).Take(MaxOutliers))
                Add($"{p.label} ({N(p.value)}) is unusually {(p.value > median ? "high" : "low")}; the typical value is {N(median)}.", Kind.Anomaly);
        }
        return facts;
    }

    internal const string Blank = "(blank)";

    /// <summary>A group value for people: empty or missing values read "(blank)".</summary>
    internal static string Label(object? v) => v?.ToString() is { } s && !string.IsNullOrWhiteSpace(s) ? s : Blank;

    /// <summary>
    /// Copies of the rows with empty group values written as "(blank)", for the AI that words the answer,
    /// so it says "(blank)" like the table and the findings instead of "null".
    /// </summary>
    public static IEnumerable<Dictionary<string, object?>> WithBlankLabels(AiQuerySpec spec, IEnumerable<Dictionary<string, object?>> rows)
    {
        var groups = spec.GroupBy ?? [];
        return groups.Count == 0 ? rows : rows.Select(r =>
        {
            var copy = new Dictionary<string, object?>(r);
            foreach (var g in groups) if (copy.ContainsKey(g)) copy[g] = Label(copy[g]);
            return copy;
        });
    }

    /// <summary>"A with 9", or every group sharing the value: "A and B with 0 each" (at most 3 named).</summary>
    private static string Tied(List<(string label, object? key, double value)> points, double value)
    {
        var names = points.Where(p => p.value == value).Select(p => p.label).ToList();
        if (names.Count == 1) return $"{names[0]} with {N(value)}";
        var shown = names.Take(3).ToList();
        var list = names.Count > 3 ? $"{string.Join(", ", shown)} and {names.Count - 3} more" : $"{string.Join(", ", shown[..^1])} and {shown[^1]}";
        return $"{list} with {N(value)} each";
    }

    /// <summary>"Total n", but just "Total" when the measure is already called total (no "Total total").</summary>
    private static string TotalOf(string name) =>
        name.StartsWith("total", StringComparison.OrdinalIgnoreCase) ? "Total" : $"Total {name}";

    /// <summary>Robust z-score above 3.5 (median and median absolute deviation), so one huge value cannot hide itself.</summary>
    internal static bool IsUnusual(double value, double median, double mad) => IsUnusual(value, median, mad, 3.5);

    /// <summary>Same rule with the score from settings (alerts: AiAlerts:UnusualScore). 0.6745 makes the MAD comparable to a standard deviation.</summary>
    internal static bool IsUnusual(double value, double median, double mad, double score) =>
        mad > 0 && Math.Abs(0.6745 * (value - median) / mad) > score;

    /// <summary>A period from a date value, a month label like 2025-03 or Mar 2025, or a year in a column named like "year".</summary>
    private static DateTime? Time(object? v, string column)
    {
        if (v is DateTime dt) return dt;
        var s = v?.ToString()?.Trim();
        if (string.IsNullOrEmpty(s)) return null;
        if (column.Contains("year", StringComparison.OrdinalIgnoreCase) && int.TryParse(s, out var y) && y is >= 1900 and <= 2100) return new DateTime(y, 1, 1);
        if (DateTime.TryParseExact(s, MonthFormats, CultureInfo.InvariantCulture, DateTimeStyles.None, out var d)) return d;
        return s.Length >= 8 && DateTime.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.None, out d) ? d : null;
    }

    internal static double Median(IEnumerable<double> values)
    {
        var v = values.Order().ToList();
        return v.Count % 2 == 1 ? v[v.Count / 2] : (v[v.Count / 2 - 1] + v[v.Count / 2]) / 2;
    }

    private static string Change(double from, double to) =>
        from == 0 ? "" : $" ({(to >= from ? "+" : "")}{P((to - from) / Math.Abs(from))})";

    private static string Share(double value, double total, bool additive) =>
        additive && total > 0 ? $", {P(value / total)} of the total" : "";

    public static string N(double v) => v.ToString("#,##0.##", CultureInfo.InvariantCulture);

    private static string P(double ratio) => (ratio * 100).ToString("0.#", CultureInfo.InvariantCulture) + "%";
}
