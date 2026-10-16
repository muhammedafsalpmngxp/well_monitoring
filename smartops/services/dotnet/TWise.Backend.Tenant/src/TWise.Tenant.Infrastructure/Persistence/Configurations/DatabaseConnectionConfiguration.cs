using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Infrastructure.Persistence.Configurations;

/// <summary>
/// Maps the DatabaseConnection entity to [core].[DatabaseConnections] table
/// created by init-tenant-schema.sql. No DDL is issued by EF — schema is SQL-managed.
/// </summary>
public sealed class DatabaseConnectionConfiguration : IEntityTypeConfiguration<DatabaseConnection>
{
    public void Configure(EntityTypeBuilder<DatabaseConnection> builder)
    {
        builder.ToTable("DatabaseConnections", "core");
        builder.HasKey(e => e.Id);

        builder.Property(e => e.Id).HasColumnName("id");
        builder.Property(e => e.ConnectionName).HasColumnName("connection_name").HasMaxLength(100).IsRequired();
        builder.Property(e => e.Server).HasColumnName("server").HasMaxLength(200).IsRequired();
        builder.Property(e => e.Port).HasColumnName("port");
        builder.Property(e => e.DatabaseName).HasColumnName("database_name").HasMaxLength(128).IsRequired();
        builder.Property(e => e.Username).HasColumnName("username").HasMaxLength(128).IsRequired();
        builder.Property(e => e.PasswordHash).HasColumnName("password_hash").HasMaxLength(500).IsRequired();
        builder.Property(e => e.Provider).HasColumnName("provider").HasMaxLength(20).IsRequired();
        builder.Property(e => e.TrustServerCertificate).HasColumnName("trust_server_certificate");
        builder.Property(e => e.IsActive).HasColumnName("is_active");
        builder.Property(e => e.TenantId).HasColumnName("tenant_id");
        builder.Property(e => e.CreatedBy).HasColumnName("created_by");
        builder.Property(e => e.CreatedAt).HasColumnName("created_at");
        builder.Property(e => e.ModifiedBy).HasColumnName("modified_by");
        builder.Property(e => e.ModifiedAt).HasColumnName("modified_at");
        builder.Property(e => e.IsDeleted).HasColumnName("is_deleted");

        builder.HasQueryFilter(e => !e.IsDeleted);
    }
}
