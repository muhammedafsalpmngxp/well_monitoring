using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Abstractions.Services;

/// <summary>The Ask Data database's user schemas, tables / views and columns (read-only, from its catalog views).</summary>
public interface IAskDataCatalogReader
{
    /// <summary>Throws InvalidOperationException with the reason when the database cannot be read.</summary>
    Task<AskDataCatalogDto> ReadAsync(CancellationToken ct);
}
