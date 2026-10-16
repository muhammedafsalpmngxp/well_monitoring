using MediatR;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Application.Features.Model.Query;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Domain.Entities.Model;

namespace TWise.Tenant.Application.Features.Model.Datasets;

public sealed class AddRelationshipHandler(IDatasetRepository repo) : IRequestHandler<AddRelationshipCommand, Result<DatasetDetailDto>>
{
    public async Task<Result<DatasetDetailDto>> Handle(AddRelationshipCommand cmd, CancellationToken ct)
    {
        if (await repo.GetAsync(cmd.DatasetId, cmd.TenantId, ct) is not { } dataset) return DatasetFlow.NoDataset();

        var parts = await repo.GetPartsAsync(dataset.Id, ct);
        var columns = await DatasetFlow.ColumnsAsync(repo, dataset, parts.Sources, ct);
        var relationship = DatasetRules.NewRelationship(dataset.Id, cmd.Request, parts.Sources, columns, parts.Relationships);
        if (!relationship.IsSuccess) return DatasetFlow.Failed(relationship);

        await repo.AddAsync(relationship.Value!, ct);
        return await DatasetFlow.DetailAsync(repo, dataset, ct);
    }
}

public sealed class UpdateRelationshipHandler(IDatasetRepository repo) : IRequestHandler<UpdateRelationshipCommand, Result<DatasetDetailDto>>
{
    public async Task<Result<DatasetDetailDto>> Handle(UpdateRelationshipCommand cmd, CancellationToken ct)
    {
        if (await repo.GetAsync(cmd.DatasetId, cmd.TenantId, ct) is not { } dataset) return DatasetFlow.NoDataset();

        var parts = await repo.GetPartsAsync(dataset.Id, ct);
        if (parts.Relationships.FirstOrDefault(r => r.Id == cmd.RelationshipId) is not { } relationship)
            return Result<DatasetDetailDto>.NotFound("The relationship is not part of this data model.");

        // Checked on a copy, so a refused change leaves the tracked relationship untouched.
        var changed = new DatasetRelationship
        {
            Id = relationship.Id, DatasetId = relationship.DatasetId, FromSourceId = relationship.FromSourceId,
            FromColumn = relationship.FromColumn, ToSourceId = relationship.ToSourceId, ToColumn = relationship.ToColumn,
            Cardinality = cmd.Request.Cardinality, IsActive = relationship.IsActive, DetectedFrom = relationship.DetectedFrom,
        };
        var columns = await DatasetFlow.ColumnsAsync(repo, dataset, parts.Sources, ct);
        var conflict = DatasetFlow.BreaksADependant(parts,
            parts with { Relationships = parts.Relationships.Select(r => r.Id == relationship.Id ? changed : r).ToList() }, columns);
        if (conflict is not null) return conflict;

        relationship.Cardinality = cmd.Request.Cardinality;
        await repo.SaveAsync(ct);
        return await DatasetFlow.DetailAsync(repo, dataset, ct);
    }
}

public sealed class RemoveRelationshipHandler(IDatasetRepository repo) : IRequestHandler<RemoveRelationshipCommand, Result<DatasetDetailDto>>
{
    public async Task<Result<DatasetDetailDto>> Handle(RemoveRelationshipCommand cmd, CancellationToken ct)
    {
        if (await repo.GetAsync(cmd.DatasetId, cmd.TenantId, ct) is not { } dataset) return DatasetFlow.NoDataset();

        var parts = await repo.GetPartsAsync(dataset.Id, ct);
        if (parts.Relationships.FirstOrDefault(r => r.Id == cmd.RelationshipId) is not { } relationship)
            return Result<DatasetDetailDto>.NotFound("The relationship is not part of this data model.");

        var columns = await DatasetFlow.ColumnsAsync(repo, dataset, parts.Sources, ct);
        var conflict = DatasetFlow.BreaksADependant(parts,
            parts with { Relationships = parts.Relationships.Where(r => r.Id != relationship.Id).ToList() }, columns);
        if (conflict is not null) return conflict;

        await repo.DeleteAsync(relationship, ct);
        return await DatasetFlow.DetailAsync(repo, dataset, ct);
    }
}

/// <summary>Read from the cached snapshot, like the dataset itself.</summary>
public sealed class GetRelationshipSuggestionsHandler(IDatasetRepository repo, ModelCache cache)
    : IRequestHandler<GetRelationshipSuggestionsQuery, Result<IReadOnlyList<RelationshipSuggestionDto>>>
{
    public async Task<Result<IReadOnlyList<RelationshipSuggestionDto>>> Handle(GetRelationshipSuggestionsQuery query, CancellationToken ct)
    {
        if (await cache.SnapshotAsync(repo, query.DatasetId, query.TenantId, reload: false, ct) is not { } snapshot)
            return Result<IReadOnlyList<RelationshipSuggestionDto>>.NotFound("The data model does not exist.");

        var declared = DatasetRules.SuggestRelationships(snapshot.Sources, snapshot.Columns, snapshot.Relationships);
        var found = new List<RelationshipSuggestionDto>();
        // Probes run on the model's connection; a model whose connection is gone gets the declared ones only.
        if (snapshot.Connection is { } connection)
        {
            foreach (var candidate in JoinFinder.Candidates(snapshot.Sources, snapshot.Columns, snapshot.Relationships, declared))
            {
                if (await ProbeAsync(snapshot, candidate, connection, ct) is { } suggestion) found.Add(suggestion);
            }
        }
        return Result<IReadOnlyList<RelationshipSuggestionDto>>.Success([.. declared, .. found]);
    }

    // ponytail: what the data says about a pair of columns is kept for ten minutes in this process; a shared cache when there are several API instances.
    private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, (DateTime At, JoinProbe? Probe)> Probed = new();

    /// <summary>The suggestion the data supports; a probe that fails (a timeout on a very large table) suggests nothing.</summary>
    private async Task<RelationshipSuggestionDto?> ProbeAsync(ModelSnapshot snapshot, JoinCandidate candidate, DatabaseConnection connection, CancellationToken ct)
    {
        string key;
        try
        {
            candidate = candidate with { ADatabase = snapshot.DatabaseOf(candidate.A), BDatabase = snapshot.DatabaseOf(candidate.B) };
            // The same SQL on another connection reads other tables, so the connection is part of the key.
            key = $"{connection.Id}|{JoinFinder.ProbeSql(candidate)}".ToLowerInvariant();
        }
        catch (QueryException)
        {
            return null;
        }
        if (!Probed.TryGetValue(key, out var kept) || kept.At < DateTime.UtcNow.AddMinutes(-10))
        {
            JoinProbe? probe;
            try
            {
                probe = await repo.ProbeJoinAsync(candidate, connection, ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                probe = null;
            }
            kept = (DateTime.UtcNow, probe);
            Probed[key] = kept;
        }
        return kept.Probe is { } found ? JoinFinder.Suggest(candidate, found) : null;
    }
}
