using System.Globalization;
using System.Text.Json;
using MediatR;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Application.Features.Model.Imports;
using TWise.Tenant.Domain.Entities.Model;

namespace TWise.Tenant.Application.Features.Model.Datasets;

public sealed class AddSourceHandler(IDatasetRepository repo) : IRequestHandler<AddSourceCommand, Result<DatasetDetailDto>>
{
    public async Task<Result<DatasetDetailDto>> Handle(AddSourceCommand cmd, CancellationToken ct)
    {
        if (await repo.GetAsync(cmd.DatasetId, cmd.TenantId, ct) is not { } dataset) return DatasetFlow.NoDataset();

        var parts = await repo.GetPartsAsync(dataset.Id, ct);
        var connectionId = cmd.Request.ConnectionId == dataset.ConnectionId ? null : cmd.Request.ConnectionId;
        if (connectionId is not null && await DatasetFlow.OtherDatabaseProblemAsync(repo, dataset, connectionId.Value, cmd.Request.Kind, ct) is { } problem)
            return Result<DatasetDetailDto>.ValidationError(problem);

        Result<DatasetSource> source;
        if (cmd.Request.Kind is "view" or ScriptSource.Kind)
        {
            IReadOnlyList<PreparedView> views = long.TryParse(cmd.Request.SourceName, NumberStyles.None, CultureInfo.InvariantCulture, out var viewId)
                ? await repo.GetViewsAsync(dataset.ConnectionId, dataset.TenantId, [viewId], ct)
                : [];
            source = cmd.Request.Kind == "view"
                ? DatasetRules.NewViewSource(dataset.Id, cmd.Request, views.FirstOrDefault(), parts.Sources)
                : DatasetRules.NewScriptSource(dataset.Id, cmd.Request, views.FirstOrDefault(), parts.Sources);
        }
        else
        {
            var columns = await repo.GetColumnsAsync(connectionId ?? dataset.ConnectionId, dataset.TenantId, [cmd.Request.SourceName], ct);
            source = DatasetRules.NewSource(dataset.Id, cmd.Request, columns, parts.Sources, connectionId);
        }
        if (!source.IsSuccess) return DatasetFlow.Failed(source);

        await repo.AddAsync(source.Value!, ct);
        return await DatasetFlow.DetailAsync(repo, dataset, ct);
    }
}

public sealed class UpdateSourceHandler(IDatasetRepository repo) : IRequestHandler<UpdateSourceCommand, Result<DatasetDetailDto>>
{
    public async Task<Result<DatasetDetailDto>> Handle(UpdateSourceCommand cmd, CancellationToken ct)
    {
        if (await repo.GetAsync(cmd.DatasetId, cmd.TenantId, ct) is not { } dataset) return DatasetFlow.NoDataset();

        var parts = await repo.GetPartsAsync(dataset.Id, ct);
        if (parts.Sources.FirstOrDefault(s => s.Id == cmd.SourceId) is not { } source)
            return Result<DatasetDetailDto>.NotFound("The table is not part of this data model.");

        // The plant filter reads the stored plant code (QueryCompiler.RlsPredicate), so it cannot use a transformed column.
        if (cmd.Request.RlsMode == "plant" && parts.Transforms.Any(t => t.SourceId == source.Id
                && string.Equals(t.ColumnName, cmd.Request.RlsPlantColumn, StringComparison.OrdinalIgnoreCase)))
            return Result<DatasetDetailDto>.ValidationError(
                $"{source.Alias}.{cmd.Request.RlsPlantColumn} has a transform, so it cannot decide who sees which rows. " +
                "Remove its transform first, or choose another column.");

        var columns = await DatasetFlow.ColumnsAsync(repo, dataset, [source], ct);
        var applied = DatasetRules.ApplyRls(source, cmd.Request.RlsMode, cmd.Request.RlsPlantColumn, columns);
        if (!applied.IsSuccess) return DatasetFlow.Failed(applied);

        await repo.SaveAsync(ct);
        return await DatasetFlow.DetailAsync(repo, dataset, ct);
    }
}

