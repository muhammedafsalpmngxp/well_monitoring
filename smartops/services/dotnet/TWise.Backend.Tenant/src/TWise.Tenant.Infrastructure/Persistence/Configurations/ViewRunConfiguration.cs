using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Infrastructure.Persistence.Configurations;

public sealed class ViewRunConfiguration : IEntityTypeConfiguration<ViewRun>
{
    /// <summary>Longest error kept; longer messages are cut (the column width).</summary>
    public const int ErrorLength = 2000;

    public void Configure(EntityTypeBuilder<ViewRun> b)
    {
        b.ToTable("ViewRunLog", "core");
        b.HasKey(e => e.Id);
        b.Property(e => e.Id).HasColumnName("id");
        b.Property(e => e.ViewId).HasColumnName("view_id");
        b.Property(e => e.SourceName).HasColumnName("source_name").HasMaxLength(256).IsRequired();
        b.Property(e => e.SourceType).HasColumnName("source_type").HasMaxLength(30).IsRequired();
        b.Property(e => e.Caller).HasColumnName("caller").HasMaxLength(20).IsRequired();
        b.Property(e => e.DurationMs).HasColumnName("duration_ms");
        b.Property(e => e.RowCount).HasColumnName("row_count");
        b.Property(e => e.Error).HasColumnName("error").HasMaxLength(ErrorLength);
        b.Property(e => e.Sql).HasColumnName("sql");
        b.Property(e => e.UserId).HasColumnName("user_id");
        b.Property(e => e.CreatedAt).HasColumnName("created_at");
    }
}
