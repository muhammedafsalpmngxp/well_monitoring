using MediatR;
using TWise.Backend.ControlPlane.Application.Abstractions.Services;
using TWise.Backend.ControlPlane.Application.Common;

namespace TWise.Backend.ControlPlane.Application.Features.Notifications;

public sealed class CreateNotificationHandler(INotificationService notifications)
    : IRequestHandler<CreateNotificationCommand, Result<bool>>
{
    public async Task<Result<bool>> Handle(CreateNotificationCommand request, CancellationToken ct)
    {
        var r = request.Request;
        await notifications.CreateAsync(r.TenantId, r.Type, r.Title, r.Description, r.Route, r.RecipientUserIds, r.ModuleCode, ct);
        return Result<bool>.Success(true);
    }
}

public sealed class MarkNotificationAsReadHandler(INotificationService notifications)
    : IRequestHandler<MarkNotificationAsReadCommand, Result<bool>>
{
    public async Task<Result<bool>> Handle(MarkNotificationAsReadCommand request, CancellationToken ct)
    {
        var ok = await notifications.MarkAsReadAsync(request.TenantId, request.UserId, request.NotificationId, ct);
        return Result<bool>.Success(ok);
    }
}

public sealed class MarkAllNotificationsAsReadHandler(INotificationService notifications)
    : IRequestHandler<MarkAllNotificationsAsReadCommand, Result<bool>>
{
    public async Task<Result<bool>> Handle(MarkAllNotificationsAsReadCommand request, CancellationToken ct)
    {
        await notifications.MarkAllAsReadAsync(request.TenantId, request.UserId, ct);
        return Result<bool>.Success(true);
    }
}