/// <summary>Names a table for people and describes it. The alias, which formulas use, does not change.</summary>
public sealed class SetSourceDetailsHandler(IDatasetRepository repo) : IRequestHandler<SetSourceDetailsCommand, Result<DatasetDetailDto>>
{
    public async Task<Result<DatasetDetailDto>> Handle(SetSourceDetailsCommand cmd, CancellationToken ct)
    {
        if (await repo.GetAsync(cmd.DatasetId, cmd.TenantId, ct) is not { } dataset) return DatasetFlow.NoDataset();

        var parts = await repo.GetPartsAsync(dataset.Id, ct);
        if (parts.Sources.FirstOrDefault(s => s.Id == cmd.SourceId) is not { } source)
            return Result<DatasetDetailDto>.NotFound("The table is not part of this data model.");

        var caption = cmd.Request.Caption?.Trim();
        if (!string.IsNullOrEmpty(caption) && parts.Sources.Any(s => s.Id != source.Id
                && string.Equals(s.Caption ?? s.Alias, caption, StringComparison.OrdinalIgnoreCase)))
            return Result<DatasetDetailDto>.Conflict($"Another table of this data model is already called {caption}.");

        source.Caption = string.IsNullOrEmpty(caption) || caption == source.Alias ? null : caption;
        source.Description = string.IsNullOrWhiteSpace(cmd.Request.Description) ? null : cmd.Request.Description.Trim();
        await repo.SaveAsync(ct);
        return await DatasetFlow.DetailAsync(repo, dataset, ct);
    }
}

/// <summary>Hides columns of one table from report builders. Only names the table has, calculated columns included, are kept.</summary>
public sealed class SetHiddenColumnsHandler(IDatasetRepository repo) : IRequestHandler<SetHiddenColumnsCommand, Result<DatasetDetailDto>>
{
    public async Task<Result<DatasetDetailDto>> Handle(SetHiddenColumnsCommand cmd, CancellationToken ct)
    {
        if (await repo.GetAsync(cmd.DatasetId, cmd.TenantId, ct) is not { } dataset) return DatasetFlow.NoDataset();

        var parts = await repo.GetPartsAsync(dataset.Id, ct);
        if (parts.Sources.FirstOrDefault(s => s.Id == cmd.SourceId) is not { } source)
            return Result<DatasetDetailDto>.NotFound("The table is not part of this data model.");

        var columns = await DatasetFlow.ColumnsAsync(repo, dataset, [source], ct);
        var known = columns.Select(c => c.Column).Concat(parts.CalculatedColumns.Where(c => c.SourceId == source.Id).Select(c => c.Name))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var unknown = cmd.Request.Columns.FirstOrDefault(c => !known.Contains(c));
        if (unknown is not null) return Result<DatasetDetailDto>.ValidationError($"{source.Alias} has no column called {unknown}.");

        var hidden = cmd.Request.Columns.Distinct(StringComparer.OrdinalIgnoreCase).OrderBy(c => c, StringComparer.OrdinalIgnoreCase).ToList();
        source.HiddenColumns = hidden.Count == 0 ? null : JsonSerializer.Serialize(hidden);
        await repo.SaveAsync(ct);
        return await DatasetFlow.DetailAsync(repo, dataset, ct);
    }
}

