using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TWise.Backend.ControlPlane.Domain.Entities;

namespace TWise.Backend.ControlPlane.Infrastructure.Persistence.Configurations;

public sealed class FeatureConfiguration : IEntityTypeConfiguration<Feature>
{
    public void Configure(EntityTypeBuilder<Feature> e)
    {
        e.ToTable("Feature", "control");
        e.HasKey(x => x.FeatureId);
        e.Property(x => x.FeatureId).HasColumnName("feature_id");
        e.Property(x => x.FeatureCode).HasColumnName("feature_code").HasMaxLength(40).IsRequired();
        e.Property(x => x.FeatureName).HasColumnName("feature_name").HasMaxLength(100);
        e.Property(x => x.IsActive).HasColumnName("is_active");
        e.Property(x => x.CreatedAt).HasColumnName("created_at");
        e.Property(x => x.ModifiedAt).HasColumnName("modified_at");
        e.HasIndex(x => x.FeatureCode).IsUnique();
    }
}
