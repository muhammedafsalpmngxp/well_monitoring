using Microsoft.Extensions.Configuration;

namespace TWise.Tenant.Application.Features.Ai;

/// <summary>Alerts on answers, from the AiAlerts section of appsettings.json.</summary>
public sealed record AiAlertOptions
{
    public const string Section = "AiAlerts";

    /// <summary>Whether the background worker checks due alerts.</summary>
    public bool Enabled { get; init; }
    /// <summary>How often the worker looks for due alerts.</summary>
    public int PollSeconds { get; init; }
    /// <summary>Due alerts checked per poll.</summary>
    public int BatchSize { get; init; }
    /// <summary>Most e-mail addresses on one alert.</summary>
    public int MaxEmails { get; init; }
    /// <summary>The check intervals a user may choose, in hours.</summary>
    public int[] EveryHours { get; init; } = [];
    /// <summary>The interval a new alert starts with (one of EveryHours).</summary>
    public int DefaultEveryHours { get; init; }
    /// <summary>Past values kept per alert ("unusual" and "change" compare with them).</summary>
    public int MaxHistory { get; init; }
    /// <summary>Checks a single number needs before "unusual" can fire (also the least groups for a grouped answer).</summary>
    public int MinHistory { get; init; }
    /// <summary>Groups named in a fired alert's message.</summary>
    public int MaxListed { get; init; }
    /// <summary>Past values the AI sees when it words the notice.</summary>
    public int NoticeHistory { get; init; }
    /// <summary>Robust z-score (median and MAD) above which a value is unusual.</summary>
    public double UnusualScore { get; init; }

    public static AiAlertOptions From(IConfiguration c)
    {
        var o = new AiAlertOptions
        {
            Enabled = RequiredSettings.Flag(c, Section, nameof(Enabled)), PollSeconds = RequiredSettings.Int(c, Section, nameof(PollSeconds)),
            BatchSize = RequiredSettings.Int(c, Section, nameof(BatchSize)), MaxEmails = RequiredSettings.Int(c, Section, nameof(MaxEmails)),
            EveryHours = RequiredSettings.Ints(c, Section, nameof(EveryHours)), DefaultEveryHours = RequiredSettings.Int(c, Section, nameof(DefaultEveryHours)),
            MaxHistory = RequiredSettings.Int(c, Section, nameof(MaxHistory)), MinHistory = RequiredSettings.Int(c, Section, nameof(MinHistory)),
            MaxListed = RequiredSettings.Int(c, Section, nameof(MaxListed)), NoticeHistory = RequiredSettings.Int(c, Section, nameof(NoticeHistory)),
            UnusualScore = RequiredSettings.Number(c, Section, nameof(UnusualScore)),
        };
        return o.EveryHours.Contains(o.DefaultEveryHours) ? o
            : throw new InvalidOperationException($"{Section}:{nameof(DefaultEveryHours)} must be one of {Section}:{nameof(EveryHours)}.");
    }
}

/// <summary>SQL review (explain and optimise a view), from the AiSqlReview section of appsettings.json.</summary>
public sealed record AiSqlReviewOptions
{
    public const string Section = "AiSqlReview";

    /// <summary>Longest SQL the AI reviews.</summary>
    public int MaxSqlLength { get; init; }
    /// <summary>Scans, missing indexes and warnings listed from the plan (each).</summary>
    public int PlanMaxListed { get; init; }
    /// <summary>Time allowed to compile the estimated plan.</summary>
    public int PlanTimeoutSeconds { get; init; }

    public static AiSqlReviewOptions From(IConfiguration c) => new()
    {
        MaxSqlLength = RequiredSettings.Int(c, Section, nameof(MaxSqlLength)),
        PlanMaxListed = RequiredSettings.Int(c, Section, nameof(PlanMaxListed)),
        PlanTimeoutSeconds = RequiredSettings.Int(c, Section, nameof(PlanTimeoutSeconds)),
    };
}
