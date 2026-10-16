using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TWise.Backend.ControlPlane.Domain.Entities;

namespace TWise.Backend.ControlPlane.Infrastructure.Persistence.Configurations;

public sealed class UserTenantRoleConfiguration : IEntityTypeConfiguration<UserTenantRole>
{
    public void Configure(EntityTypeBuilder<UserTenantRole> e)
    {
        e.ToTable("UserTenantRole", "control");
        e.HasKey(x => x.UserTenantRoleId);
        e.Property(x => x.UserTenantRoleId).HasColumnName("user_tenant_role_id");
        e.Property(x => x.UserId).HasColumnName("user_id");
        e.Property(x => x.TenantId).HasColumnName("tenant_id");
        e.Property(x => x.RoleId).HasColumnName("role_id");
        e.Property(x => x.IsActive).HasColumnName("is_active");
        e.Property(x => x.CreatedAt).HasColumnName("created_at");
        e.Property(x => x.ModifiedAt).HasColumnName("modified_at");
        e.HasIndex(x => new { x.UserId, x.TenantId, x.RoleId }).IsUnique();
        e.HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId);
        e.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId);
        e.HasOne<Role>().WithMany().HasForeignKey(x => x.RoleId);
    }
}
