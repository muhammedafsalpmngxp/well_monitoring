namespace TWise.Backend.ControlPlane.Domain.Entities;

public class AuditEvent : ISoftDeletable
{
    public long AuditEventId { get; set; }
    public long? TenantId { get; set; }
    public long? UserId { get; set; }
    public string? Action { get; set; }
    public string? Entity { get; set; }
    public string? Detail { get; set; }
    public DateTime? OccurredAt { get; set; }
    public DateTime CreatedAt { get; set; }
    public bool IsDeleted { get; set; }
    public DateTime? DeletedAt { get; set; }
}
