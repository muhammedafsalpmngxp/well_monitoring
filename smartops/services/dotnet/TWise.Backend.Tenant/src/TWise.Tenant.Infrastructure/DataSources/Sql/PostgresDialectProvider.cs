using System.Data.Common;
using Npgsql;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Infrastructure.Services;

namespace TWise.Tenant.Infrastructure.DataSources.Sql;

/// <summary>PostgreSQL. <see cref="RedshiftDialectProvider"/> derives from it.</summary>
public class PostgresDialectProvider : SqlDialectProviderBase
{
    public override string Provider => "postgres";
    public override int DefaultPort => 5432;

    public override string BuildConnectionString(DatabaseConnection connection, int connectTimeoutSeconds = 30) =>
        new NpgsqlConnectionStringBuilder
        {
            Host = connection.Server,
            Port = connection.Port > 0 ? connection.Port : DefaultPort,
            Database = connection.DatabaseName,
            Username = connection.Username,
            Password = ConnectionPasswordHelper.Decrypt(connection.PasswordHash),
            // TrustServerCertificate on the entity means "don't validate the cert". Npgsql 8
            // folds that into SslMode: Prefer negotiates TLS without validating, Require validates.
            SslMode = connection.TrustServerCertificate ? SslMode.Prefer : SslMode.Require,
            Timeout = connectTimeoutSeconds
        }.ConnectionString;

    public override DbConnection CreateConnection(string connectionString) => new NpgsqlConnection(connectionString);

    public override string QuoteIdentifier(string identifier) => $"\"{identifier.Replace("\"", "\"\"")}\"";

    public override bool IsTransportException(Exception exception) => exception is NpgsqlException;

    /// <summary>
    /// Foreign keys are resolved from pg_catalog rather than
    /// information_schema.constraint_column_usage. That view is implemented as an expensive
    /// join and on a few-hundred-column schema it pushed the whole query past the driver's
    /// 30s default, surfacing as "Timeout during reading attempt". pg_catalog with an
    /// unnest of conkey/confkey is the same result, orders of magnitude faster.
    /// </summary>
    protected override string SchemaDiscoverySql => """
        WITH pk AS (
            SELECT ku.table_schema, ku.table_name, ku.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage ku
                ON tc.constraint_name = ku.constraint_name
               AND tc.table_schema    = ku.table_schema
            WHERE tc.constraint_type = 'PRIMARY KEY'
        ),
        fk AS (
            SELECT
                src_ns.nspname  AS table_schema,
                src_cls.relname AS table_name,
                src_att.attname AS column_name,
                tgt_ns.nspname  AS ref_schema,
                tgt_cls.relname AS ref_table,
                tgt_att.attname AS ref_column
            FROM pg_constraint con
            JOIN pg_class     src_cls ON src_cls.oid = con.conrelid
            JOIN pg_namespace src_ns  ON src_ns.oid  = src_cls.relnamespace
            JOIN pg_class     tgt_cls ON tgt_cls.oid = con.confrelid
            JOIN pg_namespace tgt_ns  ON tgt_ns.oid  = tgt_cls.relnamespace
            -- Composite keys pair positionally, so both sides are unnested WITH ORDINALITY
            -- and joined on that ordinal rather than cross-joined.
            JOIN LATERAL unnest(con.conkey)  WITH ORDINALITY AS sk(attnum, ord) ON TRUE
            JOIN LATERAL unnest(con.confkey) WITH ORDINALITY AS tk(attnum, ord) ON tk.ord = sk.ord
            JOIN pg_attribute src_att ON src_att.attrelid = con.conrelid  AND src_att.attnum = sk.attnum
            JOIN pg_attribute tgt_att ON tgt_att.attrelid = con.confrelid AND tgt_att.attnum = tk.attnum
            WHERE con.contype = 'f'
        )
        SELECT
            c.table_schema,
            c.table_name,
            c.column_name,
            c.data_type,
            (c.is_nullable = 'YES') AS is_nullable,
            c.character_maximum_length,
            c.ordinal_position,
            (pk.column_name IS NOT NULL) AS is_primary_key,
            (fk.column_name IS NOT NULL) AS is_foreign_key,
            fk.ref_schema,
            fk.ref_table,
            fk.ref_column
        FROM information_schema.columns c
        JOIN information_schema.tables t
            ON c.table_schema = t.table_schema AND c.table_name = t.table_name
        LEFT JOIN pk ON c.table_schema = pk.table_schema
                    AND c.table_name   = pk.table_name
                    AND c.column_name  = pk.column_name
        LEFT JOIN fk ON c.table_schema = fk.table_schema
                    AND c.table_name   = fk.table_name
                    AND c.column_name  = fk.column_name
        WHERE t.table_type = 'BASE TABLE'
          AND c.table_schema NOT IN ('pg_catalog', 'information_schema')
        ORDER BY c.table_schema, c.table_name, c.ordinal_position
        """;
}
