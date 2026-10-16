using MediatR;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Agents;

public sealed class ListAiAgentsHandler(IAiAgentRepository agents) : IRequestHandler<ListAiAgentsQuery, IReadOnlyList<AiAgentDto>>
{
    public async Task<IReadOnlyList<AiAgentDto>> Handle(ListAiAgentsQuery q, CancellationToken ct)
    {
        var list = await agents.ListAsync(q.TenantId, ct);
        var stats = await agents.StatsAsync(q.TenantId, ct);
        return list.Select(a => AgentMapping.ToDto(a, stats.GetValueOrDefault(a.Id))).ToList();
    }
}

public sealed class GetAiAgentHandler(IAiAgentRepository agents) : IRequestHandler<GetAiAgentQuery, AiAgentDto?>
{
    public async Task<AiAgentDto?> Handle(GetAiAgentQuery q, CancellationToken ct)
    {
        var agent = await agents.GetAsync(q.TenantId, q.Id, ct);
        if (agent is null) return null;
        var stats = await agents.StatsAsync(q.TenantId, ct);
        return AgentMapping.ToDto(agent, stats.GetValueOrDefault(agent.Id));
    }
}

public sealed class ListAiAgentRunsHandler(IAiAgentRepository agents) : IRequestHandler<ListAiAgentRunsQuery, IReadOnlyList<AiAgentRunDto>>
{
    public async Task<IReadOnlyList<AiAgentRunDto>> Handle(ListAiAgentRunsQuery q, CancellationToken ct) =>
        (await agents.ListRunsAsync(q.TenantId, q.AgentId, Math.Clamp(q.Take, 1, 200), ct)).Select(AgentMapping.ToDto).ToList();
}

public sealed class ListAgentToolsHandler(IAgentRuntimeClient runtime) : IRequestHandler<ListAgentToolsQuery, AgentToolsDto>
{
    public async Task<AgentToolsDto> Handle(ListAgentToolsQuery q, CancellationToken ct)
    {
        try { return await runtime.ListToolsAsync(ct); }
        catch (HttpRequestException ex) { return new AgentToolsDto([], "The agent service is not reachable, so no tools can be listed. " + ex.Message); }
        catch (TaskCanceledException) when (!ct.IsCancellationRequested) { return new AgentToolsDto([], "The agent service did not answer in time."); }
    }
}
