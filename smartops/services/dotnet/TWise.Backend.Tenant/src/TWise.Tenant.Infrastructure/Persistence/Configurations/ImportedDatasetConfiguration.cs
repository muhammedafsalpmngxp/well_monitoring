using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Infrastructure.Persistence.Configurations;

public sealed class ImportedDatasetConfiguration : IEntityTypeConfiguration<ImportedDataset>
{
    public void Configure(EntityTypeBuilder<ImportedDataset> builder)
    {
        builder.ToTable("ImportedDatasets", "core");
        builder.HasKey(e => e.Id);

        builder.Property(e => e.Id).HasColumnName("id");
        builder.Property(e => e.DatasetName).HasColumnName("dataset_name").HasMaxLength(200).IsRequired();
        builder.Property(e => e.FileName).HasColumnName("file_name").HasMaxLength(255).IsRequired();
        builder.Property(e => e.FileType).HasColumnName("file_type").HasMaxLength(20).IsRequired();
        builder.Property(e => e.ColumnsJson).HasColumnName("columns_json").HasColumnType("nvarchar(max)").IsRequired();
        builder.Property(e => e.RowCount).HasColumnName("row_count");
        builder.Property(e => e.Status).HasColumnName("status").HasMaxLength(20).IsRequired();
        builder.Property(e => e.ErrorMessage).HasColumnName("error_message").HasMaxLength(500);
        builder.Property(e => e.DataSourceConnectionId).HasColumnName("data_source_connection_id");
        builder.Property(e => e.SourceObjectRef).HasColumnName("source_object_ref").HasMaxLength(500);
        builder.Property(e => e.LastRefreshedAt).HasColumnName("last_refreshed_at");
        builder.Property(e => e.LastRefreshStatus).HasColumnName("last_refresh_status").HasMaxLength(20);
        builder.Property(e => e.LastRefreshJobCode).HasColumnName("last_refresh_job_code").HasMaxLength(30);
        builder.Property(e => e.TenantId).HasColumnName("tenant_id");
        builder.Property(e => e.CreatedBy).HasColumnName("created_by");
        builder.Property(e => e.CreatedAt).HasColumnName("created_at");
        builder.Property(e => e.ModifiedBy).HasColumnName("modified_by");
        builder.Property(e => e.ModifiedAt).HasColumnName("modified_at");
        builder.Property(e => e.IsDeleted).HasColumnName("is_deleted");

        builder.HasQueryFilter(e => !e.IsDeleted);

        builder.HasIndex(e => new { e.TenantId, e.CreatedBy })
            .HasFilter("[is_deleted] = 0")
            .HasDatabaseName("IX_core_ImportedDatasets_tenant");
    }
}
