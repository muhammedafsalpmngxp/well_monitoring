using MediatR;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Application.Features.Model.Query;
using TWise.Tenant.Domain.Entities.Model;

namespace TWise.Tenant.Application.Features.Model.Datasets;

public sealed class AddMeasureHandler(IDatasetRepository repo) : IRequestHandler<AddMeasureCommand, Result<DatasetDetailDto>>
{
    public async Task<Result<DatasetDetailDto>> Handle(AddMeasureCommand cmd, CancellationToken ct)
    {
        if (await repo.GetAsync(cmd.DatasetId, cmd.TenantId, ct) is not { } dataset) return DatasetFlow.NoDataset();
        if (DatasetRules.ReadMeasure(cmd.Request.Expression) is not { } expression) return DatasetFlow.UnreadableMeasure();

        var parts = await repo.GetPartsAsync(dataset.Id, ct);
        var name = cmd.Request.Name.Trim();
        if (parts.Measures.Any(m => string.Equals(m.Name, name, StringComparison.OrdinalIgnoreCase)))
            return Result<DatasetDetailDto>.Conflict($"A measure called \"{name}\" already exists in this data model.");

        var columns = await DatasetFlow.ColumnsAsync(repo, dataset, parts.Sources, ct);
        var ast = DatasetRules.CheckMeasure(dataset.Id, name, expression, parts.Sources, parts.Relationships, columns,
            parts.CalculatedColumns, parts.Transforms, parts.Measures);
        if (!ast.IsSuccess) return DatasetFlow.Failed(ast);

        // The tree is the source of truth; the text is printed from it and never read back here.
        await repo.AddAsync(new DatasetMeasure
        {
            DatasetId = dataset.Id, Name = name, ExpressionAst = ast.Value!, ExpressionText = MeasureText.Print(expression),
        }, ct);
        return await DatasetFlow.DetailAsync(repo, dataset, ct);
    }
}

public sealed class UpdateMeasureHandler(IDatasetRepository repo) : IRequestHandler<UpdateMeasureCommand, Result<DatasetDetailDto>>
{
    internal static string UsedBy(IReadOnlyList<string> users, string name, string action)
        => $"{string.Join(", ", users)} {(users.Count == 1 ? "uses" : "use")} [{name}]. Change {(users.Count == 1 ? "it" : "them")} first, then {action} this measure.";

    public async Task<Result<DatasetDetailDto>> Handle(UpdateMeasureCommand cmd, CancellationToken ct)
    {
        if (await repo.GetAsync(cmd.DatasetId, cmd.TenantId, ct) is not { } dataset) return DatasetFlow.NoDataset();
        if (DatasetRules.ReadMeasure(cmd.Request.Expression) is not { } expression) return DatasetFlow.UnreadableMeasure();

        var parts = await repo.GetPartsAsync(dataset.Id, ct);
        if (parts.Measures.FirstOrDefault(m => m.Id == cmd.MeasureId) is not { } measure)
            return Result<DatasetDetailDto>.NotFound("The measure is not part of this data model.");

        var name = cmd.Request.Name.Trim();
        if (parts.Measures.Any(m => m.Id != measure.Id && string.Equals(m.Name, name, StringComparison.OrdinalIgnoreCase)))
            return Result<DatasetDetailDto>.Conflict($"A measure called \"{name}\" already exists in this data model.");

        var columns = await DatasetFlow.ColumnsAsync(repo, dataset, parts.Sources, ct);
        var ast = DatasetRules.CheckMeasure(dataset.Id, name, expression, parts.Sources, parts.Relationships, columns,
            parts.CalculatedColumns, parts.Transforms, parts.Measures);
        if (!ast.IsSuccess) return DatasetFlow.Failed(ast);

        // ponytail: a rename is refused while other measures name this one; rewrite their [refs] if renames become common.
        if (!string.Equals(measure.Name, name, StringComparison.OrdinalIgnoreCase)
            && DatasetRules.MeasuresUsing(measure.Name, parts.Measures) is { Count: > 0 } users)
            return Result<DatasetDetailDto>.Conflict(UsedBy(users, measure.Name, "rename"));

        measure.Name = name;
        measure.ExpressionAst = ast.Value!;
        measure.ExpressionText = MeasureText.Print(expression);
        await repo.SaveAsync(ct);
        return await DatasetFlow.DetailAsync(repo, dataset, ct);
    }
}

public sealed class RemoveMeasureHandler(IDatasetRepository repo) : IRequestHandler<RemoveMeasureCommand, Result<DatasetDetailDto>>
{
    public async Task<Result<DatasetDetailDto>> Handle(RemoveMeasureCommand cmd, CancellationToken ct)
    {
        if (await repo.GetAsync(cmd.DatasetId, cmd.TenantId, ct) is not { } dataset) return DatasetFlow.NoDataset();

        var parts = await repo.GetPartsAsync(dataset.Id, ct);
        if (parts.Measures.FirstOrDefault(m => m.Id == cmd.MeasureId) is not { } measure)
            return Result<DatasetDetailDto>.NotFound("The measure is not part of this data model.");
        if (DatasetRules.MeasuresUsing(measure.Name, parts.Measures) is { Count: > 0 } users)
            return Result<DatasetDetailDto>.Conflict(UpdateMeasureHandler.UsedBy(users, measure.Name, "delete"));

        await repo.DeleteAsync(measure, ct);
        return await DatasetFlow.DetailAsync(repo, dataset, ct);
    }
}
