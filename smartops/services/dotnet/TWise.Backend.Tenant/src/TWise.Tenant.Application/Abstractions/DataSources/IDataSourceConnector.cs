using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Abstractions.DataSources;

/// <summary>
/// A pull-based external data source (Google Sheets/Drive, REST API).
///
/// Connectors do not answer live SQL. They fetch a tabular snapshot which the ingestion
/// service materialises into an ImportedDataset, so charts and tiles consume connector data
/// through the existing SourceType='Import' path with no renderer changes.
/// </summary>
public interface IDataSourceConnector
{
    /// <summary>Connector key — matches <see cref="DataSourceConnection.Kind"/>.</summary>
    string Kind { get; }

    /// <summary>
    /// Verify credentials and reachability without ingesting anything.
    /// Never throws for an expected failure — returns a failed result with a message fit to show a user.
    /// </summary>
    Task<ConnectionTestResult> TestAsync(DataSourceConnection connection, CancellationToken cancellationToken = default);

    /// <summary>
    /// List the fetchable objects behind this connection — spreadsheet tabs, Drive files,
    /// or the single configured endpoint for a REST source.
    /// </summary>
    Task<IReadOnlyList<SourceObject>> ListObjectsAsync(DataSourceConnection connection, CancellationToken cancellationToken = default);

    /// <summary>
    /// Fetch one object as rows. <paramref name="objectRef"/> is the <see cref="SourceObject.Ref"/>
    /// from <see cref="ListObjectsAsync"/>; null means "the connection's default object".
    /// </summary>
    Task<ParsedImportResult> FetchAsync(DataSourceConnection connection, string? objectRef, CancellationToken cancellationToken = default);
}

/// <summary>Resolves a connector by kind.</summary>
public interface IDataSourceConnectorFactory
{
    /// <summary>Throws NotSupportedException when the kind is unknown.</summary>
    IDataSourceConnector Get(string kind);

    IDataSourceConnector Get(DataSourceConnection connection);

    /// <summary>Connector kinds this build supports — feeds the "add source" picker.</summary>
    IReadOnlyList<string> SupportedKinds { get; }
}

/// <summary>Outcome of a connectivity test.</summary>
public sealed record ConnectionTestResult(bool Success, string Message, int? ObjectCount = null)
{
    public static ConnectionTestResult Ok(string message, int? objectCount = null) => new(true, message, objectCount);
    public static ConnectionTestResult Fail(string message) => new(false, message);
}

/// <summary>One fetchable object behind a connection.</summary>
/// <param name="Ref">Opaque identifier passed back to <see cref="IDataSourceConnector.FetchAsync"/>.</param>
/// <param name="Name">Display name.</param>
/// <param name="ObjectType">Kind-specific descriptor, e.g. "sheet", "file", "endpoint".</param>
public sealed record SourceObject(string Ref, string Name, string ObjectType, long? SizeBytes = null);
