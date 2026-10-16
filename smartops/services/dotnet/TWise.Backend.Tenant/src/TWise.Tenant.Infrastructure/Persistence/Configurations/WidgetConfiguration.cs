using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Infrastructure.Persistence.Configurations;

public sealed class WidgetConfiguration : IEntityTypeConfiguration<Widget>
{
    public void Configure(EntityTypeBuilder<Widget> b)
    {
        b.ToTable("Widgets", "core");
        b.HasKey(w => w.Id);
        b.Property(w => w.Id).UseIdentityColumn();

        b.Property(w => w.Name).HasMaxLength(200).IsRequired();
        b.Property(w => w.Description).HasMaxLength(1000);
        b.Property(w => w.Type).HasMaxLength(20).IsRequired();
        b.Property(w => w.Source).HasMaxLength(200).IsRequired();
        b.Property(w => w.SourceType).HasMaxLength(20).IsRequired();
        b.Property(w => w.SourceId).IsRequired(false);
        b.Property(w => w.Status).HasMaxLength(20).IsRequired().HasDefaultValue("draft");
        b.Property(w => w.DesignJson).HasColumnType("nvarchar(max)");

        b.Property(w => w.ModifiedOn).HasColumnName("ModifiedOn");

        b.HasOne(w => w.Category)
            .WithMany()
            .HasForeignKey(w => w.CategoryId)
            .OnDelete(DeleteBehavior.SetNull);

        b.HasQueryFilter(w => !w.IsDeleted);
    }
}
