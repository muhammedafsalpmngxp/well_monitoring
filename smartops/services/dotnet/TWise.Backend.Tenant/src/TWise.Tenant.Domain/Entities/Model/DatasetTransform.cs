namespace TWise.Tenant.Domain.Entities.Model;

/// <summary>
/// A change applied to one column of a dataset source whenever the column is read. The transforms of
/// a source apply in SortOrder. Maps to [model].[Transform].
/// </summary>
public class DatasetTransform
{
    public long Id { get; set; }
    public long DatasetId { get; set; }
    public long SourceId { get; set; }
    public string ColumnName { get; set; } = string.Empty;

    /// <summary>trim | null_fill. The schema also allows the spec's other kinds, which nothing writes yet.</summary>
    public string Kind { get; set; } = string.Empty;

    /// <summary>{"value": "..."} for null_fill; {} for trim.</summary>
    public string ConfigJson { get; set; } = "{}";

    public int SortOrder { get; set; }
}
