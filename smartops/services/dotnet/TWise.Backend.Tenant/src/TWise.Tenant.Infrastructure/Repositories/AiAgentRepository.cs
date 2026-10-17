using Microsoft.EntityFrameworkCore;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Features.Agents;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Infrastructure.Persistence;

namespace TWise.Tenant.Infrastructure.Repositories;

public sealed class AiAgentRepository(TenantDbContext db) : IAiAgentRepository
{
    public async Task<IReadOnlyList<AiAgent>> ListAsync(long tenantId, CancellationToken ct) =>
        await db.AiAgents.AsNoTracking().Where(a => a.TenantId == tenantId).OrderByDescending(a => a.UpdatedAt).ToListAsync(ct);

    public Task<AiAgent?> GetAsync(long tenantId, long id, CancellationToken ct) =>
        db.AiAgents.FirstOrDefaultAsync(a => a.Id == id && a.TenantId == tenantId, ct);

    public void Add(AiAgent agent) => db.AiAgents.Add(agent);

    public void Remove(AiAgent agent) => db.AiAgents.Remove(agent);

    public Task SaveAsync(CancellationToken ct) => db.SaveChangesAsync(ct);

    public async Task AddRunAsync(AiAgentRun run, CancellationToken ct)
    {
        db.AiAgentRuns.Add(run);
        await db.SaveChangesAsync(ct);
    }

    public async Task<IReadOnlyList<AiAgentRun>> ListRunsAsync(long tenantId, long? agentId, int take, CancellationToken ct) =>
        await db.AiAgentRuns.AsNoTracking()
            .Where(r => r.TenantId == tenantId && (agentId == null || r.AgentId == agentId))
            .OrderByDescending(r => r.StartedAt).Take(take).ToListAsync(ct);

    public async Task<IReadOnlyDictionary<long, AiAgentStatsDto>> StatsAsync(long tenantId, CancellationToken ct)
    {
        var rows = await db.AiAgentRuns.AsNoTracking()
            .Where(r => r.TenantId == tenantId && r.AgentId != null)
            .GroupBy(r => r.AgentId!.Value)
            .Select(g => new
            {
                AgentId = g.Key,
                Runs = g.Count(),
                Succeeded = g.Count(r => r.Status == "success"),
                AvgSeconds = g.Average(r => r.Seconds),
                LastRunAt = g.Max(r => r.StartedAt),
            })
            .ToListAsync(ct);
        var llm = AgentUsage.ByAgent(await UsageAsync(tenantId, null, ct));
        return rows.ToDictionary(r => r.AgentId, r => new AiAgentStatsDto(
            r.Runs, Math.Round(100.0 * r.Succeeded / r.Runs, 1), Math.Round(r.AvgSeconds, 1), r.LastRunAt, llm.GetValueOrDefault(r.AgentId)));
    }

    public async Task<IReadOnlyList<AgentUsageRow>> UsageAsync(long tenantId, IReadOnlyCollection<string>? purposes, CancellationToken ct)
    {
        if (purposes is { Count: 0 }) return [];
        var logs = db.AiUsageLogs.AsNoTracking().Where(l => l.TenantId == tenantId);
        logs = purposes is null ? logs.Where(l => l.Purpose.StartsWith(AgentUsage.Prefix)) : logs.Where(l => purposes.Contains(l.Purpose));
        // Anonymous projection: EF cannot translate a record constructor inside a GroupBy select.
        var rows = await logs.GroupBy(l => new { l.Purpose, l.Model })
            .Select(g => new { g.Key.Purpose, g.Key.Model, Calls = g.Count(), Prompt = g.Sum(x => (long)x.PromptTokens), Completion = g.Sum(x => (long)x.CompletionTokens) })
            .ToListAsync(ct);
        return rows.Select(r => new AgentUsageRow(r.Purpose, r.Model, r.Calls, r.Prompt, r.Completion)).ToList();
    }
}
