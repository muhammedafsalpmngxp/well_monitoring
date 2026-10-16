using MediatR;
using TWise.Tenant.Application.Abstractions;

namespace TWise.Tenant.Application.Features.Agents;

public sealed class DeleteAiAgentHandler(IAiAgentRepository agents) : IRequestHandler<DeleteAiAgentCommand, bool>
{
    public async Task<bool> Handle(DeleteAiAgentCommand c, CancellationToken ct)
    {
        var agent = await agents.GetAsync(c.TenantId, c.Id, ct);
        if (agent is null) return false;
        agents.Remove(agent);
        await agents.SaveAsync(ct);
        return true;
    }
}
