using MediatR;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Reports;

public sealed class CreateReportHandler(IReportService svc)
    : IRequestHandler<CreateReportCommand, ReportDto>
{
    public Task<ReportDto> Handle(CreateReportCommand cmd, CancellationToken cancellationToken)
        => svc.CreateAsync(cmd.Request, cmd.UserId, cmd.TenantId, cancellationToken);
}

public sealed class RestoreReportVersionHandler(IReportService svc)
    : IRequestHandler<RestoreReportVersionCommand, RestoreReportVersionResponse?>
{
    public Task<RestoreReportVersionResponse?> Handle(RestoreReportVersionCommand request, CancellationToken cancellationToken)
        => svc.RestoreVersionAsync(request.Id, request.VersionNo, request.UserId, request.IsAdmin, request.TenantId, cancellationToken);
}
