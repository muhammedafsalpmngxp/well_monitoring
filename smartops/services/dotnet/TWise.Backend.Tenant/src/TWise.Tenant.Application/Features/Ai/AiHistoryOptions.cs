using Microsoft.Extensions.Configuration;

namespace TWise.Tenant.Application.Features.Ai;

/// <summary>What a saved chat keeps of each answer, from the AiHistory section of appsettings.json.</summary>
public sealed record AiHistoryOptions
{
    public const string Section = "AiHistory";

    /// <summary>Result rows stored with an answer, so a reopened chat shows its table and chart again.</summary>
    public int SavedRows { get; init; }

    public static AiHistoryOptions From(IConfiguration configuration) =>
        new() { SavedRows = RequiredSettings.Int(configuration, Section, nameof(SavedRows)) };
}
