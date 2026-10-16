namespace TWise.Backend.ControlPlane.Domain.Entities;

public class TenantFeature : IControlAudited, ISoftDeletable
{
    public long TenantFeatureId { get; set; }
    public long TenantId { get; set; }
    public int FeatureId { get; set; }
    public bool IsEnabled { get; set; }
    public DateTime? ValidFrom { get; set; }
    public DateTime? ValidTo { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; }
    public DateTime ModifiedAt { get; set; }
    public bool IsDeleted { get; set; }
    public DateTime? DeletedAt { get; set; }
}
