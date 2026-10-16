namespace TWise.Tenant.Domain.Entities.Model;

/// <summary>
/// A join between two sources of a dataset. For many_to_one, From is the many side.
/// Maps to [model].[Relationship].
/// </summary>
public class DatasetRelationship
{
    public long Id { get; set; }
    public long DatasetId { get; set; }
    public long FromSourceId { get; set; }
    public string FromColumn { get; set; } = string.Empty;
    public long ToSourceId { get; set; }
    public string ToColumn { get; set; } = string.Empty;

    /// <summary>many_to_one | one_to_one</summary>
    public string Cardinality { get; set; } = "many_to_one";

    public bool IsActive { get; set; } = true;

    /// <summary>fk | heuristic | user</summary>
    public string DetectedFrom { get; set; } = "user";
}
