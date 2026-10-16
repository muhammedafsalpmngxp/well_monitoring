namespace TWise.Tenant.Domain.Entities.Model;

/// <summary>A reusable semantic model over one connection. Maps to [model].[Dataset].</summary>
public class Dataset
{
    public long Id { get; set; }
    public long TenantId { get; set; }
    public long ConnectionId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }

    /// <summary>draft | published | certified</summary>
    public string Status { get; set; } = "draft";

    /// <summary>
    /// The sources, relationships, measures, calculated columns and transforms as JSON, as they were at the
    /// last Publish. Canvases read this; Model Studio edits the part tables as a draft. Null until the first Publish.
    /// </summary>
    public string? PublishedModel { get; set; }
    public DateTime? PublishedAt { get; set; }
    public long? PublishedBy { get; set; }

    public long CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public long? ModifiedBy { get; set; }
    public DateTime ModifiedAt { get; set; } = DateTime.UtcNow;
    public bool IsDeleted { get; set; }
}
