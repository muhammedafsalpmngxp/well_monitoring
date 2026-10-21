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

    public async Task<IReadOnlyList<AiAgentEvalCase>> ListEvalCasesAsync(long tenantId, long agentId, CancellationToken ct) =>
        await db.AiAgentEvalCases.AsNoTracking().Where(c => c.TenantId == tenantId && c.AgentId == agentId).OrderBy(c => c.Id).ToListAsync(ct);

    public Task<AiAgentEvalCase?> GetEvalCaseAsync(long tenantId, long id, CancellationToken ct) =>
        db.AiAgentEvalCases.FirstOrDefaultAsync(c => c.Id == id && c.TenantId == tenantId, ct);

    public void AddEvalCase(AiAgentEvalCase evalCase) => db.AiAgentEvalCases.Add(evalCase);

    public void RemoveEvalCase(AiAgentEvalCase evalCase) => db.AiAgentEvalCases.Remove(evalCase);

    public async Task<IReadOnlyList<AiAgentEvalRun>> ListEvalRunsAsync(long tenantId, long agentId, int take, CancellationToken ct) =>
        await db.AiAgentEvalRuns.AsNoTracking().Where(r => r.TenantId == tenantId && r.AgentId == agentId)
            .OrderByDescending(r => r.Id).Take(take).ToListAsync(ct);

    public Task<AiAgentEvalRun?> GetEvalRunAsync(long tenantId, long id, CancellationToken ct) =>
        db.AiAgentEvalRuns.AsNoTracking().FirstOrDefaultAsync(r => r.Id == id && r.TenantId == tenantId, ct);

    public async Task AddEvalRunAsync(AiAgentEvalRun run, CancellationToken ct)
    {
        db.AiAgentEvalRuns.Add(run);
        await db.SaveChangesAsync(ct);
    }

    public async Task<IReadOnlyList<AiAgentSchedule>> ListSchedulesAsync(long tenantId, long agentId, CancellationToken ct) =>
        await db.AiAgentSchedules.AsNoTracking().Where(s => s.TenantId == tenantId && s.AgentId == agentId).OrderBy(s => s.Id).ToListAsync(ct);

    public Task<AiAgentSchedule?> GetScheduleAsync(long? tenantId, long id, CancellationToken ct) =>
        db.AiAgentSchedules.FirstOrDefaultAsync(s => s.Id == id && (tenantId == null || s.TenantId == tenantId), ct);

    public void AddSchedule(AiAgentSchedule schedule) => db.AiAgentSchedules.Add(schedule);

    public void RemoveSchedule(AiAgentSchedule schedule) => db.AiAgentSchedules.Remove(schedule);

    public async Task<IReadOnlyList<long>> ClaimDueSchedulesAsync(DateTime nowUtc, int max, DateTime leaseUntilUtc, CancellationToken ct)
    {
        // As the delivery schedules: UPDLOCK + READPAST skips rows another instance is claiming; a crash only delays a run.
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        var ids = await db.Database.SqlQuery<long>($"""
            WITH due AS (
                SELECT TOP ({max}) id, next_run_at
                FROM core.AiAgentSchedules WITH (UPDLOCK, READPAST, ROWLOCK)
                WHERE is_active = 1 AND next_run_at <= {nowUtc}
                ORDER BY next_run_at)
            UPDATE due SET next_run_at = {leaseUntilUtc}
            OUTPUT inserted.id AS Value;
            """).ToListAsync(ct);
        await transaction.CommitAsync(ct);
        return ids;
    }

    public async Task<IReadOnlyList<AiAgentMemory>> ListMemoriesAsync(long tenantId, long agentId, int take, CancellationToken ct) =>
        await db.AiAgentMemories.AsNoTracking().Where(m => m.TenantId == tenantId && m.AgentId == agentId)
            .OrderByDescending(m => m.Id).Take(take).ToListAsync(ct);

    public async Task AddMemoriesAsync(IReadOnlyList<AiAgentMemory> memories, int keep, CancellationToken ct)
    {
        if (memories.Count == 0) return;
        db.AiAgentMemories.AddRange(memories);
        await db.SaveChangesAsync(ct);
        var agentId = memories[0].AgentId;
        var oldestKept = await db.AiAgentMemories.Where(m => m.AgentId == agentId).OrderByDescending(m => m.Id)
            .Skip(keep - 1).Select(m => (long?)m.Id).FirstOrDefaultAsync(ct);
        if (oldestKept is { } id) await db.AiAgentMemories.Where(m => m.AgentId == agentId && m.Id < id).ExecuteDeleteAsync(ct);
    }

    public Task<int> DeleteMemoriesAsync(long tenantId, long agentId, long? memoryId, CancellationToken ct) =>
        db.AiAgentMemories.Where(m => m.TenantId == tenantId && m.AgentId == agentId && (memoryId == null || m.Id == memoryId))
            .ExecuteDeleteAsync(ct);

    public async Task<IReadOnlyList<AiAgentVersionDto>> ListVersionsAsync(long tenantId, long agentId, CancellationToken ct) =>
        await db.AiAgentVersions.AsNoTracking().Where(v => v.TenantId == tenantId && v.AgentId == agentId)
            .OrderByDescending(v => v.VersionNo).Select(v => new AiAgentVersionDto(v.VersionNo, v.Status, v.CreatedBy, v.CreatedAt)).ToListAsync(ct);

    public Task<AiAgentVersion?> GetVersionAsync(long tenantId, long agentId, int versionNo, CancellationToken ct) =>
        db.AiAgentVersions.AsNoTracking().OrderByDescending(v => v.VersionNo)
            .FirstOrDefaultAsync(v => v.TenantId == tenantId && v.AgentId == agentId && (versionNo == 0 || v.VersionNo == versionNo), ct);

    public async Task AddVersionAsync(AiAgentVersion version, int keep, CancellationToken ct)
    {
        db.AiAgentVersions.Add(version);
        await db.SaveChangesAsync(ct);
        await db.AiAgentVersions.Where(v => v.AgentId == version.AgentId && v.VersionNo <= version.VersionNo - keep).ExecuteDeleteAsync(ct);
    }

    public async Task<IReadOnlyList<AiAgentRun>> ListThreadAsync(long tenantId, string threadId, int take, CancellationToken ct) =>
        (await db.AiAgentRuns.AsNoTracking().Where(r => r.TenantId == tenantId && r.ThreadId == threadId && r.Status == "success")
            .OrderByDescending(r => r.StartedAt).Take(take).ToListAsync(ct)).AsEnumerable().Reverse().ToList();

    public Task<AiAgentRun?> GetRunAsync(long tenantId, long id, CancellationToken ct) =>
        db.AiAgentRuns.FirstOrDefaultAsync(r => r.Id == id && r.TenantId == tenantId, ct);

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
