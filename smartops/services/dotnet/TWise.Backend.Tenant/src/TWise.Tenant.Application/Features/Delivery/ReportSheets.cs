using System.Text.Json;

namespace TWise.Tenant.Application.Features.Delivery;

public sealed record ReportColumn(string Field, string Header);

/// <summary>One page of a report: its source and the columns it shows. No columns means every column of the source.</summary>
public sealed record ReportSheet(string Name, string SourceName, string SourceType, IReadOnlyList<ReportColumn> Columns);

/// <summary>
/// The pages of a saved report and the table each sends, as the report viewer reads them: a page per entry of sheets
/// when there are several, else the report's own source; the shown columns under their headers.
/// </summary>
// ponytail: calculated fields, conditional and parameter filters, DAX measures and manual row edits are applied by the
// viewer in the browser and are not applied here; the file holds the source rows of the shown columns. Port them from
// report-viewer buildRowsFromData when a report that uses them is scheduled.
public static class ReportSheets
{
    public static IReadOnlyList<ReportSheet> Read(string reportName, string sourceName, string sourceType, string? reportJson)
    {
        JsonElement root;
        try
        {
            using var document = JsonDocument.Parse(reportJson ?? "{}");
            root = document.RootElement.Clone();
        }
        catch (Exception ex) when (ex is JsonException or ArgumentException)
        {
            return [new ReportSheet(reportName, sourceName, sourceType, [])];
        }

        if (root.ValueKind == JsonValueKind.Object && root.TryGetProperty("sheets", out var sheets)
            && sheets.ValueKind == JsonValueKind.Array && sheets.GetArrayLength() > 1)
        {
            return sheets.EnumerateArray().Where(s => s.ValueKind == JsonValueKind.Object).Select((sheet, i) => new ReportSheet(
                Text(sheet, "name") ?? $"Page {i + 1}", Text(sheet, "sourceName") ?? string.Empty, Text(sheet, "sourceType") ?? "Table",
                Columns(sheet.TryGetProperty("config", out var config) ? config : default))).ToList();
        }
        return [new ReportSheet(reportName, sourceName, sourceType, Columns(root))];
    }

    /// <summary>The page's rows as a table: its columns, or every column of the data when it lists none.</summary>
    public static DeliveryTable Table(ReportSheet sheet, IReadOnlyList<string> dataColumns, IReadOnlyList<IReadOnlyDictionary<string, object?>> rows)
    {
        var columns = sheet.Columns.Count > 0 ? sheet.Columns : Unique(dataColumns.Select(c => new ReportColumn(c, c)));
        var fields = columns.Select(c => c.Field).ToList();
        return new DeliveryTable(sheet.Name, fields, columns.Select(c => c.Header).ToList(),
            rows.Select(row => (IReadOnlyDictionary<string, object?>)fields.ToDictionary(f => f, f => row.GetValueOrDefault(f))).ToList());
    }

    private static IReadOnlyList<ReportColumn> Columns(JsonElement config)
    {
        if (config.ValueKind != JsonValueKind.Object || !config.TryGetProperty("columns", out var columns) || columns.ValueKind != JsonValueKind.Array)
            return [];
        return Unique(columns.EnumerateArray()
            .Where(c => c.ValueKind == JsonValueKind.Object && !(c.TryGetProperty("shown", out var shown) && shown.ValueKind == JsonValueKind.False))
            .Select(c => (Field: Text(c, "field"), Header: Text(c, "header")))
            .Where(c => !string.IsNullOrWhiteSpace(c.Field))
            .Select(c => new ReportColumn(c.Field!, string.IsNullOrWhiteSpace(c.Header) ? c.Field! : c.Header)));
    }

    /// <summary>Columns once each, ignoring case and spaces around the name, as the viewer's uniqueColumns.</summary>
    private static List<ReportColumn> Unique(IEnumerable<ReportColumn> columns)
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        return columns.Where(c => c.Field.Trim().Length > 0 && seen.Add(c.Field.Trim())).ToList();
    }

    private static string? Text(JsonElement element, string name)
        => element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
}
