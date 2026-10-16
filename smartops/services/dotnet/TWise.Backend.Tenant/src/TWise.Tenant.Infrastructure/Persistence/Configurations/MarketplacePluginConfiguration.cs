using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Infrastructure.Persistence.Configurations;

public sealed class MarketplacePluginConfiguration : IEntityTypeConfiguration<MarketplacePlugin>
{
    public void Configure(EntityTypeBuilder<MarketplacePlugin> builder)
    {
        builder.ToTable("MarketplacePlugins", "core");
        builder.HasKey(e => e.Id);

        builder.Property(e => e.Id).HasColumnName("id");
        builder.Property(e => e.PluginId).HasColumnName("plugin_id").HasMaxLength(100).IsRequired();
        builder.Property(e => e.Name).HasColumnName("name").HasMaxLength(100).IsRequired();
        builder.Property(e => e.Description).HasColumnName("description").HasMaxLength(1000).IsRequired();
        builder.Property(e => e.Version).HasColumnName("version").HasMaxLength(20).IsRequired();
        builder.Property(e => e.Publisher).HasColumnName("publisher").HasMaxLength(100).IsRequired();
        builder.Property(e => e.VisualKey).HasColumnName("visual_key").HasMaxLength(100).IsRequired();
        builder.Property(e => e.RenderKind).HasColumnName("render_kind").HasMaxLength(50).IsRequired();
        builder.Property(e => e.Icon).HasColumnName("icon").HasMaxLength(50);
        builder.Property(e => e.DataRolesJson).HasColumnName("data_roles_json").IsRequired();
        builder.Property(e => e.FeaturesJson).HasColumnName("features_json");
        builder.Property(e => e.ImageUrl).HasColumnName("image_url");
        builder.Property(e => e.OptionsTemplateJson).HasColumnName("options_template_json").IsRequired();
        builder.Property(e => e.IsActive).HasColumnName("is_active");
        builder.Property(e => e.CreatedAt).HasColumnName("created_at");
        builder.Property(e => e.ModifiedAt).HasColumnName("modified_at");

        builder.HasIndex(e => e.PluginId).IsUnique().HasDatabaseName("UX_core_MarketplacePlugins_plugin_id");
    }
}
