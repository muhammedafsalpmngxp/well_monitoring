using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Abstractions;

public interface IRefreshRepository
{
    // ── Schedules ────────────────────────────────────────────────────────────

    Task<IReadOnlyList<RefreshSchedule>> GetSchedulesAsync(long tenantId, CancellationToken ct = default);
    Task<RefreshSchedule?> GetScheduleAsync(long id, long tenantId, CancellationToken ct = default);
    Task<bool> ScheduleNameExistsAsync(string name, long tenantId, long? excludeId = null, CancellationToken ct = default);
    Task<RefreshSchedule> AddScheduleAsync(RefreshSchedule schedule, CancellationToken ct = default);
    Task UpdateScheduleAsync(RefreshSchedule schedule, CancellationToken ct = default);
    Task<bool> SoftDeleteScheduleAsync(long id, long tenantId, CancellationToken ct = default);

    /// <summary>
    /// Enabled schedules whose next run is due. Not tenant-scoped: the background worker has
    /// no user context and serves whichever tenant database this service is configured against.
    /// </summary>
    Task<IReadOnlyList<RefreshSchedule>> GetDueSchedulesAsync(DateTime utcNow, int limit, CancellationToken ct = default);

    // ── Jobs ─────────────────────────────────────────────────────────────────

    Task<IReadOnlyList<RefreshJob>> GetJobsAsync(long tenantId, int limit, CancellationToken ct = default);
    Task<RefreshJob?> GetJobAsync(long id, long tenantId, CancellationToken ct = default);

    /// <summary>
    /// Loads a job without a tenant filter, for the background worker — it has no user context,
    /// and the job row already carries the tenant it belongs to.
    /// </summary>
    Task<RefreshJob?> GetJobForExecutionAsync(long id, CancellationToken ct = default);
    Task<RefreshJob> AddJobAsync(RefreshJob job, CancellationToken ct = default);
    Task UpdateJobAsync(RefreshJob job, CancellationToken ct = default);

    /// <summary>
    /// Reserves the next job code. Codes are sequential per tenant database so they read
    /// naturally in the grid (JB-1001, JB-1002…).
    /// </summary>
    Task<string> NextJobCodeAsync(CancellationToken ct = default);

    /// <summary>
    /// Hard-deletes completed jobs older than <paramref name="olderThanUtc"/>, capped at
    /// <paramref name="batchSize"/> rows per call so a large backlog is cleared over several
    /// passes instead of one long-running delete. Returns the number removed.
    ///
    /// In-flight jobs (queued/processing) are never removed, however old — a stuck job is
    /// evidence, not clutter.
    /// </summary>
    Task<int> PurgeJobsOlderThanAsync(DateTime olderThanUtc, int batchSize, CancellationToken ct = default);

    // ── Dataset refresh markers ──────────────────────────────────────────────

    /// <summary>
    /// Replaces a dataset's rows in one transaction and stamps its last-refresh markers.
    /// Used by a full refresh, where a partial write would leave a chart rendering half a dataset.
    /// </summary>
    Task ReplaceDatasetRowsAsync(
        long datasetId, string columnsJson, IReadOnlyList<string> rowJson,
        string jobCode, string status, CancellationToken ct = default);

    /// <summary>Appends rows to a dataset and stamps its last-refresh markers (incremental refresh).</summary>
    Task AppendDatasetRowsAsync(
        long datasetId, string columnsJson, IReadOnlyList<string> rowJson,
        string jobCode, string status, CancellationToken ct = default);

    /// <summary>Records a failed refresh against the dataset without touching its rows.</summary>
    Task MarkDatasetRefreshFailedAsync(long datasetId, string jobCode, CancellationToken ct = default);
}
