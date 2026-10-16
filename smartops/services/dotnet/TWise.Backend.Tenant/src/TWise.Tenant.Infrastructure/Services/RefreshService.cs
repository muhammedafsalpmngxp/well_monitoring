using Microsoft.Extensions.Logging;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Infrastructure.Services;

/// <summary>
/// Request-facing half of refresh: schedule CRUD, manual runs, retries and the history the
/// Data Sync screen renders. Actual execution lives in <see cref="IRefreshExecutor"/>, which
/// the background worker also uses, so a manual run and a scheduled run take the same path.
/// </summary>
public sealed class RefreshService(
    IRefreshRepository repo,
    IDataSourceConnectionRepository connectionRepo,
    IImportedDatasetRepository datasetRepo,
    ICronEvaluator cron,
    IRefreshExecutor executor,
    ILogger<RefreshService> logger) : IRefreshService
{
    /// <summary>Cap on history returned to the grid, which pages client-side.</summary>
    private const int MaxJobHistory = 500;

    // ── Schedules ────────────────────────────────────────────────────────────

    public async Task<IReadOnlyList<RefreshScheduleDto>> GetSchedulesAsync(long tenantId, CancellationToken ct = default)
    {
        var schedules = await repo.GetSchedulesAsync(tenantId, ct);
        if (schedules.Count == 0) return [];

        // Names are resolved once here rather than per row, so the grid can show a readable
        // source/dataset without the client making N extra calls.
        var connections = await connectionRepo.GetAllAsync(tenantId, ct);
        var connectionNames = connections.ToDictionary(c => c.Id, c => c.ConnectionName);

        var results = new List<RefreshScheduleDto>(schedules.Count);
        foreach (var schedule in schedules)
        {
            var dataset = await datasetRepo.GetByIdAsync(schedule.ImportedDatasetId, tenantId, ct);
            results.Add(ToDto(schedule, connectionNames.GetValueOrDefault(schedule.DataSourceConnectionId), dataset?.DatasetName));
        }

        return results;
    }

    public async Task<RefreshScheduleDto?> GetScheduleAsync(long id, long tenantId, CancellationToken ct = default)
    {
        var schedule = await repo.GetScheduleAsync(id, tenantId, ct);
        if (schedule is null) return null;

        var connection = await connectionRepo.GetByIdAsync(schedule.DataSourceConnectionId, tenantId, ct);
        var dataset = await datasetRepo.GetByIdAsync(schedule.ImportedDatasetId, tenantId, ct);

        return ToDto(schedule, connection?.ConnectionName, dataset?.DatasetName);
    }

    public async Task<RefreshScheduleDto> CreateScheduleAsync(
        CreateRefreshScheduleRequest request, long userId, long tenantId, CancellationToken ct = default)
    {
        ValidateMode(request.RefreshMode, request.IncrementalColumn);

        var cronError = cron.Validate(request.CronExpression, request.TimeZoneId);
        if (cronError is not null) throw new InvalidOperationException(cronError);

        if (await repo.ScheduleNameExistsAsync(request.ScheduleName, tenantId, ct: ct))
            throw new InvalidOperationException($"A schedule named '{request.ScheduleName}' already exists.");

        await EnsureTargetsExistAsync(request.DataSourceConnectionId, request.ImportedDatasetId, tenantId, ct);

        var now = DateTime.UtcNow;
        var schedule = new RefreshSchedule
        {
            ScheduleName = request.ScheduleName.Trim(),
            DataSourceConnectionId = request.DataSourceConnectionId,
            ImportedDatasetId = request.ImportedDatasetId,
            ObjectRef = request.ObjectRef,
            CronExpression = request.CronExpression.Trim(),
            TimeZoneId = string.IsNullOrWhiteSpace(request.TimeZoneId) ? "UTC" : request.TimeZoneId.Trim(),
            FrequencyLabel = request.FrequencyLabel,
            RefreshMode = request.RefreshMode.ToLowerInvariant(),
            IncrementalColumn = request.IncrementalColumn,
            IsEnabled = request.IsEnabled,
            // A disabled schedule has no next run; computing one would make it fire the moment
            // it is enabled, regardless of its cron.
            NextRunAt = request.IsEnabled
                ? cron.GetNextOccurrence(request.CronExpression, request.TimeZoneId, now)
                : null,
            TenantId = tenantId,
            CreatedBy = userId,
            CreatedAt = now,
            ModifiedAt = now
        };

        var saved = await repo.AddScheduleAsync(schedule, ct);

        logger.LogInformation(
            "Refresh schedule created. ScheduleId={ScheduleId}, Name='{Name}', Cron='{Cron}' {TimeZone}, NextRunAt={NextRunAt}",
            saved.Id, saved.ScheduleName, saved.CronExpression, saved.TimeZoneId, saved.NextRunAt);

        return await GetScheduleAsync(saved.Id, tenantId, ct) ?? ToDto(saved, null, null);
    }

    public async Task<RefreshScheduleDto?> UpdateScheduleAsync(
        long id, UpdateRefreshScheduleRequest request, long userId, long tenantId, CancellationToken ct = default)
    {
        var schedule = await repo.GetScheduleAsync(id, tenantId, ct);
        if (schedule is null) return null;

        ValidateMode(request.RefreshMode, request.IncrementalColumn);

        var cronError = cron.Validate(request.CronExpression, request.TimeZoneId);
        if (cronError is not null) throw new InvalidOperationException(cronError);

        if (await repo.ScheduleNameExistsAsync(request.ScheduleName, tenantId, id, ct))
            throw new InvalidOperationException($"A schedule named '{request.ScheduleName}' already exists.");

        var now = DateTime.UtcNow;

        schedule.ScheduleName = request.ScheduleName.Trim();
        schedule.CronExpression = request.CronExpression.Trim();
        schedule.TimeZoneId = string.IsNullOrWhiteSpace(request.TimeZoneId) ? "UTC" : request.TimeZoneId.Trim();
        schedule.FrequencyLabel = request.FrequencyLabel;
        schedule.ObjectRef = request.ObjectRef;
        schedule.RefreshMode = request.RefreshMode.ToLowerInvariant();
        schedule.IncrementalColumn = request.IncrementalColumn;
        schedule.IsEnabled = request.IsEnabled;
        // Recomputed on every save: the cron, time zone or enabled flag may all have changed.
        schedule.NextRunAt = request.IsEnabled
            ? cron.GetNextOccurrence(schedule.CronExpression, schedule.TimeZoneId, now)
            : null;
        schedule.ModifiedBy = userId;
        schedule.ModifiedAt = now;

        await repo.UpdateScheduleAsync(schedule, ct);

        logger.LogInformation(
            "Refresh schedule updated. ScheduleId={ScheduleId}, Enabled={Enabled}, NextRunAt={NextRunAt}",
            schedule.Id, schedule.IsEnabled, schedule.NextRunAt);

        return await GetScheduleAsync(id, tenantId, ct);
    }

    public Task<bool> DeleteScheduleAsync(long id, long tenantId, CancellationToken ct = default)
        => repo.SoftDeleteScheduleAsync(id, tenantId, ct);

    // ── Jobs ─────────────────────────────────────────────────────────────────

    public async Task<IReadOnlyList<RefreshJobDto>> GetJobsAsync(long tenantId, int limit, CancellationToken ct = default)
    {
        var effectiveLimit = limit is > 0 and <= MaxJobHistory ? limit : MaxJobHistory;
        var jobs = await repo.GetJobsAsync(tenantId, effectiveLimit, ct);
        return jobs.Select(ToDto).ToList();
    }

    public async Task<RefreshJobDto?> RunScheduleNowAsync(long scheduleId, long userId, long tenantId, CancellationToken ct = default)
    {
        var schedule = await repo.GetScheduleAsync(scheduleId, tenantId, ct);
        if (schedule is null) return null;

        // NextRunAt is deliberately untouched: running now is an extra run, not a reschedule.
        var job = await QueueAsync(new RefreshJob
        {
            ScheduleId = schedule.Id,
            DataSourceConnectionId = schedule.DataSourceConnectionId,
            ImportedDatasetId = schedule.ImportedDatasetId,
            JobProcess = schedule.ScheduleName,
            TriggeredBy = RefreshTriggers.Manual,
            RefreshMode = schedule.RefreshMode,
            TriggeredByUserId = userId,
            TenantId = tenantId
        }, ct);

        await executor.ExecuteAsync(job.Id, ct);
        return await ReloadJobAsync(job.Id, tenantId, ct);
    }

    public async Task<RefreshJobDto> RunManualAsync(
        RunRefreshRequest request, long userId, long tenantId, CancellationToken ct = default)
    {
        ValidateMode(request.RefreshMode, request.IncrementalColumn);
        await EnsureTargetsExistAsync(request.DataSourceConnectionId, request.ImportedDatasetId, tenantId, ct);

        var connection = await connectionRepo.GetByIdAsync(request.DataSourceConnectionId, tenantId, ct);

        var job = await QueueAsync(new RefreshJob
        {
            ScheduleId = null,
            DataSourceConnectionId = request.DataSourceConnectionId,
            ImportedDatasetId = request.ImportedDatasetId,
            JobProcess = connection?.ConnectionName ?? "Manual refresh",
            TriggeredBy = RefreshTriggers.Manual,
            RefreshMode = request.RefreshMode.ToLowerInvariant(),
            TriggeredByUserId = userId,
            TenantId = tenantId
        }, ct);

        await executor.ExecuteAsync(job.Id, ct);
        return await ReloadJobAsync(job.Id, tenantId, ct)
            ?? throw new InvalidOperationException("The refresh job could not be read back after running.");
    }

    public async Task<RefreshJobDto?> RetryJobAsync(long jobId, long userId, long tenantId, CancellationToken ct = default)
    {
        var original = await repo.GetJobAsync(jobId, tenantId, ct);
        if (original is null) return null;

        // A retry is a NEW job, not a mutation of the old one — the failed attempt must stay
        // in the history with its error.
        var job = await QueueAsync(new RefreshJob
        {
            ScheduleId = original.ScheduleId,
            DataSourceConnectionId = original.DataSourceConnectionId,
            ImportedDatasetId = original.ImportedDatasetId,
            JobProcess = original.JobProcess,
            TriggeredBy = RefreshTriggers.Retry,
            RefreshMode = original.RefreshMode,
            TriggeredByUserId = userId,
            TenantId = tenantId
        }, ct);

        await executor.ExecuteAsync(job.Id, ct);
        return await ReloadJobAsync(job.Id, tenantId, ct);
    }

    // ── Monitoring ───────────────────────────────────────────────────────────

    public async Task<IReadOnlyList<DatasetRefreshStatusDto>> GetDatasetStatusesAsync(long tenantId, CancellationToken ct = default)
    {
        var schedules = await repo.GetSchedulesAsync(tenantId, ct);
        var byDataset = schedules
            .GroupBy(s => s.ImportedDatasetId)
            .ToDictionary(g => g.Key, g => g.OrderBy(s => s.NextRunAt ?? DateTime.MaxValue).First());

        var datasets = await datasetRepo.GetAllForTenantAsync(tenantId, ct);

        return datasets.Select(d =>
        {
            byDataset.TryGetValue(d.Id, out var schedule);
            return new DatasetRefreshStatusDto(
                d.Id, d.DatasetName, d.RowCount,
                d.DataSourceConnectionId, d.SourceObjectRef,
                d.LastRefreshedAt, d.LastRefreshStatus, d.LastRefreshJobCode,
                // Stale means "the newest attempt failed", so what is displayed is older than
                // the source — the clear indication the requirement asks for.
                IsStale: string.Equals(d.LastRefreshStatus, RefreshJobStatuses.Failed, StringComparison.OrdinalIgnoreCase),
                schedule?.Id, schedule?.NextRunAt);
        }).ToList();
    }

    public CronPreviewResponse PreviewCron(string cronExpression, string timeZoneId, int count = 5)
    {
        var error = cron.Validate(cronExpression, timeZoneId);
        if (error is not null) return new CronPreviewResponse(false, error, []);

        var next = cron.GetNextOccurrences(cronExpression, timeZoneId, DateTime.UtcNow, count);
        return new CronPreviewResponse(true, null, next);
    }

    // ── Internals ────────────────────────────────────────────────────────────

    private async Task<RefreshJob> QueueAsync(RefreshJob job, CancellationToken ct)
    {
        job.JobCode = await repo.NextJobCodeAsync(ct);
        job.Status = RefreshJobStatuses.Queued;
        job.QueuedAt = DateTime.UtcNow;
        return await repo.AddJobAsync(job, ct);
    }

    private async Task<RefreshJobDto?> ReloadJobAsync(long jobId, long tenantId, CancellationToken ct)
    {
        var job = await repo.GetJobAsync(jobId, tenantId, ct);
        return job is null ? null : ToDto(job);
    }

    private async Task EnsureTargetsExistAsync(long connectionId, long datasetId, long tenantId, CancellationToken ct)
    {
        var connection = await connectionRepo.GetByIdAsync(connectionId, tenantId, ct)
            ?? throw new InvalidOperationException($"Data source {connectionId} was not found.");

        if (!connection.IsActive)
            throw new InvalidOperationException($"Data source '{connection.ConnectionName}' is disabled.");

        _ = await datasetRepo.GetByIdAsync(datasetId, tenantId, ct)
            ?? throw new InvalidOperationException($"Imported dataset {datasetId} was not found.");
    }

    private static void ValidateMode(string mode, string? incrementalColumn)
    {
        if (!RefreshModes.IsSupported(mode))
            throw new InvalidOperationException(
                $"Refresh mode must be one of: {string.Join(", ", RefreshModes.All)}.");

        if (string.Equals(mode, RefreshModes.Incremental, StringComparison.OrdinalIgnoreCase)
            && string.IsNullOrWhiteSpace(incrementalColumn))
            throw new InvalidOperationException(
                "An incremental refresh needs an incremental column — the field that increases as new rows arrive.");
    }

    private static RefreshScheduleDto ToDto(RefreshSchedule s, string? connectionName, string? datasetName) => new(
        s.Id, s.ScheduleName, s.DataSourceConnectionId, connectionName,
        s.ImportedDatasetId, datasetName, s.ObjectRef,
        s.CronExpression, s.TimeZoneId, s.FrequencyLabel,
        s.RefreshMode, s.IncrementalColumn, s.IsEnabled,
        s.LastRunAt, s.NextRunAt, s.LastStatus, s.CreatedAt);

    private static RefreshJobDto ToDto(RefreshJob j) => new(
        j.Id, j.JobCode, j.ScheduleId, j.JobProcess, j.Status, j.TriggeredBy, j.RefreshMode,
        j.QueuedAt, j.StartedAt, j.CompletedAt, j.DurationMs, j.RowCount, j.ErrorMessage);
}
