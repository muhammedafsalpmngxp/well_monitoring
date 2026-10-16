using MediatR;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Widgets;

public sealed class ListWidgetsHandler(IWidgetService svc)
    : IRequestHandler<ListWidgetsQuery, IReadOnlyList<WidgetDto>>
{
    public Task<IReadOnlyList<WidgetDto>> Handle(ListWidgetsQuery request, CancellationToken ct)
        => svc.GetAllAsync(request.Status, request.Type, request.UserId, request.IsAdmin, ct);
}

public sealed class GetWidgetByIdHandler(IWidgetService svc)
    : IRequestHandler<GetWidgetByIdQuery, WidgetDto?>
{
    public Task<WidgetDto?> Handle(GetWidgetByIdQuery request, CancellationToken ct)
        => svc.GetByIdAsync(request.Id, request.UserId, ct);
}
