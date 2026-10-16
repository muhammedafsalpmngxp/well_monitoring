using MediatR;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.DatabaseConnections;

public sealed class CreateDatabaseConnectionHandler(IDatabaseConnectionService svc)
    : IRequestHandler<CreateDatabaseConnectionCommand, DatabaseConnectionDto>
{
    public Task<DatabaseConnectionDto> Handle(CreateDatabaseConnectionCommand request, CancellationToken cancellationToken)
        => svc.CreateAsync(request.Request, request.UserId, request.TenantId, cancellationToken);
}
