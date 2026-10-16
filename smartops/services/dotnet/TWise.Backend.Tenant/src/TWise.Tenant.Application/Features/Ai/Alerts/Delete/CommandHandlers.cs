using MediatR;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.Alerts;

public sealed class DeleteAiAlertHandler(IAiAlertService alerts) : IRequestHandler<DeleteAiAlertCommand, bool>
{
    public Task<bool> Handle(DeleteAiAlertCommand c, CancellationToken ct) => alerts.DeleteAsync(c.Id, c.TenantId, c.UserId, ct);
}
