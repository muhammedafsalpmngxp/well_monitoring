using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TWise.Backend.ControlPlane.Domain.Entities;

namespace TWise.Backend.ControlPlane.Infrastructure.Persistence.Configurations;

public sealed class TenantSourceConfiguration : IEntityTypeConfiguration<TenantSource>
{
    public void Configure(EntityTypeBuilder<TenantSource> e)
    {
        e.ToTable("TenantSource", "control");
        e.HasKey(x => x.TenantSourceId);
        e.Property(x => x.TenantSourceId).HasColumnName("tenant_source_id");
        e.Property(x => x.TenantId).HasColumnName("tenant_id");
        e.Property(x => x.SourceSystemId).HasColumnName("source_system_id");
        e.Property(x => x.ConnectionRef).HasColumnName("connection_ref").HasMaxLength(200);
        e.Property(x => x.IngestionMode).HasColumnName("ingestion_mode").HasMaxLength(20);
        e.Property(x => x.IsSystemOfRecord).HasColumnName("is_system_of_record");
        e.Property(x => x.Status).HasColumnName("status").HasMaxLength(20);
        e.Property(x => x.IsActive).HasColumnName("is_active");
        e.Property(x => x.CreatedAt).HasColumnName("created_at");
        e.Property(x => x.ModifiedAt).HasColumnName("modified_at");
        e.HasIndex(x => new { x.TenantId, x.SourceSystemId }).IsUnique();
        e.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId);
        e.HasOne<SourceSystem>().WithMany().HasForeignKey(x => x.SourceSystemId);
    }
}
