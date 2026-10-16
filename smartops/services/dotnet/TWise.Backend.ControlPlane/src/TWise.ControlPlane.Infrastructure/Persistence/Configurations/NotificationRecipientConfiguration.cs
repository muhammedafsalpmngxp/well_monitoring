using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TWise.Backend.ControlPlane.Domain.Entities;

namespace TWise.Backend.ControlPlane.Infrastructure.Persistence.Configurations;

public sealed class NotificationRecipientConfiguration : IEntityTypeConfiguration<NotificationRecipient>
{
    public void Configure(EntityTypeBuilder<NotificationRecipient> e)
    {
        e.ToTable("NotificationRecipient", "control");
        e.HasKey(x => x.Id);
        e.Property(x => x.Id).HasColumnName("id");
        e.Property(x => x.NotificationId).HasColumnName("notification_id");
        e.Property(x => x.TenantId).HasColumnName("tenant_id");
        e.Property(x => x.UserId).HasColumnName("user_id").HasMaxLength(128).IsRequired();
        e.Property(x => x.IsRead).HasColumnName("is_read");
        e.Property(x => x.ReadAt).HasColumnName("read_at");
        e.Property(x => x.CreatedAt).HasColumnName("created_at");

        e.HasOne<Domain.Entities.Tenant>().WithMany().HasForeignKey(x => x.TenantId);
        e.HasIndex(x => new { x.NotificationId, x.UserId }).IsUnique();
        e.HasIndex(x => new { x.TenantId, x.UserId, x.IsRead });
    }
}
