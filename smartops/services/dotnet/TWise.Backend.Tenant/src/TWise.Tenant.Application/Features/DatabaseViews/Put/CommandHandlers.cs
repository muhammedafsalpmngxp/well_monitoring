using MediatR;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.DatabaseViews;

public sealed class UpdateDatabaseViewHandler(IDatabaseViewService svc)
    : IRequestHandler<UpdateDatabaseViewCommand, DatabaseViewDto?>
{
    public Task<DatabaseViewDto?> Handle(UpdateDatabaseViewCommand request, CancellationToken cancellationToken)
        => svc.UpdateAsync(request.Id, request.Request, request.UserId, request.TenantId, cancellationToken);
}
