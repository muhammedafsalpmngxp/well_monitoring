using Microsoft.Extensions.Configuration;

namespace TWise.Tenant.Application.Features.Ai;

/// <summary>The defaults the provider dialog fills in for one kind of provider.</summary>
public sealed record AiProviderDefault(string Label, string BaseUrl, string Model, bool NeedsKey);

/// <summary>AI administration (providers, quota, usage, AI Activity), from the AiAdmin section of appsettings.json.</summary>
public sealed record AiAdminOptions
{
    public const string Section = "AiAdmin";

    /// <summary>Role codes that may use the AI admin screens and endpoints; their users also get the quota warning.</summary>
    public string[] AdminRoles { get; init; } = [];
    /// <summary>Daily call limit a new provider starts with (0 would mean unlimited).</summary>
    public int DefaultDailyQuota { get; init; }
    /// <summary>Share of the daily limit at which the AI admins are warned (once a day).</summary>
    public int QuotaWarnPercent { get; init; }
    /// <summary>Days of usage shown on AI Providers.</summary>
    public int UsageDays { get; init; }
    /// <summary>Days AI Activity shows when no dates are chosen.</summary>
    public int ActivityDays { get; init; }
    /// <summary>Longest period (days) usage and AI Activity may cover.</summary>
    public int MaxDays { get; init; }
    /// <summary>The quick periods offered on AI Activity (days).</summary>
    public int[] DayOptions { get; init; } = [];
    /// <summary>Rows per page on AI Activity, and the most a caller may ask for.</summary>
    public int PageSize { get; init; }
    public int MaxPageSize { get; init; }
    /// <summary>Characters of an answer shown in the AI Activity list.</summary>
    public int AnswerPreviewLength { get; init; }
    /// <summary>Days an answer's steps (trace) are kept.</summary>
    public int TraceRetentionDays { get; init; }
    /// <summary>Time allowed for one call to the AI provider.</summary>
    public int ChatTimeoutSeconds { get; init; }
    /// <summary>Dialog defaults per provider kind (every kind the server supports).</summary>
    public IReadOnlyDictionary<string, AiProviderDefault> Providers { get; init; } = new Dictionary<string, AiProviderDefault>();

    public static AiAdminOptions From(IConfiguration c, IReadOnlyList<string> providerKinds)
    {
        int Int(string name) => RequiredSettings.Int(c, Section, name);
        var o = new AiAdminOptions
        {
            AdminRoles = RequiredSettings.Texts(c, Section, nameof(AdminRoles)),
            DefaultDailyQuota = Int(nameof(DefaultDailyQuota)), QuotaWarnPercent = Int(nameof(QuotaWarnPercent)),
            UsageDays = Int(nameof(UsageDays)), ActivityDays = Int(nameof(ActivityDays)), MaxDays = Int(nameof(MaxDays)),
            DayOptions = RequiredSettings.Ints(c, Section, nameof(DayOptions)), PageSize = Int(nameof(PageSize)), MaxPageSize = Int(nameof(MaxPageSize)),
            AnswerPreviewLength = Int(nameof(AnswerPreviewLength)), TraceRetentionDays = Int(nameof(TraceRetentionDays)),
            ChatTimeoutSeconds = Int(nameof(ChatTimeoutSeconds)),
            Providers = providerKinds.ToDictionary(k => k, k =>
            {
                var at = $"{Section}:{nameof(Providers)}:{k}";
                return new AiProviderDefault(RequiredSettings.Text(c, at, nameof(AiProviderDefault.Label)),
                    RequiredSettings.Text(c, at, nameof(AiProviderDefault.BaseUrl)), c[$"{at}:{nameof(AiProviderDefault.Model)}"] ?? "",
                    RequiredSettings.Flag(c, at, nameof(AiProviderDefault.NeedsKey)));
            }),
        };
        if (o.QuotaWarnPercent >= 100) throw new InvalidOperationException($"{Section}:{nameof(QuotaWarnPercent)} must be below 100.");
        if (o.PageSize > o.MaxPageSize) throw new InvalidOperationException($"{Section}:{nameof(PageSize)} must not exceed {nameof(MaxPageSize)}.");
        if (o.UsageDays > o.MaxDays || o.ActivityDays > o.MaxDays || o.DayOptions.Any(d => d > o.MaxDays))
            throw new InvalidOperationException($"{Section}: {nameof(UsageDays)}, {nameof(ActivityDays)} and {nameof(DayOptions)} must not exceed {nameof(MaxDays)}.");
        return o;
    }
}
