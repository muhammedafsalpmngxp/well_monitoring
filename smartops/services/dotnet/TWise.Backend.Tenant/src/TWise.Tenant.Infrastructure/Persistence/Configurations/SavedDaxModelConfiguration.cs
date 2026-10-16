using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Infrastructure.Persistence.Configurations;

public sealed class SavedDaxModelConfiguration : IEntityTypeConfiguration<SavedDaxModel>
{
    public void Configure(EntityTypeBuilder<SavedDaxModel> builder)
    {
        builder.ToTable("DaxModels", "core");
        builder.HasKey(e => e.Id);

        builder.Property(e => e.Id).HasColumnName("id");
        builder.Property(e => e.Name).HasColumnName("name").HasMaxLength(128).IsRequired();
        builder.Property(e => e.SourceType).HasColumnName("source_type").HasMaxLength(10).IsRequired();
        builder.Property(e => e.DataSource).HasColumnName("data_source").HasMaxLength(256).IsRequired();
        builder.Property(e => e.CalculatedBy).HasColumnName("calculated_by").HasMaxLength(10).IsRequired();
        builder.Property(e => e.Operation).HasColumnName("operation").HasMaxLength(64);
        builder.Property(e => e.ColumnsJson).HasColumnName("columns_json");
        builder.Property(e => e.Expression).HasColumnName("expression").HasMaxLength(4000).IsRequired();
        builder.Property(e => e.Status).HasColumnName("status").HasMaxLength(10).IsRequired();
        builder.Property(e => e.CreatedBy).HasColumnName("created_by");
        builder.Property(e => e.IsDeleted).HasColumnName("is_deleted");
        builder.Property(e => e.CreatedAt).HasColumnName("created_at");
        builder.Property(e => e.ModifiedAt).HasColumnName("modified_at");

        builder.HasQueryFilter(e => !e.IsDeleted);
    }
}
