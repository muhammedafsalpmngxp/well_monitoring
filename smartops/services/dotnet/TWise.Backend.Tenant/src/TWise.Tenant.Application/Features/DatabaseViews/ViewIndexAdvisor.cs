using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.DatabaseViews;

/// <summary>An index the table already has (read from sys.indexes).</summary>
public sealed record ExistingIndexInfo(
    string Name, string Type, bool IsUnique, bool IsPrimaryKey,
    IReadOnlyList<string> KeyColumns, IReadOnlyList<string> IncludedColumns);

/// <summary>A row of SQL Server's missing-index statistics for the table.</summary>
public sealed record MissingIndexInfo(
    IReadOnlyList<string> EqualityColumns, IReadOnlyList<string> InequalityColumns,
    IReadOnlyList<string> IncludedColumns, double Impact);

/// <summary>
/// Decides which indexes would help a view: one for its value/range filters, one per join column,
/// plus SQL Server's own missing-index statistics. A suggestion is dropped when an existing index
/// already starts with the same columns.
/// </summary>
public static class ViewIndexAdvisor
{
    private const int MaxKeyColumns = 5;

    public static ViewTableIndexAdvice Advise(
        ViewTableUsage usage, string qualifiedName, long? rowCount,
        IReadOnlyList<ExistingIndexInfo> existing, IReadOnlyList<MissingIndexInfo> missing)
    {
        var used = usage.EqualityColumns.Concat(usage.RangeColumns).Concat(usage.JoinColumns).Concat(usage.SortColumns)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var existingDtos = existing.Select(index => new ExistingIndexDto(
            index.Name, index.Type, index.IsUnique, index.IsPrimaryKey, index.KeyColumns, index.IncludedColumns,
            index.KeyColumns.Count > 0 && used.Contains(index.KeyColumns[0]))).ToList();

        var suggestions = new List<SuggestedIndexDto>();
        void Add(IReadOnlyList<string> keys, int leading, IReadOnlyList<string> includes, string reason, string source, double? impact)
        {
            keys = keys.Take(MaxKeyColumns).ToList();
            if (keys.Count == 0 || existing.Any(index => Covers(index.KeyColumns, keys, Math.Min(leading, keys.Count)))) return;
            if (suggestions.Any(s => SameColumns(s.KeyColumns, keys))) return;
            suggestions.Add(new SuggestedIndexDto(keys, includes, reason, source, impact, CreateSql(usage.Table, qualifiedName, keys, includes)));
        }

        // Filters: equality columns (any order) then the first range column.
        var equality = usage.EqualityColumns.ToList();
        var range = usage.RangeColumns.FirstOrDefault(c => !equality.Contains(c, StringComparer.OrdinalIgnoreCase));
        if (equality.Count > 0 || range is not null)
        {
            var keys = range is null ? equality : [.. equality, range];
            Add(keys, equality.Count, [], $"Filters on {string.Join(", ", keys)}", "View", null);
        }
        else if (usage.SortColumns.Count > 0)
        {
            Add(usage.SortColumns, 0, [], $"Groups or sorts by {string.Join(", ", usage.SortColumns.Take(MaxKeyColumns))}", "View", null);
        }

        // Joins: each join column should lead an index on its table.
        foreach (var column in usage.JoinColumns)
            Add([column], 1, [], $"Joined on {column}", "View", null);

        // The statistics cover every query on the table; keep the top two whose leading column this view uses.
        foreach (var row in missing.Where(m => m.EqualityColumns.Concat(m.InequalityColumns).FirstOrDefault() is { } first && used.Contains(first))
                                   .OrderByDescending(m => m.Impact).Take(2))
            Add([.. row.EqualityColumns, .. row.InequalityColumns], row.EqualityColumns.Count, row.IncludedColumns,
                $"SQL Server recorded queries that would use this index (estimated {row.Impact:0}% faster)", "SQL Server", Math.Round(row.Impact, 1));

        return new ViewTableIndexAdvice(qualifiedName, rowCount, [.. usage.EqualityColumns, .. usage.RangeColumns],
            usage.JoinColumns, usage.SortColumns, existingDtos, suggestions);
    }

    /// <summary>The index starts with the same leading columns (any order) followed by the same remaining columns.</summary>
    internal static bool Covers(IReadOnlyList<string> indexKeys, IReadOnlyList<string> keys, int leading)
    {
        if (indexKeys.Count < keys.Count) return false;
        if (!SameColumns(indexKeys.Take(leading).ToList(), keys.Take(leading).ToList())) return false;
        return indexKeys.Skip(leading).Take(keys.Count - leading)
            .SequenceEqual(keys.Skip(leading), StringComparer.OrdinalIgnoreCase);
    }

    private static bool SameColumns(IReadOnlyList<string> a, IReadOnlyList<string> b)
        => a.Count == b.Count && a.ToHashSet(StringComparer.OrdinalIgnoreCase).SetEquals(b);

    internal static string CreateSql(string table, string qualifiedName, IReadOnlyList<string> keys, IReadOnlyList<string> includes)
    {
        var name = $"IX_{table}_{string.Join('_', keys)}";
        name = new string(name.Select(c => char.IsLetterOrDigit(c) || c == '_' ? c : '_').ToArray());
        if (name.Length > 128) name = name[..128];
        var sql = $"CREATE NONCLUSTERED INDEX [{name}] ON {qualifiedName} ({string.Join(", ", keys.Select(Quote))})";
        if (includes.Count > 0) sql += $" INCLUDE ({string.Join(", ", includes.Select(Quote))})";
        return sql + ";";
    }

    /// <summary>[name] with ] escaped.</summary>
    public static string Quote(string identifier) => $"[{identifier.Replace("]", "]]")}]";
}
