using SmartOps.Shared.Db;

namespace SmartOps.Auth.Domain.Entities;

public class AppRole : AuditableEntity
{
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string Permissions { get; set; } = "[]";   // JSON array of permission strings
}
