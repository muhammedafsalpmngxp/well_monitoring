namespace TWise.Tenant.Domain.DTOs;

// ── Schedules ───────────────────────────────────────────────────────────────

/// <summary>A recurring refresh, as shown on the Data Sync "Recurring" tab.</summary>
public record RefreshScheduleDto(
    long Id,
    string ScheduleName,
    long DataSourceConnectionId,
    string? DataSourceName,
    long ImportedDatasetId,
    string? DatasetName,
    string? ObjectRef,
    string CronExpression,
    string TimeZoneId,
    string? FrequencyLabel,
    string RefreshMode,
    string? IncrementalColumn,
    bool IsEnabled,
    DateTime? LastRunAt,
    DateTime? NextRunAt,
    string? LastStatus,
    DateTime CreatedAt
);

public record CreateRefreshScheduleRequest(
    string ScheduleName,
    long DataSourceConnectionId,
    long ImportedDatasetId,
    string CronExpression,
    string? ObjectRef = null,
    string TimeZoneId = "UTC",
    string? FrequencyLabel = null,
    string RefreshMode = "full",
    string? IncrementalColumn = null,
    bool IsEnabled = true
);

public record UpdateRefreshScheduleRequest(
    string ScheduleName,
    string CronExpression,
    string? ObjectRef,
    string TimeZoneId,
    string? FrequencyLabel,
    string RefreshMode,
    string? IncrementalColumn,
    bool IsEnabled
);

// ── Jobs (refresh history) ──────────────────────────────────────────────────

/// <summary>One execution, as shown on the Data Sync "Jobs" tab.</summary>
public record RefreshJobDto(
    long Id,
    string JobCode,
    long? ScheduleId,
    string JobProcess,
    string Status,
    string TriggeredBy,
    string RefreshMode,
    DateTime QueuedAt,
    DateTime? StartedAt,
    DateTime? CompletedAt,
    int? DurationMs,
    int? RowCount,
    string? ErrorMessage
);

/// <summary>Body for a manual refresh that is not tied to a schedule.</summary>
public record RunRefreshRequest(
    long DataSourceConnectionId,
    long ImportedDatasetId,
    string? ObjectRef = null,
    string RefreshMode = "full",
    string? IncrementalColumn = null
);

/// <summary>Freshness of a dataset — powers the "last refreshed" indicator.</summary>
public record DatasetRefreshStatusDto(
    long DatasetId,
    string DatasetName,
    int RowCount,
    // Null for an uploaded file, which has no source to refresh from.
    long? DataSourceConnectionId,
    string? SourceObjectRef,
    DateTime? LastRefreshedAt,
    string? LastRefreshStatus,
    string? LastRefreshJobCode,
    // True when the most recent attempt failed, so the data shown is stale.
    bool IsStale,
    long? ScheduleId,
    DateTime? NextRunAt
);

/// <summary>Validation result for a cron expression, used by the schedule form.</summary>
public record CronPreviewResponse(
    bool IsValid,
    string? Error,
    IReadOnlyList<DateTime> NextRuns
);
