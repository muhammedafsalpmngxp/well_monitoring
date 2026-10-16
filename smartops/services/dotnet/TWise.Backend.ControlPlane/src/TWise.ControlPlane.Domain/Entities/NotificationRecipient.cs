namespace TWise.Backend.ControlPlane.Domain.Entities;

/// <summary>
/// Per-user read/unread state against a Notification. tenant_id is denormalized from
/// Notification so the "unread items for this user" query never needs a join.
/// </summary>
public class NotificationRecipient
{
    public long Id { get; set; }
    public long NotificationId { get; set; }
    public long TenantId { get; set; }
    public string UserId { get; set; } = default!;
    public bool IsRead { get; set; }
    public DateTime? ReadAt { get; set; }
    public DateTime CreatedAt { get; set; }

    public Notification Notification { get; set; } = null!;
}
