using MediatR;
using TWise.Tenant.Application.Features.Model;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.DatabaseConnections;

public record ListDatabaseConnectionsQuery(long TenantId) : IRequest<IReadOnlyList<DatabaseConnectionDto>>;
public record GetDatabaseConnectionQuery(long Id, long TenantId) : IRequest<DatabaseConnectionDto?>;
public record GetDatabaseSchemaQuery(long ConnectionId, long TenantId) : IRequest<DatabaseSchemaResponse?>;
public record SyncDatabaseSchemaCommand(long ConnectionId, long TenantId) : IRequest<DatabaseSchemaResponse?>, IChangesConnection;
