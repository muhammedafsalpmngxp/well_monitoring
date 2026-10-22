using MediatR;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.Alerts;

public sealed class ListAiAlertsHandler(IAiAlertService alerts) : IRequestHandler<ListAiAlertsQuery, IReadOnlyList<AiAlertDto>>
{
    public Task<IReadOnlyList<AiAlertDto>> Handle(ListAiAlertsQuery q, CancellationToken ct) => alerts.ListAsync(q.TenantId, q.UserId, ct);
}

public sealed class GetAiAlertOptionsHandler(AiAlertOptions options) : IRequestHandler<GetAiAlertOptionsQuery, AiAlertOptionsDto>
{
    public Task<AiAlertOptionsDto> Handle(GetAiAlertOptionsQuery q, CancellationToken ct) =>
        Task.FromResult(new AiAlertOptionsDto(options.EveryHours, options.DefaultEveryHours, options.MaxEmails, options.MinHistory));
}
