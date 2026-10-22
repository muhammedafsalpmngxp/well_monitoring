using MediatR;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Features.Ai.Relationships;

public sealed class GetAiRelationGraphHandler(IAiKnowledgeRepository knowledge) : IRequestHandler<GetAiRelationGraphQuery, AiRelationGraphDto>
{
    public async Task<AiRelationGraphDto> Handle(GetAiRelationGraphQuery q, CancellationToken ct) =>
        ToGraph((await knowledge.GetRelationsAsync(q.TenantId, ct)).Where(r => r.FromType != AiSources.AskData).ToList());

    internal static AiRelationGraphDto ToGraph(IReadOnlyList<AiDatasetRelation> rows)
    {
        var nodes = rows.SelectMany(r => new[] { (r.FromType, r.FromId, r.FromName), (r.ToType, r.ToId, r.ToName) })
            .GroupBy(n => (n.Item1, n.Item2))
            .Select(g => new AiRelationNodeDto(g.Key.Item1, g.Key.Item2, g.First().Item3,
                rows.Count(r => r.Status != DatasetRelations.Rejected && ((r.FromType == g.Key.Item1 && r.FromId == g.Key.Item2) || (r.ToType == g.Key.Item1 && r.ToId == g.Key.Item2)))))
            .OrderBy(n => n.Name).ToList();
        return new AiRelationGraphDto(nodes, rows.Select(ToDto).ToList());
    }

    internal static AiRelationDto ToDto(AiDatasetRelation r) =>
        new(r.Id, r.FromType, r.FromId, r.FromName, r.FromColumn, r.ToType, r.ToId, r.ToName, r.ToColumn, r.Status, r.Overlap, AiDates.Utc(r.ModifiedAt));
}
