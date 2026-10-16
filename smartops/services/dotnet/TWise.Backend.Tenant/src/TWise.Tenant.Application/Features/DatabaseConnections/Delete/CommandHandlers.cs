using MediatR;
using TWise.Tenant.Application.Abstractions.Services;

namespace TWise.Tenant.Application.Features.DatabaseConnections;

public sealed class DeleteDatabaseConnectionHandler(IDatabaseConnectionService svc)
    : IRequestHandler<DeleteDatabaseConnectionCommand, bool>
{
    public Task<bool> Handle(DeleteDatabaseConnectionCommand request, CancellationToken cancellationToken)
        => svc.DeleteAsync(request.Id, request.TenantId, cancellationToken);
}
