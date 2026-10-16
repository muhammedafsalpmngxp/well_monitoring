using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TWise.Backend.ControlPlane.Domain.Entities;

namespace TWise.Backend.ControlPlane.Infrastructure.Persistence.Configurations;

public sealed class CapabilityProfileConfiguration : IEntityTypeConfiguration<CapabilityProfile>
{
    public void Configure(EntityTypeBuilder<CapabilityProfile> e)
    {
        e.ToTable("CapabilityProfile", "control");
        e.HasKey(x => x.CapabilityId);
        e.Property(x => x.CapabilityId).HasColumnName("capability_id");
        e.Property(x => x.TenantSourceId).HasColumnName("tenant_source_id");
        e.Property(x => x.CanonicalFieldId).HasColumnName("canonical_field_id");
        e.Property(x => x.IsAvailable).HasColumnName("is_available");
        e.Property(x => x.Note).HasColumnName("note").HasMaxLength(200);
        e.Property(x => x.IsActive).HasColumnName("is_active");
        e.Property(x => x.CreatedAt).HasColumnName("created_at");
        e.Property(x => x.ModifiedAt).HasColumnName("modified_at");
        e.HasIndex(x => new { x.TenantSourceId, x.CanonicalFieldId }).IsUnique();
        e.HasOne<TenantSource>().WithMany().HasForeignKey(x => x.TenantSourceId);
        e.HasOne<CanonicalField>().WithMany().HasForeignKey(x => x.CanonicalFieldId);
    }
}
