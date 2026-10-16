namespace TWise.Tenant.Domain.Entities;

/// <summary>
/// A named, trusted measure for a dataset: "Net revenue" = sum(Revenue). Injected into the ask prompt
/// so a question that names the metric always maps to the same aggregation. Maps to core.AiMetrics.
/// </summary>
public class AiMetric
{
    public long Id { get; set; }
    public long TenantId { get; set; }
    public string SourceType { get; set; } = "";
    public long SourceId { get; set; }
    public string Name { get; set; } = "";
    /// <summary>count | countDistinct | sum | avg | min | max (same set as AiMeasure).</summary>
    public string Agg { get; set; } = "sum";
    /// <summary>Null only for count.</summary>
    public string? ColumnName { get; set; }
    public string? Description { get; set; }
    public string? ModifiedBy { get; set; }
    public DateTime ModifiedAt { get; set; } = DateTime.UtcNow;
}
