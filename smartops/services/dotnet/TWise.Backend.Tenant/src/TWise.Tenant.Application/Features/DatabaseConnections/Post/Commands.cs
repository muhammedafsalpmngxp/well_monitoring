using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.DatabaseConnections;

public record CreateDatabaseConnectionCommand(CreateDatabaseConnectionRequest Request, long UserId, long TenantId) : IRequest<DatabaseConnectionDto>;
