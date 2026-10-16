using MediatR;

namespace TWise.Tenant.Application.Features.Agents;

/// <summary>Deletes an agent; its runs stay in history under the agent's name. False when it is not the tenant's.</summary>
public sealed record DeleteAiAgentCommand(long TenantId, long Id) : IRequest<bool>;
