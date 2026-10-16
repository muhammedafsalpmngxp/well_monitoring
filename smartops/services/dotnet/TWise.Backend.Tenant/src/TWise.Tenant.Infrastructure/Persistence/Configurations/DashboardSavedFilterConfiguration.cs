using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Infrastructure.Persistence.Configurations;

public class DashboardSavedFilterConfiguration : IEntityTypeConfiguration<DashboardSavedFilter>
{
    public void Configure(EntityTypeBuilder<DashboardSavedFilter> builder)
    {
        builder.ToTable("DashboardSavedFilter", "core");

        builder.HasKey(f => f.Id);

        builder.Property(f => f.Id)
            .UseIdentityColumn();

        builder.Property(f => f.TenantId)
            .IsRequired();

        builder.Property(f => f.DashboardId)
            .IsRequired();

        builder.Property(f => f.UserId)
            .IsRequired();

        builder.Property(f => f.FilterName)
            .HasMaxLength(120)
            .IsRequired();

        builder.Property(f => f.Country).HasMaxLength(100);
        builder.Property(f => f.Sector).HasMaxLength(100);
        builder.Property(f => f.BusinessUnit).HasMaxLength(100);
        builder.Property(f => f.Division).HasMaxLength(100);
        builder.Property(f => f.Cluster).HasMaxLength(100);
        builder.Property(f => f.Plant).HasMaxLength(100);
        builder.Property(f => f.QuickRange).HasMaxLength(30);

        builder.Property(f => f.FromDate).HasColumnType("date");
        builder.Property(f => f.ToDate).HasColumnType("date");

        builder.Property(f => f.CreatedOn)
            .HasDefaultValueSql("SYSUTCDATETIME()");

        builder.Property(f => f.UpdatedOn)
            .HasDefaultValueSql("SYSUTCDATETIME()");

        builder.Property(f => f.IsFavorite)
            .HasDefaultValue(false);

        builder.Property(f => f.IsDeleted)
            .HasDefaultValue(false);

        builder.HasQueryFilter(f => !f.IsDeleted);

        // Same filter name for the same user+dashboard is an overwrite (upsert), not a new row.
        builder.HasIndex(f => new { f.TenantId, f.DashboardId, f.UserId, f.FilterName })
            .IsUnique();

        builder.HasOne(f => f.Dashboard)
            .WithMany()
            .HasForeignKey(f => f.DashboardId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
