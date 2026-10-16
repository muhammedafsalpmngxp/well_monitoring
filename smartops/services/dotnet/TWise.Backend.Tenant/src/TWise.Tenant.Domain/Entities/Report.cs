namespace TWise.Tenant.Domain.Entities;

public class Report
{
    public long Id { get; set; }
    public string ReportName { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string SourceName { get; set; } = string.Empty;

    /// <summary>View or Table</summary>
    public string SourceType { get; set; } = string.Empty;

    /// <summary>JSON blob storing the full report layout &amp; column config designed by the user</summary>
    public string? ReportJson { get; set; }

    /// <summary>draft | published | inactive</summary>
    public string Status { get; set; } = "draft";

    public DateTime? PublishedOn { get; set; }
    public bool IsDeleted { get; set; } = false;
    public long CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public long TenantId { get; set; }

    // FK — category is required
    public int CategoryId { get; set; }
    public Category? Category { get; set; }
}
