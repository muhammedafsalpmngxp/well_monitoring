using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TWise.Backend.ControlPlane.Domain.Entities;

namespace TWise.Backend.ControlPlane.Infrastructure.Persistence.Configurations;

public sealed class FieldMappingConfiguration : IEntityTypeConfiguration<FieldMapping>
{
    public void Configure(EntityTypeBuilder<FieldMapping> e)
    {
        e.ToTable("FieldMapping", "control");
        e.HasKey(x => x.FieldMappingId);
        e.Property(x => x.FieldMappingId).HasColumnName("field_mapping_id");
        e.Property(x => x.TenantSourceId).HasColumnName("tenant_source_id");
        e.Property(x => x.CanonicalFieldId).HasColumnName("canonical_field_id");
        e.Property(x => x.SourceObject).HasColumnName("source_object").HasMaxLength(128);
        e.Property(x => x.SourceField).HasColumnName("source_field").HasMaxLength(128);
        e.Property(x => x.TransformRule).HasColumnName("transform_rule");
        e.Property(x => x.IsActive).HasColumnName("is_active");
        e.Property(x => x.CreatedAt).HasColumnName("created_at");
        e.Property(x => x.ModifiedAt).HasColumnName("modified_at");
        e.HasIndex(x => new { x.TenantSourceId, x.CanonicalFieldId }).IsUnique();
        e.HasOne<TenantSource>().WithMany().HasForeignKey(x => x.TenantSourceId);
        e.HasOne<CanonicalField>().WithMany().HasForeignKey(x => x.CanonicalFieldId);
    }
}
