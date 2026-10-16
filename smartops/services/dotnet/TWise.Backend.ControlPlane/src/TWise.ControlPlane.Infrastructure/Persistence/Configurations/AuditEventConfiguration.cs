using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TWise.Backend.ControlPlane.Domain.Entities;

namespace TWise.Backend.ControlPlane.Infrastructure.Persistence.Configurations;

public sealed class AuditEventConfiguration : IEntityTypeConfiguration<AuditEvent>
{
    public void Configure(EntityTypeBuilder<AuditEvent> e)
    {
        e.ToTable("AuditEvent", "control");
        e.HasKey(x => x.AuditEventId);
        e.Property(x => x.AuditEventId).HasColumnName("audit_event_id");
        e.Property(x => x.TenantId).HasColumnName("tenant_id");
        e.Property(x => x.UserId).HasColumnName("user_id");
        e.Property(x => x.Action).HasColumnName("action").HasMaxLength(80);
        e.Property(x => x.Entity).HasColumnName("entity").HasMaxLength(80);
        e.Property(x => x.Detail).HasColumnName("detail");
        e.Property(x => x.OccurredAt).HasColumnName("occurred_at");
        e.Property(x => x.CreatedAt).HasColumnName("created_at");
        e.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId);
        e.HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId);
    }
}
