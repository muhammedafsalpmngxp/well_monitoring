using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Agents;

/// <summary>An agent's memories, newest first; null when the agent is not the tenant's.</summary>
public sealed record ListAiAgentMemoriesQuery(long TenantId, long AgentId) : IRequest<IReadOnlyList<AiAgentMemoryDto>?>;

/// <summary>Forgets one memory, or all of them when MemoryId is null; false when nothing matched.</summary>
public sealed record DeleteAiAgentMemoriesCommand(long TenantId, long AgentId, long? MemoryId) : IRequest<bool>;