/// <summary>
/// Binds the variables of a saved view to model fields, replacing the bindings it had: a filter on a bound field then
/// sets the variable (ScriptSource.TakeBound). Only variables the stored batch declares and fields the model has are kept.
/// </summary>
public sealed class SetSourceParametersHandler(IDatasetRepository repo) : IRequestHandler<SetSourceParametersCommand, Result<DatasetDetailDto>>
{
    public async Task<Result<DatasetDetailDto>> Handle(SetSourceParametersCommand cmd, CancellationToken ct)
    {
        if (await repo.GetAsync(cmd.DatasetId, cmd.TenantId, ct) is not { } dataset) return DatasetFlow.NoDataset();

        var parts = await repo.GetPartsAsync(dataset.Id, ct);
        if (parts.Sources.FirstOrDefault(s => s.Id == cmd.SourceId) is not { } source)
            return Result<DatasetDetailDto>.NotFound("The table is not part of this data model.");
        if (source.SourceKind != ScriptSource.Kind)
            return Result<DatasetDetailDto>.ValidationError($"{source.Alias} is not a saved view, so it has no parameters.");

        var declared = ScriptSource.Parameters(source.ViewSql, null);
        var catalog = DatasetRules.Catalog(await DatasetFlow.ColumnsAsync(repo, dataset, parts.Sources, ct));
        var bindings = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var binding in cmd.Request)
        {
            if (declared.FirstOrDefault(d => string.Equals(d.Name, binding.Name, StringComparison.OrdinalIgnoreCase)) is not { } parameter)
                return Result<DatasetDetailDto>.ValidationError($"{source.Alias} declares no variable called {binding.Name}.");
            var name = parameter.Name;
            if (string.IsNullOrWhiteSpace(binding.Field)) continue;
            if (!parameter.Bindable)
                return Result<DatasetDetailDto>.ValidationError($"{name} cannot be bound: the view's SQL sets it again after declaring it, so a field's value would be lost.");
            // A binding may take one end of a range on the field: "alias.column:from" or ":to" (ScriptSource.RangeEnd).
            var (text, end) = ScriptSource.RangeEnd(binding.Field.Trim());
            if (Field(text) is not { } field)
                return Result<DatasetDetailDto>.ValidationError($"This data model has no field called {text}.");
            bindings[name] = field + end;
        }

        source.ParamsJson = bindings.Count == 0 ? null : JsonSerializer.Serialize(bindings);
        await repo.SaveAsync(ct);
        return await DatasetFlow.DetailAsync(repo, dataset, ct);

        // "alias.column" as the model spells it, calculated columns included; null when there is no such field.
        string? Field(string text)
        {
            var dot = text.IndexOf('.');
            if (dot <= 0 || parts.Sources.FirstOrDefault(s => string.Equals(s.Alias, text[..dot], StringComparison.OrdinalIgnoreCase)) is not { } owner)
                return null;
            var column = catalog.Column(owner.SchemaName, owner.SourceName, text[(dot + 1)..])
                ?? parts.CalculatedColumns.FirstOrDefault(c => c.SourceId == owner.Id && string.Equals(c.Name, text[(dot + 1)..], StringComparison.OrdinalIgnoreCase))?.Name;
            return column is null ? null : $"{owner.Alias}.{column}";
        }
    }
}

public sealed class RemoveSourceHandler(IDatasetRepository repo) : IRequestHandler<RemoveSourceCommand, Result<DatasetDetailDto>>
{
    public async Task<Result<DatasetDetailDto>> Handle(RemoveSourceCommand cmd, CancellationToken ct)
    {
        if (await repo.GetAsync(cmd.DatasetId, cmd.TenantId, ct) is not { } dataset) return DatasetFlow.NoDataset();

        var parts = await repo.GetPartsAsync(dataset.Id, ct);
        if (parts.Sources.FirstOrDefault(s => s.Id == cmd.SourceId) is not { } source)
            return Result<DatasetDetailDto>.NotFound("The table is not part of this data model.");

        // Compiling every measure without the table also catches a measure that only joined through it.
        // The table's calculated columns and transforms go with it (RemoveSourceAsync deletes them).
        var columns = await DatasetFlow.ColumnsAsync(repo, dataset, parts.Sources, ct);
        var conflict = DatasetFlow.BreaksADependant(parts, parts with
        {
            Sources = parts.Sources.Where(s => s.Id != source.Id).ToList(),
            Relationships = parts.Relationships.Where(r => r.FromSourceId != source.Id && r.ToSourceId != source.Id).ToList(),
            CalculatedColumns = parts.CalculatedColumns.Where(c => c.SourceId != source.Id).ToList(),
            Transforms = parts.Transforms.Where(t => t.SourceId != source.Id).ToList(),
        }, columns);
        if (conflict is not null) return conflict;

        if (!await repo.RemoveSourceAsync(dataset.Id, source.Id, ct))
            return Result<DatasetDetailDto>.Conflict($"{source.Alias} was changed while it was being removed. Reload the data model and try again.");
        return await DatasetFlow.DetailAsync(repo, dataset, ct);
    }
}

