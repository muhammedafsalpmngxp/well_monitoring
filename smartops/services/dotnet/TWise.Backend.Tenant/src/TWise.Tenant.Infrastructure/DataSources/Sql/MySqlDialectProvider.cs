using System.Data.Common;
using MySqlConnector;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Infrastructure.Services;

namespace TWise.Tenant.Infrastructure.DataSources.Sql;

/// <summary>MySQL. <see cref="MariaDbDialectProvider"/> reuses everything under its own key.</summary>
public class MySqlDialectProvider : SqlDialectProviderBase
{
    public override string Provider => "mysql";
    public override int DefaultPort => 3306;

    public override string BuildConnectionString(DatabaseConnection connection, int connectTimeoutSeconds = 30) =>
        new MySqlConnectionStringBuilder
        {
            Server = connection.Server,
            Port = (uint)(connection.Port > 0 ? connection.Port : DefaultPort),
            Database = connection.DatabaseName,
            UserID = connection.Username,
            Password = ConnectionPasswordHelper.Decrypt(connection.PasswordHash),
            SslMode = connection.TrustServerCertificate ? MySqlSslMode.Preferred : MySqlSslMode.Required,
            ConnectionTimeout = (uint)connectTimeoutSeconds
        }.ConnectionString;

    public override DbConnection CreateConnection(string connectionString) => new MySqlConnection(connectionString);

    public override string QuoteIdentifier(string identifier) => $"`{identifier.Replace("`", "``")}`";

    public override bool IsTransportException(Exception exception) => exception is MySqlException;

    /// <summary>
    /// MySQL has no schema/database distinction, so table_schema IS the database. DATABASE()
    /// scopes discovery to the connection's own database instead of every database on the server.
    /// </summary>
    protected override string SchemaDiscoverySql => """
        SELECT
            c.TABLE_SCHEMA,
            c.TABLE_NAME,
            c.COLUMN_NAME,
            c.DATA_TYPE,
            (c.IS_NULLABLE = 'YES') AS IS_NULLABLE,
            c.CHARACTER_MAXIMUM_LENGTH,
            c.ORDINAL_POSITION,
            (c.COLUMN_KEY = 'PRI') AS IS_PRIMARY_KEY,
            (fk.COLUMN_NAME IS NOT NULL) AS IS_FOREIGN_KEY,
            fk.REFERENCED_TABLE_SCHEMA,
            fk.REFERENCED_TABLE_NAME,
            fk.REFERENCED_COLUMN_NAME
        FROM information_schema.COLUMNS c
        JOIN information_schema.TABLES t
            ON c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME
        LEFT JOIN information_schema.KEY_COLUMN_USAGE fk
            ON c.TABLE_SCHEMA = fk.TABLE_SCHEMA
           AND c.TABLE_NAME   = fk.TABLE_NAME
           AND c.COLUMN_NAME  = fk.COLUMN_NAME
           AND fk.REFERENCED_TABLE_NAME IS NOT NULL
        WHERE t.TABLE_TYPE = 'BASE TABLE'
          AND c.TABLE_SCHEMA = DATABASE()
        ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION
        """;
}
