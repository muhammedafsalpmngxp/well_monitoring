using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TWise.Backend.ControlPlane.Domain.Entities;

namespace TWise.Backend.ControlPlane.Infrastructure.Persistence.Configurations;

public sealed class CanonicalFieldConfiguration : IEntityTypeConfiguration<CanonicalField>
{
    public void Configure(EntityTypeBuilder<CanonicalField> e)
    {
        e.ToTable("CanonicalField", "control");
        e.HasKey(x => x.CanonicalFieldId);
        e.Property(x => x.CanonicalFieldId).HasColumnName("canonical_field_id");
        e.Property(x => x.CanonicalEntityId).HasColumnName("canonical_entity_id");
        e.Property(x => x.FieldName).HasColumnName("field_name").HasMaxLength(100).IsRequired();
        e.Property(x => x.DataType).HasColumnName("data_type").HasMaxLength(50);
        e.Property(x => x.IsRequired).HasColumnName("is_required");
        e.Property(x => x.IsUnique).HasColumnName("is_unique");
        e.Property(x => x.ReferenceEntityId).HasColumnName("reference_entity_id");
        e.Property(x => x.Description).HasColumnName("description").HasMaxLength(200);
        e.Property(x => x.IsActive).HasColumnName("is_active");
        e.Property(x => x.CreatedAt).HasColumnName("created_at");
        e.Property(x => x.ModifiedAt).HasColumnName("modified_at");
        e.HasIndex(x => new { x.CanonicalEntityId, x.FieldName }).IsUnique();
        e.HasOne<CanonicalEntity>().WithMany().HasForeignKey(x => x.CanonicalEntityId);
        e.HasOne<CanonicalEntity>().WithMany().HasForeignKey(x => x.ReferenceEntityId).IsRequired(false);


    }
}
