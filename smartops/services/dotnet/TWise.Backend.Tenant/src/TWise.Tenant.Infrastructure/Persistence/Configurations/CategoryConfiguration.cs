using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Infrastructure.Persistence.Configurations;

public class CategoryConfiguration : IEntityTypeConfiguration<Category>
{
    public void Configure(EntityTypeBuilder<Category> builder)
    {
        builder.ToTable("Category", "core");

        builder.HasKey(c => c.CategoryId);

        builder.Property(c => c.CategoryName)
            .HasMaxLength(100)
            .IsRequired();

        builder.Property(c => c.Description)
            .HasMaxLength(500);

        builder.Property(c => c.ControlType)
            .HasMaxLength(50)
            .HasDefaultValue(string.Empty);

        builder.Property(c => c.IsDeleted)
            .HasDefaultValue(false);

        builder.Property(c => c.CreatedAt)
            .HasDefaultValueSql("GETUTCDATE()");

        builder.Property(c => c.ModifiedAt)
            .HasDefaultValueSql("GETUTCDATE()");

        // Scoped by CreatedBy so a category name is only unique per creator (matches the
        // per-user duplicate check/list in CategoryRepository), not tenant-wide.
        builder.HasIndex(c => new { c.CategoryName, c.ControlType, c.CreatedBy })
            .IsUnique()
            .HasFilter("[IsDeleted] = 0")
            .HasDatabaseName("UQ_Category_Name_ControlType");

        builder.HasMany(c => c.Dashboards)
            .WithOne(d => d.Category)
            .HasForeignKey(d => d.CategoryId);

        // Seed default category
        builder.HasData(new Category
        {
            CategoryId = 1,
            CategoryName = "Others",
            Description = "Default category",
            IsDeleted = false,
            CreatedBy = "system",
            ModifiedBy = "system",
            CreatedAt = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc),
            ModifiedAt = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc)
        });
    }
}