/// <summary>
/// Stores the view's checked SQL as it is now on every source of the dataset that reads the view (for a script source,
/// its batch as saved). Refused, with nothing changed, when the view no longer passes, or when a plant filter, relationship, measure or calculated
/// column of the dataset would stop working with the view's new columns.
/// </summary>
public sealed class RefreshViewSourceHandler(IDatasetRepository repo) : IRequestHandler<RefreshViewSourceCommand, Result<DatasetDetailDto>>
{
    public async Task<Result<DatasetDetailDto>> Handle(RefreshViewSourceCommand cmd, CancellationToken ct)
    {
        if (await repo.GetAsync(cmd.DatasetId, cmd.TenantId, ct) is not { } dataset) return DatasetFlow.NoDataset();

        var parts = await repo.GetPartsAsync(dataset.Id, ct);
        if (parts.Sources.FirstOrDefault(s => s.Id == cmd.SourceId) is not { } source)
            return Result<DatasetDetailDto>.NotFound("The table is not part of this data model.");
        if (source.SourceKind == "table")
            return Result<DatasetDetailDto>.ValidationError($"{source.Alias} is a table, not a view.");

        var views = ViewSource.Ids([source]) is [var viewId]
            ? await repo.GetViewsAsync(dataset.ConnectionId, dataset.TenantId, [viewId], ct)
            : [];
        if (views.FirstOrDefault() is not { } view)
            return Result<DatasetDetailDto>.ValidationError($"The view behind {source.Alias} no longer exists. Remove {source.Alias} from the data model.");
        var script = source.SourceKind == ScriptSource.Kind;
        if (script && view.Script is null && view.IsUsable)
            return Result<DatasetDetailDto>.ValidationError(
                $"The view {view.Name} now meets the view contract; remove it and add it as a view.");
        if (script ? view.Script is not { IsUsable: true } : !view.IsUsable)
            return Result<DatasetDetailDto>.ValidationError(
                $"The view {view.Name} cannot be used. {(script ? view.Script?.Problems.FirstOrDefault() : view.Problems.FirstOrDefault())}");

        var sharing = parts.Sources.Where(s => s.SourceKind == source.SourceKind && s.SourceName == source.SourceName).ToList();
        var before = await DatasetFlow.ColumnsAsync(repo, dataset, parts.Sources, ct);
        var after = before.Where(c => !(c.Schema == source.SchemaName && c.Table == source.SourceName))
            .Concat(script ? ScriptSource.CatalogColumns(source.SourceName, view.Script!.Columns) : ViewSource.CatalogColumns(view))
            .ToList();
        if (ImportRules.ColumnChangeProblem(dataset.Name, parts, before, after, sharing, "the view") is { } problem)
            return Result<DatasetDetailDto>.Conflict($"{problem} Keep those columns in the view, or change the data model first.");

        foreach (var s in sharing) s.ViewSql = script ? view.Script!.Text : view.Sql!.Sql;
        await repo.SaveAsync(ct);
        return await DatasetFlow.DetailAsync(repo, dataset, ct);
    }
}
