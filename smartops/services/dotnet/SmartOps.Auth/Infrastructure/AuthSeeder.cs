using System.Text.Json;
using SmartOps.Auth.Domain.Entities;

namespace SmartOps.Auth.Infrastructure;

public static class AuthSeeder
{
    public static async Task SeedAsync(AuthDbContext db)
    {
        await db.Database.EnsureCreatedAsync();

        if (!db.Roles.Any())
        {
            db.Roles.AddRange(
                new AppRole { Name = "admin",   Description = "Full access",
                              Permissions = JsonSerializer.Serialize(new[] { "*" }) },
                new AppRole { Name = "manager", Description = "Operations manager",
                              Permissions = JsonSerializer.Serialize(new[] {
                                  "wells.*", "finance.read", "workflow.*", "reports.*" }) },
                new AppRole { Name = "viewer",  Description = "Read-only dashboards",
                              Permissions = JsonSerializer.Serialize(new[] {
                                  "wells.read", "finance.read", "reports.read", "alerts.read" }) }
            );
        }

        if (!db.Users.Any())
        {
            db.Users.AddRange(
                new AppUser
                {
                    Email = "admin@smartops.local",
                    FullName = "System Administrator",
                    PasswordHash = BCrypt.Net.BCrypt.HashPassword("admin"),
                    Role = "admin"
                },
                new AppUser
                {
                    Email = "khalid.albalushi@smartops.local",
                    FullName = "Khalid Al-Balushi",
                    PasswordHash = BCrypt.Net.BCrypt.HashPassword("password"),
                    Role = "manager"
                },
                new AppUser
                {
                    Email = "viewer@smartops.local",
                    FullName = "Read Only User",
                    PasswordHash = BCrypt.Net.BCrypt.HashPassword("password"),
                    Role = "viewer"
                }
            );
        }

        await db.SaveChangesAsync();
    }
}
