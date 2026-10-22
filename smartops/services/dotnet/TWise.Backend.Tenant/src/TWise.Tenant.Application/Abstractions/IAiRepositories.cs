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
    Task<IReadOnlyList<AiModelPrice>> ListPricesAsync(long tenantId, CancellationToken ct);
    /// <summary>The tenant's price catalog becomes exactly these rows.</summary>
    Task ReplacePricesAsync(long tenantId, IReadOnlyList<AiModelPrice> prices, CancellationToken ct);
    Task AddAsync(AiProvider provider, CancellationToken ct);
    /// <summary>Marks this provider active and every other provider of the tenant inactive.</summary>
    Task SetActiveAsync(AiProvider provider, CancellationToken ct);
    /// <summary>Deletes the provider row for good (its encrypted key goes with it).</summary>
    Task DeleteAsync(AiProvider provider, CancellationToken ct);
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
    /// <summary>Several rows in one save (one round trip), e.g. every model call of one Ask Data question.</summary>
    Task AddRangeAsync(IReadOnlyList<AiUsageLog> logs, CancellationToken ct);
    Task<int> CountTodayAsync(long tenantId, CancellationToken ct);
    /// <summary>Per-day totals for the last <paramref name="days"/> UTC days, oldest first.</summary>
    Task<IReadOnlyList<AiUsageDayDto>> GetDailyAsync(long tenantId, int days, CancellationToken ct);
    /// <summary>Failed calls since a date, newest first.</summary>
    Task<IReadOnlyList<AiUsageLog>> GetFailuresAsync(long tenantId, DateTime since, int take, CancellationToken ct);
}

/// <summary>Explain summaries kept until the data they summarise changes (core.AiSummaries). Best-effort: a failing store
/// (e.g. the table not created yet) reads as "not stored" and never fails the Explain.</summary>
public interface IAiSummaryRepository
{
    /// <summary>The stored summary for this payload hash, or null.</summary>
    Task<string?> GetAsync(long tenantId, string kind, string hash, CancellationToken ct);
    /// <summary>Stores (or replaces) it; summaries unused for AiExplain:SummaryUnusedDays are removed.</summary>
    Task SaveAsync(long tenantId, string kind, string hash, string text, CancellationToken ct);
}
