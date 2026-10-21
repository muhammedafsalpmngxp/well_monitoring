using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Agents;

/// <summary>Saves a new agent as draft or published.</summary>
public sealed record CreateAiAgentCommand(long TenantId, string UserName, SaveAiAgentRequest Request) : IRequest<AiAgentDto>;

/// <summary>
/// Runs an agent configuration (saved or not) through the agent runtime and streams its progress:
/// step, status and node events, then done (with the saved run's id) or error. Every run is saved.
/// </summary>
/// <summary>Continues a run waiting at a Human Approval step (approve / edit / reject) and streams the rest like a test.</summary>
public sealed record ResumeAiAgentRunStream(long TenantId, string UserId, string UserName, long RunId, ResumeAiAgentRunRequest Request)
    : IStreamRequest<AiAskEvent>;

public sealed record TestAiAgentStream(long TenantId, string UserId, string UserName, TestAiAgentRequest Request) : IStreamRequest<AiAskEvent>;
