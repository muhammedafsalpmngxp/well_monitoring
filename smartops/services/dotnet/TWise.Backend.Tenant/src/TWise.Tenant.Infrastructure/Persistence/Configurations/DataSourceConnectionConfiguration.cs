using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Infrastructure.Persistence.Configurations;

public sealed class DataSourceConnectionConfiguration : IEntityTypeConfiguration<DataSourceConnection>
{
    public void Configure(EntityTypeBuilder<DataSourceConnection> builder)
    {
        builder.ToTable("DataSourceConnections", "core");
        builder.HasKey(e => e.Id);

        builder.Property(e => e.Id).HasColumnName("id");
        builder.Property(e => e.ConnectionName).HasColumnName("connection_name").HasMaxLength(200).IsRequired();
        builder.Property(e => e.Kind).HasColumnName("kind").HasMaxLength(50).IsRequired();
        builder.Property(e => e.AuthType).HasColumnName("auth_type").HasMaxLength(30).IsRequired();
        builder.Property(e => e.CredentialsEncrypted).HasColumnName("credentials_encrypted").HasColumnType("nvarchar(max)");
        builder.Property(e => e.ConfigJson).HasColumnName("config_json").HasColumnType("nvarchar(max)").IsRequired();
        builder.Property(e => e.LastStatus).HasColumnName("last_status").HasMaxLength(20);
        builder.Property(e => e.LastErrorMessage).HasColumnName("last_error_message").HasMaxLength(500);
        builder.Property(e => e.LastTestedAt).HasColumnName("last_tested_at");
        builder.Property(e => e.IsActive).HasColumnName("is_active");
        builder.Property(e => e.TenantId).HasColumnName("tenant_id");
        builder.Property(e => e.CreatedBy).HasColumnName("created_by");
        builder.Property(e => e.CreatedAt).HasColumnName("created_at");
        builder.Property(e => e.ModifiedBy).HasColumnName("modified_by");
        builder.Property(e => e.ModifiedAt).HasColumnName("modified_at");
        builder.Property(e => e.IsDeleted).HasColumnName("is_deleted");

        builder.HasQueryFilter(e => !e.IsDeleted);

        builder.HasIndex(e => new { e.TenantId, e.ConnectionName })
            .IsUnique()
            .HasFilter("[is_deleted] = 0")
            .HasDatabaseName("UX_core_DataSourceConnections_tenant_name");

        builder.HasIndex(e => new { e.TenantId, e.Kind })
            .HasFilter("[is_deleted] = 0")
            .HasDatabaseName("IX_core_DataSourceConnections_tenant_kind");
    }
}
