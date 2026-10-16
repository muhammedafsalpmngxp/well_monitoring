using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TWise.Backend.ControlPlane.Domain.Entities;

namespace TWise.Backend.ControlPlane.Infrastructure.Persistence.Configurations;

public sealed class AppUserConfiguration : IEntityTypeConfiguration<AppUser>
{
    public void Configure(EntityTypeBuilder<AppUser> e)
    {
        e.ToTable("AppUser", "control");
        e.HasKey(x => x.UserId);
        e.Property(x => x.UserId).HasColumnName("user_id");
        e.Property(x => x.Email).HasColumnName("email").HasMaxLength(160).IsRequired();
        e.Property(x => x.DisplayName).HasColumnName("display_name").HasMaxLength(100);
        e.Property(x => x.EmployeeId).HasColumnName("employee_id").HasMaxLength(50).IsRequired(false);
        e.Property(x => x.IsSso).HasColumnName("is_sso");
        e.Property(x => x.Status).HasColumnName("status").HasMaxLength(20);
        e.Property(x => x.IsActive).HasColumnName("is_active");
        e.Property(x => x.PasswordHash).HasColumnName("password_hash").HasMaxLength(200).IsRequired(false);
        e.Property(x => x.LastLoginAt).HasColumnName("last_login_at").IsRequired(false);
        e.Property(x => x.CreatedAt).HasColumnName("created_at");
        e.Property(x => x.ModifiedAt).HasColumnName("modified_at");
        e.HasIndex(x => x.Email).IsUnique()
            .HasDatabaseName("UX_AppUser_Email_NotDeleted")
            .HasFilter("[IsDeleted] = 0");
    }
}
