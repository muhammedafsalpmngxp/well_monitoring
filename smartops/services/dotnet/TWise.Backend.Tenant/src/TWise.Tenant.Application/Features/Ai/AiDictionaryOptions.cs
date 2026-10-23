using Microsoft.Extensions.Configuration;

namespace TWise.Tenant.Application.Features.Ai;

/// <summary>Limits for drafting the data dictionary with AI, from the AiDictionary section of appsettings.json.</summary>
public sealed record AiDictionaryOptions
{
    public const string Section = "AiDictionary";

    /// <summary>Rows the dataset already holds that are read for example values (an import's rows, a view's last preview).</summary>
    public int SampleRows { get; init; }
    /// <summary>Distinct example values per column sent to the AI.</summary>
    public int SampleValues { get; init; }
    /// <summary>Longest example value sent (longer ones are cut).</summary>
    public int SampleValueLength { get; init; }
    /// <summary>Most columns drafted in one request; the rest keep their current documentation.</summary>
    public int MaxColumns { get; init; }

    public static AiDictionaryOptions From(IConfiguration configuration)
    {
        int Read(string name) => RequiredSettings.Int(configuration, Section, name);
        return new AiDictionaryOptions
        {
            SampleRows = Read(nameof(SampleRows)), SampleValues = Read(nameof(SampleValues)),
            SampleValueLength = Read(nameof(SampleValueLength)), MaxColumns = Read(nameof(MaxColumns)),
        };
    }
}
