using MediatR;
using TWise.Tenant.Application.Abstractions.Services;

namespace TWise.Tenant.Application.Features.Reports;

public sealed class DeleteReportHandler(IReportService svc)
    : IRequestHandler<DeleteReportCommand, bool>
{
    public Task<bool> Handle(DeleteReportCommand cmd, CancellationToken cancellationToken)
        => svc.DeleteAsync(cmd.Id, cmd.UserId, cancellationToken);
}
