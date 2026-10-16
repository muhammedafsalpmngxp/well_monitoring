using Microsoft.EntityFrameworkCore;
using TWise.Tenant.Application.Abstractions;
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
        return rows.ToDictionary(r => r.AgentId, r => new AiAgentStatsDto(
            r.Runs, Math.Round(100.0 * r.Succeeded / r.Runs, 1), Math.Round(r.AvgSeconds, 1), r.LastRunAt));
    }
}
