using System.Globalization;
using System.IO.Compression;
using System.Text.Json;
using CsvHelper;
using CsvHelper.Configuration;
using ExcelDataReader;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Features.Model.Imports;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Infrastructure.Services;

/// <summary>
/// Parses CSV/XLSX/XLS/JSON files into a common {columns, rows} shape so downstream
/// storage/consumption never needs to know which file format the data came from.
/// </summary>
public sealed class FileImportParserService : IFileImportParserService
{
    static FileImportParserService()
    {
        // Required by ExcelDataReader for legacy .xls code-page handling.
        System.Text.Encoding.RegisterProvider(System.Text.CodePagesEncodingProvider.Instance);
    }

    public ParsedImportResult Parse(Stream fileStream, string fileName, string fileType)
    {
        return fileType.ToLowerInvariant() switch
        {
            "csv" => ParseCsv(fileStream),
            "xlsx" or "xls" => ParseExcel(fileStream),
            "json" => ParseJson(fileStream),
            _ => throw new NotSupportedException($"File type '{fileType}' is not supported.")
        };
    }

    // Wider sheets are refused by ImportRules.Shape; reading one column more is enough to tell.
    private const int MaxReadColumns = ImportRules.MaxColumns + 1;

    public ImportSheet[] ReadSheets(Stream fileStream, string fileKind, string fileName, string? sheet, int maxRows, int maxCells)
    {
        var cells = 0;
        if (fileKind == "csv")
        {
            using var reader = new StreamReader(fileStream, detectEncodingFromByteOrderMarks: true);
            // Blank lines are kept, so row numbers match the lines of the file.
            using var csv = new CsvReader(reader, new CsvConfiguration(CultureInfo.InvariantCulture)
                { HasHeaderRecord = false, IgnoreBlankLines = false, BadDataFound = null, MissingFieldFound = null });
            var rows = new List<object?[]>();
            var truncated = false;
            while (csv.Read())
            {
                var width = Math.Min(csv.Parser.Count, MaxReadColumns);
                if (rows.Count == maxRows || cells + width > maxCells) { truncated = true; break; }
                cells += width;
                rows.Add(Enumerable.Range(0, width).Select(i => (object?)csv.GetField(i)).ToArray());
            }
            return [new ImportSheet(Path.GetFileNameWithoutExtension(fileName), rows, truncated)];
        }

        if (fileKind == "xlsx") RefuseLargeZip(fileStream);

        // ExcelDataReader returns the values Excel saved with the file. It never calculates a formula and
        // never runs a macro. Sheets are read row by row and a sheet that is not wanted is only named, so the
        // caps bound memory.
        using var excel = ExcelReaderFactory.CreateReader(fileStream);
        var sheets = new List<ImportSheet>();
        var stopped = false;
        do
        {
            var rows = new List<object?[]>();
            var truncated = false;
            if (!stopped && (sheet is null || excel.Name == sheet))
            {
                while (excel.Read())
                {
                    var width = Math.Min(excel.FieldCount, MaxReadColumns);
                    if (rows.Count == maxRows || cells + width > maxCells) { truncated = stopped = true; break; }
                    cells += width;
                    var row = new object?[width];
                    for (var i = 0; i < row.Length; i++) row[i] = excel.GetValue(i);
                    rows.Add(row);
                }
            }
            sheets.Add(new ImportSheet(excel.Name, rows, truncated));
        } while (excel.NextResult());
        return [.. sheets];
    }

    /// <summary>Throws ImportTooLargeException when the parts of the workbook add up to more than the ceiling once unpacked.</summary>
    private static void RefuseLargeZip(Stream stream)
    {
        long total = 0;
        using (var zip = new ZipArchive(stream, ZipArchiveMode.Read, leaveOpen: true))
            foreach (var entry in zip.Entries)
                if ((total += entry.Length) > ImportRules.MaxUnpackedBytes) throw new ImportTooLargeException();
        stream.Position = 0;
    }

