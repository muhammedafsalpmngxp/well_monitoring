using MediatR;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.DatabaseConnections;

public sealed class ListDatabaseConnectionsHandler(IDatabaseConnectionService svc)
    : IRequestHandler<ListDatabaseConnectionsQuery, IReadOnlyList<DatabaseConnectionDto>>
{
    public Task<IReadOnlyList<DatabaseConnectionDto>> Handle(ListDatabaseConnectionsQuery request, CancellationToken cancellationToken)
        => svc.GetAllAsync(request.TenantId, cancellationToken);
}

public sealed class GetDatabaseConnectionHandler(IDatabaseConnectionService svc)
    : IRequestHandler<GetDatabaseConnectionQuery, DatabaseConnectionDto?>
{
    public Task<DatabaseConnectionDto?> Handle(GetDatabaseConnectionQuery request, CancellationToken cancellationToken)
        => svc.GetByIdAsync(request.Id, request.TenantId, cancellationToken);
}

public sealed class GetDatabaseSchemaHandler(IDatabaseConnectionService svc)
    : IRequestHandler<GetDatabaseSchemaQuery, DatabaseSchemaResponse?>
{
    public Task<DatabaseSchemaResponse?> Handle(GetDatabaseSchemaQuery request, CancellationToken cancellationToken)
        => svc.GetSchemaAsync(request.ConnectionId, request.TenantId, cancellationToken);
}

public sealed class SyncDatabaseSchemaHandler(IDatabaseConnectionService svc)
    : IRequestHandler<SyncDatabaseSchemaCommand, DatabaseSchemaResponse?>
{
    public Task<DatabaseSchemaResponse?> Handle(SyncDatabaseSchemaCommand request, CancellationToken cancellationToken)
        => svc.SyncSchemaAsync(request.ConnectionId, request.TenantId, cancellationToken);
}
