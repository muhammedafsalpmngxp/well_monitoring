using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Infrastructure.Persistence.Configurations;

public sealed class ReportVersionConfiguration : IEntityTypeConfiguration<ReportVersion>
{
    public void Configure(EntityTypeBuilder<ReportVersion> builder)
    {
        builder.ToTable("ReportVersions", "core");
        builder.HasKey(e => e.Id);

        builder.Property(e => e.Id).HasColumnName("id");
        builder.Property(e => e.ReportId).HasColumnName("report_id");
        builder.Property(e => e.VersionNo).HasColumnName("version_no");
        builder.Property(e => e.ReportName).HasColumnName("report_name").HasMaxLength(200).IsRequired();
        builder.Property(e => e.Description).HasColumnName("description").HasMaxLength(1000);
        builder.Property(e => e.CategoryId).HasColumnName("category_id");
        builder.Property(e => e.SourceName).HasColumnName("source_name").HasMaxLength(200).IsRequired();
        builder.Property(e => e.SourceType).HasColumnName("source_type").HasMaxLength(20).IsRequired();
        builder.Property(e => e.ReportJson).HasColumnName("report_json").HasColumnType("nvarchar(max)");
        builder.Property(e => e.Reason).HasColumnName("reason").HasMaxLength(20).IsRequired();
        builder.Property(e => e.RestoredFromVersionNo).HasColumnName("restored_from_version_no");
        builder.Property(e => e.PublishedBy).HasColumnName("published_by");
        builder.Property(e => e.PublishedAt).HasColumnName("published_at");
        builder.Property(e => e.TenantId).HasColumnName("tenant_id");

        // Snapshots are immutable and must survive a soft-deleted report, so there is
        // deliberately no query filter and no cascade from Reports.
        builder.HasIndex(e => new { e.ReportId, e.VersionNo })
            .IsUnique()
            .HasDatabaseName("UX_core_ReportVersions_report_version");

        builder.HasIndex(e => new { e.TenantId, e.ReportId })
            .HasDatabaseName("IX_core_ReportVersions_tenant_report");
    }
}
