using MediatR;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.Knowledge;

public sealed class DeleteAiExampleHandler(IAiKnowledgeRepository knowledge) : IRequestHandler<DeleteAiExampleCommand, bool>
{
    public async Task<bool> Handle(DeleteAiExampleCommand c, CancellationToken ct)
    {
        var e = await knowledge.GetExampleAsync(c.Id, c.TenantId, ct);
        if (e is null) return false;
        await knowledge.RemoveExampleAsync(e, ct);
        return true;
    }
}
