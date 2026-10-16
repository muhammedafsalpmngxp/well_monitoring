using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Infrastructure.Persistence;

namespace TWise.Tenant.Infrastructure.Repositories;

public sealed class RefreshRepository(TenantDbContext db, ILogger<RefreshRepository> logger) : IRefreshRepository
{
    /// <summary>Job codes start here so they never collide with the seeded demo codes.</summary>
    private const int JobCodeSeed = 1000;

    private const string JobCodePrefix = "JB-";

    // ── Schedules ────────────────────────────────────────────────────────────

    public async Task<IReadOnlyList<RefreshSchedule>> GetSchedulesAsync(long tenantId, CancellationToken ct = default)
        => await db.RefreshSchedules
            .AsNoTracking()
            .Where(s => s.TenantId == tenantId)
            .OrderByDescending(s => s.CreatedAt)
            .ToListAsync(ct);

    public async Task<RefreshSchedule?> GetScheduleAsync(long id, long tenantId, CancellationToken ct = default)
        => await db.RefreshSchedules.FirstOrDefaultAsync(s => s.Id == id && s.TenantId == tenantId, ct);

    public async Task<bool> ScheduleNameExistsAsync(string name, long tenantId, long? excludeId = null, CancellationToken ct = default)
        => await db.RefreshSchedules
            .AnyAsync(s => s.TenantId == tenantId && s.ScheduleName == name && (excludeId == null || s.Id != excludeId), ct);

    public async Task<RefreshSchedule> AddScheduleAsync(RefreshSchedule schedule, CancellationToken ct = default)
    {
        db.RefreshSchedules.Add(schedule);
        await db.SaveChangesAsync(ct);
        return schedule;
    }

    public async Task UpdateScheduleAsync(RefreshSchedule schedule, CancellationToken ct = default)
    {
        db.RefreshSchedules.Update(schedule);
        await db.SaveChangesAsync(ct);
    }

    public async Task<bool> SoftDeleteScheduleAsync(long id, long tenantId, CancellationToken ct = default)
    {
        var schedule = await db.RefreshSchedules.FirstOrDefaultAsync(s => s.Id == id && s.TenantId == tenantId, ct);
        if (schedule is null) return false;

        schedule.IsDeleted = true;
        schedule.IsEnabled = false;
        schedule.ModifiedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return true;
    }

    public async Task<IReadOnlyList<RefreshSchedule>> GetDueSchedulesAsync(DateTime utcNow, int limit, CancellationToken ct = default)
        => await db.RefreshSchedules
            .Where(s => s.IsEnabled && s.NextRunAt != null && s.NextRunAt <= utcNow)
            .OrderBy(s => s.NextRunAt)
            .Take(limit)
            .ToListAsync(ct);

    // ── Jobs ─────────────────────────────────────────────────────────────────

    public async Task<IReadOnlyList<RefreshJob>> GetJobsAsync(long tenantId, int limit, CancellationToken ct = default)
        => await db.RefreshJobs
            .AsNoTracking()
            .Where(j => j.TenantId == tenantId)
            .OrderByDescending(j => j.QueuedAt)
            .Take(limit)
            .ToListAsync(ct);

    public async Task<RefreshJob?> GetJobAsync(long id, long tenantId, CancellationToken ct = default)
        => await db.RefreshJobs.FirstOrDefaultAsync(j => j.Id == id && j.TenantId == tenantId, ct);

    public async Task<RefreshJob?> GetJobForExecutionAsync(long id, CancellationToken ct = default)
        => await db.RefreshJobs.FirstOrDefaultAsync(j => j.Id == id, ct);

    public async Task<RefreshJob> AddJobAsync(RefreshJob job, CancellationToken ct = default)
    {
        db.RefreshJobs.Add(job);
        await db.SaveChangesAsync(ct);
        return job;
    }

    public async Task UpdateJobAsync(RefreshJob job, CancellationToken ct = default)
    {
        db.RefreshJobs.Update(job);
        await db.SaveChangesAsync(ct);
    }

    public async Task<string> NextJobCodeAsync(CancellationToken ct = default)
    {
        // Derived from the row count rather than a sequence to avoid another schema object.
        // UX_core_RefreshJobs_job_code is the real guard: if two callers race, the second
        // insert fails and is retried by the caller rather than producing a duplicate code.
        var count = await db.RefreshJobs.IgnoreQueryFilters().CountAsync(ct);
        return $"{JobCodePrefix}{JobCodeSeed + count + 1}";
    }

