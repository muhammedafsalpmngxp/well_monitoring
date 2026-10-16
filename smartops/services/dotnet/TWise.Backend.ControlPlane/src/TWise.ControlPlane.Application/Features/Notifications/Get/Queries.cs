using MediatR;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.Application.Features.Notifications;

/// <summary>
/// Single navbar-bell poll for this service — reads real persisted read/unread state from
/// control.Notification/NotificationRecipient (INotificationService).
/// </summary>
public record GetNotificationsQuery(long UserId, long TenantId, DateTime Since) : IRequest<Result<NotificationsResponse>>;
