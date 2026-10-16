using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.DataSources;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Infrastructure.Services;

/// <summary>
/// Performs one refresh: fetch through the connector, then replace or append the dataset's rows.
///
/// This is the same connector path the original manual import used, so a refresh cannot drift
/// from how the data was first ingested.
///
/// Failures are recorded on the job rather than thrown: a scheduled run has no caller to
/// surface an exception to, and an unhandled throw would kill the background worker loop.
/// </summary>
public sealed class RefreshExecutor(
    IRefreshRepository repo,
    IDataSourceConnectionRepository connectionRepo,
    IDataSourceConnectorFactory connectorFactory,
    IControlPlaneNotificationClient notifications,
    ILogger<RefreshExecutor> logger) : IRefreshExecutor
{
    /// <summary>Matches ImportedDatasetService.MaxRows and the DB check constraint.</summary>
    private const int MaxRows = 10_000;

    /// <summary>Error text is stored in an nvarchar(2000) column.</summary>
    private const int MaxErrorLength = 2000;

    public async Task ExecuteAsync(long jobId, CancellationToken ct = default)
    {
        // Loaded without a tenant filter: the worker has no user context, and the job row
        // already carries the tenant it belongs to.
        var job = await repo.GetJobForExecutionAsync(jobId, ct);
        if (job is null)
        {
            logger.LogWarning("Refresh job {JobId} no longer exists; nothing to execute.", jobId);
            return;
        }

        if (RefreshJobStatuses.IsTerminal(job.Status))
        {
            logger.LogInformation("Refresh job {JobCode} is already {Status}; skipping.", job.JobCode, job.Status);
            return;
        }

        var stopwatch = Stopwatch.StartNew();

        job.Status = RefreshJobStatuses.Processing;
        job.StartedAt = DateTime.UtcNow;
        await repo.UpdateJobAsync(job, ct);

        logger.LogInformation(
            "Refresh started. JobCode={JobCode}, DatasetId={DatasetId}, Mode={Mode}, TriggeredBy={TriggeredBy}",
            job.JobCode, job.ImportedDatasetId, job.RefreshMode, job.TriggeredBy);

        try
        {
            var rowsWritten = await RunAsync(job, ct);

            stopwatch.Stop();
            job.Status = RefreshJobStatuses.Succeeded;
            job.RowCount = rowsWritten;
            job.CompletedAt = DateTime.UtcNow;
            job.DurationMs = (int)stopwatch.ElapsedMilliseconds;
            await repo.UpdateJobAsync(job, ct);

            await UpdateScheduleOutcomeAsync(job, RefreshJobStatuses.Succeeded, ct);

            logger.LogInformation(
                "Refresh succeeded. JobCode={JobCode}, Rows={Rows}, DurationMs={DurationMs}",
                job.JobCode, rowsWritten, job.DurationMs);
        }
        catch (Exception ex)
        {
            stopwatch.Stop();
            var message = Truncate(ex.Message, MaxErrorLength);

            job.Status = RefreshJobStatuses.Failed;
            job.ErrorMessage = message;
            job.CompletedAt = DateTime.UtcNow;
            job.DurationMs = (int)stopwatch.ElapsedMilliseconds;
            await repo.UpdateJobAsync(job, ct);

            await repo.MarkDatasetRefreshFailedAsync(job.ImportedDatasetId, job.JobCode, ct);
            await UpdateScheduleOutcomeAsync(job, RefreshJobStatuses.Failed, ct);
            await RaiseFailureAlertAsync(job, message, ct);

            logger.LogError(ex,
                "Refresh failed. JobCode={JobCode}, DatasetId={DatasetId}",
                job.JobCode, job.ImportedDatasetId);
        }
    }

    private async Task<int> RunAsync(RefreshJob job, CancellationToken ct)
    {
        var connection = await connectionRepo.GetByIdAsync(job.DataSourceConnectionId, job.TenantId, ct)
            ?? throw new InvalidOperationException(
                $"Data source {job.DataSourceConnectionId} no longer exists or was deleted.");

        if (!connection.IsActive)
            throw new InvalidOperationException($"Data source '{connection.ConnectionName}' is disabled.");

        var schedule = job.ScheduleId is null
            ? null
            : await repo.GetScheduleAsync(job.ScheduleId.Value, job.TenantId, ct);

        var objectRef = schedule?.ObjectRef;

        var connector = connectorFactory.Get(connection);
        var parsed = await connector.FetchAsync(connection, objectRef, ct);

        var columnsJson = JsonSerializer.Serialize(parsed.Columns);

        var isIncremental = string.Equals(job.RefreshMode, RefreshModes.Incremental, StringComparison.OrdinalIgnoreCase);

        if (!isIncremental)
        {
            if (parsed.Rows.Count > MaxRows)
                throw new InvalidOperationException(
                    $"The source returned {parsed.Rows.Count} rows, which exceeds the {MaxRows}-row limit.");

            var allRows = parsed.Rows.Select(r => JsonSerializer.Serialize(r)).ToList();
            await repo.ReplaceDatasetRowsAsync(
                job.ImportedDatasetId, columnsJson, allRows, job.JobCode, RefreshJobStatuses.Succeeded, ct);

            return allRows.Count;
        }

        // ── Incremental ──────────────────────────────────────────────────────
        // Connectors cannot filter at source (a sheet or a REST page returns everything),
        // so "incremental" means: fetch all, keep only what is past the watermark, append that.
        // It saves storage and keeps history, but not bandwidth.
        var column = schedule?.IncrementalColumn
            ?? throw new InvalidOperationException(
                "An incremental refresh needs an incremental column configured on its schedule.");

        var watermark = schedule.LastWatermark;
        var newRows = parsed.Rows
            .Where(row => IsPastWatermark(row, column, watermark))
            .ToList();

        if (newRows.Count > MaxRows)
            throw new InvalidOperationException(
                $"The source returned {newRows.Count} new rows, which exceeds the {MaxRows}-row limit.");

        if (newRows.Count > 0)
        {
            var rowJson = newRows.Select(r => JsonSerializer.Serialize(r)).ToList();
            await repo.AppendDatasetRowsAsync(
                job.ImportedDatasetId, columnsJson, rowJson, job.JobCode, RefreshJobStatuses.Succeeded, ct);

            schedule.LastWatermark = HighestValue(newRows, column) ?? watermark;
            schedule.ModifiedAt = DateTime.UtcNow;
            await repo.UpdateScheduleAsync(schedule, ct);
        }
        else
        {
            // Nothing new is a successful refresh, not a no-op: the dataset's freshness
            // markers must still advance or it looks stale.
            await repo.AppendDatasetRowsAsync(
                job.ImportedDatasetId, columnsJson, [], job.JobCode, RefreshJobStatuses.Succeeded, ct);
        }

        return newRows.Count;
    }

    /// <summary>
    /// Compares as a number, then a date, then ordinal text — so numeric ids and timestamps
    /// both order correctly instead of being compared as strings ("10" &lt; "9").
    /// </summary>
    private static bool IsPastWatermark(IReadOnlyDictionary<string, object?> row, string column, string? watermark)
    {
        if (string.IsNullOrEmpty(watermark)) return true;
        if (!row.TryGetValue(column, out var raw) || raw is null) return false;

        var value = Convert.ToString(raw, CultureInfo.InvariantCulture);
        if (string.IsNullOrEmpty(value)) return false;

        if (double.TryParse(value, NumberStyles.Any, CultureInfo.InvariantCulture, out var numeric)
            && double.TryParse(watermark, NumberStyles.Any, CultureInfo.InvariantCulture, out var numericMark))
            return numeric > numericMark;

        if (DateTime.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.None, out var date)
            && DateTime.TryParse(watermark, CultureInfo.InvariantCulture, DateTimeStyles.None, out var dateMark))
            return date > dateMark;

        return string.CompareOrdinal(value, watermark) > 0;
    }

    private static string? HighestValue(IReadOnlyList<Dictionary<string, object?>> rows, string column)
    {
        string? highest = null;

        foreach (var row in rows)
        {
            if (!row.TryGetValue(column, out var raw) || raw is null) continue;

            var value = Convert.ToString(raw, CultureInfo.InvariantCulture);
            if (string.IsNullOrEmpty(value)) continue;

            if (highest is null || IsPastWatermark(row, column, highest)) highest = value;
        }

        return highest;
    }

    private async Task UpdateScheduleOutcomeAsync(RefreshJob job, string status, CancellationToken ct)
    {
        if (job.ScheduleId is null) return;

        var schedule = await repo.GetScheduleAsync(job.ScheduleId.Value, job.TenantId, ct);
        if (schedule is null) return;

        schedule.LastRunAt = DateTime.UtcNow;
        schedule.LastStatus = status;
        schedule.ModifiedAt = DateTime.UtcNow;
        await repo.UpdateScheduleAsync(schedule, ct);
    }

    /// <summary>
    /// Notifies the Control Plane so a failed refresh surfaces in the notification centre
    /// rather than only in a log nobody is watching. Alerting must never fail the job itself.
    /// </summary>
    private async Task RaiseFailureAlertAsync(RefreshJob job, string message, CancellationToken ct)
    {
        try
        {
            // Broadcast to everyone who can see Data Sync, rather than to named recipients:
            // a scheduled failure has no single owner to notify.
            await notifications.PublishAsync(
                tenantId: job.TenantId,
                type: "refresh_failed",
                title: $"Refresh failed: {job.JobProcess}",
                description: $"Job {job.JobCode} failed. {message}",
                route: "/settings/data-sync",
                recipientUserIds: [],
                moduleCode: "settings.data-sync",
                ct);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex,
                "Could not raise a failure alert for job {JobCode}; the job outcome itself was recorded.",
                job.JobCode);
        }
    }

    private static string Truncate(string value, int maxLength)
        => value.Length <= maxLength ? value : value[..maxLength];
}
