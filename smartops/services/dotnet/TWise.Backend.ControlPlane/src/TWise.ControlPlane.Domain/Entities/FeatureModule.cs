namespace TWise.Backend.ControlPlane.Domain.Entities;

public class FeatureModule : IControlAudited, ISoftDeletable
{
    public int ModuleId { get; set; }
    public string ModuleCode { get; set; } = default!;
    public string? ParentCode { get; set; }
    public string? DisplayName { get; set; }
    public string? FeatureCode { get; set; }
    public int SortOrder { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; }
    public DateTime ModifiedAt { get; set; }
    public bool IsDeleted { get; set; }
    public DateTime? DeletedAt { get; set; }
}
