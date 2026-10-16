namespace TWise.Tenant.Domain.Entities;

/// <summary>
/// An immutable snapshot of a report taken at publish time.
///
/// Reports publish by overwriting the live row in place, so without this table the previous
/// definition is lost the moment a new one is published — there is nothing to roll back to.
/// Each publish appends a row here; restoring replays one of them onto the live report and
/// appends another snapshot, so the history is never rewritten.
///
/// Maps to [core].[ReportVersions].
/// </summary>
public class ReportVersion
{
    public long Id { get; set; }

    /// <summary>FK → core.Reports.id — the live report this snapshot belongs to.</summary>
    public long ReportId { get; set; }

    /// <summary>0, 1, 2… assigned per report, in publish order.</summary>
    public int VersionNo { get; set; }

    // ── Snapshot of the report definition ────────────────────────────────────
    public string ReportName { get; set; } = string.Empty;
    public string? Description { get; set; }
    public int CategoryId { get; set; }
    public string SourceName { get; set; } = string.Empty;
    public string SourceType { get; set; } = string.Empty;
    public string? ReportJson { get; set; }

    /// <summary>Why this snapshot exists — see <see cref="ReportVersionReasons"/>.</summary>
    public string Reason { get; set; } = ReportVersionReasons.Publish;

    /// <summary>Set when this snapshot was produced by restoring an earlier version.</summary>
    public int? RestoredFromVersionNo { get; set; }

    public long PublishedBy { get; set; }
    public DateTime PublishedAt { get; set; } = DateTime.UtcNow;
    public long TenantId { get; set; }
}

/// <summary>Values for <see cref="ReportVersion.Reason"/>.</summary>
public static class ReportVersionReasons
{
    /// <summary>A normal publish.</summary>
    public const string Publish = "publish";

    /// <summary>A publish created by restoring an earlier version.</summary>
    public const string Restore = "restore";
}
