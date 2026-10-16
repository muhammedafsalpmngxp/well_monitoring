using MediatR;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.DatabaseViews;

public sealed class CreateDatabaseViewHandler(IDatabaseViewService svc)
    : IRequestHandler<CreateDatabaseViewCommand, DatabaseViewDto>
{
    public Task<DatabaseViewDto> Handle(CreateDatabaseViewCommand request, CancellationToken cancellationToken)
        => svc.CreateAsync(request.Request, request.UserId, request.TenantId, cancellationToken);
}

public sealed class PreviewDatabaseViewHandler(IDatabaseViewService svc)
    : IRequestHandler<PreviewDatabaseViewCommand, PreviewDatabaseViewResponse?>
{
    public Task<PreviewDatabaseViewResponse?> Handle(PreviewDatabaseViewCommand request, CancellationToken cancellationToken)
        => svc.PreviewAsync(request.Request, request.TenantId, cancellationToken);
}
