namespace TWise.Tenant.Application.Abstractions.Services;

/// <summary>
/// Publishes notifications into the centralized ControlPlane store (control.Notification/
/// NotificationRecipient) via its internal ingest endpoint — used for events that originate in
/// this Tenant DB (Data Share, Data Quality) but must show up in the same navbar bell as
/// ControlPlane-native events (access/role change). Implementations must never let a ControlPlane
/// outage break the underlying tenant operation (dashboard share / rule execution) — swallow and
/// log failures instead of throwing.
/// </summary>
public interface IControlPlaneNotificationClient
{
    /// <summary>
    /// Either <paramref name="recipientUserIds"/> is non-empty (specific recipients, e.g.
    /// dashboard-share) OR <paramref name="moduleCode"/> is set (broadcast — ControlPlane resolves
    /// every user in this tenant with CanView on that module).
    /// </summary>
    Task PublishAsync(long tenantId, string type, string title, string? description, string? route,
        IReadOnlyList<long> recipientUserIds, string? moduleCode, CancellationToken ct);
}
