using MediatR;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Application.Features.Model.Datasets;
using TWise.Tenant.Domain.Entities.Model;

namespace TWise.Tenant.Application.Features.Model.Imports;

/// <summary>Steps the upload handlers share.</summary>
internal static class ImportFlow
{
    public const int PreviewRows = 50;

    /// <summary>Why a file cannot be loaded for the data model, or null. Files load into the tenant database only.</summary>
    public static async Task<string?> OtherDatabaseAsync(IDatasetRepository repo, Dataset dataset, CancellationToken ct)
    {
        var connection = (await repo.GetConnectionsAsync(dataset.TenantId, ct)).FirstOrDefault(c => c.Id == dataset.ConnectionId);
        return connection is not null && DatasetRules.IsTenantDatabase(connection, repo.TenantDatabaseName)
            ? null
            : $"Files load into the tenant database, so they can be added only to a data model on it. This data model reads {connection?.DatabaseName ?? "another database"}.";
    }

    /// <summary>The sheets of an uploaded file, or why it cannot be read.</summary>
    public static Result<IReadOnlyList<ImportSheet>> Read(IFileImportParserService parser, ImportFile file, string? sheet)
    {
        if (file.Content.Length == 0)
            return Result<IReadOnlyList<ImportSheet>>.ValidationError("Choose a file to upload.");
        if (file.Content.Length > ImportRules.MaxBytes)
            return Result<IReadOnlyList<ImportSheet>>.ValidationError("The file is larger than 10 MB. Split it into smaller files.");

        var kind = ImportRules.FileKind(file.FileName, file.Content.AsSpan(0, Math.Min(file.Content.Length, 4096)));
        if (kind is null)
            return Result<IReadOnlyList<ImportSheet>>.ValidationError(
                "Upload an Excel workbook (.xlsx or .xls) or a CSV file. The file's content must match its extension.");

        try
        {
            var sheets = parser.ReadSheets(new MemoryStream(file.Content, writable: false), kind, file.FileName, sheet,
                ImportRules.MaxSheetRows, ImportRules.MaxCells);
            return sheets.Length > 0
                ? Result<IReadOnlyList<ImportSheet>>.Success(sheets)
                : Result<IReadOnlyList<ImportSheet>>.ValidationError("The file has no sheets.");
        }
        catch (ImportTooLargeException)
        {
            return Result<IReadOnlyList<ImportSheet>>.ValidationError("The workbook holds more than 100 MB of data once unpacked. Split it into smaller files.");
        }
        // Any failure inside the reader means the file is damaged or not what it claims to be. The message is
        // the plain fix, never the reader's own text.
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return Result<IReadOnlyList<ImportSheet>>.ValidationError(kind == "csv"
                ? "The file could not be read as CSV. Save it again as CSV and retry."
                : "The file could not be read as an Excel workbook. Open it in Excel, save it again and retry.");
        }
    }

    /// <summary>The sheet the options name (or the first one with data rows), its rows, and its data ready to load.</summary>
    public static Result<(ImportSheet Sheet, int HeaderRow, int LastRow, ImportShape Shape)> Shape(
        IReadOnlyList<ImportSheet> sheets, ImportOptions options)
    {
        // With no sheet named, the first sheet that has rows under a header, so a cover sheet is passed over.
        var sheet = options.Sheet is null
            ? sheets.FirstOrDefault(s => ImportRules.SuggestRange(s.Rows) is var (header, last) && last > header) ?? sheets[0]
            : sheets.FirstOrDefault(s => s.Name == options.Sheet);
        if (sheet is null)
            return Result<(ImportSheet, int, int, ImportShape)>.ValidationError($"The file has no sheet called \"{options.Sheet}\".");

        var (suggestedHeader, suggestedLast) = ImportRules.SuggestRange(sheet.Rows);
        if (suggestedHeader == 0)
            return Result<(ImportSheet, int, int, ImportShape)>.ValidationError($"The sheet {sheet.Name} is empty.");

        var headerRow = options.HeaderRow ?? suggestedHeader;
        var lastRow = options.LastRow ?? suggestedLast;
        var shape = ImportRules.Shape(sheet, headerRow, lastRow, options.Types);
        return shape.IsSuccess
            ? Result<(ImportSheet, int, int, ImportShape)>.Success((sheet, headerRow, lastRow, shape.Value!))
            : Result<(ImportSheet, int, int, ImportShape)>.ValidationError(shape.ErrorMessage!);
    }

    /// <summary>The written table; the conflict message when the store returns null; a validation error for clashing column names.</summary>
    public static async Task<Result<ImportTableDto>> WriteAsync(
        IImportTableStore store, ImportTable table, ImportShape shape, string conflict, CancellationToken ct)
    {
        try
        {
            return await store.WriteAsync(table, shape, ct) is { } written
                ? Result<ImportTableDto>.Success(ImportTableDto.From(written))
                : Result<ImportTableDto>.Conflict(conflict);
        }
        catch (DuplicateImportColumnException)
        {
            return Result<ImportTableDto>.ValidationError(
                "Two column headers of the sheet count as the same name in the database. Rename one of them in the file and upload it again.");
        }
    }

    /// <summary>The file's own name, without any path a browser may send, as model.ImportTable stores it.</summary>
    public static string FileName(ImportFile file) => Clip(Path.GetFileName(file.FileName), 260);

    public static string Clip(string text, int length) => text[..Math.Min(text.Length, length)];
}

