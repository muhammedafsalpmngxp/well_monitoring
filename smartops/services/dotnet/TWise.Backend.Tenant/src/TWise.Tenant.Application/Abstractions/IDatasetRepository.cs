using TWise.Tenant.Application.Features.Model;
using TWise.Tenant.Application.Features.Model.Datasets;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Domain.Entities.Model;

namespace TWise.Tenant.Application.Abstractions;

/// <summary>
/// Storage for model datasets. A dataset is only ever read with its tenant id; sources,
/// relationships and measures are only reached through a dataset read that way.
/// </summary>
public interface IDatasetRepository
{
    Task<IReadOnlyList<Dataset>> ListAsync(long tenantId, CancellationToken ct = default);

    /// <summary>Tracked, so changes are written by SaveAsync. Null when missing, deleted or another tenant's.</summary>
    Task<Dataset?> GetAsync(long id, long tenantId, CancellationToken ct = default);

    Task<bool> NameTakenAsync(long tenantId, string name, long? exceptId, CancellationToken ct = default);

    /// <summary>The tenant's connections that are not deleted, untracked.</summary>
    Task<IReadOnlyList<DatabaseConnection>> GetConnectionsAsync(long tenantId, CancellationToken ct = default);

    /// <summary>The database of the API's own tenant connection string; null when it is not configured.</summary>
    string? TenantDatabaseName { get; }

    /// <summary>Tracked sources, relationships, measures, calculated columns and transforms of one dataset.</summary>
    Task<DatasetParts> GetPartsAsync(long datasetId, CancellationToken ct = default);

    /// <summary>Columns of the named tables on one connection, from core.DatabaseSchema, in table order.</summary>
    Task<IReadOnlyList<CatalogColumn>> GetColumnsAsync(long connectionId, long tenantId, IReadOnlyCollection<string> tables, CancellationToken ct = default);

    /// <summary>Counts the rows and values of a candidate join of two tables, on the data model's connection (JoinFinder.ProbeSql).</summary>
    Task<JoinProbe> ProbeJoinAsync(JoinCandidate candidate, DatabaseConnection connection, CancellationToken ct = default);

    /// <summary>
    /// View Builder views of view type "view" saved on the connection, each checked against the view contract
    /// and, when it passes, described by SQL Server. Null ids means every such view; ordered by name.
    /// </summary>
    Task<IReadOnlyList<PreparedView>> GetViewsAsync(long connectionId, long tenantId, IReadOnlyCollection<long>? ids, CancellationToken ct = default);

    /// <summary>
    /// Columns of the stored SQL of the given view sources, keyed ("view", view id, column), as SQL Server
    /// describes that SQL on the connection. A source without stored SQL, or whose SQL cannot be described, has none.
    /// </summary>
    Task<IReadOnlyList<CatalogColumn>> GetViewSourceColumnsAsync(long connectionId, long tenantId, IReadOnlyCollection<DatasetSource> sources, CancellationToken ct = default);

    /// <summary>
    /// The dataset with its connection, sources, relationships, measures and the catalogue columns
    /// of its tables and of its view sources' stored SQL, untracked, with Version 0. Null when missing, deleted or another tenant's.
    /// </summary>
    Task<ModelSnapshot?> GetSnapshotAsync(long id, long tenantId, CancellationToken ct = default);

    Task AddAsync<T>(T entity, CancellationToken ct = default) where T : class;

    Task DeleteAsync<T>(T entity, CancellationToken ct = default) where T : class;

    Task SaveAsync(CancellationToken ct = default);

    /// <summary>
    /// Deletes a source of the dataset with every relationship, calculated column and transform that
    /// belongs to it, in one transaction. False, with nothing deleted, when another row still
    /// references the source.
    /// </summary>
    Task<bool> RemoveSourceAsync(long datasetId, long sourceId, CancellationToken ct = default);

    /// <summary>Replaces every part of the dataset with the published version's, in one transaction, under new ids.</summary>
    Task ReplacePartsAsync(long datasetId, PublishedModel model, CancellationToken ct = default);
}
