namespace TWise.Tenant.Domain.Entities;

/// <summary>
/// Catalogue of available chart/tile widgets.
/// Users pick from this library when building dashboards.
/// </summary>
public class ChartLibrary : BaseEntity
{
    public int ChartId { get; set; }
    public string ChartName { get; set; } = string.Empty;
    public string WidgetType { get; set; } = string.Empty;  // KPI | Chart | Table | Gauge | Tile
    public string? ChartType { get; set; }                   // bar | line | donut | pie | area | scatter
    public int? CategoryId { get; set; }
    public string? Description { get; set; }
    public string? Query { get; set; }                       // SQL query template for this chart
    public string? DefaultConfiguration { get; set; }        // JSON — colors, axis, thresholds, etc.
    public bool PublishedYN { get; set; } = false;

    // Navigation
    public Category? Category { get; set; }
}
