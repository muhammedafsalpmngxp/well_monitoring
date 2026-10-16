using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Domain.Entities.Model;

namespace TWise.Tenant.Application.Features.Model.Datasets;

/// <summary>Steps every dataset handler shares.</summary>
internal static class DatasetFlow
{
    public static Result<DatasetDetailDto> NoDataset() => Result<DatasetDetailDto>.NotFound("The data model does not exist.");

    public static Result<DatasetDetailDto> UnreadableMeasure() => Result<DatasetDetailDto>.ValidationError("Build the measure before saving it.");

    public static Result<DatasetDetailDto> UnreadableColumn() => Result<DatasetDetailDto>.ValidationError("Build the calculated column before saving it.");

    public static async Task<Result<DatasetDetailDto>> DetailAsync(IDatasetRepository repo, Dataset dataset, CancellationToken ct)
    {
        var parts = await repo.GetPartsAsync(dataset.Id, ct);
        var viewIds = ViewSource.Ids(parts.Sources);
        IReadOnlyList<PreparedView> views = viewIds.Count == 0 ? [] : await repo.GetViewsAsync(dataset.ConnectionId, dataset.TenantId, viewIds, ct);
        return Result<DatasetDetailDto>.Success(DatasetDetailDto.From(dataset, parts, views, await repo.GetConnectionsAsync(dataset.TenantId, ct)));
    }

    /// <summary>
    /// Why the source cannot be read from another connection of the tenant, or null when it can. A view's SQL names
    /// tables of the model's own database, so views come from there only.
    /// </summary>
    public static async Task<string?> OtherDatabaseProblemAsync(
        IDatasetRepository repo, Dataset dataset, long connectionId, string kind, CancellationToken ct)
    {
        if (kind is "view" or ScriptSource.Kind) return "Views can be added only from this data model's own database, because a view's SQL reads the tables of its own database.";
        var connections = await repo.GetConnectionsAsync(dataset.TenantId, ct);
        if (connections.FirstOrDefault(c => c.Id == connectionId) is not { } other) return "The database connection does not exist.";
        if (connections.FirstOrDefault(c => c.Id == dataset.ConnectionId) is not { } own) return "The data model's database connection no longer exists.";
        return DatasetRules.CannotJoin(own, other);
    }

    /// <summary>
    /// Catalogue columns of the given sources on the dataset's tenant: tables from core.DatabaseSchema of the
    /// connection each is read from, view sources as SQL Server describes their stored SQL on the dataset's own
    /// connection, script sources as it describes their stored batch, with row_order. A view source without stored SQL
    /// has no columns, so rules that use it fail with the usual "has no column" message.
    /// </summary>
    public static async Task<IReadOnlyList<CatalogColumn>> ColumnsAsync(
        IDatasetRepository repo, Dataset dataset, IEnumerable<DatasetSource> sources, CancellationToken ct)
    {
        var list = sources.ToList();
        var tables = new List<CatalogColumn>();
        foreach (var connection in list.Where(s => s.SourceKind == "table").GroupBy(s => s.ConnectionId ?? dataset.ConnectionId))
            tables.AddRange(await repo.GetColumnsAsync(connection.Key, dataset.TenantId,
                connection.Select(s => s.SourceName).Distinct(StringComparer.OrdinalIgnoreCase).ToList(), ct));
        var views = list.Where(s => s.SourceKind != "table").ToList();
        if (views.Count == 0) return tables;

        return [.. tables, .. await repo.GetViewSourceColumnsAsync(dataset.ConnectionId, dataset.TenantId, views, ct)];
    }

    /// <summary>
    /// A 409 when the change, given as the dataset's parts before and after it, would stop a stored
    /// measure or calculated column compiling; null when it would not. Ones that did not compile before
    /// the change are left out, so one already broken item does not block unrelated edits. Measures are
    /// checked first. Canvas objects and other saved field lists are not checked: they name fields as
    /// text in their own configuration, and show a plain refusal when they next run.
    /// </summary>
    public static Result<DatasetDetailDto>? BreaksADependant(DatasetParts before, DatasetParts after, IReadOnlyList<CatalogColumn> columns)
    {
        var measures = before.Measures.Where(m => Measure(before, [m]) is null).Select(m => m.Id).ToHashSet();
        if (Measure(after, after.Measures.Where(m => measures.Contains(m.Id))) is { } broken)
            return Result<DatasetDetailDto>.Conflict($"The measure \"{broken.Name}\" depends on this. Change or delete that measure first.");

        var calculated = before.CalculatedColumns.Where(c => DatasetRules.FirstBrokenColumn(before, columns, [c]) is null).Select(c => c.Id).ToHashSet();
        if (DatasetRules.FirstBrokenColumn(after, columns, after.CalculatedColumns.Where(c => calculated.Contains(c.Id))) is { } column)
            return Result<DatasetDetailDto>.Conflict(
                $"The calculated column \"{Alias(before, column.SourceId)}.{column.Name}\" depends on this. Change or delete that column first.");
        return null;

        (string Name, string Reason)? Measure(DatasetParts parts, IEnumerable<DatasetMeasure> items)
            => DatasetRules.FirstBrokenMeasure(parts.Sources, parts.Relationships, columns, items, parts.CalculatedColumns, parts.Transforms, parts.Measures);
    }

    /// <summary>Carries a failed rule result over to the handler's result type.</summary>
    public static Result<DatasetDetailDto> Failed<T>(Result<T> failed) => failed.Status switch
    {
        ResultStatus.Conflict => Result<DatasetDetailDto>.Conflict(failed.ErrorMessage!),
        ResultStatus.NotFound => Result<DatasetDetailDto>.NotFound(failed.ErrorMessage!),
        _ => Result<DatasetDetailDto>.ValidationError(failed.ErrorMessage!),
    };

    private static string Alias(DatasetParts parts, long sourceId) => parts.Sources.FirstOrDefault(s => s.Id == sourceId)?.Alias ?? "?";
}
