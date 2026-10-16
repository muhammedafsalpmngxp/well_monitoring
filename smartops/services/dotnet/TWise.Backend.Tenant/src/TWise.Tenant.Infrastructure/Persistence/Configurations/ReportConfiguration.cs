using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Infrastructure.Persistence.Configurations;

public class ReportConfiguration : IEntityTypeConfiguration<Report>
{
    public void Configure(EntityTypeBuilder<Report> builder)
    {
        builder.ToTable("Reports", "core");

        builder.HasKey(r => r.Id);

        builder.Property(r => r.Id)
            .UseIdentityColumn();

        builder.Property(r => r.ReportName)
            .HasMaxLength(200)
            .IsRequired();

        builder.Property(r => r.Description)
            .HasMaxLength(500)
            .IsRequired(false);

        builder.Property(r => r.SourceName)
            .HasMaxLength(200)
            .IsRequired();

        builder.Property(r => r.SourceType)
            .HasMaxLength(20)
            .IsRequired();

        builder.Property(r => r.ReportJson)
            .HasColumnType("nvarchar(max)");

        builder.Property(r => r.Status)
            .HasMaxLength(20)
            .IsRequired()
            .HasDefaultValue("draft");

        builder.Property(r => r.PublishedOn)
            .IsRequired(false);

        builder.Property(r => r.IsDeleted)
            .HasDefaultValue(false);

        builder.Property(r => r.CreatedAt)
            .HasDefaultValueSql("GETUTCDATE()");

        builder.Property(r => r.UpdatedAt)
            .HasDefaultValueSql("GETUTCDATE()");

        builder.Property(r => r.TenantId)
            .IsRequired();

        // FK → core.Category (required — report must belong to a category; restrict delete)
        builder.HasOne(r => r.Category)
            .WithMany(c => c.Reports)
            .HasForeignKey(r => r.CategoryId)
            .OnDelete(DeleteBehavior.Restrict)
            .IsRequired(true);

        // Unique index: per-user uniqueness on ReportName + SourceName (excludes soft-deleted)
        // Different users CAN create reports with the same name+source; same user cannot.
        builder.HasIndex(r => new { r.ReportName, r.SourceName, r.CreatedBy })
            .IsUnique()
            .HasFilter("[IsDeleted] = 0");

        // Soft-delete filter — GET APIs will never return deleted records
        builder.HasQueryFilter(r => !r.IsDeleted);
    }
}
