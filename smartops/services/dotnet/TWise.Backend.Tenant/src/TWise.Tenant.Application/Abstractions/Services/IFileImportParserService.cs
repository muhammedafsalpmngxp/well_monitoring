namespace TWise.Tenant.Application.Abstractions.Services;

/// <summary>Parses an uploaded file into a common {columns, rows} shape regardless of source format.</summary>
public interface IFileImportParserService
{
    ParsedImportResult Parse(Stream fileStream, string fileName, string fileType);

    /// <summary>
    /// Every sheet of an Excel workbook, or the one table of a CSV file, as raw cells: Excel cells keep their
    /// type (double, DateTime, bool, string), CSV cells are text. With a sheet named, only that sheet's rows
    /// are read and the others are listed without rows. At most maxRows rows are read per sheet and maxCells
    /// cells in all; the sheet where either cap is reached has ImportSheet.Truncated set, and no later sheet is
    /// read. fileKind is "xlsx", "xls" or "csv". Throws ImportTooLargeException for an .xlsx that unpacks to more
    /// than ImportRules.MaxUnpackedBytes.
    /// </summary>
    Features.Model.Imports.ImportSheet[] ReadSheets(Stream fileStream, string fileKind, string fileName, string? sheet, int maxRows, int maxCells);
}

public sealed record ParsedImportResult(
    IReadOnlyList<Domain.DTOs.ImportColumnDto> Columns,
    IReadOnlyList<Dictionary<string, object?>> Rows
);
