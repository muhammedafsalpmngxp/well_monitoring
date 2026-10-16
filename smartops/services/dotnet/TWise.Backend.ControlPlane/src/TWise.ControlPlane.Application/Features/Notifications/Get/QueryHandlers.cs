using MediatR;
using TWise.Backend.ControlPlane.Application.Abstractions.Services;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.Application.Features.Notifications;

public sealed class GetNotificationsHandler(INotificationService notifications)
    : IRequestHandler<GetNotificationsQuery, Result<NotificationsResponse>>
{
    public async Task<Result<NotificationsResponse>> Handle(GetNotificationsQuery request, CancellationToken ct)
    {
        var response = await notifications.GetForUserAsync(request.TenantId, request.UserId, request.Since, ct);
        return Result<NotificationsResponse>.Success(response);
    }
}
