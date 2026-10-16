using MediatR;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Agents;

public sealed class UpdateAiAgentHandler(IAiAgentRepository agents) : IRequestHandler<UpdateAiAgentCommand, AiAgentDto?>
{
    public async Task<AiAgentDto?> Handle(UpdateAiAgentCommand c, CancellationToken ct)
    {
        var agent = await agents.GetAsync(c.TenantId, c.Id, ct);
        if (agent is null) return null;
        AgentMapping.Apply(agent, c.Request);
        await agents.SaveAsync(ct);
        var stats = await agents.StatsAsync(c.TenantId, ct);
        return AgentMapping.ToDto(agent, stats.GetValueOrDefault(agent.Id));
    }
}
