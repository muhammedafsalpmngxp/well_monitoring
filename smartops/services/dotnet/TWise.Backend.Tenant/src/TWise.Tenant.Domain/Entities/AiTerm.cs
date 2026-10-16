namespace TWise.Tenant.Domain.Entities;

/// <summary>
/// A business word and what it means in one dataset: "producing wells" (also "producers") =
/// Status = 'P'. Put in the ask prompt so the model translates the business's own language
/// the same way every time. Maps to core.AiTerms.
/// </summary>
public class AiTerm
{
    public long Id { get; set; }
    public long TenantId { get; set; }
    public string SourceType { get; set; } = "";
    public long SourceId { get; set; }
    public string Term { get; set; } = "";
    /// <summary>Other words for the same thing, comma separated.</summary>
    public string? Synonyms { get; set; }
    /// <summary>With Value: the term is the filter ColumnName = Value.</summary>
    public string? ColumnName { get; set; }
    public string? Value { get; set; }
    /// <summary>Free-text meaning when it is not a single filter.</summary>
    public string? Meaning { get; set; }
    public string? ModifiedBy { get; set; }
    public DateTime ModifiedAt { get; set; } = DateTime.UtcNow;
}
