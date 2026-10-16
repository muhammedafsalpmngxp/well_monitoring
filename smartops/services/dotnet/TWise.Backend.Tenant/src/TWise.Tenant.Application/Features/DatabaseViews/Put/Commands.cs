using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.DatabaseViews;

public record UpdateDatabaseViewCommand(long Id, UpdateDatabaseViewRequest Request, long UserId, long TenantId) : IRequest<DatabaseViewDto?>;
