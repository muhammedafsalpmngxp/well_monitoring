using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Infrastructure.Persistence.Configurations;

public sealed class CustomVisualConfiguration : IEntityTypeConfiguration<CustomVisual>
{
    public void Configure(EntityTypeBuilder<CustomVisual> builder)
    {
        builder.ToTable("CustomVisuals", "core");
        builder.HasKey(e => e.Id);

        builder.Property(e => e.Id).HasColumnName("id");
        builder.Property(e => e.VisualKey).HasColumnName("visual_key").HasMaxLength(50).IsRequired();
        builder.Property(e => e.DisplayName).HasColumnName("display_name").HasMaxLength(100).IsRequired();
        builder.Property(e => e.Description).HasColumnName("description").HasMaxLength(500);
        builder.Property(e => e.Icon).HasColumnName("icon").HasMaxLength(50);
        builder.Property(e => e.RenderKind).HasColumnName("render_kind").HasMaxLength(30).IsRequired();
        builder.Property(e => e.DataRolesJson).HasColumnName("data_roles_json").HasColumnType("nvarchar(max)").IsRequired();
        builder.Property(e => e.OptionsTemplateJson).HasColumnName("options_template_json").HasColumnType("nvarchar(max)").IsRequired();
        builder.Property(e => e.IsActive).HasColumnName("is_active");
        builder.Property(e => e.TenantId).HasColumnName("tenant_id");
        builder.Property(e => e.CreatedBy).HasColumnName("created_by");
        builder.Property(e => e.CreatedAt).HasColumnName("created_at");
        builder.Property(e => e.ModifiedBy).HasColumnName("modified_by");
        builder.Property(e => e.ModifiedAt).HasColumnName("modified_at");
        builder.Property(e => e.IsDeleted).HasColumnName("is_deleted");
        builder.Property(e => e.CatalogId).HasColumnName("catalog_id").HasMaxLength(50);
        builder.Property(e => e.CatalogPluginId).HasColumnName("catalog_plugin_id").HasMaxLength(100);
        builder.Property(e => e.InstalledVersion).HasColumnName("installed_version").HasMaxLength(30);

        // The key is a widget's chartType, so a duplicate would make rendering ambiguous.
        // Filtered on is_deleted so a key can be reused after its visual is removed.
        builder.HasIndex(e => new { e.TenantId, e.VisualKey })
            .IsUnique()
            .HasDatabaseName("UX_core_CustomVisuals_tenant_key")
            .HasFilter("[is_deleted] = 0");

        builder.HasQueryFilter(e => !e.IsDeleted);
    }
}
