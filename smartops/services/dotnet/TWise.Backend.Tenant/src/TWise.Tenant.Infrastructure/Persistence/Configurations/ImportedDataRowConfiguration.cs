using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Infrastructure.Persistence.Configurations;

public sealed class ImportedDataRowConfiguration : IEntityTypeConfiguration<ImportedDataRow>
{
    public void Configure(EntityTypeBuilder<ImportedDataRow> builder)
    {
        builder.ToTable("ImportedDataRows", "core");
        builder.HasKey(e => e.Id);

        builder.Property(e => e.Id).HasColumnName("id");
        builder.Property(e => e.DatasetId).HasColumnName("dataset_id");
        builder.Property(e => e.RowIndex).HasColumnName("row_index");
        builder.Property(e => e.DataJson).HasColumnName("data_json").HasColumnType("nvarchar(max)").IsRequired();
        builder.Property(e => e.CreatedAt).HasColumnName("created_at");

        builder.HasOne<ImportedDataset>()
            .WithMany()
            .HasForeignKey(e => e.DatasetId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasIndex(e => new { e.DatasetId, e.RowIndex })
            .HasDatabaseName("IX_core_ImportedDataRows_dataset");
    }
}
