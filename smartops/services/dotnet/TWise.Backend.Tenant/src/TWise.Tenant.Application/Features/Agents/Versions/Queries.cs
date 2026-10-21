using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Agents;

/// <summary>An agent's saved versions, newest first; null when the agent is not the tenant's.</summary>
public sealed record ListAiAgentVersionsQuery(long TenantId, long AgentId) : IRequest<IReadOnlyList<AiAgentVersionDto>?>;

/// <summary>One version as the agent object (to load into the editor); null when it does not exist.</summary>
public sealed record GetAiAgentVersionQuery(long TenantId, long AgentId, int VersionNo) : IRequest<SaveAiAgentRequest?>;
