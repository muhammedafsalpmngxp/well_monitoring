using Microsoft.EntityFrameworkCore;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Infrastructure.Persistence;

namespace TWise.Tenant.Infrastructure.Repositories;

public sealed class CrewAssignmentRepository(TenantDbContext db) : ICrewAssignmentRepository
{
    public async Task<bool> ExistsAsync(string crewUid, string activityCode, string? wellId,
        DateTime? plannedStart, DateTime? plannedEnd, CancellationToken ct = default)
    {
        return await db.CrewActivityAssignments
            .AsNoTracking()
            .AnyAsync(a =>
                a.CrewUid == crewUid &&
                a.ActivityCode == activityCode &&
                a.WellId == wellId &&
                (!plannedStart.HasValue || !a.PlannedEnd.HasValue || a.PlannedEnd.Value.Date >= plannedStart.Value.Date) &&
                (!plannedEnd.HasValue || !a.PlannedStart.HasValue || a.PlannedStart.Value.Date <= plannedEnd.Value.Date), ct);
    }

    public async Task<CrewActivityAssignment?> CreateAsync(CrewActivityAssignment entity, CancellationToken ct = default)
    {
        var strategy = db.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync(async () =>
        {
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            await db.CrewActivityAssignments
                .FromSqlInterpolated($"""
                    SELECT * FROM core.CrewActivityAssignment WITH (UPDLOCK, HOLDLOCK)
                    WHERE crew_uid = {entity.CrewUid} AND activity_code = {entity.ActivityCode}
                      AND (well_id = {entity.WellId} OR (well_id IS NULL AND {entity.WellId} IS NULL))
                    """)
                .AsNoTracking()
                .ToListAsync(ct);

            if (await ExistsAsync(entity.CrewUid, entity.ActivityCode, entity.WellId,
                entity.PlannedStart, entity.PlannedEnd, ct))
                return null;

            db.CrewActivityAssignments.Add(entity);
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
            return entity;
        });
    }

    public async Task<CrewActivityAssignment?> GetByIdAsync(long id, CancellationToken ct = default)
    {
        return await db.CrewActivityAssignments.FirstOrDefaultAsync(a => a.Id == id, ct);
    }

    public async Task SoftDeleteAsync(CrewActivityAssignment entity, CancellationToken ct = default)
    {
        db.CrewActivityAssignments.Update(entity);
        await db.SaveChangesAsync(ct);
    }

    public async Task<IReadOnlyList<CrewActivityAssignment>> GetForScopeAsync(
        string? crewGroupCode, string? wellId, DateTime? from = null, DateTime? to = null,
        CancellationToken ct = default)
    {
        var query = db.CrewActivityAssignments
            .AsNoTracking()
            .Where(a => !a.IsDeleted);

        if (!string.IsNullOrWhiteSpace(crewGroupCode))
            query = query.Where(a => a.CrewGroupCode == crewGroupCode);

        if (!string.IsNullOrWhiteSpace(wellId))
            query = query.Where(a => a.WellId == wellId);

        if (from.HasValue)
            query = query.Where(a => !a.PlannedEnd.HasValue || a.PlannedEnd >= from.Value);

        if (to.HasValue)
            query = query.Where(a => !a.PlannedStart.HasValue || a.PlannedStart <= to.Value);

        return await query
            .OrderBy(a => a.CrewGroupCode)
            .ThenBy(a => a.CrewUid)
            .ToListAsync(ct);
    }
}
