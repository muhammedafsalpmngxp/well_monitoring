using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Agents;

/// <summary>The agent's test cases and latest eval runs; null when the agent is not the tenant's.</summary>
public sealed record GetAiAgentEvalsQuery(long TenantId, long AgentId) : IRequest<AiAgentEvalsDto?>;

/// <summary>One eval run with every case's result; null when it is not the tenant's agent's.</summary>
public sealed record GetAiAgentEvalRunQuery(long TenantId, long AgentId, long Id) : IRequest<AiAgentEvalRunDto?>;

/// <summary>Adds a test case. Throws InvalidOperationException when the agent has the most cases allowed.</summary>
public sealed record CreateAiAgentEvalCaseCommand(long TenantId, long AgentId, string UserName, SaveAiAgentEvalCaseRequest Request)
    : IRequest<AiAgentEvalCaseDto?>;

public sealed record UpdateAiAgentEvalCaseCommand(long TenantId, long AgentId, long Id, SaveAiAgentEvalCaseRequest Request)
    : IRequest<AiAgentEvalCaseDto?>;

public sealed record DeleteAiAgentEvalCaseCommand(long TenantId, long AgentId, long Id) : IRequest<bool>;

/// <summary>
/// Runs the test cases and streams their results: case (phase start / end, with passed and reasons), then done (the
/// saved eval run: passed, total) or error. Each case runs like Test Agent (recorded by "Eval · user").
/// </summary>
public sealed record RunAiAgentEvalStream(long TenantId, string UserId, string UserName, long AgentId, RunAiAgentEvalRequest Request)
    : IStreamRequest<AiAskEvent>;