    public async Task<int> PurgeJobsOlderThanAsync(DateTime olderThanUtc, int batchSize, CancellationToken ct = default)
    {
        // Only terminal jobs are eligible; a queued or processing row that is old is a stuck
        // job worth keeping. IgnoreQueryFilters so soft-deleted rows are cleared too.
        var deleted = await db.RefreshJobs
            .IgnoreQueryFilters()
            .Where(j => j.QueuedAt < olderThanUtc
                     && (j.Status == RefreshJobStatuses.Succeeded || j.Status == RefreshJobStatuses.Failed))
            .OrderBy(j => j.QueuedAt)
            .Take(batchSize)
            .ExecuteDeleteAsync(ct);

        if (deleted > 0)
            logger.LogInformation(
                "Purged {Deleted} refresh job(s) queued before {Cutoff:u}", deleted, olderThanUtc);

        return deleted;
    }

    // ── Dataset refresh markers ──────────────────────────────────────────────

    public async Task ReplaceDatasetRowsAsync(
        long datasetId, string columnsJson, IReadOnlyList<string> rowJson,
        string jobCode, string status, CancellationToken ct = default)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        try
        {
            // Delete-then-insert inside one transaction: a chart reading mid-refresh must
            // never see an empty or half-written dataset.
            await db.ImportedDataRows
                .Where(r => r.DatasetId == datasetId)
                .ExecuteDeleteAsync(ct);

            await InsertRowsAsync(datasetId, rowJson, startIndex: 0, ct);
            await StampDatasetAsync(datasetId, columnsJson, rowJson.Count, jobCode, status, replaceRowCount: true, ct);

            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
        }
        catch
        {
            await transaction.RollbackAsync(ct);
            throw;
        }
    }

    public async Task AppendDatasetRowsAsync(
        long datasetId, string columnsJson, IReadOnlyList<string> rowJson,
        string jobCode, string status, CancellationToken ct = default)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        try
        {
            var nextIndex = await db.ImportedDataRows
                .Where(r => r.DatasetId == datasetId)
                .Select(r => (int?)r.RowIndex)
                .MaxAsync(ct) ?? -1;

            await InsertRowsAsync(datasetId, rowJson, startIndex: nextIndex + 1, ct);
            await StampDatasetAsync(datasetId, columnsJson, rowJson.Count, jobCode, status, replaceRowCount: false, ct);

            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
        }
        catch
        {
            await transaction.RollbackAsync(ct);
            throw;
        }
    }

    public async Task MarkDatasetRefreshFailedAsync(long datasetId, string jobCode, CancellationToken ct = default)
    {
        var dataset = await db.ImportedDatasets.FirstOrDefaultAsync(d => d.Id == datasetId, ct);
        if (dataset is null) return;

        // Deliberately does not touch LastRefreshedAt: the data is still whatever the last
        // SUCCESSFUL refresh produced, and claiming otherwise would misrepresent its freshness.
        dataset.LastRefreshStatus = RefreshJobStatuses.Failed;
        dataset.LastRefreshJobCode = jobCode;
        dataset.ModifiedAt = DateTime.UtcNow;

        await db.SaveChangesAsync(ct);

        logger.LogWarning("Dataset {DatasetId} marked as failed refresh by job {JobCode}", datasetId, jobCode);
    }

    private async Task InsertRowsAsync(long datasetId, IReadOnlyList<string> rowJson, int startIndex, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var rows = rowJson.Select((json, offset) => new ImportedDataRow
        {
            DatasetId = datasetId,
            RowIndex = startIndex + offset,
            DataJson = json,
            CreatedAt = now
        });

        await db.ImportedDataRows.AddRangeAsync(rows, ct);
    }

    private async Task StampDatasetAsync(
        long datasetId, string columnsJson, int rowCount, string jobCode,
        string status, bool replaceRowCount, CancellationToken ct)
    {
        var dataset = await db.ImportedDatasets.FirstOrDefaultAsync(d => d.Id == datasetId, ct);
        if (dataset is null)
            throw new InvalidOperationException($"Imported dataset {datasetId} no longer exists.");

        // Columns can legitimately change between refreshes (a new field in an API response),
        // so the latest shape wins.
        dataset.ColumnsJson = columnsJson;
        dataset.RowCount = replaceRowCount ? rowCount : dataset.RowCount + rowCount;
        dataset.Status = "completed";
        dataset.LastRefreshedAt = DateTime.UtcNow;
        dataset.LastRefreshStatus = status;
        dataset.LastRefreshJobCode = jobCode;
        dataset.ModifiedAt = DateTime.UtcNow;
    }
}
