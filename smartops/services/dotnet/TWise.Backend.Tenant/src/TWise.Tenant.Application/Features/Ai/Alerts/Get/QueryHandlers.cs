using MediatR;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.Alerts;

public sealed class ListAiAlertsHandler(IAiAlertService alerts) : IRequestHandler<ListAiAlertsQuery, IReadOnlyList<AiAlertDto>>
{
    public Task<IReadOnlyList<AiAlertDto>> Handle(ListAiAlertsQuery q, CancellationToken ct) => alerts.ListAsync(q.TenantId, q.UserId, ct);
}
