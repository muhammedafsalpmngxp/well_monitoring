using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Infrastructure.Persistence.Configurations;

public class ReportTemplateConfiguration : IEntityTypeConfiguration<ReportTemplate>
{
    public void Configure(EntityTypeBuilder<ReportTemplate> builder)
    {
        builder.ToTable("ReportTemplates", "core");

        builder.HasKey(t => t.Id);

        builder.Property(t => t.Id)
            .UseIdentityColumn();

        builder.Property(t => t.TenantId)
            .IsRequired();

        builder.Property(t => t.CreatedBy)
            .IsRequired();

        builder.Property(t => t.SourceName)
            .HasMaxLength(200)
            .IsRequired();

        builder.Property(t => t.CustomName)
            .HasMaxLength(200)
            .IsRequired();

        builder.Property(t => t.SourceType)
            .HasMaxLength(50)
            .IsRequired();

        builder.Property(t => t.TemplateJson)
            .HasColumnType("nvarchar(max)")
            .IsRequired();

        builder.Property(t => t.Type)
            .HasMaxLength(20);

        builder.Property(t => t.IsActive)
            .HasColumnName("Is_Active");

        builder.Property(t => t.ViewId);

        builder.Property(t => t.CreatedAt)
            .HasDefaultValueSql("SYSUTCDATETIME()");

        builder.Property(t => t.UpdatedAt)
            .HasDefaultValueSql("SYSUTCDATETIME()");

        // One saved design per user, per data source, per template type (chart/report), per custom name
        builder.HasIndex(t => new { t.SourceName, t.SourceType, t.Type, t.CreatedBy, t.CustomName })
            .IsUnique();
    }
}
