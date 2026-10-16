using MediatR;

namespace TWise.Tenant.Application.Features.Widgets;

public record DeleteWidgetCommand(long Id, long UserId) : IRequest<bool>;
