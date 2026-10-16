using System.Globalization;
using System.Text.Json;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai;

/// <summary>
/// Validates an AI-produced query spec against the dataset's columns and runs it over in-memory rows
/// (the same rows the Chart Builder aggregates in the browser). Pure and synchronous: no SQL, no I/O,
/// so a bad spec can never touch a database. Errors are InvalidOperationException with a message
/// that is fed back to the model for one auto-fix attempt.
/// </summary>
public static class QuerySpecEngine
{
    private static readonly string[] Aggs = ["count", "countDistinct", "sum", "avg", "min", "max"];
    private static readonly string[] Ops = ["eq", "neq", "gt", "gte", "lt", "lte", "contains", "in", "notNull", "isNull"];
    public const int MaxLimit = 500;

    public static AiQuerySpec Validate(AiQuerySpec spec, IReadOnlyList<string> columns)
    {
        var known = new HashSet<string>(columns, StringComparer.OrdinalIgnoreCase);
        string Col(string? c, string where)
        {
            if (string.IsNullOrWhiteSpace(c)) throw new InvalidOperationException($"{where}: column name is missing.");
            var match = columns.FirstOrDefault(k => string.Equals(k, c.Trim(), StringComparison.OrdinalIgnoreCase))
                ?? throw new InvalidOperationException($"{where}: unknown column '{c}'. Available columns: {string.Join(", ", columns)}.");
            return match;
        }

        var select = spec.Select?.Select(c => Col(c, "select")).Distinct().ToList() ?? [];
        var groupBy = spec.GroupBy?.Select(c => Col(c, "groupBy")).Distinct().ToList() ?? [];
        var measures = (spec.Measures ?? []).Select(m =>
        {
            var agg = Aggs.FirstOrDefault(a => string.Equals(a, m.Agg, StringComparison.OrdinalIgnoreCase))
                ?? throw new InvalidOperationException($"measures: unknown agg '{m.Agg}'. Use one of {string.Join(", ", Aggs)}.");
            var col = agg == "count" && string.IsNullOrWhiteSpace(m.Column) ? null : Col(m.Column, "measures");
            var alias = string.IsNullOrWhiteSpace(m.Alias) ? (col is null ? "count" : $"{agg}_{col}") : m.Alias.Trim();
            return new AiMeasure(agg, col, alias);
        }).ToList();
        var filters = (spec.Filters ?? []).Select(f =>
        {
            var op = Ops.FirstOrDefault(o => string.Equals(o, f.Op, StringComparison.OrdinalIgnoreCase))
                ?? throw new InvalidOperationException($"filters: unknown op '{f.Op}'. Use one of {string.Join(", ", Ops)}.");
            return new AiFilter(Col(f.Column, "filters"), op, f.Value);
        }).ToList();

        if (measures.Count == 0 && groupBy.Count > 0)
            throw new InvalidOperationException("groupBy needs at least one measure.");
        if (measures.Count > 0 && select.Count > 0)
            throw new InvalidOperationException("Use either select (raw rows) or groupBy+measures (aggregation), not both.");

        AiSort? sort = null;
        if (spec.Sort is not null && !string.IsNullOrWhiteSpace(spec.Sort.Column))
        {
            var outputs = measures.Count > 0 ? groupBy.Concat(measures.Select(m => m.Alias!)).ToList() : (select.Count > 0 ? select : columns.ToList());
            var s = outputs.FirstOrDefault(o => string.Equals(o, spec.Sort.Column.Trim(), StringComparison.OrdinalIgnoreCase))
                ?? throw new InvalidOperationException($"sort: '{spec.Sort.Column}' is not an output column. Outputs: {string.Join(", ", outputs)}.");
            sort = new AiSort(s, spec.Sort.Descending);
        }

        var limit = Math.Clamp(spec.Limit ?? (measures.Count > 0 ? 100 : 50), 1, MaxLimit);
        return new AiQuerySpec(select, groupBy, measures, filters, sort, limit);
    }

    public static AiQueryResult Execute(AiQuerySpec spec, IReadOnlyList<string> columns, IReadOnlyList<Dictionary<string, object?>> rows, bool sourceTruncated)
    {
        IEnumerable<Dictionary<string, object?>> q = rows;
        foreach (var f in spec.Filters ?? []) q = q.Where(r => Matches(Get(r, f.Column), f));

        List<Dictionary<string, object?>> output;
        List<string> outCols;
        var measures = spec.Measures ?? [];
        if (measures.Count > 0)
        {
            var groupBy = spec.GroupBy ?? [];
            outCols = groupBy.Concat(measures.Select(m => m.Alias!)).ToList();
            output = q.GroupBy(r => string.Join("\u0001", groupBy.Select(g => Get(r, g)?.ToString() ?? "")))
                .Select(g =>
                {
                    var first = g.First();
                    var row = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
                    foreach (var c in groupBy) row[c] = Get(first, c);
                    foreach (var m in measures) row[m.Alias!] = Aggregate(m, g);
                    return row;
                }).ToList();
        }
        else
        {
            outCols = spec.Select is { Count: > 0 } ? spec.Select.ToList() : columns.ToList();
            output = q.Select(r =>
            {
                var row = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
                foreach (var c in outCols) row[c] = Get(r, c);
                return row;
            }).ToList();
        }

        if (spec.Sort is { } s)
            output = (s.Descending ? output.OrderByDescending(r => r[s.Column], ValueComparer.Instance) : output.OrderBy(r => r[s.Column], ValueComparer.Instance)).ToList();

        var total = output.Count;
        var limit = spec.Limit ?? MaxLimit;
        return new AiQueryResult(outCols, output.Take(limit).ToList(), total, rows.Count, sourceTruncated);
    }

