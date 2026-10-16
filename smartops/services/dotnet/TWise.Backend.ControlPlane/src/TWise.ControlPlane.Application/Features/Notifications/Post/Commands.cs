using MediatR;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.Application.Features.Notifications;

/// <summary>Direct write (used by ControlPlane-native events, e.g. role/permission change).</summary>
public record CreateNotificationCommand(CreateNotificationRequest Request) : IRequest<Result<bool>>;

public record MarkNotificationAsReadCommand(long TenantId, long UserId, long NotificationId) : IRequest<Result<bool>>;

public record MarkAllNotificationsAsReadCommand(long TenantId, long UserId) : IRequest<Result<bool>>;
