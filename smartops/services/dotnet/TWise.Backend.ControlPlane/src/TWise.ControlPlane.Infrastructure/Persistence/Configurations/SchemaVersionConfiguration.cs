using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TWise.Backend.ControlPlane.Domain.Entities;

namespace TWise.Backend.ControlPlane.Infrastructure.Persistence.Configurations;

public sealed class SchemaVersionConfiguration : IEntityTypeConfiguration<SchemaVersion>
{
    public void Configure(EntityTypeBuilder<SchemaVersion> e)
    {
        e.ToTable("SchemaVersion", "control");
        e.HasKey(x => x.SchemaVersionId);
        e.Property(x => x.SchemaVersionId).HasColumnName("schema_version_id");
        e.Property(x => x.VersionNo).HasColumnName("version_no").HasMaxLength(20).IsRequired();
        e.Property(x => x.Description).HasColumnName("description").HasMaxLength(200);
        e.Property(x => x.ReleasedAt).HasColumnName("released_at");
        e.Property(x => x.IsCurrent).HasColumnName("is_current");
        e.Property(x => x.IsActive).HasColumnName("is_active");
        e.Property(x => x.CreatedAt).HasColumnName("created_at");
        e.Property(x => x.ModifiedAt).HasColumnName("modified_at");
        e.HasIndex(x => x.VersionNo).IsUnique();
    }
}
