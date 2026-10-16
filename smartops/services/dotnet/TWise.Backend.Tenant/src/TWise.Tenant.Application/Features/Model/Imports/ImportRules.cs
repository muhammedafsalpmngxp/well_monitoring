using System.Globalization;
using System.Text.RegularExpressions;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Application.Features.Model.Datasets;
using TWise.Tenant.Domain.Entities.Model;

namespace TWise.Tenant.Application.Features.Model.Imports;

/// <summary>One sheet of an uploaded file as raw cells, top row first. Truncated when it had more rows than were read.</summary>
public sealed record ImportSheet(string Name, IReadOnlyList<object?[]> Rows, bool Truncated = false);

/// <summary>An .xlsx whose parts add up to more than ImportRules.MaxUnpackedBytes once unpacked.</summary>
public sealed class ImportTooLargeException() : Exception("The workbook unpacks to more than the upload ceiling.");

/// <summary>
/// Two column names of a sheet that the database's collation counts as one, although ImportRules.ColumnNames
/// made them unique ignoring case (for example names that differ only in accents).
/// </summary>
public sealed class DuplicateImportColumnException() : Exception("Two columns of the sheet have the same name in the database.");

/// <summary>A column of an import table. Type is one of ImportTypes.All.</summary>
public sealed record ImportColumn(string Name, string Type);

/// <summary>The data of a sheet ready to load: its columns, the converted rows, and each row's number in the sheet (from 1).</summary>
public sealed record ImportShape(IReadOnlyList<ImportColumn> Columns, IReadOnlyList<object?[]> Rows, IReadOnlyList<int> RowNumbers);

/// <summary>The column types an import table can have.</summary>
public static class ImportTypes
{
    public const string Text = "text";
    public const string Whole = "whole";
    public const string Number = "decimal";
    public const string Date = "date";
    public const string DateAndTime = "datetime";
    public const string TrueFalse = "boolean";

    public static readonly IReadOnlyList<string> All = [Text, Whole, Number, Date, DateAndTime, TrueFalse];
}

/// <summary>
/// Rules for loading an uploaded sheet into a table of the import schema.
/// Pure, so every rule is pinned by a unit test.
/// </summary>
public static partial class ImportRules
{
    public const string Schema = "import";
    public const int MaxBytes = 10 * 1024 * 1024;
    public const int MaxDataRows = 100_000;
    public const int MaxColumns = 200;

    /// <summary>Rows read per sheet: the data cap plus room for a title, the header and total rows.</summary>
    public const int MaxSheetRows = MaxDataRows + 100;

    /// <summary>Cells read from a file across all its sheets, which bounds the memory one upload takes.</summary>
    public const int MaxCells = 3_000_000;

    /// <summary>What the parts of an .xlsx may add up to once unpacked; a 10 MB workbook of real data stays well under.</summary>
    public const long MaxUnpackedBytes = 100L * 1024 * 1024;

