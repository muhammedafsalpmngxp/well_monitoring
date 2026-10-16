using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Abstractions.Services;

public interface IDatabaseViewService
{
    Task<IReadOnlyList<DatabaseViewListDto>> GetAllAsync(long tenantId, string? viewType = null, CancellationToken cancellationToken = default);
    Task<DatabaseViewDto?> GetByIdAsync(long id, long tenantId, CancellationToken cancellationToken = default);
    /// <summary>The view name alone, without the stored preview rows.</summary>
    Task<string?> GetNameAsync(long id, long tenantId, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<ViewContractReportItem>> GetContractReportAsync(long tenantId, CancellationToken cancellationToken = default);
    Task<DatabaseViewDto> CreateAsync(CreateDatabaseViewRequest request, long userId, long tenantId, CancellationToken cancellationToken = default);
    Task<DatabaseViewDto?> UpdateAsync(long id, UpdateDatabaseViewRequest request, long userId, long tenantId, CancellationToken cancellationToken = default);
    Task<bool> DeleteAsync(long id, long userId, long tenantId, CancellationToken cancellationToken = default);
    Task<PreviewDatabaseViewResponse?> PreviewAsync(PreviewDatabaseViewRequest request, long tenantId, CancellationToken cancellationToken = default);
    /// <summary>
    /// The read-only SQL to review (stored SQL when the request has none, same guard as the preview)
    /// and, on SQL Server, facts from its estimated plan without running it. Null when the connection
    /// is not the tenant's; plan null when the provider cannot explain or the plan request fails.
    /// </summary>
    Task<(string Sql, SqlPlanFacts? Plan)?> ExplainAsync(AiSqlReviewRequest request, long tenantId, CancellationToken cancellationToken = default);
    /// <summary>
    /// Existing and suggested indexes for the tables <paramref name="request"/>'s SQL reads (SQL Server only).
    /// Null when the connection is not found for the tenant.
    /// </summary>
    Task<ViewIndexAdviceResponse?> GetIndexAdviceAsync(ViewIndexAdviceRequest request, long tenantId, CancellationToken cancellationToken = default);
    /// <summary>Last stored preview (up to <paramref name="maxRows"/> rows); null when the view has none.</summary>
    Task<PreviewSnapshotDto?> GetPreviewSnapshotAsync(long id, long tenantId, int maxRows, CancellationToken cancellationToken = default);

    /// <summary>Recalculates reliability of every view whose columns_used contains a column of the given rule; returns the number updated.</summary>
    Task<int> RecalculateReliabilityForRuleAsync(string? tableName, string? fields, long tenantId, CancellationToken cancellationToken = default);
}
