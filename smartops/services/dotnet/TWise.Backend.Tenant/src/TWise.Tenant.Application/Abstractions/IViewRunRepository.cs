using TWise.Tenant.Application.Features.SelfHealing;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Abstractions;

public interface IViewRunRepository
{
    /// <summary>The scan of runs since now minus <paramref name="days"/>, and of the tenant's imports.</summary>
    Task<SelfHealingOverviewDto> OverviewAsync(long tenantId, int days, SelfHealingOptions options, CancellationToken ct = default);
}
