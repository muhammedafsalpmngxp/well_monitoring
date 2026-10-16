using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Infrastructure.Persistence.Configurations;

public sealed class DatabaseViewConfiguration : IEntityTypeConfiguration<DatabaseView>
{
    private const string NvarcharMax = "nvarchar(max)";

    public void Configure(EntityTypeBuilder<DatabaseView> builder)
    {
        builder.ToTable("DatabaseViews", "core");
        builder.HasKey(e => e.Id);

        builder.Property(e => e.Id).HasColumnName("id");
        builder.Property(e => e.ConnectionId).HasColumnName("connection_id");
        builder.Property(e => e.ViewName).HasColumnName("view_name").HasMaxLength(128).IsRequired();
        builder.Property(e => e.Description).HasColumnName("description").HasMaxLength(500);
        builder.Property(e => e.IsDistinct).HasColumnName("is_distinct");
        builder.Property(e => e.TablesJson).HasColumnName("tables_json").HasColumnType(NvarcharMax).IsRequired();
        builder.Property(e => e.JoinsJson).HasColumnName("joins_json").HasColumnType(NvarcharMax).IsRequired();
        builder.Property(e => e.SelectedColumnsJson).HasColumnName("selected_columns_json").HasColumnType(NvarcharMax).IsRequired();
        builder.Property(e => e.ColumnAliasesJson).HasColumnName("column_aliases_json").HasColumnType(NvarcharMax);
        builder.Property(e => e.FiltersJson).HasColumnName("filters_json").HasColumnType(NvarcharMax);
        builder.Property(e => e.GeneratedSql).HasColumnName("generated_sql").HasColumnType(NvarcharMax).IsRequired();
        builder.Property(e => e.ManualSql).HasColumnName("manual_sql").HasColumnType(NvarcharMax);
        builder.Property(e => e.PreviewDataJson).HasColumnName("preview_data_json").HasColumnType(NvarcharMax);
        builder.Property(e => e.PreviewColumnsJson).HasColumnName("preview_columns_json").HasColumnType(NvarcharMax);
        builder.Property(e => e.PreviewRowCount).HasColumnName("preview_row_count");
        builder.Property(e => e.PreviewExecutedAt).HasColumnName("preview_executed_at");
        builder.Property(e => e.TablesUsed).HasColumnName("tables_used").HasColumnType(NvarcharMax).IsRequired();
        builder.Property(e => e.ColumnsUsed).HasColumnName("columns_used").HasColumnType(NvarcharMax);
        builder.Property(e => e.ColumnCount).HasColumnName("column_count");
        builder.Property(e => e.RowCount).HasColumnName("row_count");
        // Matches the decimal(5,2) column. Without explicit precision EF assumes its
        // decimal(18,2) default and warns that values will be silently truncated.
        builder.Property(e => e.Reliability).HasColumnName("reliability").HasPrecision(5, 2);
        builder.Property(e => e.SourceType).HasColumnName("source_type").HasMaxLength(20).IsRequired();
        builder.Property(e => e.ViewType).HasColumnName("view_type").HasMaxLength(20).IsRequired().HasDefaultValue("view");
        builder.Property(e => e.ReferencedCteIdsJson).HasColumnName("referenced_cte_ids_json").HasColumnType(NvarcharMax);
        builder.Property(e => e.ReferencedComponentIdsJson).HasColumnName("referenced_component_ids_json").HasColumnType(NvarcharMax);
        builder.Property(e => e.TenantId).HasColumnName("tenant_id");
        builder.Property(e => e.CreatedBy).HasColumnName("created_by");
        builder.Property(e => e.CreatedAt).HasColumnName("created_at");
        builder.Property(e => e.ModifiedBy).HasColumnName("modified_by");
        builder.Property(e => e.ModifiedAt).HasColumnName("modified_at");
        builder.Property(e => e.IsDeleted).HasColumnName("is_deleted");

        builder.HasOne(e => e.Connection)
            .WithMany()
            .HasForeignKey(e => e.ConnectionId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasQueryFilter(e => !e.IsDeleted);

        // Enforce uniqueness on (tenant_id, view_name) for non-deleted rows.
        // This prevents duplicate view names under concurrency at the DB level.
        builder.HasIndex(e => new { e.TenantId, e.ViewName })
            .IsUnique()
            .HasFilter("[is_deleted] = 0")
            .HasDatabaseName("IX_DatabaseViews_TenantId_ViewName");
    }
}
