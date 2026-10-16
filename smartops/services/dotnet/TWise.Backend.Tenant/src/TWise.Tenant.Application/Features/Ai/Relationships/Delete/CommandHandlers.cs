using MediatR;
using TWise.Tenant.Application.Abstractions;

namespace TWise.Tenant.Application.Features.Ai.Relationships;

public sealed class DeleteAiRelationHandler(IAiKnowledgeRepository knowledge) : IRequestHandler<DeleteAiRelationCommand, bool>
{
    public async Task<bool> Handle(DeleteAiRelationCommand c, CancellationToken ct)
    {
        var r = await knowledge.GetRelationAsync(c.Id, c.TenantId, ct);
        if (r is null) return false;
        await knowledge.RemoveRelationAsync(r, ct);
        await knowledge.SaveRelationsAsync(ct);
        return true;
    }
}
