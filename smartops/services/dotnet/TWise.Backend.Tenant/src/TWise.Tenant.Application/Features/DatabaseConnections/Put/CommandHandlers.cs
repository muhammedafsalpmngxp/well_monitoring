using MediatR;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.DatabaseConnections;

public sealed class UpdateDatabaseConnectionHandler(IDatabaseConnectionService svc)
    : IRequestHandler<UpdateDatabaseConnectionCommand, DatabaseConnectionDto?>
{
    public Task<DatabaseConnectionDto?> Handle(UpdateDatabaseConnectionCommand request, CancellationToken cancellationToken)
        => svc.UpdateAsync(request.Id, request.Request, request.UserId, request.TenantId, cancellationToken);
}
