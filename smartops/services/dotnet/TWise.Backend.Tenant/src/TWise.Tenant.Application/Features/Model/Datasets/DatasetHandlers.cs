using MediatR;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Domain.Entities.Model;

namespace TWise.Tenant.Application.Features.Model.Datasets;

public sealed class ListDatasetsHandler(IDatasetRepository repo)
    : IRequestHandler<ListDatasetsQuery, Result<IReadOnlyList<DatasetSummaryDto>>>
{
    public async Task<Result<IReadOnlyList<DatasetSummaryDto>>> Handle(ListDatasetsQuery query, CancellationToken ct)
        => Result<IReadOnlyList<DatasetSummaryDto>>.Success(
            (await repo.ListAsync(query.TenantId, ct)).Select(DatasetSummaryDto.From).ToList());
}

/// <summary>Read from the cached snapshot, so an unchanged dataset costs no database read.</summary>
public sealed class GetDatasetHandler(IDatasetRepository repo, ModelCache cache) : IRequestHandler<GetDatasetQuery, Result<DatasetDetailDto>>
{
    public async Task<Result<DatasetDetailDto>> Handle(GetDatasetQuery query, CancellationToken ct)
    {
        if (await cache.SnapshotAsync(repo, query.Id, query.TenantId, reload: false, ct) is not { } snapshot) return DatasetFlow.NoDataset();

        // View names are read every time: a view can be renamed in View Builder without changing the dataset.
        var viewIds = ViewSource.Ids(snapshot.Sources);
        IReadOnlyList<PreparedView> views = viewIds.Count == 0 ? [] : await repo.GetViewsAsync(snapshot.Dataset.ConnectionId, query.TenantId, viewIds, ct);
        return Result<DatasetDetailDto>.Success(DatasetDetailDto.From(snapshot.Dataset, snapshot.Parts(), views, snapshot.Connections));
    }
}

public sealed class ListDatasetViewsHandler(IDatasetRepository repo)
    : IRequestHandler<ListDatasetViewsQuery, Result<IReadOnlyList<ViewChoiceDto>>>
{
    public async Task<Result<IReadOnlyList<ViewChoiceDto>>> Handle(ListDatasetViewsQuery query, CancellationToken ct)
    {
        if (await repo.GetAsync(query.DatasetId, query.TenantId, ct) is not { } dataset)
            return Result<IReadOnlyList<ViewChoiceDto>>.NotFound("The data model does not exist.");

        var views = await repo.GetViewsAsync(dataset.ConnectionId, dataset.TenantId, null, ct);
        return Result<IReadOnlyList<ViewChoiceDto>>.Success(views.Select(ViewChoiceDto.From).ToList());
    }
}

public sealed class ListDatasetConnectionsHandler(IDatasetRepository repo)
    : IRequestHandler<ListDatasetConnectionsQuery, Result<IReadOnlyList<DatasetConnectionDto>>>
{
    public async Task<Result<IReadOnlyList<DatasetConnectionDto>>> Handle(ListDatasetConnectionsQuery query, CancellationToken ct)
        => Result<IReadOnlyList<DatasetConnectionDto>>.Success(
            (await repo.GetConnectionsAsync(query.TenantId, ct))
                .Where(DatasetRules.CanHostDataset)
                .Select(c => new DatasetConnectionDto(c.Id, c.ConnectionName, c.DatabaseName)).ToList());
}

