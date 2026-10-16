using MediatR;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Common;

namespace TWise.Tenant.Application.Features.Model.Datasets;

public sealed class AddCalculatedColumnHandler(IDatasetRepository repo) : IRequestHandler<AddCalculatedColumnCommand, Result<DatasetDetailDto>>
{
    public async Task<Result<DatasetDetailDto>> Handle(AddCalculatedColumnCommand cmd, CancellationToken ct)
    {
        if (await repo.GetAsync(cmd.DatasetId, cmd.TenantId, ct) is not { } dataset) return DatasetFlow.NoDataset();
        if (DatasetRules.ReadMeasure(cmd.Request.Expression) is not { } expression) return DatasetFlow.UnreadableColumn();

        var parts = await repo.GetPartsAsync(dataset.Id, ct);
        if (parts.Sources.FirstOrDefault(s => s.Id == cmd.Request.SourceId) is not { } source)
            return Result<DatasetDetailDto>.ValidationError("The table is not part of this data model.");

        var columns = await DatasetFlow.ColumnsAsync(repo, dataset, parts.Sources, ct);
        var column = DatasetRules.NewCalculatedColumn(dataset.Id, source, cmd.Request.Name.Trim(), expression, parts, columns);
        if (!column.IsSuccess) return DatasetFlow.Failed(column);

        await repo.AddAsync(column.Value!, ct);
        return await DatasetFlow.DetailAsync(repo, dataset, ct);
    }
}

public sealed class UpdateCalculatedColumnHandler(IDatasetRepository repo) : IRequestHandler<UpdateCalculatedColumnCommand, Result<DatasetDetailDto>>
{
    public async Task<Result<DatasetDetailDto>> Handle(UpdateCalculatedColumnCommand cmd, CancellationToken ct)
    {
        if (await repo.GetAsync(cmd.DatasetId, cmd.TenantId, ct) is not { } dataset) return DatasetFlow.NoDataset();
        if (DatasetRules.ReadMeasure(cmd.Request.Expression) is not { } expression) return DatasetFlow.UnreadableColumn();

        var parts = await repo.GetPartsAsync(dataset.Id, ct);
        if (parts.CalculatedColumns.FirstOrDefault(c => c.Id == cmd.ColumnId) is not { } stored)
            return Result<DatasetDetailDto>.NotFound("The calculated column is not part of this data model.");
        var source = parts.Sources.First(s => s.Id == stored.SourceId);

        // Checked as a new column beside the others, then as the replacement for the stored one, so a
        // change that breaks a measure or another calculated column is refused before anything is written.
        var others = parts with { CalculatedColumns = parts.CalculatedColumns.Where(c => c.Id != stored.Id).ToList() };
        var columns = await DatasetFlow.ColumnsAsync(repo, dataset, parts.Sources, ct);
        var changed = DatasetRules.NewCalculatedColumn(dataset.Id, source, cmd.Request.Name.Trim(), expression, others, columns);
        if (!changed.IsSuccess) return DatasetFlow.Failed(changed);
        changed.Value!.Id = stored.Id;
        var conflict = DatasetFlow.BreaksADependant(parts, others with { CalculatedColumns = [.. others.CalculatedColumns, changed.Value] }, columns);
        if (conflict is not null) return conflict;

        stored.Name = changed.Value.Name;
        stored.ExpressionAst = changed.Value.ExpressionAst;
        stored.ExpressionText = changed.Value.ExpressionText;
        stored.DataType = changed.Value.DataType;
        await repo.SaveAsync(ct);
        return await DatasetFlow.DetailAsync(repo, dataset, ct);
    }
}

public sealed class RemoveCalculatedColumnHandler(IDatasetRepository repo) : IRequestHandler<RemoveCalculatedColumnCommand, Result<DatasetDetailDto>>
{
    public async Task<Result<DatasetDetailDto>> Handle(RemoveCalculatedColumnCommand cmd, CancellationToken ct)
    {
        if (await repo.GetAsync(cmd.DatasetId, cmd.TenantId, ct) is not { } dataset) return DatasetFlow.NoDataset();

        var parts = await repo.GetPartsAsync(dataset.Id, ct);
        if (parts.CalculatedColumns.FirstOrDefault(c => c.Id == cmd.ColumnId) is not { } stored)
            return Result<DatasetDetailDto>.NotFound("The calculated column is not part of this data model.");

        var columns = await DatasetFlow.ColumnsAsync(repo, dataset, parts.Sources, ct);
        var conflict = DatasetFlow.BreaksADependant(parts,
            parts with { CalculatedColumns = parts.CalculatedColumns.Where(c => c.Id != stored.Id).ToList() }, columns);
        if (conflict is not null) return conflict;

        await repo.DeleteAsync(stored, ct);
        return await DatasetFlow.DetailAsync(repo, dataset, ct);
    }
}
