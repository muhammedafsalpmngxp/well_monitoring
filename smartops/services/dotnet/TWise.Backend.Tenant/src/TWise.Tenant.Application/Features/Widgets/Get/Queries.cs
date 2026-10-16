using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Widgets;

public record ListWidgetsQuery(string? Status, string? Type, long UserId, bool IsAdmin) : IRequest<IReadOnlyList<WidgetDto>>;
public record GetWidgetByIdQuery(long Id, long UserId) : IRequest<WidgetDto?>;
