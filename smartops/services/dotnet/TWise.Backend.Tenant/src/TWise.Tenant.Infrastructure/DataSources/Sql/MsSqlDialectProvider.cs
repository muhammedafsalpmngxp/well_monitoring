using System.Data.Common;
using Microsoft.Data.SqlClient;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Infrastructure.Services;

namespace TWise.Tenant.Infrastructure.DataSources.Sql;

/// <summary>Microsoft SQL Server. This is the original (and still default) provider.</summary>
public sealed class MsSqlDialectProvider : SqlDialectProviderBase
{
    public override string Provider => "mssql";
    public override int DefaultPort => 1433;

    public override string BuildConnectionString(DatabaseConnection connection, int connectTimeoutSeconds = 30) =>
        new SqlConnectionStringBuilder
        {
            DataSource = connection.Port == DefaultPort ? connection.Server : $"{connection.Server},{connection.Port}",
            InitialCatalog = connection.DatabaseName,
            UserID = connection.Username,
            Password = ConnectionPasswordHelper.Decrypt(connection.PasswordHash),
            TrustServerCertificate = connection.TrustServerCertificate,
            ConnectTimeout = connectTimeoutSeconds
        }.ConnectionString;

    public override DbConnection CreateConnection(string connectionString) => new SqlConnection(connectionString);

    public override string QuoteIdentifier(string identifier) => $"[{identifier.Replace("]", "]]")}]";

    public override bool IsTransportException(Exception exception) => exception is SqlException;

    /// <summary>
    /// Suppresses the "n rows affected" messages that otherwise surface as extra, column-less
    /// result sets ahead of the real one in multi-statement batches.
    /// </summary>
    public override IReadOnlyList<string> SessionPreambleStatements => ["SET NOCOUNT ON"];

    protected override string SchemaDiscoverySql => """
        SELECT
            c.TABLE_SCHEMA,
            c.TABLE_NAME,
            c.COLUMN_NAME,
            c.DATA_TYPE,
            CASE WHEN c.IS_NULLABLE = 'YES' THEN 1 ELSE 0 END AS IS_NULLABLE,
            c.CHARACTER_MAXIMUM_LENGTH,
            c.ORDINAL_POSITION,
            CASE WHEN pk_ku.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END AS IS_PRIMARY_KEY,
            CASE WHEN pk_ref.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END AS IS_FOREIGN_KEY,
            pk_ref.TABLE_SCHEMA AS FK_REF_SCHEMA,
            pk_ref.TABLE_NAME   AS FK_REF_TABLE,
            pk_ref.COLUMN_NAME  AS FK_REF_COLUMN
        FROM INFORMATION_SCHEMA.COLUMNS c
        JOIN INFORMATION_SCHEMA.TABLES t
            ON c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME
        LEFT JOIN (
            SELECT ku.TABLE_SCHEMA, ku.TABLE_NAME, ku.COLUMN_NAME
            FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
            JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku
                ON tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME
               AND tc.TABLE_SCHEMA    = ku.TABLE_SCHEMA
            WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
        ) pk_ku ON c.TABLE_SCHEMA = pk_ku.TABLE_SCHEMA
               AND c.TABLE_NAME   = pk_ku.TABLE_NAME
               AND c.COLUMN_NAME  = pk_ku.COLUMN_NAME
        LEFT JOIN (
            SELECT fk_ku.TABLE_SCHEMA, fk_ku.TABLE_NAME, fk_ku.COLUMN_NAME,
                   fk_ku.ORDINAL_POSITION,
                   rc.UNIQUE_CONSTRAINT_NAME, rc.UNIQUE_CONSTRAINT_SCHEMA
            FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
            JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE fk_ku
                ON rc.CONSTRAINT_NAME   = fk_ku.CONSTRAINT_NAME
               AND rc.CONSTRAINT_SCHEMA = fk_ku.TABLE_SCHEMA
        ) fk ON c.TABLE_SCHEMA = fk.TABLE_SCHEMA
             AND c.TABLE_NAME  = fk.TABLE_NAME
             AND c.COLUMN_NAME = fk.COLUMN_NAME
        LEFT JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE pk_ref
            ON fk.UNIQUE_CONSTRAINT_NAME   = pk_ref.CONSTRAINT_NAME
           AND fk.UNIQUE_CONSTRAINT_SCHEMA = pk_ref.TABLE_SCHEMA
           AND fk.ORDINAL_POSITION         = pk_ref.ORDINAL_POSITION
        WHERE t.TABLE_TYPE = 'BASE TABLE'
        ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION
        """;
}
