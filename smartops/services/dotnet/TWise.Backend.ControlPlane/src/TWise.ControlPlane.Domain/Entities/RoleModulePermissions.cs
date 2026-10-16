namespace TWise.Backend.ControlPlane.Domain.Entities;

public class RoleModulePermissions : IControlAudited, ISoftDeletable
{
    public long RoleModulePermissionId { get; set; }
    public int RoleId { get; set; }
    public int ModuleId { get; set; }
    public bool CanView { get; set; }
    public bool CanCreate { get; set; }
    public bool CanModify { get; set; }
    public bool CanAdmin { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; }
    public DateTime ModifiedAt { get; set; }
    public bool IsDeleted { get; set; }
    public DateTime? DeletedAt { get; set; }
}
