using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Agents;

/// <summary>An agent's triggers; null when the agent is not the tenant's.</summary>
public sealed record ListAiAgentSchedulesQuery(long TenantId, long AgentId) : IRequest<IReadOnlyList<AiAgentScheduleDto>?>;

/// <summary>Adds a trigger. Throws InvalidOperationException when the agent cannot run on a schedule.</summary>
public sealed record CreateAiAgentScheduleCommand(long TenantId, long AgentId, string UserName, SaveAiAgentScheduleRequest Request)
    : IRequest<AiAgentScheduleDto?>;

public sealed record UpdateAiAgentScheduleCommand(long TenantId, long AgentId, long Id, SaveAiAgentScheduleRequest Request)
    : IRequest<AiAgentScheduleDto?>;

public sealed record DeleteAiAgentScheduleCommand(long TenantId, long AgentId, long Id) : IRequest<bool>;

/// <summary>Makes an active trigger due now (the worker runs it within a minute).</summary>
public sealed record RunAiAgentScheduleNowCommand(long TenantId, long AgentId, long Id) : IRequest<bool>;

public sealed record PreviewAgentScheduleQuery(AgentSchedulePreviewRequest Request) : IRequest<AgentSchedulePreviewDto>;
