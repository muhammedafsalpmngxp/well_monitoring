using MediatR;
using TWise.Tenant.Application.Abstractions.Services;

namespace TWise.Tenant.Application.Features.DatabaseViews;

public sealed class DeleteDatabaseViewHandler(IDatabaseViewService svc)
    : IRequestHandler<DeleteDatabaseViewCommand, bool>
{
    public Task<bool> Handle(DeleteDatabaseViewCommand request, CancellationToken cancellationToken)
        => svc.DeleteAsync(request.Id, request.UserId, request.TenantId, cancellationToken);
}
