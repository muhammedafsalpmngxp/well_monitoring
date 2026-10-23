namespace TWise.Tenant.Domain.DTOs;

/// <summary>The Self-Healing scan over the last <see cref="Days"/> days: run totals, failing and slow views, data loads
/// that failed or went stale, and the failed or slow runs themselves.</summary>
public sealed record SelfHealingOverviewDto(
    int Days,
    IReadOnlyList<int> DayOptions,
    int SlowMs,
    bool RecordingOn,
    SelfHealingKpisDto Kpis,
    IReadOnlyList<SelfHealingDayDto> Daily,
    IReadOnlyList<FailingViewDto> FailingViews,
    IReadOnlyList<SlowViewDto> SlowViews,
    IReadOnlyList<DataLoadIssueDto> DataLoads,
    IReadOnlyList<ViewRunDto> Log);

public sealed record SelfHealingKpisDto(int Runs, int Failures, int SlowRuns, int AvgMs, int MaxMs, int FailingViews, int DataLoadIssues);

public sealed record SelfHealingDayDto(DateTime Day, int Runs, int Failures, int AvgMs);

/// <summary>A source that failed at least once. StillFailing: its latest run failed too.</summary>
public sealed record FailingViewDto(long? ViewId, string SourceName, string SourceType, int Runs, int Failures,
    string? LastError, DateTime LastFailedAt, bool StillFailing);

public sealed record SlowViewDto(long? ViewId, string SourceName, string SourceType, int Runs, int AvgMs, int MaxMs);

/// <summary>Issue: failed (the import itself), refresh_failed (its last refresh) or stale (not refreshed for SelfHealing:StaleDays).</summary>
public sealed record DataLoadIssueDto(long ImportId, string Name, string Issue, string? Error, DateTime? At);

public sealed record ViewRunDto(long Id, long? ViewId, string SourceName, string SourceType, string Caller,
    int DurationMs, int? RowCount, string? Error, DateTime CreatedAt);
