using TWise.Tenant.Application.Features.Ai;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Abstractions.Services;

/// <summary>Runs a validated AI query spec over a saved view in its own database, across all rows.</summary>
public interface IAiViewQueryRunner
{
    /// <summary>
    /// Null when the view cannot be queried this way (not found, not SQL Server); the caller then
    /// uses the rows it already loaded. Throws InvalidOperationException with a message for the
    /// model when the database rejects the query, so the auto-fix retry can correct the spec.
    /// </summary>
    Task<AiQueryResult?> RunAsync(long viewId, long tenantId, AiQuerySpec spec, IReadOnlyList<string> columns, CancellationToken ct = default);

    /// <summary>Column profiles over every row of the view. Null when it cannot be read this way; the caller then profiles the rows it has.</summary>
    /// <summary>Values of the text columns containing any search word, over every row. Null when the view must be read in memory.</summary>
    Task<IReadOnlyList<AiValueMatch>?> FindValuesAsync(long viewId, long tenantId, IReadOnlyList<string> textColumns, IReadOnlyList<string> terms, CancellationToken ct = default);

    Task<IReadOnlyList<AiColumnStats>?> ProfileAsync(long viewId, long tenantId, IReadOnlyList<string> columns, CancellationToken ct = default);
}
