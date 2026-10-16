namespace TWise.Tenant.Application.Common;

/// <summary>Normalises rule and view columns to "schema.table.column" keys so they can be matched.</summary>
public static class ReliabilityColumns
{
    public static HashSet<string> ForRule(string? tableName, string? fields)
    {
        var result = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var tables = (tableName ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

        foreach (var field in (fields ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var parts = field.Split('.', StringSplitOptions.TrimEntries).Select(StripBrackets).ToArray();
            if (parts.Length >= 3)
            {
                result.Add(ColumnKey($"{parts[0]}.{parts[1]}", string.Join('.', parts.Skip(2))));
                continue;
            }

            var column = parts[^1];
            foreach (var table in tables)
                result.Add(ColumnKey(table, column));
        }

        return result;
    }

    public static string ColumnKey(string table, string column)
        => $"{TableKey(table)}.{StripBrackets(column.Trim())}";

    public static string TableKey(string table)
    {
        var parts = table.Split('.', StringSplitOptions.TrimEntries).Select(StripBrackets).ToArray();
        return parts.Length >= 2 ? $"{parts[^2]}.{parts[^1]}" : $"dbo.{parts[0]}";
    }

    public static string StripBrackets(string identifier) => identifier.TrimStart('[').TrimEnd(']');
}
