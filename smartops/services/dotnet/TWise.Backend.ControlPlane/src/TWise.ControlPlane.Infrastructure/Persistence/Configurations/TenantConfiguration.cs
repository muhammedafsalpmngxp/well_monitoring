using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TWise.Backend.ControlPlane.Domain.Entities;

namespace TWise.Backend.ControlPlane.Infrastructure.Persistence.Configurations;

public sealed class TenantConfiguration : IEntityTypeConfiguration<Tenant>
{
    public void Configure(EntityTypeBuilder<Tenant> e)
    {
        e.ToTable("Tenant", "control");
        e.HasKey(x => x.TenantId);
        e.Property(x => x.TenantId).HasColumnName("tenant_id");
        e.Property(x => x.TenantCode).HasColumnName("tenant_code").HasMaxLength(20).IsRequired();
        e.Property(x => x.TenantName).HasColumnName("tenant_name").HasMaxLength(100);
        e.Property(x => x.RegionId).HasColumnName("region_id");
        e.Property(x => x.IsolationMode).HasColumnName("isolation_mode").HasMaxLength(20);
        e.Property(x => x.DataPlaneRef).HasColumnName("data_plane_ref").HasMaxLength(200);
        e.Property(x => x.SchemaVersionId).HasColumnName("schema_version_id");
        e.Property(x => x.Status).HasColumnName("status").HasMaxLength(20);
        e.Property(x => x.ProvisionStep).HasColumnName("provision_step").HasMaxLength(30);
        e.Property(x => x.RetryCount).HasColumnName("retry_count");
        e.Property(x => x.IsActive).HasColumnName("is_active");
        e.Property(x => x.CreatedAt).HasColumnName("created_at");
        e.Property(x => x.ModifiedAt).HasColumnName("modified_at");
        e.Property(x => x.IsDeleted).HasColumnName("is_deleted");
        e.Property(x => x.DeletedAt).HasColumnName("deleted_at");
        e.HasIndex(x => x.TenantCode).IsUnique();
        e.HasOne<Region>().WithMany().HasForeignKey(x => x.RegionId);
        e.HasOne<SchemaVersion>().WithMany().HasForeignKey(x => x.SchemaVersionId);
    }
}
