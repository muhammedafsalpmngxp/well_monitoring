using System.Text.Json;
using MediatR;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Agents;

public sealed class ListAiAgentVersionsHandler(IAiAgentRepository agents) : IRequestHandler<ListAiAgentVersionsQuery, IReadOnlyList<AiAgentVersionDto>?>
{
    public async Task<IReadOnlyList<AiAgentVersionDto>?> Handle(ListAiAgentVersionsQuery q, CancellationToken ct) =>
        await agents.GetAsync(q.TenantId, q.AgentId, ct) is null ? null : await agents.ListVersionsAsync(q.TenantId, q.AgentId, ct);
}

public sealed class GetAiAgentVersionHandler(IAiAgentRepository agents) : IRequestHandler<GetAiAgentVersionQuery, SaveAiAgentRequest?>
{
    public async Task<SaveAiAgentRequest?> Handle(GetAiAgentVersionQuery q, CancellationToken ct) =>
        q.VersionNo < 1 || await agents.GetVersionAsync(q.TenantId, q.AgentId, q.VersionNo, ct) is not { } v
            ? null : JsonSerializer.Deserialize<SaveAiAgentRequest>(v.SnapshotJson, AgentMapping.Json);
}