public sealed class ListImportsHandler(IDatasetRepository repo, IImportTableStore store)
    : IRequestHandler<ListImportsQuery, Result<IReadOnlyList<ImportTableDto>>>
{
    public async Task<Result<IReadOnlyList<ImportTableDto>>> Handle(ListImportsQuery query, CancellationToken ct)
        => await repo.GetAsync(query.DatasetId, query.TenantId, ct) is { } dataset
            ? Result<IReadOnlyList<ImportTableDto>>.Success(
                (await store.ListAsync(dataset.ConnectionId, query.TenantId, ct)).Select(ImportTableDto.From).ToList())
            : Result<IReadOnlyList<ImportTableDto>>.NotFound("The data model does not exist.");
}

public sealed class PreviewImportHandler(IDatasetRepository repo, IFileImportParserService parser)
    : IRequestHandler<PreviewImportQuery, Result<ImportPreviewDto>>
{
    public async Task<Result<ImportPreviewDto>> Handle(PreviewImportQuery query, CancellationToken ct)
    {
        if (await repo.GetAsync(query.DatasetId, query.TenantId, ct) is null)
            return Result<ImportPreviewDto>.NotFound("The data model does not exist.");

        var sheets = ImportFlow.Read(parser, query.File, query.Options.Sheet);
        if (!sheets.IsSuccess) return Result<ImportPreviewDto>.ValidationError(sheets.ErrorMessage!);
        var read = ImportFlow.Shape(sheets.Value!, query.Options);
        if (!read.IsSuccess) return Result<ImportPreviewDto>.ValidationError(read.ErrorMessage!);

        var (sheet, headerRow, lastRow, shape) = read.Value;
        return Result<ImportPreviewDto>.Success(new ImportPreviewDto(
            sheets.Value!.Select(s => s.Name).ToList(), sheet.Name, sheet.Rows.Count, headerRow, lastRow, shape.Columns,
            shape.Rows.Take(ImportFlow.PreviewRows).Select(row => (IReadOnlyList<string>)row.Select(ImportRules.Cell).ToList()).ToList(),
            shape.Rows.Count,
            ImportRules.SuggestTableName(query.File.FileName, sheets.Value!.Count > 1 ? sheet.Name : null)));
    }
}

public sealed class CreateImportHandler(IDatasetRepository repo, IFileImportParserService parser, IImportTableStore store)
    : IRequestHandler<CreateImportCommand, Result<ImportTableDto>>
{
    public async Task<Result<ImportTableDto>> Handle(CreateImportCommand cmd, CancellationToken ct)
    {
        if (await repo.GetAsync(cmd.DatasetId, cmd.TenantId, ct) is not { } dataset)
            return Result<ImportTableDto>.NotFound("The data model does not exist.");
        if (await ImportFlow.OtherDatabaseAsync(repo, dataset, ct) is { } refusal)
            return Result<ImportTableDto>.ValidationError(refusal);

        var name = cmd.Options.TableName?.Trim();
        if (!ImportRules.IsTableName(name))
            return Result<ImportTableDto>.ValidationError(
                "A table name starts with a letter and uses letters, digits and underscores, at most 100 characters.");
        if (cmd.Options.Types is null)
            return Result<ImportTableDto>.ValidationError("Choose a type for every column.");

        var sheets = ImportFlow.Read(parser, cmd.File, cmd.Options.Sheet);
        if (!sheets.IsSuccess) return Result<ImportTableDto>.ValidationError(sheets.ErrorMessage!);
        var read = ImportFlow.Shape(sheets.Value!, cmd.Options);
        if (!read.IsSuccess) return Result<ImportTableDto>.ValidationError(read.ErrorMessage!);
        if (await store.NameTakenAsync(name!, ct))
            return Result<ImportTableDto>.Conflict($"A loaded table called {name} already exists. Choose another name, or replace that table.");

        var (sheet, headerRow, lastRow, shape) = read.Value;
        var table = new ImportTable
        {
            TenantId = cmd.TenantId, ConnectionId = dataset.ConnectionId, TableName = name!, FileName = ImportFlow.FileName(cmd.File),
            SheetName = ImportFlow.Clip(sheet.Name, 128), HeaderRow = headerRow, LastRow = lastRow, CreatedBy = cmd.UserId, ModifiedBy = cmd.UserId,
        };
        return await ImportFlow.WriteAsync(store, table, shape, $"A table called {name} already exists in the import schema. Choose another name.", ct);
    }
}

