using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Agents;

/// <summary>The tenant's agents, newest first, each with its run stats.</summary>
public sealed record ListAiAgentsQuery(long TenantId) : IRequest<IReadOnlyList<AiAgentDto>>;

/// <summary>One agent; null when it is not the tenant's.</summary>
public sealed record GetAiAgentQuery(long TenantId, long Id) : IRequest<AiAgentDto?>;

/// <summary>Latest runs, of one agent or of all the tenant's agents.</summary>
public sealed record ListAiAgentRunsQuery(long TenantId, long? AgentId, int Take = 50) : IRequest<IReadOnlyList<AiAgentRunDto>>;

/// <summary>The tools a step can use (twise agents and their actions), from the agent runtime.</summary>
public sealed record ListAgentToolsQuery : IRequest<AgentToolsDto>;
