namespace TWise.Tenant.Domain.Entities;

/// <summary>
/// One load of a chart source or a saved view: how long it took, how many rows came back, or why it failed. The
/// Self-Healing page reads these to find failing and slow views. Maps to core.ViewRunLog; rows older than
/// SelfHealing:RetentionDays are removed.
/// </summary>
public class ViewRun
{
    public long Id { get; set; }
    /// <summary>The saved view, when the source is one.</summary>
    public long? ViewId { get; set; }
    public string SourceName { get; set; } = "";
    /// <summary>View | Table | the chart's source type.</summary>
    public string SourceType { get; set; } = "";
    /// <summary>chart | preview (<see cref="ViewRunCallers"/>).</summary>
    public string Caller { get; set; } = "";
    public int DurationMs { get; set; }
    public int? RowCount { get; set; }
    /// <summary>Null when the load succeeded.</summary>
    public string? Error { get; set; }
    /// <summary>The SQL sent to the database (parameter names, not their values); kept only for failed and slow runs.</summary>
    public string? Sql { get; set; }
    public long? UserId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public static class ViewRunCallers
{
    /// <summary>Charts, tiles, dashboards and Ask AI (ISourceService.GetFilteredChartDataAsync).</summary>
    public const string Chart = "chart";
    /// <summary>A saved view's preview or report run (IDatabaseViewService.PreviewAsync).</summary>
    public const string Preview = "preview";
    /// <summary>A Model Studio data model query (charts and canvas objects built on a data model).</summary>
    public const string Dataset = "dataset";
    /// <summary>Ask AI answering over every row of a view in its database.</summary>
    public const string Ai = "ai";
}
