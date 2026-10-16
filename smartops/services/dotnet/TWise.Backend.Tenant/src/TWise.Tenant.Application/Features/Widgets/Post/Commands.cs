using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Widgets;

public record CreateWidgetCommand(CreateWidgetRequest Request, long UserId, long TenantId) : IRequest<WidgetDto>;

public record CopyWidgetToDraftCommand(long Id, long UserId, bool IsAdmin, long TenantId) : IRequest<WidgetDto?>;
