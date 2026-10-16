using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TWise.Backend.ControlPlane.Domain.Entities;

namespace TWise.Backend.ControlPlane.Infrastructure.Persistence.Configurations;

public sealed class SourceSystemConfiguration : IEntityTypeConfiguration<SourceSystem>
{
    public void Configure(EntityTypeBuilder<SourceSystem> e)
    {
        e.ToTable("SourceSystem", "control");
        e.HasKey(x => x.SourceSystemId);
        e.Property(x => x.SourceSystemId).HasColumnName("source_system_id");
        e.Property(x => x.SourceCode).HasColumnName("source_code").HasMaxLength(20).IsRequired();
        e.Property(x => x.SourceName).HasColumnName("source_name").HasMaxLength(100);
        e.Property(x => x.SourceKind).HasColumnName("source_kind").HasMaxLength(50);
        e.Property(x => x.IsActive).HasColumnName("is_active");
        e.Property(x => x.CreatedAt).HasColumnName("created_at");
        e.Property(x => x.ModifiedAt).HasColumnName("modified_at");
        e.HasIndex(x => x.SourceCode).IsUnique();
    }
}
