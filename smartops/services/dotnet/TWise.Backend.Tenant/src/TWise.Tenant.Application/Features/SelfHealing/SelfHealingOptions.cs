using Microsoft.Extensions.Configuration;
using TWise.Tenant.Application.Features.Ai;

namespace TWise.Tenant.Application.Features.SelfHealing;

/// <summary>The view run log and the Self-Healing scan, from the SelfHealing section of appsettings.json (no defaults in code).</summary>
public sealed record SelfHealingOptions
{
    public const string Section = "SelfHealing";

    /// <summary>false: chart and view loads are not recorded (the page still lists failed data loads).</summary>
    public bool RecordRuns { get; init; }
    /// <summary>Runs waiting to be written; when full, new runs are dropped (loads are never slowed down).</summary>
    public int QueueCapacity { get; init; }
    /// <summary>Most runs written in one insert.</summary>
    public int BatchSize { get; init; }
    /// <summary>Seconds between writes.</summary>
    public int FlushSeconds { get; init; }
    /// <summary>Runs older than this are removed.</summary>
    public int RetentionDays { get; init; }
    /// <summary>Hours between removals of old runs.</summary>
    public int CleanupHours { get; init; }
    /// <summary>A load that takes at least this long counts as slow.</summary>
    public int SlowMs { get; init; }
    /// <summary>The periods the page offers, in days; the first is the default.</summary>
    public int[] Days { get; init; } = [];
    /// <summary>Most failing views and slow views listed.</summary>
    public int TopViews { get; init; }
    /// <summary>Most failed or slow runs in the run log.</summary>
    public int LogRows { get; init; }
    /// <summary>A refreshable import not refreshed for this many days is stale.</summary>
    public int StaleDays { get; init; }

    public static SelfHealingOptions From(IConfiguration c)
    {
        int Read(string name) => RequiredSettings.Int(c, Section, name);
        return new SelfHealingOptions
        {
            RecordRuns = RequiredSettings.Flag(c, Section, nameof(RecordRuns)),
            QueueCapacity = Read(nameof(QueueCapacity)), BatchSize = Read(nameof(BatchSize)), FlushSeconds = Read(nameof(FlushSeconds)),
            RetentionDays = Read(nameof(RetentionDays)), CleanupHours = Read(nameof(CleanupHours)), SlowMs = Read(nameof(SlowMs)),
            Days = RequiredSettings.Ints(c, Section, nameof(Days)),
            TopViews = Read(nameof(TopViews)), LogRows = Read(nameof(LogRows)), StaleDays = Read(nameof(StaleDays)),
        };
    }
}
