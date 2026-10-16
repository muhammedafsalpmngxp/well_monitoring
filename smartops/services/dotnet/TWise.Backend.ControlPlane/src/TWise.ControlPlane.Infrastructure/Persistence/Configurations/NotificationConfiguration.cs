using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TWise.Backend.ControlPlane.Domain.Entities;

namespace TWise.Backend.ControlPlane.Infrastructure.Persistence.Configurations;

public sealed class NotificationConfiguration : IEntityTypeConfiguration<Notification>
{
    public void Configure(EntityTypeBuilder<Notification> e)
    {
        e.ToTable("Notification", "control");
        e.HasKey(x => x.NotificationId);
        e.Property(x => x.NotificationId).HasColumnName("notification_id");
        e.Property(x => x.TenantId).HasColumnName("tenant_id");
        e.Property(x => x.Type).HasColumnName("type").HasMaxLength(50).IsRequired();
        e.Property(x => x.Title).HasColumnName("title").HasMaxLength(200).IsRequired();
        e.Property(x => x.Description).HasColumnName("description").HasMaxLength(1000);
        e.Property(x => x.Route).HasColumnName("route").HasMaxLength(500);
        e.Property(x => x.CreatedAt).HasColumnName("created_at");

        e.HasOne<Domain.Entities.Tenant>().WithMany().HasForeignKey(x => x.TenantId);
        e.HasMany(x => x.Recipients).WithOne(x => x.Notification).HasForeignKey(x => x.NotificationId);
        e.HasIndex(x => new { x.TenantId, x.CreatedAt });
    }
}
