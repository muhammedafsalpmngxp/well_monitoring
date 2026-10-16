namespace TWise.Tenant.Domain.Entities;

/// <summary>
/// One execution of a refresh — scheduled, manual or a retry. This is the refresh history:
/// rows are never updated after completion, so a failed run stays visible with its error.
///
/// Maps to [core].[RefreshJobs].
/// </summary>
public class RefreshJob
{
    public long Id { get; set; }

    /// <summary>Short human-facing code shown in the grid, e.g. "JB-1088".</summary>
    public string JobCode { get; set; } = string.Empty;

    /// <summary>FK → core.RefreshSchedules.id. Null for a manual, unscheduled refresh.</summary>
    public long? ScheduleId { get; set; }

    public long DataSourceConnectionId { get; set; }
    public long ImportedDatasetId { get; set; }

    /// <summary>Label for the "Job / Process" column, captured at queue time.</summary>
    public string JobProcess { get; set; } = string.Empty;

    /// <summary>See <see cref="RefreshJobStatuses"/>.</summary>
    public string Status { get; set; } = RefreshJobStatuses.Queued;

    /// <summary>schedule | manual | retry — see <see cref="RefreshTriggers"/>.</summary>
    public string TriggeredBy { get; set; } = RefreshTriggers.Manual;

    public string RefreshMode { get; set; } = RefreshModes.Full;

    public DateTime QueuedAt { get; set; } = DateTime.UtcNow;
    public DateTime? StartedAt { get; set; }
    public DateTime? CompletedAt { get; set; }

    /// <summary>Wall-clock duration, set on completion so the grid needs no arithmetic.</summary>
    public int? DurationMs { get; set; }

    /// <summary>Rows written by this run.</summary>
    public int? RowCount { get; set; }

    /// <summary>Populated only when Status is 'failed'. Safe to show a user.</summary>
    public string? ErrorMessage { get; set; }

    /// <summary>User who triggered a manual run; null for scheduled runs.</summary>
    public long? TriggeredByUserId { get; set; }

    public long TenantId { get; set; }
    public bool IsDeleted { get; set; }
}

/// <summary>
/// Job lifecycle. These strings are the contract with the Data Sync grid's status renderer,
/// so they must stay in sync with SyncJobStatus in data-sync.component.ts.
/// </summary>
public static class RefreshJobStatuses
{
    public const string Queued = "queued";
    public const string Processing = "processing";
    public const string Succeeded = "succeeded";
    public const string Failed = "failed";

    public static readonly IReadOnlyList<string> All = [Queued, Processing, Succeeded, Failed];

    /// <summary>True once the job can no longer change state.</summary>
    public static bool IsTerminal(string status) =>
        status is Succeeded or Failed;
}

/// <summary>What caused a job to be created.</summary>
public static class RefreshTriggers
{
    public const string Schedule = "schedule";
    public const string Manual = "manual";
    public const string Retry = "retry";
}
