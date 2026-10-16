using MediatR;
using TWise.Tenant.Application.Features.Model;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.DatabaseConnections;

public record UpdateDatabaseConnectionCommand(long Id, UpdateDatabaseConnectionRequest Request, long UserId, long TenantId) : IRequest<DatabaseConnectionDto?>, IChangesConnection;
