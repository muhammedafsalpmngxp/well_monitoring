using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TWise.Backend.ControlPlane.Domain.Entities;

namespace TWise.Backend.ControlPlane.Infrastructure.Persistence.Configurations;

public sealed class WidgetLibraryConfiguration : IEntityTypeConfiguration<WidgetLibrary>
{
    public void Configure(EntityTypeBuilder<WidgetLibrary> e)
    {
        e.ToTable("widget_library", "control");
        e.HasKey(x => x.Id);
        e.Property(x => x.Id).HasColumnName("id").UseIdentityColumn();
        e.Property(x => x.WidgetName).HasColumnName("widget_name").HasMaxLength(200).IsRequired();
        e.Property(x => x.Type).HasColumnName("type").HasMaxLength(20).IsRequired();
        e.Property(x => x.Json).HasColumnName("json").HasColumnType("nvarchar(max)");
        e.Property(x => x.CreatedBy).HasColumnName("created_by");
        e.Property(x => x.CreatedAt).HasColumnName("created_at");
        e.Property(x => x.ModifiedBy).HasColumnName("modified_by");
        e.Property(x => x.ModifiedAt).HasColumnName("modified_at");
        e.Property(x => x.IsDeleted).HasColumnName("is_deleted");
        e.Property(x => x.DeletedAt).HasColumnName("deleted_at");
    }
}
