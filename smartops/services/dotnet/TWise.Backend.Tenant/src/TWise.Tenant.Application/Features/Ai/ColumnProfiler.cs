using System.Globalization;
using System.Text;
using System.Text.Json;

namespace TWise.Tenant.Application.Features.Ai;

/// <summary>Profile of one column over every row of a dataset, for the AI prompt.</summary>
/// <param name="DistinctAtLeast">True when counting stopped at the cap, so Distinct is a lower bound.</param>
/// <param name="TopValues">Every value with its count when the column has few values; otherwise the most frequent ones.</param>
public sealed record AiColumnStats(
    string Column, string Type, long Rows, long Nulls, long Distinct, bool DistinctAtLeast,
    string? Min, string? Max, IReadOnlyList<AiValueCount> TopValues, IReadOnlyList<string> Samples);

public sealed record AiValueCount(string Value, long Count);

/// <summary>
/// Builds column profiles from rows fed one at a time, so a streamed dataset is profiled without
/// holding it. Distinct values are tracked up to a cap; min/max only for numbers and dates.
/// </summary>
public sealed class ColumnProfiler(IReadOnlyList<string> columns)
{
    /// <summary>Columns with at most this many values list all of them, with counts.</summary>
    public const int LowCardinality = 20;
    private const int MaxTracked = 10_000;
    private const int SampleCount = 5;

    private readonly Accumulator[] acc = columns.Select(_ => new Accumulator()).ToArray();
    private long rows;

    public void Add(IReadOnlyDictionary<string, object?> row)
    {
        rows++;
        for (var i = 0; i < columns.Count; i++)
            acc[i].Add(row.TryGetValue(columns[i], out var v) ? Unwrap(v) : null);
    }

    public IReadOnlyList<AiColumnStats> Build() => columns.Select((c, i) => acc[i].Build(c, rows)).ToList();

    /// <summary>One prompt line: "Plant (text) 4 values: Marmul ODC (935), Nimr ODC (616) | 697 empty".</summary>
    public static string Describe(AiColumnStats s)
    {
        static string Cut(string v) => v.Length > 30 ? v[..30] + "…" : v;
        var sb = new StringBuilder().Append(s.Column).Append(" (").Append(s.Type).Append(')');
        if (s.Rows > 0 && s.Nulls == s.Rows) return sb.Append(" always empty").ToString();
        var listsAll = !s.DistinctAtLeast && s.Distinct <= LowCardinality && s.TopValues.Count == s.Distinct && s.Distinct > 0;
        if (listsAll)
            sb.Append(' ').Append(s.Distinct).Append(s.Distinct == 1 ? " value: " : " values: ")
              .Append(string.Join(", ", s.TopValues.Select(v => $"{Cut(v.Value)} ({v.Count.ToString("N0", CultureInfo.InvariantCulture)})")));
        else
        {
            sb.Append(' ').Append(s.DistinctAtLeast ? "over " : "").Append(s.Distinct.ToString("N0", CultureInfo.InvariantCulture)).Append(" distinct");
            if (s.Min is not null && s.Max is not null) sb.Append(" | range ").Append(Cut(s.Min)).Append(" to ").Append(Cut(s.Max));
            var eg = s.Samples.Count > 0 ? s.Samples : s.TopValues.Select(v => v.Value).ToList();
            if (eg.Count > 0) sb.Append(" | e.g. ").Append(string.Join(", ", eg.Take(SampleCount).Select(Cut)));
        }
        if (s.Nulls > 0) sb.Append(" | ").Append(s.Nulls.ToString("N0", CultureInfo.InvariantCulture)).Append(" empty");
        return sb.ToString();
    }

    private sealed class Accumulator
    {
        private readonly Dictionary<string, long> counts = new(StringComparer.OrdinalIgnoreCase);
        private readonly List<string> samples = [];
        private bool capped;
        private long nulls, numbers, dates, bools, texts;
        private object? min, max;

        public void Add(object? v)
        {
            if (v is null || v is string { Length: 0 }) { nulls++; return; }
            var kind = Kind(v);
            switch (kind) { case "number": numbers++; break; case "date": dates++; break; case "boolean": bools++; break; default: texts++; break; }
            var key = Text(v);
            if (counts.TryGetValue(key, out var n)) counts[key] = n + 1;
            else if (counts.Count < MaxTracked) { counts[key] = 1; if (samples.Count < SampleCount) samples.Add(key); }
            else capped = true;
            if (kind is "number" or "date")
            {
                if (min is null || Compare(v, min) < 0) min = v;
                if (max is null || Compare(v, max) > 0) max = v;
            }
        }

        public AiColumnStats Build(string column, long rows)
        {
            var type = numbers > 0 && texts == 0 && dates == 0 ? "number"
                : dates > 0 && texts == 0 && numbers == 0 ? "date"
                : bools > 0 && texts == 0 && numbers == 0 && dates == 0 ? "boolean" : "text";
            var top = counts.OrderByDescending(kv => kv.Value).ThenBy(kv => kv.Key, StringComparer.OrdinalIgnoreCase)
                .Take(counts.Count <= LowCardinality ? LowCardinality : SampleCount)
                .Select(kv => new AiValueCount(kv.Key, kv.Value)).ToList();
            var ranged = type is "number" or "date";
            return new AiColumnStats(column, type, rows, nulls, counts.Count, capped,
                ranged && min is not null ? Text(min) : null, ranged && max is not null ? Text(max) : null, top, samples);
        }
    }

    private static string Kind(object v) => v switch
    {
        bool => "boolean",
        DateTime or DateTimeOffset or DateOnly => "date",
        sbyte or byte or short or ushort or int or uint or long or ulong or float or double or decimal => "number",
        string s when double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out _) => "number",
        string s when s.Length >= 8 && DateTime.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.None, out _) => "date",
        _ => "text",
    };

    private static string Text(object v) => v switch
    {
        DateTime d => d.TimeOfDay == TimeSpan.Zero ? d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) : d.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture),
        DateTimeOffset d => d.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture),
        IFormattable f => f.ToString(null, CultureInfo.InvariantCulture),
        _ => v.ToString() ?? "",
    };

    private static int Compare(object a, object b)
    {
        if (Num(a) is { } x && Num(b) is { } y) return x.CompareTo(y);
        if (Date(a) is { } d1 && Date(b) is { } d2) return d1.CompareTo(d2);
        return string.Compare(Text(a), Text(b), StringComparison.OrdinalIgnoreCase);
    }

    private static double? Num(object v) => v switch
    {
        DateTime or DateTimeOffset or bool => null,
        IConvertible c when v is not string => c.ToDouble(CultureInfo.InvariantCulture),
        string s when double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out var d) => d,
        _ => null,
    };

    private static DateTime? Date(object v) => v switch
    {
        DateTime d => d,
        DateTimeOffset d => d.UtcDateTime,
        string s when DateTime.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) => d,
        _ => null,
    };

    /// <summary>Imported rows arrive as JsonElement; normalise to CLR values like SQL rows.</summary>
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
}
