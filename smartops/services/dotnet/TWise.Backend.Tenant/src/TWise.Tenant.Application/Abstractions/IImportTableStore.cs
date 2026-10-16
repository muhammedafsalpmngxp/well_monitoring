using TWise.Tenant.Application.Features.Model.Datasets;
using TWise.Tenant.Application.Features.Model.Imports;
using TWise.Tenant.Domain.Entities.Model;

namespace TWise.Tenant.Application.Abstractions;

/// <summary>Tables loaded from uploaded files: the registry, and the writes that create or replace them.</summary>
public interface IImportTableStore
{
    /// <summary>Uploaded tables on the connection, most recently changed first.</summary>
    Task<IReadOnlyList<ImportTable>> ListAsync(long connectionId, long tenantId, CancellationToken ct = default);

    /// <summary>Tracked, so WriteAsync saves changes made to it. Null when missing or another tenant's.</summary>
    Task<ImportTable?> GetAsync(long id, long tenantId, CancellationToken ct = default);

    /// <summary>True when a registry row or a table in the import schema already has the name.</summary>
    Task<bool> NameTakenAsync(string tableName, CancellationToken ct = default);

    /// <summary>
    /// The tenant's datasets on the connection with a source on import.tableName, or a view source whose stored SQL
    /// mentions tableName, with their parts, untracked. ImportRules.ViewSourcesReading tells which views really read it.
    /// </summary>
    Task<IReadOnlyList<(Dataset Dataset, DatasetParts Parts)>> UsagesAsync(long connectionId, long tenantId, string tableName, CancellationToken ct = default);

    /// <summary>
    /// In one transaction: creates import.TableName, dropping it first when the registry row
    /// already exists; loads the rows; replaces its core.DatabaseSchema rows; saves the registry row. Returns null,
    /// with nothing changed, when a table of that name appeared in the meantime. Throws DuplicateImportColumnException,
    /// with nothing changed, when the database counts two column names as one.
    /// </summary>
    Task<ImportTable?> WriteAsync(ImportTable table, ImportShape shape, CancellationToken ct = default);
}
