namespace TWise.Backend.ControlPlane.Domain.Entities;

public class FieldMapping : IControlAudited, ISoftDeletable
{
    public long FieldMappingId { get; set; }
    public long TenantSourceId { get; set; }
    public int CanonicalFieldId { get; set; }
    public string? SourceObject { get; set; }
    public string? SourceField { get; set; }
    public string? TransformRule { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; }
    public DateTime ModifiedAt { get; set; }
    public bool IsDeleted { get; set; }
    public DateTime? DeletedAt { get; set; }
}
