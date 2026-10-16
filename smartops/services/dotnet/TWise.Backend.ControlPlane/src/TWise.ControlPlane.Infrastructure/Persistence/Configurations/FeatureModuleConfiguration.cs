using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TWise.Backend.ControlPlane.Domain.Entities;

namespace TWise.Backend.ControlPlane.Infrastructure.Persistence.Configurations;

public sealed class FeatureModuleConfiguration : IEntityTypeConfiguration<FeatureModule>
{
    public void Configure(EntityTypeBuilder<FeatureModule> e)
    {
        e.ToTable("FeatureModule", "control");
        e.HasKey(x => x.ModuleId);
        e.Property(x => x.ModuleId).HasColumnName("module_id");
        e.Property(x => x.ModuleCode).HasColumnName("module_code").HasMaxLength(80).IsRequired();
        e.Property(x => x.ParentCode).HasColumnName("parent_code").HasMaxLength(80);
        e.Property(x => x.DisplayName).HasColumnName("display_name").HasMaxLength(100);
        e.Property(x => x.FeatureCode).HasColumnName("feature_code").HasMaxLength(40);
        e.Property(x => x.SortOrder).HasColumnName("sort_order");
        e.Property(x => x.IsActive).HasColumnName("is_active");
        e.Property(x => x.CreatedAt).HasColumnName("created_at");
        e.Property(x => x.ModifiedAt).HasColumnName("modified_at");
        e.Property(x => x.IsDeleted).HasColumnName("is_deleted");
        e.Property(x => x.DeletedAt).HasColumnName("deleted_at");
        e.HasIndex(x => x.ModuleCode).IsUnique();
    }
}
