using MediatR;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Reports;

public sealed class UpdateReportHandler(IReportService svc)
    : IRequestHandler<UpdateReportCommand, ReportDto?>
{
    public Task<ReportDto?> Handle(UpdateReportCommand cmd, CancellationToken cancellationToken)
        => svc.UpdateAsync(cmd.Id, cmd.Request, cmd.UserId, cmd.IsAdmin, cancellationToken);
}