    private static ParsedImportResult ParseCsv(Stream stream)
    {
        using var reader = new StreamReader(stream);
        using var csv = new CsvReader(reader, new CsvConfiguration(CultureInfo.InvariantCulture)
            { HasHeaderRecord = false, BadDataFound = null, MissingFieldFound = null });
        var rows = new List<object?[]>();
        while (csv.Read()) rows.Add(Enumerable.Range(0, csv.Parser.Count).Select(i => (object?)csv.GetField(i)).ToArray());
        return BuildResult(rows);
    }

    private static ParsedImportResult ParseExcel(Stream stream)
    {
        using var reader = ExcelReaderFactory.CreateReader(stream);
        var rows = new List<object?[]>();
        while (reader.Read())
        {
            var row = new object?[reader.FieldCount];
            for (var i = 0; i < row.Length; i++) row[i] = reader.GetValue(i);
            rows.Add(row);
        }
        return BuildResult(rows);
    }

    /// <summary>
    /// Sheet rows to columns and rows. The header is the row ImportRules.SuggestRange picks, so a report
    /// title block above the table is skipped. Blank rows are left out.
    /// </summary>
    private static ParsedImportResult BuildResult(List<object?[]> sheetRows)
    {
        var (headerRow, _) = ImportRules.SuggestRange(sheetRows);
        if (headerRow == 0) return BuildResult([], []);

        var header = sheetRows[headerRow - 1];
        var data = sheetRows.Skip(headerRow).Where(r => !ImportRules.IsBlank(r)).ToList();
        var width = data.Prepend(header).Max(r => Array.FindLastIndex(r, c => ImportRules.Cell(c).Length > 0) + 1);
        string At(object?[] row, int c) => c < row.Length ? row[c]?.ToString() ?? "" : "";

        var used = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var headers = new List<string>(width);
        for (var c = 0; c < width; c++)
        {
            var text = At(header, c).Trim();
            if (text.Length == 0) text = $"Column{c + 1}";
            var name = text;
            for (var n = 2; !used.Add(name); n++) name = $"{text}_{n}";
            headers.Add(name);
        }

        var rawRows = data.Select(r => headers.Select((h, c) => (h, v: (string?)At(r, c))).ToDictionary(x => x.h, x => x.v)).ToList();
        return BuildResult(headers, rawRows);
    }

    private static ParsedImportResult ParseJson(Stream stream)
    {
        using var doc = JsonDocument.Parse(stream);
        if (doc.RootElement.ValueKind != JsonValueKind.Array)
            throw new InvalidOperationException("JSON file must contain an array of objects.");

        var headers = new List<string>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var rawRows = new List<Dictionary<string, string?>>();

        foreach (var element in doc.RootElement.EnumerateArray())
        {
            var dict = new Dictionary<string, string?>();
            if (element.ValueKind == JsonValueKind.Object)
            {
                foreach (var prop in element.EnumerateObject())
                {
                    if (seen.Add(prop.Name)) headers.Add(prop.Name);
                    dict[prop.Name] = prop.Value.ValueKind switch
                    {
                        JsonValueKind.String => prop.Value.GetString(),
                        JsonValueKind.Null => null,
                        JsonValueKind.True or JsonValueKind.False => prop.Value.GetRawText(),
                        _ => prop.Value.GetRawText()
                    };
                }
            }
            rawRows.Add(dict);
        }
        return BuildResult(headers, rawRows);
    }

    private static ParsedImportResult BuildResult(IReadOnlyList<string> headers, List<Dictionary<string, string?>> rawRows)
    {
        var columns = headers.Select(h => new ImportColumnDto(h, InferColumnType(h, rawRows))).ToList();
        var rows = rawRows
            .Select(r => headers.ToDictionary(h => h, h => ConvertValue(r.GetValueOrDefault(h))))
            .ToList();
        return new ParsedImportResult(columns, rows);
    }

    private static string InferColumnType(string column, List<Dictionary<string, string?>> rows)
    {
        var sample = rows.Take(50)
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
