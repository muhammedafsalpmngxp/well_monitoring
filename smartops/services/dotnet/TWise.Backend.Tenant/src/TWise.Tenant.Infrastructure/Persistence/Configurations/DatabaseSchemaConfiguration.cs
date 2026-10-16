using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Infrastructure.Persistence.Configurations;

/// <summary>
/// Maps DatabaseSchema entity to [core].[DatabaseSchema] table created by init-tenant-schema.sql.
/// </summary>
public sealed class DatabaseSchemaConfiguration : IEntityTypeConfiguration<DatabaseSchema>
{
    public void Configure(EntityTypeBuilder<DatabaseSchema> builder)
    {
        builder.ToTable("DatabaseSchema", "core");
        builder.HasKey(e => e.Id);

        builder.Property(e => e.Id).HasColumnName("id");
        builder.Property(e => e.ConnectionId).HasColumnName("connection_id");
        builder.Property(e => e.SchemaName).HasColumnName("schema_name").HasMaxLength(128).IsRequired();
        builder.Property(e => e.TableName).HasColumnName("table_name").HasMaxLength(128).IsRequired();
        builder.Property(e => e.ColumnName).HasColumnName("column_name").HasMaxLength(128).IsRequired();
        builder.Property(e => e.DataType).HasColumnName("data_type").HasMaxLength(50).IsRequired();
        builder.Property(e => e.IsNullable).HasColumnName("is_nullable");
        builder.Property(e => e.IsPrimaryKey).HasColumnName("is_primary_key");
        builder.Property(e => e.IsForeignKey).HasColumnName("is_foreign_key");
        builder.Property(e => e.ForeignKeySchema).HasColumnName("foreign_key_schema").HasMaxLength(128);
        builder.Property(e => e.ForeignKeyTable).HasColumnName("foreign_key_table").HasMaxLength(128);
        builder.Property(e => e.ForeignKeyColumn).HasColumnName("foreign_key_column").HasMaxLength(128);
        builder.Property(e => e.MaxLength).HasColumnName("max_length");
        builder.Property(e => e.OrdinalPosition).HasColumnName("ordinal_position");
        builder.Property(e => e.TenantId).HasColumnName("tenant_id");
        builder.Property(e => e.SyncedAt).HasColumnName("synced_at");
        builder.Property(e => e.IsDeleted).HasColumnName("is_deleted");

        builder.HasOne(e => e.Connection)
            .WithMany()
            .HasForeignKey(e => e.ConnectionId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasQueryFilter(e => !e.IsDeleted);
    }
}
