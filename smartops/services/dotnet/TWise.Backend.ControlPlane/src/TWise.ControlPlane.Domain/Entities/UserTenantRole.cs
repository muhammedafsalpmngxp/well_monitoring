namespace TWise.Backend.ControlPlane.Domain.Entities;

public class UserTenantRole : IControlAudited, ISoftDeletable
{
    public long UserTenantRoleId { get; set; }
    public long UserId { get; set; }
    public long TenantId { get; set; }
    public int RoleId { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; }
    public DateTime ModifiedAt { get; set; }
    public bool IsDeleted { get; set; }
    public DateTime? DeletedAt { get; set; }
}
