using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Infrastructure.Persistence.Configurations;

public sealed class DataDictionaryEntryConfiguration : IEntityTypeConfiguration<DataDictionaryEntry>
{
    public void Configure(EntityTypeBuilder<DataDictionaryEntry> builder)
    {
        builder.ToTable("DataDictionary", "core");
        builder.HasKey(e => e.Id);

        builder.Property(e => e.Id).HasColumnName("id");
        builder.Property(e => e.DatasetKind).HasColumnName("dataset_kind").HasMaxLength(20).IsRequired();
        builder.Property(e => e.DatasetId).HasColumnName("dataset_id");
        builder.Property(e => e.ColumnName).HasColumnName("column_name").HasMaxLength(200);
        builder.Property(e => e.BusinessName).HasColumnName("business_name").HasMaxLength(200);
        builder.Property(e => e.Description).HasColumnName("description").HasMaxLength(2000);
        builder.Property(e => e.Owner).HasColumnName("owner").HasMaxLength(200);
        builder.Property(e => e.Sensitivity).HasColumnName("sensitivity").HasMaxLength(20).IsRequired();
        builder.Property(e => e.Tags).HasColumnName("tags").HasMaxLength(500);
        builder.Property(e => e.TenantId).HasColumnName("tenant_id");
        builder.Property(e => e.CreatedBy).HasColumnName("created_by");
        builder.Property(e => e.CreatedAt).HasColumnName("created_at");
        builder.Property(e => e.ModifiedBy).HasColumnName("modified_by");
        builder.Property(e => e.ModifiedAt).HasColumnName("modified_at");
        builder.Property(e => e.IsDeleted).HasColumnName("is_deleted");

        builder.HasQueryFilter(e => !e.IsDeleted);
    }
}
