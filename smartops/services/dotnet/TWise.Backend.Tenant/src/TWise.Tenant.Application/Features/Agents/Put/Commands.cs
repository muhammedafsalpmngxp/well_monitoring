using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Agents;

/// <summary>Replaces an agent's configuration and status; null when it is not the tenant's.</summary>
public sealed record UpdateAiAgentCommand(long TenantId, long Id, string UserName, SaveAiAgentRequest Request) : IRequest<AiAgentDto?>;

/// <summary>Switches an agent on or off ("active" / "inactive"); null when it is not the tenant's.</summary>
public sealed record SetAiAgentStateCommand(long TenantId, long Id, string AgentState) : IRequest<AiAgentDto?>;
