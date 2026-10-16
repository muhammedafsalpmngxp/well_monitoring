using System.Data.Common;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Abstractions.DataSources;

/// <summary>
/// Engine-specific behaviour for an external SQL data source.
/// One implementation per value of <see cref="DatabaseConnection.Provider"/>
/// (mssql | postgres | mysql | mariadb | redshift | clickhouse | trino). Resolved through <see cref="ISqlProviderFactory"/>.
/// </summary>
public interface ISqlDialectProvider
{
    /// <summary>Provider key as stored on DatabaseConnection.Provider.</summary>
    string Provider { get; }

    /// <summary>Port used when a connection does not specify one.</summary>
    int DefaultPort { get; }

    /// <summary>Build an ADO.NET connection string from the stored connection (decrypts the password).</summary>
    string BuildConnectionString(DatabaseConnection connection, int connectTimeoutSeconds = 30);

    /// <summary>Create a closed provider-specific connection.</summary>
    DbConnection CreateConnection(string connectionString);

    /// <summary>
    /// Read tables, columns, PKs and FKs from the remote server.
    /// INFORMATION_SCHEMA coverage varies by engine, so each provider owns its own query.
    /// </summary>
    Task<IReadOnlyList<DiscoveredColumn>> DiscoverSchemaAsync(
        DbConnection connection, int commandTimeoutSeconds, CancellationToken cancellationToken = default);

    /// <summary>Quote an identifier for this engine ([x] / "x" / `x`).</summary>
    string QuoteIdentifier(string identifier);

    /// <summary>True when the exception came from this engine's driver (used to decide retry/cache fallback).</summary>
    bool IsTransportException(Exception exception);

    /// <summary>
    /// Statements run once on a freshly opened connection before the user's SQL
    /// (SQL Server needs SET NOCOUNT ON; other engines need nothing). Empty by default.
    /// </summary>
    IReadOnlyList<string> SessionPreambleStatements { get; }
}

/// <summary>Resolves the dialect provider for a connection.</summary>
public interface ISqlProviderFactory
{
    /// <summary>Throws NotSupportedException when the provider key is unknown.</summary>
    ISqlDialectProvider Get(string provider);

    ISqlDialectProvider Get(DatabaseConnection connection);

    /// <summary>Provider keys this build supports — feeds the connection-form dropdown.</summary>
    IReadOnlyList<string> SupportedProviders { get; }
}

/// <summary>One column discovered on a remote server during schema sync.</summary>
public sealed record DiscoveredColumn(
    string SchemaName,
    string TableName,
    string ColumnName,
    string DataType,
    bool IsNullable,
    bool IsPrimaryKey,
    bool IsForeignKey,
    string? ForeignKeySchema,
    string? ForeignKeyTable,
    string? ForeignKeyColumn,
    int? MaxLength,
    int OrdinalPosition);
