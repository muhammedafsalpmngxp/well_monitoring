using MediatR;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Widgets;

public sealed class CreateWidgetHandler(IWidgetService svc)
    : IRequestHandler<CreateWidgetCommand, WidgetDto>
{
    public Task<WidgetDto> Handle(CreateWidgetCommand request, CancellationToken ct)
        => svc.CreateAsync(request.Request, request.UserId, request.TenantId, ct);
}

public sealed class CopyWidgetToDraftHandler(IWidgetService svc)
    : IRequestHandler<CopyWidgetToDraftCommand, WidgetDto?>
{
    public Task<WidgetDto?> Handle(CopyWidgetToDraftCommand request, CancellationToken ct)
        => svc.CopyToDraftAsync(request.Id, request.UserId, request.IsAdmin, request.TenantId, ct);
}
