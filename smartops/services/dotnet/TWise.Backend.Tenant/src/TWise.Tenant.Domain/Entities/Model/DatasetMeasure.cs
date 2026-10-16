namespace TWise.Tenant.Domain.Entities.Model;

/// <summary>
/// A named aggregate expression. ExpressionAst is the source of truth; ExpressionText is
/// rendered from it. Maps to [model].[Measure].
/// </summary>
public class DatasetMeasure
{
    public long Id { get; set; }
    public long DatasetId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string ExpressionAst { get; set; } = "{}";
    public string? ExpressionText { get; set; }
    public string? Format { get; set; }
    /// <summary>A display folder: measures with the same folder are listed together under it.</summary>
    public string? Folder { get; set; }
    /// <summary>The table the measure is listed under in the Data pane; null lists it with the dataset's measures.</summary>
    public long? HomeSourceId { get; set; }
    public bool IsCertified { get; set; }
}
