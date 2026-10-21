using MediatR;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Agents;

public sealed class ListAiAgentMemoriesHandler(IAiAgentRepository agents) : IRequestHandler<ListAiAgentMemoriesQuery, IReadOnlyList<AiAgentMemoryDto>?>
{
    public async Task<IReadOnlyList<AiAgentMemoryDto>?> Handle(ListAiAgentMemoriesQuery q, CancellationToken ct) =>
        await agents.GetAsync(q.TenantId, q.AgentId, ct) is null ? null
            : (await agents.ListMemoriesAsync(q.TenantId, q.AgentId, TestAiAgentStreamHandler.MemoryKeep, ct))
                .Select(m => new AiAgentMemoryDto(m.Id, m.Text, m.RunId, m.CreatedAt)).ToList();
}

public sealed class DeleteAiAgentMemoriesHandler(IAiAgentRepository agents) : IRequestHandler<DeleteAiAgentMemoriesCommand, bool>
{
    public async Task<bool> Handle(DeleteAiAgentMemoriesCommand c, CancellationToken ct) =>
        await agents.GetAsync(c.TenantId, c.AgentId, ct) is not null
        && (await agents.DeleteMemoriesAsync(c.TenantId, c.AgentId, c.MemoryId, ct) > 0 || c.MemoryId is null);
}
