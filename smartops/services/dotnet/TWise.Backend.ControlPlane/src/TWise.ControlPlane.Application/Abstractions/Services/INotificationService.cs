using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.Application.Abstractions.Services;

/// <summary>
/// Centralized notification store (control.Notification/NotificationRecipient) — the single
/// place ALL notification types (Data Share, Data Quality, Access/Role change, ...) are written
/// to and read from, regardless of which service/DB the underlying event originated in.
/// </summary>
public interface INotificationService
{
    /// <summary>
    /// Persists one notification event + one recipient row per user. If
    /// <paramref name="recipientUserIds"/> is empty and <paramref name="moduleCode"/> is set,
    /// recipients are resolved as every active user in <paramref name="tenantId"/> whose role has
    /// CanView on that module (broadcast-by-permission).
    /// </summary>
    Task CreateAsync(long tenantId, string type, string title, string? description, string? route,
        IReadOnlyList<long> recipientUserIds, string? moduleCode, CancellationToken ct);

    Task<NotificationsResponse> GetForUserAsync(long tenantId, long userId, DateTime since, CancellationToken ct);

    /// <summary>Marks a single notification as read for this user. Returns false if not found/not theirs.</summary>
    Task<bool> MarkAsReadAsync(long tenantId, long userId, long notificationId, CancellationToken ct);

    Task MarkAllAsReadAsync(long tenantId, long userId, CancellationToken ct);
}
