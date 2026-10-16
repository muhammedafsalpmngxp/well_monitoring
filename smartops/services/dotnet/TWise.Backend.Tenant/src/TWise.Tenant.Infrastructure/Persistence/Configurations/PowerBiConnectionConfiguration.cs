using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Infrastructure.Persistence.Configurations;

public sealed class PowerBiConnectionConfiguration : IEntityTypeConfiguration<PowerBiConnection>
{
    public void Configure(EntityTypeBuilder<PowerBiConnection> builder)
    {
        builder.ToTable("PowerBiConnections", "core");
        builder.HasKey(e => e.Id);

        builder.Property(e => e.Id).HasColumnName("id");
        builder.Property(e => e.TenantId).HasColumnName("tenant_id");
        builder.Property(e => e.AzureTenantId).HasColumnName("azure_tenant_id").HasMaxLength(36).IsRequired();
        builder.Property(e => e.ClientId).HasColumnName("client_id").HasMaxLength(36).IsRequired();
        builder.Property(e => e.ClientSecretEncrypted).HasColumnName("client_secret_encrypted").HasMaxLength(4000).IsRequired();
        builder.Property(e => e.WorkspaceId).HasColumnName("workspace_id").HasMaxLength(36).IsRequired();
        builder.Property(e => e.ModifiedBy).HasColumnName("modified_by");
        builder.Property(e => e.CreatedAt).HasColumnName("created_at");
        builder.Property(e => e.ModifiedAt).HasColumnName("modified_at");

        builder.HasIndex(e => e.TenantId).IsUnique().HasDatabaseName("UX_core_PowerBiConnections_tenant");
    }
}
