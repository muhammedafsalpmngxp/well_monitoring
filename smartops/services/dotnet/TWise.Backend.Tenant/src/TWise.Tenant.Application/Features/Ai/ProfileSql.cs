using System.Text;
using TWise.Tenant.Application.Common;

namespace TWise.Tenant.Application.Features.Ai;

/// <summary>
/// SQL that profiles a view in its database in two passes: one aggregate row with row count,
/// distinct count, empty count and (numbers, dates) min/max per column; then, for the columns with
/// few values, every value and its count via GROUPING SETS. Column names are bracket-quoted.
/// </summary>
public static class ProfileSql
{
    public const string RowsColumn = "__rows";
    public const string CountColumn = "__n";
    private const string Source = "_ai_src";

    /// <param name="types">"number", "date", "boolean", "text" or "binary" (skipped) per column.</param>
    /// <returns>Null when the view is a batch; the caller streams it instead.</returns>
    public static string? Stats(string viewSql, IReadOnlyList<(string Column, string Type)> types)
    {
        var w = ViewSqlWrapper.Wrap(viewSql, Source, stripOrderBy: true);
        if (w is null) return null;
        var parts = new List<string> { $"COUNT(*) AS {Q(RowsColumn)}" };
        for (var i = 0; i < types.Count; i++)
        {
            var (col, type) = types[i];
            if (type == "binary") continue;
            var c = Q(col);
            parts.Add($"COUNT(DISTINCT {c}) AS [d{i}]");
            parts.Add($"SUM(CASE WHEN {c} IS NULL OR CAST({c} AS nvarchar(4000)) = N'' THEN 1 ELSE 0 END) AS [n{i}]");
            if (type is "number" or "date") parts.Add($"MIN({c}) AS [mn{i}], MAX({c}) AS [mx{i}]");
        }
        return $"{w.Head}SELECT {string.Join(", ", parts)}\nFROM {w.Relation}";
    }

    /// <summary>Value counts for the given columns in one scan; GROUPING([c]) = 0 marks column c's rows.</summary>
    public static string? Values(string viewSql, IReadOnlyList<(int Index, string Column)> lowCardinality)
    {
        if (lowCardinality.Count == 0) return null;
        var w = ViewSqlWrapper.Wrap(viewSql, Source, stripOrderBy: true);
        if (w is null) return null;
        var select = new StringBuilder();
        foreach (var (i, col) in lowCardinality)
            select.Append($"CAST({Q(col)} AS nvarchar(400)) AS [v{i}], GROUPING({Q(col)}) AS [g{i}], ");
        select.Append($"COUNT(*) AS {Q(CountColumn)}");
        var sets = string.Join(", ", lowCardinality.Select(x => $"({Q(x.Column)})"));
        return $"{w.Head}SELECT {select}\nFROM {w.Relation}\nGROUP BY GROUPING SETS ({sets})";
    }

    /// <summary>
    /// Values of the given text columns that contain any search word, with row counts, in one scan:
    /// each row is unpivoted with CROSS APPLY (VALUES ...) and filtered by LIKE. Words are parameters
    /// @t0..@tn holding "%word%" (the caller escapes LIKE wildcards).
    /// </summary>
    public static string? Lookup(string viewSql, IReadOnlyList<string> textColumns, int termCount, int maxRows)
    {
        if (textColumns.Count == 0 || termCount == 0) return null;
        var w = ViewSqlWrapper.Wrap(viewSql, Source, stripOrderBy: true);
        if (w is null) return null;
        var values = string.Join(", ", textColumns.Select(c => $"(N'{c.Replace("'", "''")}', CAST({Q(c)} AS nvarchar(400)))"));
        var like = string.Join(" OR ", Enumerable.Range(0, termCount).Select(i => $"x.v LIKE @t{i} ESCAPE '\\'"));
        return $"{w.Head}SELECT TOP ({maxRows}) x.c, x.v, COUNT(*) AS {Q(CountColumn)}\nFROM {w.Relation}\n"
             + $"CROSS APPLY (VALUES {values}) AS x(c, v)\nWHERE x.v IS NOT NULL AND ({like})\n"
             + "GROUP BY x.c, x.v\nORDER BY COUNT(*) DESC";
    }

    private static string Q(string name) => $"[{name.Replace("]", "]]")}]";
}
