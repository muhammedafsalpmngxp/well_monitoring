using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TWise.Backend.ControlPlane.Domain.Entities;

namespace TWise.Backend.ControlPlane.Infrastructure.Persistence.Configurations;

public sealed class RoleConfiguration : IEntityTypeConfiguration<Role>
{
    public void Configure(EntityTypeBuilder<Role> e)
    {
        e.ToTable("Role", "control");
        e.HasKey(x => x.RoleId);
        e.Property(x => x.RoleId).HasColumnName("role_id");
        e.Property(x => x.RoleCode).HasColumnName("role_code").HasMaxLength(40).IsRequired();
        e.Property(x => x.RoleName).HasColumnName("role_name").HasMaxLength(100);
        e.Property(x => x.Description).HasColumnName("description").HasMaxLength(500);
        e.Property(x => x.Scope).HasColumnName("scope").HasMaxLength(20);
        e.Property(x => x.TenantId).HasColumnName("tenant_id");
        e.Property(x => x.IsActive).HasColumnName("is_active");
        e.Property(x => x.CreatedAt).HasColumnName("created_at");
        e.Property(x => x.ModifiedAt).HasColumnName("modified_at");
        e.Property(x => x.IsDeleted).HasColumnName("is_deleted");
        e.Property(x => x.DeletedAt).HasColumnName("deleted_at");
        e.HasIndex(x => new { x.RoleCode, x.TenantId }).IsUnique()
            .HasFilter("[tenant_id] IS NOT NULL AND [is_deleted] = 0");
        e.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).IsRequired(false);
    }
}
