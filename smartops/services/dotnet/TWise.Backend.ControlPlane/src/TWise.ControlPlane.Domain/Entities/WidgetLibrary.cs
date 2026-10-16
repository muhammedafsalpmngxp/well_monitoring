namespace TWise.Backend.ControlPlane.Domain.Entities;

/// <summary>Master template library for charts and tiles — shared across all tenants.</summary>
public class WidgetLibrary : IControlAudited, ISoftDeletable
{
    public int Id { get; set; }
    public string WidgetName { get; set; } = default!;

    /// <summary>chart | tile</summary>
    public string Type { get; set; } = default!;

    /// <summary>Design JSON template (e.g. default bar chart config).</summary>
    public string? Json { get; set; }

    public long CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; }
    public long? ModifiedBy { get; set; }
    public DateTime ModifiedAt { get; set; }
    public bool IsDeleted { get; set; }
    public DateTime? DeletedAt { get; set; }
}
