using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TWise.Backend.ControlPlane.Domain.Entities;

namespace TWise.Backend.ControlPlane.Infrastructure.Persistence.Configurations;

public sealed class UserSessionConfiguration : IEntityTypeConfiguration<UserSession>
{
    public void Configure(EntityTypeBuilder<UserSession> entity)
    {
        entity.ToTable("UserSession", "control");
        entity.HasKey(session => session.SessionId);
        entity.Property(session => session.SessionId).HasColumnName("session_id").ValueGeneratedNever();
        entity.Property(session => session.UserId).HasColumnName("user_id");
        entity.Property(session => session.CreatedAt).HasColumnName("created_at");
        entity.Property(session => session.RevokedAt).HasColumnName("revoked_at");
        entity.HasOne(session => session.User).WithMany().HasForeignKey(session => session.UserId)
            .OnDelete(DeleteBehavior.Restrict);
        entity.HasIndex(session => session.UserId).HasDatabaseName("IX_UserSession_UserId");
    }
}