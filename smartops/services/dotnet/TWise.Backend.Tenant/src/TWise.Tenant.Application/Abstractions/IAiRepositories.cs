using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Abstractions;

public interface IAiSettingsRepository
{
    Task<AiSettings?> GetAsync(long tenantId, CancellationToken ct);
    Task UpsertAsync(AiSettings settings, CancellationToken ct);
}

public interface IAiProviderRepository
{
    Task<IReadOnlyList<AiProvider>> ListAsync(long tenantId, CancellationToken ct);
    Task<AiProvider?> GetAsync(long id, long tenantId, CancellationToken ct);
    Task<AiProvider?> GetActiveAsync(long tenantId, CancellationToken ct);
    Task AddAsync(AiProvider provider, CancellationToken ct);
    /// <summary>Marks this provider active and every other provider of the tenant inactive.</summary>
    Task SetActiveAsync(AiProvider provider, CancellationToken ct);
    Task SaveAsync(CancellationToken ct);
}

public interface IAiFeatureRoleRepository
{
    Task<IReadOnlyList<AiFeatureRole>> GetAsync(long tenantId, CancellationToken ct);
    /// <summary>Replaces every grant of the tenant with the given set.</summary>
    Task ReplaceAsync(long tenantId, IReadOnlyList<AiFeatureRole> grants, CancellationToken ct);
}

public interface IAiUsageRepository
{
    Task AddAsync(AiUsageLog log, CancellationToken ct);
    Task<int> CountTodayAsync(long tenantId, CancellationToken ct);
    /// <summary>Per-day totals for the last <paramref name="days"/> UTC days, oldest first.</summary>
    Task<IReadOnlyList<AiUsageDayDto>> GetDailyAsync(long tenantId, int days, CancellationToken ct);
    /// <summary>Failed calls since a date, newest first.</summary>
    Task<IReadOnlyList<AiUsageLog>> GetFailuresAsync(long tenantId, DateTime since, int take, CancellationToken ct);
}
