using Microsoft.Extensions.Configuration;

namespace TWise.Tenant.Application.Features.Ai;

/// <summary>Limits for Explain (chart and dashboard) and the AI deck, from the AiExplain section of appsettings.json.</summary>
public sealed record AiExplainOptions
{
    public const string Section = "AiExplain";

    /// <summary>Rows of one chart sent to the AI by Explain this chart.</summary>
    public int ChartRows { get; init; }
    /// <summary>Charts of a dashboard covered by Explain the dashboard and the AI deck.</summary>
    public int DashboardCharts { get; init; }
    /// <summary>Rows of each chart sent to the AI by Explain the dashboard and the AI deck.</summary>
    public int DashboardRowsPerChart { get; init; }
    /// <summary>How long a summary stays in memory in front of core.AiSummaries.</summary>
    public int SummaryMemoryMinutes { get; init; }
    /// <summary>A stored summary not shown for this many days is removed.</summary>
    public int SummaryUnusedDays { get; init; }
    /// <summary>Most headline numbers on the deck's Key figures slide.</summary>
    public int DeckKeyFigures { get; init; }

    public static AiExplainOptions From(IConfiguration configuration)
    {
        int Read(string name) => int.TryParse(configuration[$"{Section}:{name}"], out var v) && v > 0
            ? v
            : throw new InvalidOperationException($"{Section}:{name} must be set to a positive number in appsettings.json.");
        return new AiExplainOptions
        {
            ChartRows = Read(nameof(ChartRows)), DashboardCharts = Read(nameof(DashboardCharts)), DashboardRowsPerChart = Read(nameof(DashboardRowsPerChart)),
            SummaryMemoryMinutes = Read(nameof(SummaryMemoryMinutes)), SummaryUnusedDays = Read(nameof(SummaryUnusedDays)), DeckKeyFigures = Read(nameof(DeckKeyFigures)),
        };
    }
}
