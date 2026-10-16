using System.Globalization;
using System.Text.Json;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Infrastructure.DataSources;

/// <summary>
/// Turns loosely-typed source data into the <see cref="ParsedImportResult"/> shape that
/// ImportedDatasets store — a column list with inferred types plus typed row dictionaries.
///
/// Shared by file import (CSV/Excel/JSON) and every pull connector so that a column of
/// numbers is inferred the same way no matter where the data came from.
/// </summary>
public static class TabularResultBuilder
{
    /// <summary>Rows sampled when inferring a column's type.</summary>
    private const int TypeInferenceSampleSize = 50;

    public static ParsedImportResult Build(
        IReadOnlyList<string> headers, List<Dictionary<string, string?>> rawRows)
    {
        var columns = headers.Select(h => new ImportColumnDto(h, InferColumnType(h, rawRows))).ToList();

        var rows = rawRows
            .Select(r => headers.ToDictionary(h => h, h => ConvertValue(r.GetValueOrDefault(h))))
            .ToList();

        return new ParsedImportResult(columns, rows);
    }

    /// <summary>
    /// Flattens a JSON array of objects into rows. Nested objects and arrays are kept as raw
    /// JSON text in their column rather than being exploded, which keeps the row count honest.
    /// Columns are unioned across all rows, so sparse records still line up.
    /// </summary>
    public static ParsedImportResult FromJsonArray(JsonElement array)
    {
        if (array.ValueKind != JsonValueKind.Array)
            throw new InvalidOperationException("Expected a JSON array of objects.");

        var headers = new List<string>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var rawRows = new List<Dictionary<string, string?>>();

        foreach (var element in array.EnumerateArray())
        {
            var row = new Dictionary<string, string?>();

            if (element.ValueKind == JsonValueKind.Object)
            {
                foreach (var prop in element.EnumerateObject())
                {
                    if (seen.Add(prop.Name)) headers.Add(prop.Name);
                    row[prop.Name] = ReadScalar(prop.Value);
                }
            }
            else
            {
                // An array of bare scalars still makes a usable single-column dataset.
                const string valueColumn = "value";
                if (seen.Add(valueColumn)) headers.Add(valueColumn);
                row[valueColumn] = ReadScalar(element);
            }

            rawRows.Add(row);
        }

        return Build(headers, rawRows);
    }

    /// <summary>
    /// Builds a result from a grid of cell values where the first row holds the headers —
    /// the shape the Google Sheets API returns.
    /// </summary>
    public static ParsedImportResult FromGrid(IReadOnlyList<IReadOnlyList<string?>> grid)
    {
        if (grid.Count == 0) return new ParsedImportResult([], []);

        var headers = new List<string>();
        var seen = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);

        for (var i = 0; i < grid[0].Count; i++)
        {
            var raw = grid[0][i];
            var name = string.IsNullOrWhiteSpace(raw) ? $"column_{i + 1}" : raw.Trim();

            // Sheets happily allows duplicate header cells; datasets cannot.
            if (seen.TryGetValue(name, out var count))
            {
                seen[name] = ++count;
                name = $"{name}_{count}";
            }
            else
            {
                seen[name] = 0;
            }

            headers.Add(name);
        }

        var rawRows = new List<Dictionary<string, string?>>(grid.Count - 1);
        for (var r = 1; r < grid.Count; r++)
        {
            var row = new Dictionary<string, string?>();
            for (var c = 0; c < headers.Count; c++)
                row[headers[c]] = c < grid[r].Count ? grid[r][c] : null;
            rawRows.Add(row);
        }

        return Build(headers, rawRows);
    }

    public static string? ReadScalar(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.String => value.GetString(),
        JsonValueKind.Null or JsonValueKind.Undefined => null,
        _ => value.GetRawText()
    };

    private static string InferColumnType(string column, List<Dictionary<string, string?>> rows)
    {
        var sample = rows.Take(TypeInferenceSampleSize)
            .Select(r => r.GetValueOrDefault(column))
            .Where(v => !string.IsNullOrWhiteSpace(v))
            .ToList();

        if (sample.Count == 0) return "string";
        if (sample.All(v => double.TryParse(v, NumberStyles.Any, CultureInfo.InvariantCulture, out _))) return "number";
        if (sample.All(v => bool.TryParse(v, out _))) return "boolean";
        if (sample.All(v => DateTime.TryParse(v, CultureInfo.InvariantCulture, DateTimeStyles.None, out _))) return "date";
        return "string";
    }

    private static object? ConvertValue(string? raw)
    {
        if (raw is null) return null;
        if (long.TryParse(raw, out var l)) return l;
        if (double.TryParse(raw, NumberStyles.Any, CultureInfo.InvariantCulture, out var d)) return d;
        if (bool.TryParse(raw, out var b)) return b;
        return raw;
    }
}
