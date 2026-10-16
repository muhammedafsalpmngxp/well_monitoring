using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TWise.Backend.ControlPlane.Domain.Entities;

namespace TWise.Backend.ControlPlane.Infrastructure.Persistence.Configurations;

public sealed class RoleModulePermissionsConfiguration : IEntityTypeConfiguration<RoleModulePermissions>
{
    public void Configure(EntityTypeBuilder<RoleModulePermissions> e)
    {
        e.ToTable("RoleModulePermission", "control");
        e.HasKey(x => x.RoleModulePermissionId);
        e.Property(x => x.RoleModulePermissionId).HasColumnName("role_module_permission_id");
        e.Property(x => x.RoleId).HasColumnName("role_id");
        e.Property(x => x.ModuleId).HasColumnName("module_id");
        e.Property(x => x.CanView).HasColumnName("can_view");
        e.Property(x => x.CanCreate).HasColumnName("can_create");
        e.Property(x => x.CanModify).HasColumnName("can_modify");
        e.Property(x => x.CanAdmin).HasColumnName("can_admin");
        e.Property(x => x.IsActive).HasColumnName("is_active");
        e.Property(x => x.CreatedAt).HasColumnName("created_at");
        e.Property(x => x.ModifiedAt).HasColumnName("modified_at");
        e.Property(x => x.IsDeleted).HasColumnName("is_deleted");
        e.Property(x => x.DeletedAt).HasColumnName("deleted_at");
        e.HasIndex(x => new { x.RoleId, x.ModuleId }).IsUnique();
    }
}