/// <summary>Every connection of the tenant, each saying whether the data model can add its tables and why not.</summary>
public sealed class ListSourceConnectionsHandler(IDatasetRepository repo)
    : IRequestHandler<ListSourceConnectionsQuery, Result<IReadOnlyList<DatasetConnectionDto>>>
{
    public async Task<Result<IReadOnlyList<DatasetConnectionDto>>> Handle(ListSourceConnectionsQuery query, CancellationToken ct)
    {
        if (await repo.GetAsync(query.DatasetId, query.TenantId, ct) is not { } dataset)
            return Result<IReadOnlyList<DatasetConnectionDto>>.NotFound("The data model does not exist.");

        var connections = await repo.GetConnectionsAsync(query.TenantId, ct);
        var own = connections.FirstOrDefault(c => c.Id == dataset.ConnectionId);
        return Result<IReadOnlyList<DatasetConnectionDto>>.Success(connections
            .Select(c => (Connection: c, Reason: own is null ? "The data model's own connection no longer exists." : DatasetRules.CannotJoin(own, c)))
            .Select(x => new DatasetConnectionDto(x.Connection.Id, x.Connection.ConnectionName, x.Connection.DatabaseName, x.Reason is null, x.Reason))
            .ToList());
    }
}

public sealed class CreateDatasetHandler(IDatasetRepository repo) : IRequestHandler<CreateDatasetCommand, Result<DatasetDetailDto>>
{
    public async Task<Result<DatasetDetailDto>> Handle(CreateDatasetCommand cmd, CancellationToken ct)
    {
        var name = cmd.Request.Name.Trim();
        var connection = (await repo.GetConnectionsAsync(cmd.TenantId, ct)).FirstOrDefault(c => c.Id == cmd.Request.ConnectionId);
        if (connection is null)
            return Result<DatasetDetailDto>.ValidationError("The database connection does not exist.");
        if (!DatasetRules.CanHostDataset(connection))
            return Result<DatasetDetailDto>.ValidationError("Data models can use active SQL Server connections only.");
        if (await repo.NameTakenAsync(cmd.TenantId, name, null, ct))
            return Result<DatasetDetailDto>.Conflict($"A data model called \"{name}\" already exists.");

        var now = DateTime.UtcNow;
        var dataset = new Dataset
        {
            TenantId = cmd.TenantId,
            ConnectionId = cmd.Request.ConnectionId,
            Name = name,
            Description = string.IsNullOrWhiteSpace(cmd.Request.Description) ? null : cmd.Request.Description.Trim(),
            CreatedBy = cmd.UserId,
            CreatedAt = now,
            ModifiedAt = now,
        };
        await repo.AddAsync(dataset, ct);
        return await DatasetFlow.DetailAsync(repo, dataset, ct);
    }
}

public sealed class UpdateDatasetHandler(IDatasetRepository repo) : IRequestHandler<UpdateDatasetCommand, Result<DatasetDetailDto>>
{
    public async Task<Result<DatasetDetailDto>> Handle(UpdateDatasetCommand cmd, CancellationToken ct)
    {
        if (await repo.GetAsync(cmd.Id, cmd.TenantId, ct) is not { } dataset) return DatasetFlow.NoDataset();

        var name = cmd.Request.Name.Trim();
        if (await repo.NameTakenAsync(cmd.TenantId, name, dataset.Id, ct))
            return Result<DatasetDetailDto>.Conflict($"A data model called \"{name}\" already exists.");

        dataset.Name = name;
        dataset.Description = string.IsNullOrWhiteSpace(cmd.Request.Description) ? null : cmd.Request.Description.Trim();
        dataset.ModifiedBy = cmd.UserId;
        dataset.ModifiedAt = DateTime.UtcNow;
        await repo.SaveAsync(ct);
        return await DatasetFlow.DetailAsync(repo, dataset, ct);
    }
}

public sealed class DeleteDatasetHandler(IDatasetRepository repo) : IRequestHandler<DeleteDatasetCommand, Result>
{
    public async Task<Result> Handle(DeleteDatasetCommand cmd, CancellationToken ct)
    {
        if (await repo.GetAsync(cmd.Id, cmd.TenantId, ct) is not { } dataset) return Result.NotFound("The data model does not exist.");

        // Soft delete: the name becomes free again (the unique index is filtered on IsDeleted = 0).
        dataset.IsDeleted = true;
        dataset.ModifiedBy = cmd.UserId;
        dataset.ModifiedAt = DateTime.UtcNow;
        await repo.SaveAsync(ct);
        return Result.Success();
    }
}
