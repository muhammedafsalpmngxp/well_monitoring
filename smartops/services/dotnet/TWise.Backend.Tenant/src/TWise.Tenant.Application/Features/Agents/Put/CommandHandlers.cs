using MediatR;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Agents;

public sealed class UpdateAiAgentHandler(IAiAgentRepository agents, IAiKeyProtector keys) : IRequestHandler<UpdateAiAgentCommand, AiAgentDto?>
{
    public async Task<AiAgentDto?> Handle(UpdateAiAgentCommand c, CancellationToken ct)
    {
        var agent = await agents.GetAsync(c.TenantId, c.Id, ct);
        if (agent is null) return null;
        AgentMapping.Apply(agent, c.Request, keys);
        await agents.SaveAsync(ct);
        await AgentVersioning.RecordAsync(agents, agent, c.UserName, ct);
        var stats = await agents.StatsAsync(c.TenantId, ct);
        return AgentMapping.ToDto(agent, stats.GetValueOrDefault(agent.Id));
    }
}

/// <summary>Only the state changes: saving the agent's configuration never switches it back on.</summary>
public sealed class SetAiAgentStateHandler(IAiAgentRepository agents) : IRequestHandler<SetAiAgentStateCommand, AiAgentDto?>
{
    public async Task<AiAgentDto?> Handle(SetAiAgentStateCommand c, CancellationToken ct)
    {
        var agent = await agents.GetAsync(c.TenantId, c.Id, ct);
        if (agent is null) return null;
        agent.AgentState = c.AgentState;
        agent.UpdatedAt = DateTime.UtcNow;
        await agents.SaveAsync(ct);
        var stats = await agents.StatsAsync(c.TenantId, ct);
        return AgentMapping.ToDto(agent, stats.GetValueOrDefault(agent.Id));
    }
}
