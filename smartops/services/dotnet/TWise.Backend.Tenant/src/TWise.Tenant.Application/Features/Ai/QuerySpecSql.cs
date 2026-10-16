using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai;

/// <summary>
/// Turns a validated AI query spec into one T-SQL query over a view's SQL, so the answer is
/// computed by the database over every row instead of in memory over the first rows loaded.
/// Columns come from the validated spec (names checked against the view) and are bracket-quoted;
/// every value is a parameter. The model never writes SQL. Semantics follow QuerySpecEngine.
/// </summary>
public static partial class QuerySpecSql
{
    /// <summary>Extra output column holding the result's row count before the limit.</summary>
    public const string TotalColumn = "__ai_total";
    private const string Source = "_ai_src";
    private const int MaxInValues = 100;

    public sealed record Built(string Sql, IReadOnlyList<KeyValuePair<string, object>> Parameters);

    [GeneratedRegex(@"^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?Z?$")]
    private static partial Regex IsoDate();

    /// <summary>Null when the view's SQL is a batch that cannot be read as a row source.</summary>
    public static Built? Build(string viewSql, AiQuerySpec spec, IReadOnlyList<string> columns)
    {
        var wrapped = ViewSqlWrapper.Wrap(viewSql, Source, stripOrderBy: true);
        if (wrapped is null) return null;

        var parameters = new List<KeyValuePair<string, object>>();
        string Param(object value)
        {
            var name = $"@ai_p{parameters.Count}";
            parameters.Add(new(name, value));
            return name;
        }

        var measures = spec.Measures ?? [];
        var groupBy = spec.GroupBy ?? [];
        var output = new List<string>();
        if (measures.Count > 0)
        {
            output.AddRange(groupBy.Select(Q));
            output.AddRange(measures.Select(m => $"{Measure(m)} AS {Q(m.Alias!)}"));
        }
        else
        {
            output.AddRange((spec.Select is { Count: > 0 } ? spec.Select : columns).Select(Q));
        }
        // Counted before TOP is applied, so the caller knows how many rows the full answer has.
        output.Add($"COUNT(*) OVER () AS {Q(TotalColumn)}");

        var where = (spec.Filters ?? []).Select(f => Filter(f, Param)).ToList();
        var limit = Param(spec.Limit ?? QuerySpecEngine.MaxLimit);

        var sql = new StringBuilder(wrapped.Head);
        sql.Append("SELECT TOP (").Append(limit).Append(") ").Append(string.Join(", ", output));
        sql.Append("\nFROM ").Append(wrapped.Relation);
        if (where.Count > 0) sql.Append("\nWHERE ").Append(string.Join(" AND ", where));
        if (measures.Count > 0 && groupBy.Count > 0) sql.Append("\nGROUP BY ").Append(string.Join(", ", groupBy.Select(Q)));
        if (spec.Sort is { } s) sql.Append("\nORDER BY ").Append(Q(s.Column)).Append(s.Descending ? " DESC" : " ASC");
        return new Built(sql.ToString(), parameters);
    }

    private static string Q(string name) => $"[{name.Replace("]", "]]")}]";

    private static string Measure(AiMeasure m) => m.Agg switch
    {
        "count" => m.Column is null ? "COUNT(*)" : $"COUNT({Q(m.Column)})",
        "countDistinct" => $"COUNT(DISTINCT {Q(m.Column!)})",
        // Text columns holding numbers are summed like the in-memory engine does; other text is skipped.
        "sum" => $"ROUND(SUM(TRY_CAST({Q(m.Column!)} AS float)), 4)",
        "avg" => $"ROUND(AVG(TRY_CAST({Q(m.Column!)} AS float)), 4)",
        "min" => $"MIN({Q(m.Column!)})",
        "max" => $"MAX({Q(m.Column!)})",
        _ => throw new InvalidOperationException($"measures: unknown agg '{m.Agg}'."),
    };

    private static string Filter(AiFilter f, Func<object, string> param)
    {
        var col = Q(f.Column);
        var text = $"CAST({col} AS nvarchar(4000))";
        switch (f.Op)
        {
            case "isNull": return $"({col} IS NULL OR {text} = N'')";
            case "notNull": return $"({col} IS NOT NULL AND {text} <> N'')";
            case "contains":
                var like = (Scalar(f.Value)?.ToString() ?? "").Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_").Replace("[", "\\[");
                return $"CAST({col} AS nvarchar(max)) LIKE {param($"%{like}%")} ESCAPE '\\'";
            case "in":
                var items = Items(f.Value).Take(MaxInValues).ToList();
                return items.Count == 0 ? "1 = 0" : $"{text} IN ({string.Join(", ", items.Select(i => param(i)))})";
        }

        var op = f.Op switch { "eq" => "=", "neq" => "<>", "gt" => ">", "gte" => ">=", "lt" => "<", "lte" => "<=", _ => throw new InvalidOperationException($"filters: unknown op '{f.Op}'.") };
        // Same order as the in-memory comparison: number, then date, then case-insensitive text.
        var value = Scalar(f.Value);
        if (value is double d) return $"TRY_CAST({col} AS float) {op} {param(d)}";
        var s = value?.ToString() ?? "";
        if (double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out var n)) return $"TRY_CAST({col} AS float) {op} {param(n)}";
        if (IsoDate().IsMatch(s) && DateTime.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal, out var dt))
            return $"TRY_CAST({col} AS datetime2) {op} {param(dt)}";
        return $"{text} {op} {param(s)}";
    }

    /// <summary>The model's JSON value as a CLR scalar: number → double, true/false → 1/0, else text.</summary>
    private static object? Scalar(object? v) => v switch
    {
        JsonElement { ValueKind: JsonValueKind.Number } e => e.GetDouble(),
        JsonElement { ValueKind: JsonValueKind.True } => 1d,
        JsonElement { ValueKind: JsonValueKind.False } => 0d,
        JsonElement { ValueKind: JsonValueKind.Null or JsonValueKind.Undefined } => null,
        JsonElement e => e.ToString(),
        int or long or float or decimal => Convert.ToDouble(v, CultureInfo.InvariantCulture),
        bool b => b ? 1d : 0d,
        _ => v,
    };

    private static IEnumerable<string> Items(object? v) => v switch
    {
        JsonElement { ValueKind: JsonValueKind.Array } e => e.EnumerateArray().Select(x => x.ToString()),
        IEnumerable<object?> list => list.Select(x => (Scalar(x) ?? "").ToString()!),
        string s => s.Split(',').Select(x => x.Trim()),
        null => [],
        _ => [Scalar(v)?.ToString() ?? ""],
    };
}
