namespace TWise.Tenant.Domain.Entities.Model;

/// <summary>
/// A calculation on one row of a dataset source, used by name like a column of it. ExpressionAst is
/// the source of truth; ExpressionText is printed from it. Maps to [model].[CalculatedColumn].
/// </summary>
public class DatasetCalculatedColumn
{
    public long Id { get; set; }
    public long DatasetId { get; set; }
    public long SourceId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string ExpressionAst { get; set; } = "{}";
    public string? ExpressionText { get; set; }

    /// <summary>number | text: the type of the formula's result.</summary>
    public string DataType { get; set; } = "number";
}
