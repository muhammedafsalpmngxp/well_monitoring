using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.DatabaseViews;

public record CreateDatabaseViewCommand(CreateDatabaseViewRequest Request, long UserId, long TenantId) : IRequest<DatabaseViewDto>;
public record PreviewDatabaseViewCommand(PreviewDatabaseViewRequest Request, long TenantId) : IRequest<PreviewDatabaseViewResponse?>;
