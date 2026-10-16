namespace TWise.Backend.ControlPlane.Domain.Entities;

public class Region : IControlAudited, ISoftDeletable
{
    public int RegionId { get; set; }
    public string RegionCode { get; set; } = default!;
    public string? RegionName { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; }
    public DateTime ModifiedAt { get; set; }
    public bool IsDeleted { get; set; }
    public DateTime? DeletedAt { get; set; }
}
