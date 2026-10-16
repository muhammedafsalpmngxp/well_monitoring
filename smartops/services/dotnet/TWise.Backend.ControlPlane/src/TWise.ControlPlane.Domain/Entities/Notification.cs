namespace TWise.Backend.ControlPlane.Domain.Entities;

/// <summary>
/// A single notification event, persisted centrally in ControlPlane regardless of which
/// service/DB (Tenant or ControlPlane) the underlying event originated in.
/// </summary>
public class Notification
{
    public long NotificationId { get; set; }
    public long TenantId { get; set; }
    public string Type { get; set; } = default!;
    public string Title { get; set; } = default!;
    public string? Description { get; set; }
    public string? Route { get; set; }
    public DateTime CreatedAt { get; set; }

    public List<NotificationRecipient> Recipients { get; set; } = [];
}
