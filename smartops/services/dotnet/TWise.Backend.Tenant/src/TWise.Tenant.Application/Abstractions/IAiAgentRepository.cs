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
    /// <summary>A thread's answered runs, oldest first (at most <paramref name="take"/>, the newest).</summary>
    Task<IReadOnlyList<AiAgentRun>> ListThreadAsync(long tenantId, string threadId, int take, CancellationToken ct);
    /// <summary>One run, tracked (SaveAsync stores changes); null when it is not the tenant's.</summary>
    Task<AiAgentRun?> GetRunAsync(long tenantId, long id, CancellationToken ct);

    Task<IReadOnlyList<AiAgentEvalCase>> ListEvalCasesAsync(long tenantId, long agentId, CancellationToken ct);
    /// <summary>Tracked; null when it is not the tenant's.</summary>
    Task<AiAgentEvalCase?> GetEvalCaseAsync(long tenantId, long id, CancellationToken ct);
    void AddEvalCase(AiAgentEvalCase evalCase);
    void RemoveEvalCase(AiAgentEvalCase evalCase);
    /// <summary>Newest first.</summary>
    Task<IReadOnlyList<AiAgentEvalRun>> ListEvalRunsAsync(long tenantId, long agentId, int take, CancellationToken ct);
    Task<AiAgentEvalRun?> GetEvalRunAsync(long tenantId, long id, CancellationToken ct);
    Task AddEvalRunAsync(AiAgentEvalRun run, CancellationToken ct);

    Task<IReadOnlyList<AiAgentSchedule>> ListSchedulesAsync(long tenantId, long agentId, CancellationToken ct);
    /// <summary>Tracked; null when it is not the tenant's (any tenant when tenantId is null: the worker).</summary>
    Task<AiAgentSchedule?> GetScheduleAsync(long? tenantId, long id, CancellationToken ct);
    void AddSchedule(AiAgentSchedule schedule);
    void RemoveSchedule(AiAgentSchedule schedule);
    /// <summary>Up to <paramref name="max"/> due active schedules; their next run moves to the lease so no one else takes them.</summary>
    Task<IReadOnlyList<long>> ClaimDueSchedulesAsync(DateTime nowUtc, int max, DateTime leaseUntilUtc, CancellationToken ct);

    /// <summary>Newest first.</summary>
    Task<IReadOnlyList<AiAgentMemory>> ListMemoriesAsync(long tenantId, long agentId, int take, CancellationToken ct);
    /// <summary>Saves the memories and drops the agent's oldest beyond <paramref name="keep"/>.</summary>
    Task AddMemoriesAsync(IReadOnlyList<AiAgentMemory> memories, int keep, CancellationToken ct);
    /// <summary>Deletes one memory, or all of the agent's when <paramref name="memoryId"/> is null; the number deleted.</summary>
    Task<int> DeleteMemoriesAsync(long tenantId, long agentId, long? memoryId, CancellationToken ct);

    /// <summary>Newest first, without the snapshots.</summary>
    Task<IReadOnlyList<AiAgentVersionDto>> ListVersionsAsync(long tenantId, long agentId, CancellationToken ct);
    Task<AiAgentVersion?> GetVersionAsync(long tenantId, long agentId, int versionNo, CancellationToken ct);
    /// <summary>Saves the version and drops the agent's oldest beyond <paramref name="keep"/>.</summary>
    Task AddVersionAsync(AiAgentVersion version, int keep, CancellationToken ct);
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