public sealed class ReplaceImportHandler(IDatasetRepository repo, IFileImportParserService parser, IImportTableStore store)
    : IRequestHandler<ReplaceImportCommand, Result<ImportTableDto>>
{
    public async Task<Result<ImportTableDto>> Handle(ReplaceImportCommand cmd, CancellationToken ct)
    {
        if (await repo.GetAsync(cmd.DatasetId, cmd.TenantId, ct) is not { } dataset)
            return Result<ImportTableDto>.NotFound("The data model does not exist.");
        if (await ImportFlow.OtherDatabaseAsync(repo, dataset, ct) is { } refusal)
            return Result<ImportTableDto>.ValidationError(refusal);
        if (await store.GetAsync(cmd.ImportId, cmd.TenantId, ct) is not { } table || table.ConnectionId != dataset.ConnectionId)
            return Result<ImportTableDto>.NotFound("The loaded table does not exist.");
        if (cmd.Options.Types is null)
            return Result<ImportTableDto>.ValidationError("Choose a type for every column.");

        var sheets = ImportFlow.Read(parser, cmd.File, cmd.Options.Sheet);
        if (!sheets.IsSuccess) return Result<ImportTableDto>.ValidationError(sheets.ErrorMessage!);
        var read = ImportFlow.Shape(sheets.Value!, cmd.Options);
        if (!read.IsSuccess) return Result<ImportTableDto>.ValidationError(read.ErrorMessage!);
        var (sheet, headerRow, lastRow, shape) = read.Value;

        // Every dataset that uses the table must keep working with its new columns.
        var newColumns = ImportRules.CatalogColumns(table.TableName, shape);
        // A view source's SQL is not checked column by column, so it keeps working only if no column it may read changes.
        var changed = (await repo.GetColumnsAsync(table.ConnectionId, cmd.TenantId, [table.TableName], ct))
            .Where(o => string.Equals(o.Schema, ImportRules.Schema, StringComparison.OrdinalIgnoreCase)
                        && string.Equals(o.Table, table.TableName, StringComparison.OrdinalIgnoreCase)
                        && !newColumns.Any(n => string.Equals(n.Column, o.Column, StringComparison.OrdinalIgnoreCase)
                                                && string.Equals(n.DataType, o.DataType, StringComparison.OrdinalIgnoreCase)))
            .Select(o => o.Column)
            .ToList();
        foreach (var (user, parts) in await store.UsagesAsync(table.ConnectionId, cmd.TenantId, table.TableName, ct))
        {
            if (changed.Count > 0 && ImportRules.ViewSourcesReading(parts, table.TableName).FirstOrDefault() is { } view)
                return Result<ImportTableDto>.Conflict(
                    $"The data model \"{user.Name}\" reads {table.TableName} through the view source {view.Alias}, and the new file drops or changes " +
                    $"{string.Join(", ", changed)}. Keep those columns in the new file, or change the data model first.");

            var before = await DatasetFlow.ColumnsAsync(repo, user, parts.Sources, ct);
            var after = before
                .Where(c => !(string.Equals(c.Schema, ImportRules.Schema, StringComparison.OrdinalIgnoreCase)
                              && string.Equals(c.Table, table.TableName, StringComparison.OrdinalIgnoreCase)))
                .Concat(newColumns)
                .ToList();
            if (ImportRules.ReplacementProblem(user.Name, parts, before, after, table.TableName) is { } problem)
                return Result<ImportTableDto>.Conflict($"{problem} Keep those columns in the new file, or change the data model first.");
        }

        table.FileName = ImportFlow.FileName(cmd.File);
        table.SheetName = ImportFlow.Clip(sheet.Name, 128);
        table.HeaderRow = headerRow;
        table.LastRow = lastRow;
        table.ModifiedBy = cmd.UserId;
        return await ImportFlow.WriteAsync(store, table, shape, "The table was changed by someone else at the same time. Try again.", ct);
    }
}
