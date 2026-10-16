using MediatR;

namespace TWise.Tenant.Application.Features.Model;

/// <summary>
/// A request that changes a dataset: the dataset itself, its tables and their row filters, its
/// relationships or its measures. Every such request must carry this, so cached snapshots and
/// results of the dataset are not read again after it.
/// </summary>
public interface IChangesDataset
{
    long TenantId { get; }
    long DatasetId { get; }
}

/// <summary>
/// A request that changes a database connection or its catalogue: every dataset of the tenant
/// may read through it, so all its cached snapshots and results are dropped after it.
/// </summary>
public interface IChangesConnection
{
    long TenantId { get; }
}

/// <summary>
/// Moves the dataset of an IChangesDataset request to a new cache version, and the tenant of an
/// IChangesConnection request to a new cache generation, once the handler has
/// finished, whether it succeeded, refused or threw: a refused or failed change may still have
/// written part of its work. Moving the version afterwards, not before, means a query that read
/// the dataset while the change was being saved kept what it read under the old version, which
/// no later request asks for.
/// </summary>
public sealed class DatasetChangeBehavior<TRequest, TResponse>(ModelCache cache) : IPipelineBehavior<TRequest, TResponse>
    where TRequest : notnull
{
    public async Task<TResponse> Handle(TRequest request, RequestHandlerDelegate<TResponse> next, CancellationToken cancellationToken)
    {
        try
        {
            return await next();
        }
        finally
        {
            if (request is IChangesDataset change) cache.Changed(change.TenantId, change.DatasetId);
            if (request is IChangesConnection connection) cache.ConnectionsChanged(connection.TenantId);
        }
    }
}
