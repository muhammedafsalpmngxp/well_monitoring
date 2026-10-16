namespace TWise.Backend.ControlPlane.Domain.Entities;

public class Feature : IControlAudited, ISoftDeletable
{
    public int FeatureId { get; set; }
    public string FeatureCode { get; set; } = default!;
    public string? FeatureName { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; }
    public DateTime ModifiedAt { get; set; }
    public bool IsDeleted { get; set; }
    public DateTime? DeletedAt { get; set; }
}