    private static object? Get(Dictionary<string, object?> row, string col)
    {
        if (row.TryGetValue(col, out var v)) return Unwrap(v);
        var k = row.Keys.FirstOrDefault(x => string.Equals(x, col, StringComparison.OrdinalIgnoreCase));
        return k is null ? null : Unwrap(row[k]);
    }

    /// <summary>Rows from imports arrive as JsonElement; rows from SQL as CLR values. Normalise both.</summary>
    private static object? Unwrap(object? v) => v switch
    {
        JsonElement { ValueKind: JsonValueKind.Null or JsonValueKind.Undefined } => null,
        JsonElement { ValueKind: JsonValueKind.Number } e => e.TryGetInt64(out var l) ? l : e.GetDouble(),
        JsonElement { ValueKind: JsonValueKind.True } => true,
        JsonElement { ValueKind: JsonValueKind.False } => false,
        JsonElement e => e.ToString(),
        DBNull => null,
        _ => v,
    };

    internal static double? Num(object? v) => v switch
    {
        null => null,
        double d => d,
        float f => f,
        decimal m => (double)m,
        int i => i,
        long l => l,
        short s => s,
        byte b => b,
        bool b => b ? 1 : 0,
        DateTime dt => dt.Ticks,
        string s when double.TryParse(s, NumberStyles.Any, CultureInfo.InvariantCulture, out var d) => d,
        _ => null,
    };

    private static object? Aggregate(AiMeasure m, IEnumerable<Dictionary<string, object?>> g)
    {
        if (m.Agg == "count") return m.Column is null ? g.Count() : g.Count(r => Get(r, m.Column) is not null);
        var values = g.Select(r => Get(r, m.Column!)).Where(v => v is not null).ToList();
        if (m.Agg == "countDistinct") return values.Select(v => v!.ToString()).Distinct().Count();
        var nums = values.Select(Num).Where(n => n.HasValue).Select(n => n!.Value).ToList();
        if (nums.Count == 0) return null;
        return m.Agg switch
        {
            "sum" => Math.Round(nums.Sum(), 4),
            "avg" => Math.Round(nums.Average(), 4),
            "min" => values.Min(ValueComparer.Instance),
            "max" => values.Max(ValueComparer.Instance),
            _ => null,
        };
    }

    private static bool Matches(object? v, AiFilter f)
    {
        switch (f.Op)
        {
            case "isNull": return v is null || v as string == "";
            case "notNull": return v is not null && v as string != "";
        }
        if (v is null) return false;
        var target = f.Value is JsonElement je ? Unwrap(je) : f.Value;
        if (f.Op == "in")
        {
            var set = target switch
            {
                IEnumerable<object?> list => list.Select(x => (x is JsonElement e ? Unwrap(e) : x)?.ToString() ?? ""),
                string s => s.Split(',').Select(x => x.Trim()),
                _ => [target?.ToString() ?? ""],
            };
            return set.Contains(v.ToString() ?? "", StringComparer.OrdinalIgnoreCase);
        }
        if (f.Op == "contains") return (v.ToString() ?? "").Contains(target?.ToString() ?? "", StringComparison.OrdinalIgnoreCase);

        var cmp = Compare(v, target);
        return f.Op switch
        {
            "eq" => cmp == 0,
            "neq" => cmp != 0,
            "gt" => cmp > 0,
            "gte" => cmp >= 0,
            "lt" => cmp < 0,
            "lte" => cmp <= 0,
            _ => false,
        };
    }

    /// <summary>Numeric when both sides parse as numbers, date when both parse as dates, else case-insensitive text.</summary>
    private static int Compare(object? a, object? b)
    {
        if (a is null && b is null) return 0;
        if (a is null) return -1;
        if (b is null) return 1;
        var na = Num(a); var nb = Num(b);
        if (na.HasValue && nb.HasValue && a is not string && b is not string) return na.Value.CompareTo(nb.Value);
        if (na.HasValue && nb.HasValue && (a is string || b is string) && a is not DateTime && b is not DateTime) return na.Value.CompareTo(nb.Value);
        if (TryDate(a, out var da) && TryDate(b, out var db)) return da.CompareTo(db);
        return string.Compare(a.ToString(), b.ToString(), StringComparison.OrdinalIgnoreCase);
    }

    private static bool TryDate(object v, out DateTime d)
    {
        if (v is DateTime dt) { d = dt; return true; }
        return DateTime.TryParse(v.ToString(), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out d);
    }

    private sealed class ValueComparer : IComparer<object?>
    {
        public static readonly ValueComparer Instance = new();
        public int Compare(object? x, object? y) => QuerySpecEngine.Compare(x, y);
    }
}
