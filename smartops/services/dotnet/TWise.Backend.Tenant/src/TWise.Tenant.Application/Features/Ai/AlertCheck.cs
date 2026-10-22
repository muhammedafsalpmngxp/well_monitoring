using TWise.Tenant.Domain.DTOs;
using static TWise.Tenant.Application.Features.Ai.Insights;

namespace TWise.Tenant.Application.Features.Ai;

/// <summary>
/// Decides whether a watched answer needs attention. It watches the first measure (per group when the
/// query groups rows) or, for a row list, the number of rows. Above/below compare with the user's limit;
/// unusual compares a single number with its own past checks, or each group with the others, using the
/// same robust rule as the insight report (step 8); change compares a single number with the previous
/// check and fires when it moved by more than the limit in percent. No AI involved.
/// </summary>
public static class AlertCheck
{
    private static AlertOutcome Capitalized(AlertOutcome o) => o with { Message = Wording.Sentence(o.Message) };

    public const string Above = "above";
    public const string Below = "below";
    public const string Unusual = "unusual";
    public const string Change = "change";

    public static bool IsKind(string kind) => kind is Above or Below or Unusual or Change;

    /// <summary>Value is the single number watched (kept as history for "unusual"); null for grouped answers.</summary>
    public static AlertOutcome Evaluate(string kind, double? limit, AiQuerySpec spec, AiQueryResult result, IReadOnlyList<double> history, AiAlertOptions options)
    {
        var measure = spec.Measures is { Count: > 0 } m ? m[0].Alias ?? m[0].Agg : null;
        if (measure is null || spec.GroupBy is not { Count: > 0 } groups)
        {
            var value = measure is null ? result.TotalRows
                : result.Rows.Count > 0 ? QuerySpecEngine.Num(result.Rows[0].GetValueOrDefault(measure)) ?? 0 : 0;
            return Capitalized(Single(kind, limit, measure is null ? "number of rows" : Wording.Words(measure), value, history, options));
        }
        var points = result.Rows
            .Select(r => (label: string.Join(" / ", groups.Select(g => Label(r.GetValueOrDefault(g)))), value: QuerySpecEngine.Num(r.GetValueOrDefault(measure))))
            .Where(p => p.value is not null).Select(p => (p.label, value: p.value!.Value)).ToList();
        return Capitalized(Grouped(kind, limit, Wording.Words(measure), points, options));
    }

    private static AlertOutcome Single(string kind, double? limit, string name, double value, IReadOnlyList<double> history, AiAlertOptions options)
    {
        if (kind == Change)
        {
            if (history.Count == 0) return new(false, value, $"{name} is {N(value)}. The next check compares with this value.");
            var prev = history[^1];
            var pct = prev == 0 ? (value == 0 ? 0 : double.PositiveInfinity) : Math.Abs(value - prev) / Math.Abs(prev) * 100;
            var moved = pct > (limit ?? 0);
            var by = double.IsInfinity(pct) ? "from 0" : $"by {N(pct)}% ({N(prev)} → {N(value)})";
            return new(moved, value, moved ? $"{name} changed {by}, more than the {N(limit ?? 0)}% allowed." : $"{name} is {N(value)}, {(prev == value ? "unchanged" : $"changed {by}")} (limit: {N(limit ?? 0)}%).");
        }
        if (kind == Unusual)
        {
            if (history.Count < options.MinHistory)
                // This check is stored too, so it counts as one of the learning checks.
                return new(false, value, $"{name} is {N(value)}. Learning the usual range ({history.Count + 1} of {options.MinHistory} checks done).");
            var median = Median(history);
            var mad = Median(history.Select(h => Math.Abs(h - median)));
            // A value that never moved is unusual as soon as it changes.
            var unusual = mad == 0 ? value != median : IsUnusual(value, median, mad, options.UnusualScore);
            return unusual
                ? new(true, value, $"{name} is {N(value)}, unusually {(value > median ? "high" : "low")}; usually about {N(median)}.")
                : new(false, value, $"{name} is {N(value)}, within the usual range (about {N(median)}).");
        }
        var t = limit ?? 0;
        var crossed = kind == Above ? value > t : value < t;
        return new(crossed, value, crossed ? $"{name} is {N(value)}, {kind} the limit of {N(t)}." : $"{name} is {N(value)} (limit: {kind} {N(t)}).");
    }

    private static AlertOutcome Grouped(string kind, double? limit, string name, List<(string label, double value)> points, AiAlertOptions options)
    {
        List<(string label, double value)> hits;
        string rule;
        if (kind == Change) return new(false, null, "Change watching needs a single-number answer; this answer has groups.");
        if (kind == Unusual)
        {
            if (points.Count < options.MinHistory) return new(false, null, $"Only {points.Count} groups; at least {options.MinHistory} are needed to spot unusual ones.");
            var median = Median(points.Select(p => p.value));
            var mad = Median(points.Select(p => Math.Abs(p.value - median)));
            hits = points.Where(p => IsUnusual(p.value, median, mad, options.UnusualScore)).OrderByDescending(p => Math.Abs(p.value - median)).ToList();
            rule = $"unusual (typical {name} {N(median)})";
        }
        else
        {
            var t = limit ?? 0;
            hits = points.Where(p => kind == Above ? p.value > t : p.value < t).OrderByDescending(p => kind == Above ? p.value : -p.value).ToList();
            rule = $"{kind} {N(t)}";
        }
        if (hits.Count == 0) return new(false, null, $"No group is {rule} ({points.Count} groups checked).");
        var list = string.Join(", ", hits.Take(options.MaxListed).Select(h => $"{h.label} ({N(h.value)})")) + (hits.Count > options.MaxListed ? ", …" : "");
        return new(true, null, $"{hits.Count} of {points.Count} groups {rule}: {list}.");
    }
}

public record AlertOutcome(bool Fired, double? Value, string Message);
