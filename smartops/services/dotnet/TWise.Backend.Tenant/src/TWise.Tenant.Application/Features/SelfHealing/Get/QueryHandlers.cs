using MediatR;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.SelfHealing;

public sealed class GetSelfHealingOverviewHandler(IViewRunRepository runs, SelfHealingOptions options)
    : IRequestHandler<GetSelfHealingOverviewQuery, SelfHealingOverviewDto>
{
    public Task<SelfHealingOverviewDto> Handle(GetSelfHealingOverviewQuery request, CancellationToken cancellationToken)
        => runs.OverviewAsync(request.TenantId, request.Days ?? options.Days[0], options, cancellationToken);
}
