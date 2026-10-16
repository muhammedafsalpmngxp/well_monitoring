using TWise.Tenant.Domain.Entities.Model;

namespace TWise.Tenant.Application.Features.Model.Imports;

/// <summary>An uploaded file, read into memory by the controller.</summary>
public sealed record ImportFile(string FileName, byte[] Content);

/// <summary>
/// How to read a sheet. A null value means "suggest it": the first sheet with data, the suggested rows, the
/// inferred types. TableName is the new table's name; a replace keeps the old one.
/// </summary>
public sealed record ImportOptions(string? Sheet, int? HeaderRow, int? LastRow, IReadOnlyList<string>? Types, string? TableName);

/// <summary>What the navigator shows for a sheet before it is loaded. Rows are the first data rows, as text.</summary>
public sealed record ImportPreviewDto(
    IReadOnlyList<string> Sheets, string Sheet, int SheetRows, int HeaderRow, int LastRow,
    IReadOnlyList<ImportColumn> Columns, IReadOnlyList<IReadOnlyList<string>> Rows, int DataRows, string SuggestedTableName);

public sealed record ImportTableDto(
    long Id, string TableName, string FileName, string? SheetName, int HeaderRow, int LastRow, int LoadedRows, DateTime ModifiedAt)
{
    public static ImportTableDto From(ImportTable t)
        => new(t.Id, t.TableName, t.FileName, t.SheetName, t.HeaderRow, t.LastRow, t.LoadedRows, t.ModifiedAt);
}
