using Microsoft.EntityFrameworkCore;
using SmartOps.Auth.Domain.Entities;
using SmartOps.Shared.Db;

namespace SmartOps.Auth.Infrastructure;

public class AuthDbContext(DbContextOptions<AuthDbContext> options) : DbContext(options)
{
    public DbSet<AppUser> Users => Set<AppUser>();
    public DbSet<AppRole> Roles => Set<AppRole>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<AppUser>(e =>
        {
            e.ToTable("users");
            e.HasIndex(u => u.Email).IsUnique();
            e.Property(u => u.Email).HasMaxLength(255).IsRequired();
            e.Property(u => u.FullName).HasMaxLength(255).IsRequired();
            e.Property(u => u.PasswordHash).HasMaxLength(255).IsRequired();
            e.Property(u => u.Role).HasMaxLength(64);
            e.Property(u => u.AzureObjectId).HasMaxLength(64);
        });

        b.Entity<AppRole>(e =>
        {
            e.ToTable("roles");
            e.HasIndex(r => r.Name).IsUnique();
            e.Property(r => r.Name).HasMaxLength(64).IsRequired();
        });

        b.Entity<AuditLog>(e =>
        {
            e.ToTable("audit_logs");
            e.Property(a => a.Actor).HasMaxLength(255).IsRequired();
            e.Property(a => a.Action).HasMaxLength(128).IsRequired();
            e.HasIndex(a => a.CreatedAt);
        });
    }
}
