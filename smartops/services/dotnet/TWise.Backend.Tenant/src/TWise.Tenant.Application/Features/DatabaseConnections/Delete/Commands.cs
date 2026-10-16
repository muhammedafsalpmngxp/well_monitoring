using MediatR;
using TWise.Tenant.Application.Features.Model;

namespace TWise.Tenant.Application.Features.DatabaseConnections;

public record DeleteDatabaseConnectionCommand(long Id, long TenantId) : IRequest<bool>, IChangesConnection;
