using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TWise.Backend.ControlPlane.Domain.Entities;

namespace TWise.Backend.ControlPlane.Infrastructure.Persistence.Configurations;

public sealed class RegionConfiguration : IEntityTypeConfiguration<Region>
{
    public void Configure(EntityTypeBuilder<Region> e)
    {
        e.ToTable("Region", "control");
        e.HasKey(x => x.RegionId);
        e.Property(x => x.RegionId).HasColumnName("region_id");
        e.Property(x => x.RegionCode).HasColumnName("region_code").HasMaxLength(20).IsRequired();
        e.Property(x => x.RegionName).HasColumnName("region_name").HasMaxLength(100);
        e.Property(x => x.IsActive).HasColumnName("is_active");
        e.Property(x => x.CreatedAt).HasColumnName("created_at");
        e.Property(x => x.ModifiedAt).HasColumnName("modified_at");
        e.HasIndex(x => x.RegionCode).IsUnique();
    }
}
