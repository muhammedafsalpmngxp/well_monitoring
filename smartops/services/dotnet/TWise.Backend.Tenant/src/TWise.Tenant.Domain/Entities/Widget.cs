namespace TWise.Tenant.Domain.Entities;

/// <summary>A user-created chart or tile belonging to a tenant.</summary>
public class Widget
{
    public long Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }

    /// <summary>chart | tile</summary>
    public string Type { get; set; } = string.Empty;

    /// <summary>FK → ControlPlane.WidgetLibrary (cross-DB — no navigation property).</summary>
    public int? LibraryId { get; set; }

    /// <summary>Core schema table or view name used as data source.</summary>
    public string Source { get; set; } = string.Empty;

    /// <summary>Table | View</summary>
    public string SourceType { get; set; } = string.Empty;

    /// <summary>FK → DatabaseViews.Id when SourceType is View; null for Table sources.</summary>
    public long? SourceId { get; set; }

    /// <summary>Full design JSON: chart type, axes, filters, colours, etc.</summary>
    public string? DesignJson { get; set; }

    /// <summary>draft | published | inactive</summary>
    public string Status { get; set; } = "draft";

    public int? CategoryId { get; set; }
    public Category? Category { get; set; }

    public long TenantId { get; set; }
    public long CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public long? ModifiedBy { get; set; }
    public DateTime ModifiedOn { get; set; } = DateTime.UtcNow;
    public bool IsDeleted { get; set; } = false;
}
