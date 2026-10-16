using SmartOps.Shared.Db;

namespace SmartOps.Auth.Domain.Entities;

public class AuditLog : AuditableEntity
{
    public string Actor { get; set; } = string.Empty;     // email
    public string Action { get; set; } = string.Empty;     // login / role-change / etc.
    public string? Resource { get; set; }
    public string? Details { get; set; }
}
