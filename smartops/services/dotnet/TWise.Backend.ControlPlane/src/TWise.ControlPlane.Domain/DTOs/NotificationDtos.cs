namespace TWise.Backend.ControlPlane.Domain.DTOs;

/// <summary>One persisted navbar-bell entry read from control.Notification/NotificationRecipient.</summary>
public record NotificationEntry(long Id, string Type, string Title, string? Description, DateTime CreatedAt, bool IsRead, string? Route = null);

/// <summary>Aggregated navbar-bell poll result, backed by the real per-user read/unread state.</summary>
public record NotificationsResponse(int UnreadCount, IReadOnlyList<NotificationEntry> Items);

/// <summary>
/// Request body for creating a notification — used by both direct (same-service) writes and the
/// internal cross-service ingest endpoint. Either RecipientUserIds is non-empty (specific
/// recipients, e.g. dashboard-share), OR ModuleCode is set (broadcast — ControlPlane resolves
/// every user in TenantId whose role has CanView on that module, since only ControlPlane owns
/// RoleModulePermissions/UserTenantRole).
/// </summary>
public record CreateNotificationRequest(long TenantId, string Type, string Title, string? Description, string? Route,
    IReadOnlyList<long> RecipientUserIds, string? ModuleCode = null);
