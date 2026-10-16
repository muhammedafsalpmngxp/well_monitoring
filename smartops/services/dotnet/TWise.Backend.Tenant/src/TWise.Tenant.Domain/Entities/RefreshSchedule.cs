namespace TWise.Tenant.Domain.Entities;

/// <summary>
/// A recurring refresh of a data source, expressed as a cron expression in a named time zone.
///
/// A schedule only ever re-runs an existing ingest: it fetches the source again through the
/// same connector used for the manual import and replaces (or appends to) the dataset those
/// rows live in. Nothing here understands the sources themselves.
///
/// Maps to [core].[RefreshSchedules].
/// </summary>
public class RefreshSchedule
{
    public long Id { get; set; }

    public string ScheduleName { get; set; } = string.Empty;

    /// <summary>FK → core.DataSourceConnections.id — the connector to fetch through.</summary>
    public long DataSourceConnectionId { get; set; }

    /// <summary>
    /// FK → core.ImportedDatasets.id — the dataset the refreshed rows land in.
    /// Refreshing updates this dataset in place so charts and tiles keep working without rewiring.
    /// </summary>
    public long ImportedDatasetId { get; set; }

    /// <summary>Connector object to fetch (sheet tab, Drive file id); null uses the source default.</summary>
    public string? ObjectRef { get; set; }

    /// <summary>Standard 5-field cron expression, evaluated in <see cref="TimeZoneId"/>.</summary>
    public string CronExpression { get; set; } = string.Empty;

    /// <summary>IANA or Windows time zone id. Defaults to UTC.</summary>
    public string TimeZoneId { get; set; } = "UTC";

    /// <summary>Human label shown in the grid ("Daily", "Every 5 minutes") — display only.</summary>
    public string? FrequencyLabel { get; set; }

    /// <summary>full | incremental — see <see cref="RefreshModes"/>.</summary>
    public string RefreshMode { get; set; } = RefreshModes.Full;

    /// <summary>
    /// Incremental mode only: the column holding a monotonically increasing value
    /// (a timestamp or id). Rows at or below <see cref="LastWatermark"/> are discarded.
    /// </summary>
    public string? IncrementalColumn { get; set; }

    /// <summary>Highest <see cref="IncrementalColumn"/> value seen so far, as text.</summary>
    public string? LastWatermark { get; set; }

    public bool IsEnabled { get; set; } = true;

    public DateTime? LastRunAt { get; set; }

    /// <summary>Next fire time in UTC. The worker claims schedules whose value is in the past.</summary>
    public DateTime? NextRunAt { get; set; }

    /// <summary>Outcome of the most recent run — see <see cref="RefreshJobStatuses"/>.</summary>
    public string? LastStatus { get; set; }

    public long TenantId { get; set; }
    public long CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public long? ModifiedBy { get; set; }
    public DateTime ModifiedAt { get; set; } = DateTime.UtcNow;
    public bool IsDeleted { get; set; }
}

/// <summary>How much data a refresh pulls.</summary>
public static class RefreshModes
{
    /// <summary>Re-fetch everything and replace the dataset's rows.</summary>
    public const string Full = "full";

    /// <summary>Fetch everything, keep only rows past the watermark, and append them.</summary>
    public const string Incremental = "incremental";

    public static readonly IReadOnlyList<string> All = [Full, Incremental];

    public static bool IsSupported(string? mode) =>
        mode is not null && All.Contains(mode, StringComparer.OrdinalIgnoreCase);
}
