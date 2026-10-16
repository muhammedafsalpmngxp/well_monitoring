using MediatR;

namespace TWise.Tenant.Application.Features.DatabaseViews;

public record DeleteDatabaseViewCommand(long Id, long UserId, long TenantId) : IRequest<bool>;
