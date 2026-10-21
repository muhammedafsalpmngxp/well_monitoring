using System.Text.Json;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Features.Agents;

/// <summary>Each Save as Draft / Publish keeps the agent as it was saved, as the next version.</summary>
public static class AgentVersioning
{
    public const int Keep = 50;

    public static async Task RecordAsync(IAiAgentRepository agents, AiAgent agent, string user, CancellationToken ct)
    {
        // The request as the page would send it: tool secrets are never in it (HasAuthSecret only).
        var snapshot = JsonSerializer.Serialize(AgentMapping.ToRequest(AgentMapping.ToDto(agent, null)), AgentMapping.Json);
        var last = await agents.GetVersionAsync(agent.TenantId, agent.Id, 0, ct);
        if (last?.SnapshotJson == snapshot) return;   // saved again without a change
        await agents.AddVersionAsync(new AiAgentVersion
        {
            TenantId = agent.TenantId, AgentId = agent.Id, VersionNo = (last?.VersionNo ?? 0) + 1, Status = agent.Status,
            SnapshotJson = snapshot, CreatedBy = user, CreatedAt = DateTime.UtcNow,
        }, Keep, ct);
    }
}
