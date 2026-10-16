using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TWise.Backend.ControlPlane.Domain.Entities;

namespace TWise.Backend.ControlPlane.Infrastructure.Persistence.Configurations;

public sealed class TenantFeatureConfiguration : IEntityTypeConfiguration<TenantFeature>
{
    public void Configure(EntityTypeBuilder<TenantFeature> e)
    {
        e.ToTable("TenantFeature", "control");
        e.HasKey(x => x.TenantFeatureId);
        e.Property(x => x.TenantFeatureId).HasColumnName("tenant_feature_id");
        e.Property(x => x.TenantId).HasColumnName("tenant_id");
        e.Property(x => x.FeatureId).HasColumnName("feature_id");
        e.Property(x => x.IsEnabled).HasColumnName("is_enabled");
        e.Property(x => x.ValidFrom).HasColumnName("valid_from");
        e.Property(x => x.ValidTo).HasColumnName("valid_to");
        e.Property(x => x.IsActive).HasColumnName("is_active");
        e.Property(x => x.CreatedAt).HasColumnName("created_at");
        e.Property(x => x.ModifiedAt).HasColumnName("modified_at");
        e.HasIndex(x => new { x.TenantId, x.FeatureId }).IsUnique();
        e.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId);
        e.HasOne<Feature>().WithMany().HasForeignKey(x => x.FeatureId);
    }
}
