using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Abstractions;

/// <summary>core.AiAgents and core.AiAgentRuns, always scoped to one tenant.</summary>
public interface IAiAgentRepository
{
    Task<IReadOnlyList<AiAgent>> ListAsync(long tenantId, CancellationToken ct);
    Task<AiAgent?> GetAsync(long tenantId, long id, CancellationToken ct);
    void Add(AiAgent agent);
    void Remove(AiAgent agent);
    Task SaveAsync(CancellationToken ct);

    Task AddRunAsync(AiAgentRun run, CancellationToken ct);
    /// <summary>Newest first; all of the tenant's runs when agentId is null.</summary>
    Task<IReadOnlyList<AiAgentRun>> ListRunsAsync(long tenantId, long? agentId, int take, CancellationToken ct);
    /// <summary>Run count, success rate, average seconds, last run and LLM use per saved agent.</summary>
    Task<IReadOnlyDictionary<long, AiAgentStatsDto>> StatsAsync(long tenantId, CancellationToken ct);
    /// <summary>
    /// core.AiUsageLog rows of agent runs grouped by purpose and model: those purposes only, or every agent run's
    /// when purposes is null (see AgentUsage).
    /// </summary>
    Task<IReadOnlyList<AgentUsageRow>> UsageAsync(long tenantId, IReadOnlyCollection<string>? purposes, CancellationToken ct);
}
