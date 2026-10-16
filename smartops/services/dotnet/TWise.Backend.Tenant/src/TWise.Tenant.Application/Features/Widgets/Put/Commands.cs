using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Widgets;

public record UpdateWidgetCommand(long Id, UpdateWidgetRequest Request, long UserId, bool IsAdmin) : IRequest<WidgetDto?>;
