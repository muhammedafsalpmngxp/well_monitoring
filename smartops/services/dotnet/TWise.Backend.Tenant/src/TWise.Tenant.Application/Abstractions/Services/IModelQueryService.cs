using TWise.Tenant.Application.Features.Model.Query;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Abstractions.Services;

public interface IModelQueryService
{
    /// <summary>
    /// Runs a compiled query on the connection and returns its rows with the time they were read.
    /// Throws QueryException with a stable code on a timeout or when the tenant has too many
    /// queries running.
    /// </summary>
    Task<QueryResult> RunAsync(CompiledQuery compiled, DatabaseConnection connection, long tenantId, CancellationToken cancellationToken = default);
}
