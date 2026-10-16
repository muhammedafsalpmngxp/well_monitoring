using MediatR;
using TWise.Tenant.Application.Abstractions.Services;

namespace TWise.Tenant.Application.Features.Widgets;

public sealed class DeleteWidgetHandler(IWidgetService svc)
    : IRequestHandler<DeleteWidgetCommand, bool>
{
    public Task<bool> Handle(DeleteWidgetCommand request, CancellationToken ct)
        => svc.DeleteAsync(request.Id, request.UserId, ct);
}
