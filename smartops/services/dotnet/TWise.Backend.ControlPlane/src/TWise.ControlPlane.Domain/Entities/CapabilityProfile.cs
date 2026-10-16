namespace TWise.Backend.ControlPlane.Domain.Entities;

public class CapabilityProfile : IControlAudited, ISoftDeletable
{
    public long CapabilityId { get; set; }
    public long TenantSourceId { get; set; }
    public int CanonicalFieldId { get; set; }
    public bool IsAvailable { get; set; }
    public string? Note { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; }
    public DateTime ModifiedAt { get; set; }
    public bool IsDeleted { get; set; }
    public DateTime? DeletedAt { get; set; }
}
