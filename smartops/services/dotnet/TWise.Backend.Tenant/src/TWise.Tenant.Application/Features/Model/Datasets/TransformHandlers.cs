using MediatR;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Common;

namespace TWise.Tenant.Application.Features.Model.Datasets;

public sealed class AddTransformHandler(IDatasetRepository repo) : IRequestHandler<AddTransformCommand, Result<DatasetDetailDto>>
{
    public async Task<Result<DatasetDetailDto>> Handle(AddTransformCommand cmd, CancellationToken ct)
    {
        if (await repo.GetAsync(cmd.DatasetId, cmd.TenantId, ct) is not { } dataset) return DatasetFlow.NoDataset();

        var parts = await repo.GetPartsAsync(dataset.Id, ct);
        if (parts.Sources.FirstOrDefault(s => s.Id == cmd.Request.SourceId) is not { } source)
            return Result<DatasetDetailDto>.ValidationError("The table is not part of this data model.");

        var columns = await DatasetFlow.ColumnsAsync(repo, dataset, parts.Sources, ct);
        var transform = DatasetRules.NewTransform(dataset.Id, source, cmd.Request, parts, columns);
        if (!transform.IsSuccess) return DatasetFlow.Failed(transform);
        var conflict = DatasetFlow.BreaksADependant(parts, parts with { Transforms = [.. parts.Transforms, transform.Value!] }, columns);
        if (conflict is not null) return conflict;

        await repo.AddAsync(transform.Value!, ct);
        return await DatasetFlow.DetailAsync(repo, dataset, ct);
    }
}

public sealed class RemoveTransformHandler(IDatasetRepository repo) : IRequestHandler<RemoveTransformCommand, Result<DatasetDetailDto>>
{
    public async Task<Result<DatasetDetailDto>> Handle(RemoveTransformCommand cmd, CancellationToken ct)
    {
        if (await repo.GetAsync(cmd.DatasetId, cmd.TenantId, ct) is not { } dataset) return DatasetFlow.NoDataset();

        var parts = await repo.GetPartsAsync(dataset.Id, ct);
        if (parts.Transforms.FirstOrDefault(t => t.Id == cmd.TransformId) is not { } transform)
            return Result<DatasetDetailDto>.NotFound("The transform is not part of this data model.");

        var columns = await DatasetFlow.ColumnsAsync(repo, dataset, parts.Sources, ct);
        var conflict = DatasetFlow.BreaksADependant(parts,
            parts with { Transforms = parts.Transforms.Where(t => t.Id != transform.Id).ToList() }, columns);
        if (conflict is not null) return conflict;

        await repo.DeleteAsync(transform, ct);
        return await DatasetFlow.DetailAsync(repo, dataset, ct);
    }
}
