using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Abstractions.Services;

/// <summary>
/// Scheduled, manual and incremental refresh of connector-backed datasets, plus the
/// execution history behind the Data Sync screen.
/// </summary>
public interface IRefreshService
{
    // ── Schedules ────────────────────────────────────────────────────────────

    Task<IReadOnlyList<RefreshScheduleDto>> GetSchedulesAsync(long tenantId, CancellationToken ct = default);

    Task<RefreshScheduleDto?> GetScheduleAsync(long id, long tenantId, CancellationToken ct = default);

    Task<RefreshScheduleDto> CreateScheduleAsync(
        CreateRefreshScheduleRequest request, long userId, long tenantId, CancellationToken ct = default);

    Task<RefreshScheduleDto?> UpdateScheduleAsync(
        long id, UpdateRefreshScheduleRequest request, long userId, long tenantId, CancellationToken ct = default);

    Task<bool> DeleteScheduleAsync(long id, long tenantId, CancellationToken ct = default);

    // ── Jobs ─────────────────────────────────────────────────────────────────

    /// <summary>Refresh history, newest first.</summary>
    Task<IReadOnlyList<RefreshJobDto>> GetJobsAsync(long tenantId, int limit, CancellationToken ct = default);

    /// <summary>Runs a schedule immediately without disturbing its next scheduled fire time.</summary>
    Task<RefreshJobDto?> RunScheduleNowAsync(long scheduleId, long userId, long tenantId, CancellationToken ct = default);

    /// <summary>Runs an ad-hoc refresh that is not attached to any schedule.</summary>
    Task<RefreshJobDto> RunManualAsync(
        RunRefreshRequest request, long userId, long tenantId, CancellationToken ct = default);

    /// <summary>Re-runs a previous job with the same target and mode.</summary>
    Task<RefreshJobDto?> RetryJobAsync(long jobId, long userId, long tenantId, CancellationToken ct = default);

    // ── Monitoring ───────────────────────────────────────────────────────────

    /// <summary>Freshness of every connector-backed dataset in the tenant.</summary>
    Task<IReadOnlyList<DatasetRefreshStatusDto>> GetDatasetStatusesAsync(long tenantId, CancellationToken ct = default);

    /// <summary>Validates a cron expression and previews its next fire times.</summary>
    CronPreviewResponse PreviewCron(string cronExpression, string timeZoneId, int count = 5);
}

/// <summary>
/// Executes a single refresh. Separated from <see cref="IRefreshService"/> because the
/// background worker resolves it directly, without any user or tenant context from a request.
/// </summary>
public interface IRefreshExecutor
{
    /// <summary>
    /// Runs the job to completion, updating the job row and the dataset's refresh markers.
    /// Never throws for an expected failure — the failure is recorded on the job instead,
    /// because a scheduled run has no caller to surface an exception to.
    /// </summary>
    Task ExecuteAsync(long jobId, CancellationToken ct = default);
}

/// <summary>Cron parsing and next-fire-time calculation, in a named time zone.</summary>
public interface ICronEvaluator
{
    /// <summary>Next fire time in UTC after <paramref name="fromUtc"/>, or null if the expression never fires again.</summary>
    DateTime? GetNextOccurrence(string cronExpression, string timeZoneId, DateTime fromUtc);

    /// <summary>Returns null when valid, otherwise a message fit to show a user.</summary>
    string? Validate(string cronExpression, string timeZoneId);

    IReadOnlyList<DateTime> GetNextOccurrences(string cronExpression, string timeZoneId, DateTime fromUtc, int count);
}
