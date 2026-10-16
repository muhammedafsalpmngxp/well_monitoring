using MediatR;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Widgets;

public sealed class UpdateWidgetHandler(IWidgetService svc)
    : IRequestHandler<UpdateWidgetCommand, WidgetDto?>
{
    public Task<WidgetDto?> Handle(UpdateWidgetCommand request, CancellationToken ct)
        => svc.UpdateAsync(request.Id, request.Request, request.UserId, request.IsAdmin, ct);
}
