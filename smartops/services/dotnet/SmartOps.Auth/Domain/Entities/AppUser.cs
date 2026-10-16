using SmartOps.Shared.Db;

namespace SmartOps.Auth.Domain.Entities;

public class AppUser : AuditableEntity
{
    public string Email { get; set; } = string.Empty;
    public string FullName { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty;
    public string Role { get; set; } = "viewer";
    public bool IsActive { get; set; } = true;
    public string? AzureObjectId { get; set; }   // populated when SSO via Entra
    public DateTime? LastLoginAt { get; set; }
}
