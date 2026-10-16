using MediatR;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Common;

namespace TWise.Tenant.Application.Features.Model.Datasets;

/// <summary>
/// Makes the draft the version canvases read. Refused while a measure cannot be compiled, so a published
/// dataset never hands a canvas a measure that fails.
/// </summary>
public sealed class PublishDatasetHandler(IDatasetRepository repo) : IRequestHandler<PublishDatasetCommand, Result<DatasetDetailDto>>
{
    public async Task<Result<DatasetDetailDto>> Handle(PublishDatasetCommand cmd, CancellationToken ct)
    {
        if (await repo.GetAsync(cmd.DatasetId, cmd.TenantId, ct) is not { } dataset) return DatasetFlow.NoDataset();
        var parts = await repo.GetPartsAsync(dataset.Id, ct);
        if (parts.Sources.Count == 0) return Result<DatasetDetailDto>.ValidationError("Add a table before publishing the data model.");

        var columns = await DatasetFlow.ColumnsAsync(repo, dataset, parts.Sources, ct);
        if (DatasetRules.FirstBrokenMeasure(parts.Sources, parts.Relationships, columns, parts.Measures, parts.CalculatedColumns, parts.Transforms)
            is { } broken)
            return Result<DatasetDetailDto>.ValidationError($"{broken.Name} cannot be published: {broken.Reason} Fix it or delete it, then publish.");

        dataset.PublishedModel = PublishedModel.From(parts).Write();
        dataset.PublishedAt = DateTime.UtcNow;
        dataset.PublishedBy = cmd.UserId;
        dataset.Status = "published";
        dataset.ModifiedAt = DateTime.UtcNow;
        dataset.ModifiedBy = cmd.UserId;
        await repo.SaveAsync(ct);
        return await DatasetFlow.DetailAsync(repo, dataset, ct);
    }
}

/// <summary>Throws the draft away: the parts become the published version again.</summary>
public sealed class DiscardDraftHandler(IDatasetRepository repo) : IRequestHandler<DiscardDraftCommand, Result<DatasetDetailDto>>
{
    public async Task<Result<DatasetDetailDto>> Handle(DiscardDraftCommand cmd, CancellationToken ct)
    {
        if (await repo.GetAsync(cmd.DatasetId, cmd.TenantId, ct) is not { } dataset) return DatasetFlow.NoDataset();
        if (PublishedModel.Read(dataset.PublishedModel) is not { } published)
            return Result<DatasetDetailDto>.Conflict("The data model has never been published, so there is no version to go back to.");

        await repo.ReplacePartsAsync(dataset.Id, published, ct);
        return await DatasetFlow.DetailAsync(repo, dataset, ct);
    }
}

/// <summary>Moves a measure under a table or back to the dataset's measures, and into a folder or out of one.</summary>
public sealed class PlaceMeasureHandler(IDatasetRepository repo) : IRequestHandler<PlaceMeasureCommand, Result<DatasetDetailDto>>
{
    public async Task<Result<DatasetDetailDto>> Handle(PlaceMeasureCommand cmd, CancellationToken ct)
    {
        if (await repo.GetAsync(cmd.DatasetId, cmd.TenantId, ct) is not { } dataset) return DatasetFlow.NoDataset();
        var parts = await repo.GetPartsAsync(dataset.Id, ct);
        if (parts.Measures.FirstOrDefault(m => m.Id == cmd.MeasureId) is not { } measure)
            return Result<DatasetDetailDto>.NotFound("The measure is not part of this data model.");
        if (cmd.Request.HomeSourceId is { } home && parts.Sources.All(s => s.Id != home))
            return Result<DatasetDetailDto>.ValidationError("The table is not part of this data model.");

        var folder = cmd.Request.Folder?.Trim();
        if (folder is { Length: > 128 }) return Result<DatasetDetailDto>.ValidationError("A folder name is at most 128 characters.");
        measure.HomeSourceId = cmd.Request.HomeSourceId;
        measure.Folder = string.IsNullOrEmpty(folder) ? null : folder;
        await repo.SaveAsync(ct);
        return await DatasetFlow.DetailAsync(repo, dataset, ct);
    }
}
