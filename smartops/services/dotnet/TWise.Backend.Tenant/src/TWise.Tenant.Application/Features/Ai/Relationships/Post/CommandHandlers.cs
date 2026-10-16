using MediatR;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Features.Ai.Relationships;

/// <summary>
/// Column-name matching first (cheap, metadata only), then the value overlap of each candidate pair
/// from the first rows the ask already caches. Existing confirmed/rejected links are kept; earlier
/// suggestions among the scanned datasets are replaced.
/// </summary>
public sealed class DetectAiRelationsHandler(IAiAskService ask, IAiKnowledgeRepository knowledge) : IRequestHandler<DetectAiRelationsCommand, AiRelationScanDto>
{
    public async Task<AiRelationScanDto> Handle(DetectAiRelationsCommand c, CancellationToken ct)
    {
        var all = await ask.ListDatasetsAsync(c.TenantId, c.UserId, ct);
        var wanted = c.Datasets is { Count: > 0 } ? all.Where(d => c.Datasets.Contains($"{d.SourceType}:{d.SourceId}")).ToList() : all.Take(DatasetRelations.MaxDatasetsPerScan).ToList();
        var skipped = new List<string>();
        var loaded = new Dictionary<string, (AiDatasetDto ds, TableDataDto data)>();
        foreach (var d in wanted)
        {
            var data = await ask.SampleAsync(d.SourceType, d.SourceId, c.TenantId, ct);
            if (data is { Columns.Count: > 0 }) loaded[$"{d.SourceType}:{d.SourceId}"] = (d, data); else skipped.Add(d.Name);
        }

        var existing = await knowledge.GetRelationsAsync(c.TenantId, ct);
        var decided = existing.Where(r => r.Status != DatasetRelations.Suggested)
            .Select(r => (Key(r.FromType, r.FromId, r.FromColumn), Key(r.ToType, r.ToId, r.ToColumn))).ToHashSet();
        await knowledge.RemoveSuggestedRelationsAsync(c.TenantId, loaded.Keys.ToList(), ct);

        var items = loaded.Values.ToList();
        var found = 0;
        for (var i = 0; i < items.Count; i++)
            for (var j = i + 1; j < items.Count; j++)
            {
                var (a, da) = items[i]; var (b, db) = items[j];
                var byName = db.Columns.Where(DatasetRelations.IsKeyLike).ToLookup(DatasetRelations.Normalise, StringComparer.Ordinal);
                foreach (var ca in da.Columns.Where(DatasetRelations.IsKeyLike))
                    foreach (var cb in byName[DatasetRelations.Normalise(ca)])
                    {
                        var ka = Key(a.SourceType, a.SourceId, ca); var kb = Key(b.SourceType, b.SourceId, cb);
                        if (decided.Contains((ka, kb)) || decided.Contains((kb, ka))) continue;
                        var va = DatasetRelations.Values(da, ca); var vb = DatasetRelations.Values(db, cb);
                        var overlap = Math.Max(DatasetRelations.Overlap(va, vb), DatasetRelations.Overlap(vb, va));
                        if (overlap < DatasetRelations.MinOverlap) continue;
                        await knowledge.AddRelationAsync(new AiDatasetRelation
                        {
                            TenantId = c.TenantId, FromType = a.SourceType, FromId = a.SourceId, FromName = a.Name, FromColumn = ca,
                            ToType = b.SourceType, ToId = b.SourceId, ToName = b.Name, ToColumn = cb, Status = DatasetRelations.Suggested,
                            Overlap = Math.Round(overlap, 3), ModifiedBy = c.UserId.ToString(),
                        }, ct);
                        found++;
                    }
            }
        await knowledge.SaveRelationsAsync(ct);
        return new AiRelationScanDto(loaded.Count, found, existing.Count(r => r.Status != DatasetRelations.Suggested), skipped);
    }

    private static string Key(string type, long id, string column) => $"{type}:{id}:{DatasetRelations.Normalise(column)}";
}

public sealed class AddAiRelationHandler(IAiAskService ask, IAiKnowledgeRepository knowledge) : IRequestHandler<AddAiRelationCommand, AiRelationDto>
{
    public async Task<AiRelationDto> Handle(AddAiRelationCommand c, CancellationToken ct)
    {
        var r = c.Request;
        var datasets = await ask.ListDatasetsAsync(c.TenantId, c.UserId, ct);
        var from = datasets.FirstOrDefault(d => d.SourceType == r.FromType && d.SourceId == r.FromId) ?? throw new InvalidOperationException("The first dataset was not found.");
        var to = datasets.FirstOrDefault(d => d.SourceType == r.ToType && d.SourceId == r.ToId) ?? throw new InvalidOperationException("The second dataset was not found.");
        var relation = new AiDatasetRelation
        {
            TenantId = c.TenantId, FromType = from.SourceType, FromId = from.SourceId, FromName = from.Name, FromColumn = r.FromColumn.Trim(),
            ToType = to.SourceType, ToId = to.SourceId, ToName = to.Name, ToColumn = r.ToColumn.Trim(), Status = DatasetRelations.Confirmed, ModifiedBy = c.UserId.ToString(),
        };
        await knowledge.AddRelationAsync(relation, ct);
        await knowledge.SaveRelationsAsync(ct);
        return GetAiRelationGraphHandler.ToDto(relation);
    }
}
