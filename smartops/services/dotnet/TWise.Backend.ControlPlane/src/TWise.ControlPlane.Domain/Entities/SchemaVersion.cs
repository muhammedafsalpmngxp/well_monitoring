namespace TWise.Backend.ControlPlane.Domain.Entities;

public class SchemaVersion : IControlAudited, ISoftDeletable
{
    public int SchemaVersionId { get; set; }
    public string VersionNo { get; set; } = default!;
    public string? Description { get; set; }
    public DateTime? ReleasedAt { get; set; }
    public bool IsCurrent { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; }
    public DateTime ModifiedAt { get; set; }
    public bool IsDeleted { get; set; }
    public DateTime? DeletedAt { get; set; }
}