    private static readonly byte[] ZipSignature = [0x50, 0x4B, 0x03, 0x04];
    private static readonly byte[] OleSignature = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];

    /// <summary>
    /// "xlsx", "xls" or "csv" when the file's first bytes match what its extension claims; null for anything
    /// else, so a workbook with macros (.xlsm), a renamed file or a binary file called .csv is refused.
    /// </summary>
    public static string? FileKind(string fileName, ReadOnlySpan<byte> head) => Path.GetExtension(fileName).ToLowerInvariant() switch
    {
        ".xlsx" when head.StartsWith(ZipSignature) => "xlsx",
        ".xls" when head.StartsWith(OleSignature) => "xls",
        ".csv" when head[..Math.Min(head.Length, 4096)].IndexOf((byte)0) < 0 => "csv",
        _ => null,
    };

    [GeneratedRegex(@"^https://docs\.google\.com/spreadsheets/d/([A-Za-z0-9_-]{20,100})(?:[/?#]|\z)", RegexOptions.CultureInvariant)]
    private static partial Regex GoogleSheetLink();

    /// <summary>
    /// The .xlsx export address of a Google Sheets link, or null for any other address. Only the sheet's id is
    /// taken from the link, so the server never asks any host but docs.google.com.
    /// </summary>
    public static Uri? GoogleSheetExport(string? link)
        => link is not null && GoogleSheetLink().Match(link.Trim()) is { Success: true } match
            ? new Uri($"https://docs.google.com/spreadsheets/d/{match.Groups[1].Value}/export?format=xlsx")
            : null;

    [GeneratedRegex(@"^[A-Za-z][A-Za-z0-9_]{0,99}\z", RegexOptions.CultureInvariant)]
    private static partial Regex TableNamePattern();

    [GeneratedRegex("[^A-Za-z0-9]+", RegexOptions.CultureInvariant)]
    private static partial Regex NotAsciiWord();

    [GeneratedRegex(@"[^\p{L}\p{Nd}_]+", RegexOptions.CultureInvariant)]
    private static partial Regex NotNameCharacter();

    /// <summary>A letter, then letters, digits and underscores, at most 100 characters.</summary>
    public static bool IsTableName(string? name) => name is not null && TableNamePattern().IsMatch(name);

    /// <summary>A table name from the file name and, for a workbook with several sheets, the sheet name.</summary>
    public static string SuggestTableName(string fileName, string? sheet)
    {
        var raw = Path.GetFileNameWithoutExtension(fileName) + (string.IsNullOrWhiteSpace(sheet) ? "" : "_" + sheet);
        var name = NotAsciiWord().Replace(raw, "_").Trim('_');
        if (name.Length == 0 || !char.IsAsciiLetter(name[0])) name = ("Upload_" + name).TrimEnd('_');
        return name[..Math.Min(name.Length, 100)].TrimEnd('_');
    }

    /// <summary>
    /// Column names from the header cells: letters of any language, digits and underscores, with any other run
    /// of characters turned into one space; trimmed, at most 120 characters, and unique ignoring case ("crew 2").
    /// A header with nothing left is "Column N", N being its position.
    /// </summary>
    public static IReadOnlyList<string> ColumnNames(IReadOnlyList<object?> header)
    {
        var used = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var names = new List<string>(header.Count);
        for (var i = 0; i < header.Count; i++)
        {
            var text = NotNameCharacter().Replace(Cell(header[i]), " ").Trim();
            if (text.Length == 0) text = $"Column {i + 1}";
            text = text[..Math.Min(text.Length, 120)].TrimEnd();
            var name = text;
            for (var n = 2; !used.Add(name); n++) name = $"{text} {n}";
            names.Add(name);
        }
        return names;
    }

    /// <summary>A cell as text, as the preview shows it: numbers and dates in invariant form, blank as "".</summary>
    public static string Cell(object? value) => value switch
    {
        null or DBNull => "",
        string s => s.Trim(),
        double d => d.ToString("R", CultureInfo.InvariantCulture),
        DateTime dt when dt.TimeOfDay == TimeSpan.Zero => dt.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        DateTime dt => dt.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture),
        bool b => b ? "true" : "false",
        IFormattable f => f.ToString(null, CultureInfo.InvariantCulture).Trim(),
        _ => value.ToString()?.Trim() ?? "",
    };

    [GeneratedRegex(@"\b(sub)?totals?\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex TotalLabel();

    // ISO forms only, so 03/04/2026 is never read as the wrong month.
    private static readonly string[] DateForms =
        ["yyyy-MM-dd", "yyyy-MM-dd HH:mm", "yyyy-MM-dd HH:mm:ss", "yyyy-MM-dd'T'HH:mm", "yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd'T'HH:mm:ss.FFFFFFF"];

    // Beyond 2^53 a double no longer holds every whole number exactly.
    private const double MaxExactWhole = 9_007_199_254_740_992d;

    // Below System.Decimal's limit; DECIMAL(38, 6) holds up to 10^32.
    private const double MaxNumber = 1e28;

    public static bool IsBlank(object?[] row) => row.All(c => Cell(c).Length == 0);

    /// <summary>
    /// The header row and last data row to suggest, counted from 1. The header is the
    /// first row with at least half as many filled cells as the fullest row, so a title line above it is
    /// skipped. The data ends at the last row that is not blank, leaving out trailing rows whose first filled
    /// cell says total, totals or subtotal. (0, 0) for a blank sheet.
    /// </summary>
    public static (int HeaderRow, int LastRow) SuggestRange(IReadOnlyList<object?[]> rows)
    {
        var filled = rows.Select(row => row.Count(c => Cell(c).Length > 0)).ToList();
        var most = filled.DefaultIfEmpty(0).Max();
        if (most == 0) return (0, 0);

        var header = filled.FindIndex(count => count * 2 >= most);
        var last = rows.Count - 1;
        while (last > header && (IsBlank(rows[last]) || IsTotal(rows[last]))) last--;
        return (header + 1, last + 1);
    }

    private static bool IsTotal(object?[] row)
        => row.Select(Cell).FirstOrDefault(text => text.Length > 0) is { } first && TotalLabel().IsMatch(first);

    /// <summary>The value as the column type stores it, or false when it does not convert. A blank cell is NULL for every type.</summary>
    public static bool TryConvert(object? value, string type, out object? result)
    {
        result = null;
        var text = Cell(value);
        if (text.Length == 0) return true;

        switch (type)
        {
            case ImportTypes.Text:
                result = text;
                return true;
            case ImportTypes.Whole when value is double d && Math.Abs(d) < MaxExactWhole && d == Math.Floor(d):
                result = (long)d;
                return true;
            case ImportTypes.Whole when value is string && long.TryParse(text, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var whole):
                result = whole;
                return true;
            case ImportTypes.Number when value is double d && Math.Abs(d) < MaxNumber:
                result = Math.Round((decimal)d, 6);
                return true;
            case ImportTypes.Number when value is string
                && decimal.TryParse(text, NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var number)
                && Math.Abs(number) < (decimal)MaxNumber:
                result = Math.Round(number, 6);
                return true;
            case ImportTypes.Date or ImportTypes.DateAndTime when value is DateTime dt:
                result = type == ImportTypes.Date ? dt.Date : dt;
                return true;
            case ImportTypes.Date or ImportTypes.DateAndTime
                when value is string && DateTime.TryParseExact(text, DateForms, CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed):
                result = type == ImportTypes.Date ? parsed.Date : parsed;
                return true;
            case ImportTypes.TrueFalse when value is bool b:
                result = b;
                return true;
            case ImportTypes.TrueFalse when value is string && bool.TryParse(text, out var flag):
                result = flag;
                return true;
            default:
                return false;
        }
    }

    /// <summary>The narrowest type every non-blank value converts to: true/false, whole number, number, date, date and time, else text.</summary>
    public static string InferType(IEnumerable<object?> values)
    {
        var candidates = new List<string> { ImportTypes.TrueFalse, ImportTypes.Whole, ImportTypes.Number, ImportTypes.Date, ImportTypes.DateAndTime };
        var any = false;
        foreach (var value in values)
        {
            if (Cell(value).Length == 0) continue;
            any = true;
            candidates.RemoveAll(type => !TryConvert(value, type, out _) || (type == ImportTypes.Date && HasTime(value)));
            if (candidates.Count == 0) break;
        }
        return any && candidates.Count > 0 ? candidates[0] : ImportTypes.Text;
    }

    private static bool HasTime(object? value)
        => TryConvert(value, ImportTypes.DateAndTime, out var converted) && converted is DateTime dt && dt.TimeOfDay != TimeSpan.Zero;

    /// <summary>
    /// The columns and converted data rows between the header row and the last data row (both from 1), with
    /// blank rows left out and blank columns at the right ignored. Types are inferred from every data row,
    /// unless given in column order.
    /// </summary>
    public static Result<ImportShape> Shape(ImportSheet sheet, int headerRow, int lastRow, IReadOnlyList<string>? types = null)
    {
        if (sheet.Truncated)
            return Result<ImportShape>.ValidationError($"The sheet {sheet.Name} has more than 100,000 rows or 3,000,000 cells. Split it into smaller files.");
        if (headerRow < 1 || headerRow > sheet.Rows.Count)
            return Result<ImportShape>.ValidationError($"The header row must be between 1 and {sheet.Rows.Count}.");
        if (lastRow <= headerRow || lastRow > sheet.Rows.Count)
            return Result<ImportShape>.ValidationError($"The last data row must be after the header row and at most {sheet.Rows.Count}.");

        // Indexes from 0 of the non-blank rows after the header, up to and including the last data row.
        var data = Enumerable.Range(headerRow, lastRow - headerRow).Where(i => !IsBlank(sheet.Rows[i])).ToList();
        if (data.Count == 0)
            return Result<ImportShape>.ValidationError("There are no data rows between the header row and the last data row.");
        if (data.Count > MaxDataRows)
            return Result<ImportShape>.ValidationError($"The sheet {sheet.Name} has more than 100,000 rows. Split it into smaller files.");

        object? At(int row, int column) => column < sheet.Rows[row].Length ? sheet.Rows[row][column] : null;
        var width = data.Prepend(headerRow - 1).Max(r => Array.FindLastIndex(sheet.Rows[r], c => Cell(c).Length > 0) + 1);
        if (width > MaxColumns)
            return Result<ImportShape>.ValidationError($"The sheet {sheet.Name} has more than {MaxColumns} columns. Remove the columns you do not need.");
        if (types is not null && (types.Count != width || types.Any(t => !ImportTypes.All.Contains(t))))
            return Result<ImportShape>.ValidationError("Choose a type for every column.");

        var names = ColumnNames(Enumerable.Range(0, width).Select(c => At(headerRow - 1, c)).ToList());
        var columnTypes = types ?? Enumerable.Range(0, width).Select(c => InferType(data.Select(r => At(r, c)))).ToList();

        var rows = new List<object?[]>(data.Count);
        foreach (var r in data)
        {
            var row = new object?[width];
            for (var c = 0; c < width; c++)
            {
                if (!TryConvert(At(r, c), columnTypes[c], out row[c]))
                    return Result<ImportShape>.ValidationError(
                        $"Row {r + 1}, column {names[c]}: \"{Cell(At(r, c))}\" is not {TypeLabel(columnTypes[c])}. Choose Text for this column, or correct the file.");
            }
            rows.Add(row);
        }
        return Result<ImportShape>.Success(new ImportShape(
            names.Select((name, c) => new ImportColumn(name, columnTypes[c])).ToList(), rows, data.Select(r => r + 1).ToList()));
    }

    private static string TypeLabel(string type) => type switch
    {
        ImportTypes.Whole => "a whole number",
        ImportTypes.Number => "a number",
        ImportTypes.Date => "a date",
        ImportTypes.DateAndTime => "a date and time",
        ImportTypes.TrueFalse => "true or false",
        _ => "text",
    };

    /// <summary>[import].[name], for the DDL and the bulk copy. Callers check the name with IsTableName first.</summary>
    public static string QualifiedName(string table) => $"{Quote(Schema)}.{Quote(table)}";

    /// <summary>The SQL Server type of each column. Text is NVARCHAR(MAX) only when a value needs it.</summary>
    public static IReadOnlyList<string> SqlTypes(ImportShape shape) => shape.Columns.Select((column, c) => column.Type switch
    {
        ImportTypes.Whole => "BIGINT",
        ImportTypes.Number => "DECIMAL(38, 6)",
        ImportTypes.Date => "DATE",
        ImportTypes.DateAndTime => "DATETIME2(3)",
        ImportTypes.TrueFalse => "BIT",
        _ => shape.Rows.Any(row => row[c] is string s && s.Length > 4000) ? "NVARCHAR(MAX)" : "NVARCHAR(4000)",
    }).ToList();

    /// <summary>
    /// The statements that create the table, after dropping the old one when replacing. Only the import schema
    /// is ever named, and every identifier is bracket-quoted, even though names were already sanitised.
    /// </summary>
    public static string WriteTableSql(string table, ImportShape shape, bool replace)
    {
        var types = SqlTypes(shape);
        var columns = shape.Columns.Select((column, c) => $"    {Quote(column.Name)} {types[c]} NULL");
        var create = $"CREATE TABLE {QualifiedName(table)} (\n{string.Join(",\n", columns)}\n);";
        return replace ? $"DROP TABLE IF EXISTS {QualifiedName(table)};\n{create}" : create;
    }

    /// <summary>
    /// The table's columns as a schema sync writes them to core.DatabaseSchema: the type
    /// name as INFORMATION_SCHEMA.DATA_TYPE gives it, and the character length of text (-1 for MAX).
    /// </summary>
    public static IReadOnlyList<(string Name, string DataType, int? MaxLength)> CatalogRows(ImportShape shape)
    {
        var types = SqlTypes(shape);
        var rows = new List<(string, string, int?)>(types.Count);
        for (var c = 0; c < types.Count; c++)
        {
            int? length = types[c] switch { "NVARCHAR(MAX)" => -1, "NVARCHAR(4000)" => 4000, _ => null };
            rows.Add((shape.Columns[c].Name, types[c].Split('(')[0].ToLowerInvariant(), length));
        }
        return rows;
    }

    /// <summary>The table's columns as the dataset rules see them.</summary>
    public static IReadOnlyList<CatalogColumn> CatalogColumns(string table, ImportShape shape)
        => CatalogRows(shape).Select(r => new CatalogColumn(Schema, table, r.Name, false, false, null, null, null, r.DataType)).ToList();

    /// <summary>The .NET type the bulk copy sends for a column type.</summary>
    public static Type ClrType(string type) => type switch
    {
        ImportTypes.Whole => typeof(long),
        ImportTypes.Number => typeof(decimal),
        ImportTypes.Date or ImportTypes.DateAndTime => typeof(DateTime),
        ImportTypes.TrueFalse => typeof(bool),
        _ => typeof(string),
    };

    /// <summary>
    /// Why replacing the columns of import.table would break a dataset that uses it, or null when it would not
    ///: a relationship or a plant filter on a column that goes away, or a measure that
    /// or calculated column that works today and would stop compiling, which includes a number column that
    /// becomes text. before and
    /// after are the catalogue columns of all the dataset's sources, with the table's old and new columns.
    /// </summary>
    public static string? ReplacementProblem(
        string datasetName, DatasetParts parts, IReadOnlyList<CatalogColumn> before, IReadOnlyList<CatalogColumn> after, string table)
        => ColumnChangeProblem(datasetName, parts, before, after,
            parts.Sources.Where(s => s.SourceKind == "table" && Same(s.SchemaName, Schema) && Same(s.SourceName, table)), "the new file");

    /// <summary>The view and script sources whose stored SQL reads import.table.</summary>
    public static IReadOnlyList<DatasetSource> ViewSourcesReading(DatasetParts parts, string table)
        => parts.Sources
            .Where(s => s.SourceKind is "view" or ScriptSource.Kind && !string.IsNullOrWhiteSpace(s.ViewSql)
                        && ViewSource.Tables(s.ViewSql).Any(t => Same(t.Schema, Schema) && Same(t.Table, table)))
            .ToList();

    /// <summary>
    /// As ReplacementProblem, for any change of the columns of the changed sources. replacement names where
    /// their columns come from now, for the message ("the new file", "the view").
    /// </summary>
    public static string? ColumnChangeProblem(
        string datasetName, DatasetParts parts, IReadOnlyList<CatalogColumn> before, IReadOnlyList<CatalogColumn> after,
        IEnumerable<DatasetSource> changed, string replacement)
    {
        var catalog = DatasetRules.Catalog(after);
        foreach (var source in changed)
        {
            if (source.RlsMode == "plant" && catalog.Column(source.SchemaName, source.SourceName, source.RlsPlantColumn ?? "") is null)
                return $"The data model \"{datasetName}\" filters {source.Alias} by the column {source.RlsPlantColumn}, which {replacement} does not have.";

            foreach (var relationship in parts.Relationships.Where(r => r.FromSourceId == source.Id || r.ToSourceId == source.Id))
            {
                var column = relationship.FromSourceId == source.Id ? relationship.FromColumn : relationship.ToColumn;
                if (catalog.Column(source.SchemaName, source.SourceName, column) is null)
                    return $"The data model \"{datasetName}\" relates {source.Alias} on the column {column}, which {replacement} does not have.";
            }
        }

        (string Name, string Reason)? Measure(IReadOnlyList<CatalogColumn> columns, IEnumerable<DatasetMeasure> measures)
            => DatasetRules.FirstBrokenMeasure(parts.Sources, parts.Relationships, columns, measures, parts.CalculatedColumns, parts.Transforms, parts.Measures);

        var working = parts.Measures.Where(m => Measure(before, [m]) is null).ToList();
        if (Measure(after, working) is { } broken)
            return $"The measure \"{broken.Name}\" in the data model \"{datasetName}\" would stop working: {broken.Reason}";

        var workingColumns = parts.CalculatedColumns.Where(c => DatasetRules.FirstBrokenColumn(parts, before, [c]) is null).ToList();
        return DatasetRules.FirstBrokenColumn(parts, after, workingColumns) is { } brokenColumn
            ? $"The calculated column \"{parts.Sources.First(s => s.Id == brokenColumn.SourceId).Alias}.{brokenColumn.Name}\" in the data model \"{datasetName}\" would stop working. Change or delete it first."
            : null;
    }

    private static string Quote(string identifier) => "[" + identifier.Replace("]", "]]") + "]";

    private static bool Same(string? a, string? b) => string.Equals(a, b, StringComparison.OrdinalIgnoreCase);
}
