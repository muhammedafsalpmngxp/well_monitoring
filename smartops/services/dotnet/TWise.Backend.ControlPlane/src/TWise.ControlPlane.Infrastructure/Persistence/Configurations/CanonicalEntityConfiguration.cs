using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TWise.Backend.ControlPlane.Domain.Entities;

namespace TWise.Backend.ControlPlane.Infrastructure.Persistence.Configurations;

public sealed class CanonicalEntityConfiguration : IEntityTypeConfiguration<CanonicalEntity>
{
    public void Configure(EntityTypeBuilder<CanonicalEntity> e)
    {
        e.ToTable("CanonicalEntity", "control");
        e.HasKey(x => x.CanonicalEntityId);
        e.Property(x => x.CanonicalEntityId).HasColumnName("canonical_entity_id");
        e.Property(x => x.EntityName).HasColumnName("entity_name").HasMaxLength(100).IsRequired();
        e.Property(x => x.SchemaVersionId).HasColumnName("schema_version_id");
        e.Property(x => x.Layer).HasColumnName("layer").HasMaxLength(10);
        e.Property(x => x.Description).HasColumnName("description").HasMaxLength(200);
        e.Property(x => x.IsActive).HasColumnName("is_active");
        e.Property(x => x.CreatedAt).HasColumnName("created_at");
        e.Property(x => x.ModifiedAt).HasColumnName("modified_at");
        e.HasIndex(x => x.EntityName).IsUnique();
        e.HasOne<SchemaVersion>().WithMany().HasForeignKey(x => x.SchemaVersionId);
    }
}
