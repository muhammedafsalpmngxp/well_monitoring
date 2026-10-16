namespace TWise.Backend.ControlPlane.Domain.Entities;

public class Role : IControlAudited, ISoftDeletable
{
    public int RoleId { get; set; }
    public string RoleCode { get; set; } = default!;
    public string? RoleName { get; set; }
    public string? Description { get; set; }
    public string? Scope { get; set; }
    public long? TenantId { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; }
    public DateTime ModifiedAt { get; set; }
    public bool IsDeleted { get; set; }
    public DateTime? DeletedAt { get; set; }

    public bool IsSystemRole => TenantId is null;
}
