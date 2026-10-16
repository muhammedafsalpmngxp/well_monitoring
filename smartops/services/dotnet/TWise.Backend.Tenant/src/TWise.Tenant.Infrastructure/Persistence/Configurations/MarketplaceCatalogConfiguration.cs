using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Infrastructure.Persistence.Configurations;

public sealed class MarketplaceCatalogConfiguration : IEntityTypeConfiguration<MarketplaceCatalog>
{
    public void Configure(EntityTypeBuilder<MarketplaceCatalog> builder)
    {
        builder.ToTable("MarketplaceCatalogs", "core");
        builder.HasKey(e => e.Id);

        builder.Property(e => e.Id).HasColumnName("id");
        builder.Property(e => e.CatalogKey).HasColumnName("catalog_key").HasMaxLength(50).IsRequired();
        builder.Property(e => e.Name).HasColumnName("name").HasMaxLength(100).IsRequired();
        builder.Property(e => e.Url).HasColumnName("url").HasMaxLength(2000).IsRequired();
        builder.Property(e => e.AuthHeader).HasColumnName("auth_header").HasMaxLength(100);
        builder.Property(e => e.AuthValueEncrypted).HasColumnName("auth_value_encrypted").HasMaxLength(4000);
        builder.Property(e => e.TenantId).HasColumnName("tenant_id");
        builder.Property(e => e.CreatedBy).HasColumnName("created_by");
        builder.Property(e => e.CreatedAt).HasColumnName("created_at");
        builder.Property(e => e.ModifiedAt).HasColumnName("modified_at");
        builder.Property(e => e.IsDeleted).HasColumnName("is_deleted");

        // The key is what installed visuals reference, so it must be unique per tenant.
        builder.HasIndex(e => new { e.TenantId, e.CatalogKey })
            .IsUnique()
            .HasDatabaseName("UX_core_MarketplaceCatalogs_tenant_key")
            .HasFilter("[is_deleted] = 0");

        builder.HasQueryFilter(e => !e.IsDeleted);
    }
}
