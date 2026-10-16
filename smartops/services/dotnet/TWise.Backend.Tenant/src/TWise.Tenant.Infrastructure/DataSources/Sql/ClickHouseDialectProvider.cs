using System.Data.Common;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Infrastructure.DataSources.Sql.Http;
using TWise.Tenant.Infrastructure.Services;

namespace TWise.Tenant.Infrastructure.DataSources.Sql;

/// <summary>Shared connection-string handling for the engines reached over HTTP.</summary>
public abstract class HttpSqlDialectProviderBase : SqlDialectProviderBase
{
    public override string BuildConnectionString(DatabaseConnection connection, int connectTimeoutSeconds = 30) =>
        new DbConnectionStringBuilder
        {
            ["Server"] = connection.Server,
            ["Port"] = connection.Port > 0 ? connection.Port : DefaultPort,
            ["Database"] = connection.DatabaseName,
            ["Username"] = connection.Username,
            ["Password"] = ConnectionPasswordHelper.Decrypt(connection.PasswordHash),
            ["TrustServerCertificate"] = connection.TrustServerCertificate,
            ["Timeout"] = connectTimeoutSeconds
        }.ConnectionString;

    public override bool IsTransportException(Exception exception) => exception is HttpSqlException;
}

/// <summary>ClickHouse via the HTTP interface. No foreign keys; primary key comes from the sorting key.</summary>
public sealed class ClickHouseDialectProvider : HttpSqlDialectProviderBase
{
    public override string Provider => "clickhouse";
    public override int DefaultPort => 8123;

    public override DbConnection CreateConnection(string connectionString) => new ClickHouseConnection(connectionString);

    public override string QuoteIdentifier(string identifier) => $"`{identifier.Replace("`", "``")}`";

    protected override string SchemaDiscoverySql => """
        SELECT
            c.database,
            c.table,
            c.name,
            c.type,
            startsWith(c.type, 'Nullable') AS is_nullable,
            NULL AS max_length,
            c.position,
            c.is_in_primary_key,
            0 AS is_foreign_key,
            NULL AS fk_schema,
            NULL AS fk_table,
            NULL AS fk_column
        FROM system.columns c
        JOIN system.tables t ON c.database = t.database AND c.table = t.name
        WHERE c.database = currentDatabase()
          AND t.engine NOT IN ('View', 'MaterializedView', 'LiveView', 'WindowView')
        ORDER BY c.database, c.table, c.position
        """;
}

/// <summary>Trino / Presto via the REST statement API. Discovery is scoped to the connection's catalog.</summary>
public sealed class TrinoDialectProvider : HttpSqlDialectProviderBase
{
    public override string Provider => "trino";
    public override int DefaultPort => 8080;

    public override DbConnection CreateConnection(string connectionString) => new TrinoConnection(connectionString);

    public override string QuoteIdentifier(string identifier) => $"\"{identifier.Replace("\"", "\"\"")}\"";

    protected override string SchemaDiscoverySql => """
        SELECT
            c.table_schema,
            c.table_name,
            c.column_name,
            c.data_type,
            (c.is_nullable = 'YES') AS is_nullable,
            CAST(NULL AS integer) AS max_length,
            c.ordinal_position,
            false AS is_primary_key,
            false AS is_foreign_key,
            CAST(NULL AS varchar) AS fk_schema,
            CAST(NULL AS varchar) AS fk_table,
            CAST(NULL AS varchar) AS fk_column
        FROM information_schema.columns c
        JOIN information_schema.tables t
            ON c.table_schema = t.table_schema AND c.table_name = t.table_name
        WHERE t.table_type = 'BASE TABLE'
          AND c.table_schema <> 'information_schema'
        ORDER BY c.table_schema, c.table_name, c.ordinal_position
        """;
}
