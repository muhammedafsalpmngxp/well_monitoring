using MediatR;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.Relationships;

public sealed class SetAiRelationStatusHandler(IAiKnowledgeRepository knowledge) : IRequestHandler<SetAiRelationStatusCommand, AiRelationDto?>
{
    public async Task<AiRelationDto?> Handle(SetAiRelationStatusCommand c, CancellationToken ct)
    {
        var r = await knowledge.GetRelationAsync(c.Id, c.TenantId, ct);
        if (r is null) return null;
        r.Status = c.Status; r.ModifiedBy = c.UserId; r.ModifiedAt = DateTime.UtcNow;
        await knowledge.SaveRelationsAsync(ct);
        return GetAiRelationGraphHandler.ToDto(r);
    }
}
