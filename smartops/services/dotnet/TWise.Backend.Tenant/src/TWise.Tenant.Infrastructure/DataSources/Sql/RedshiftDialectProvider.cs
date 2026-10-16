using Npgsql;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Infrastructure.DataSources.Sql;

/// <summary>
/// Amazon Redshift over the Postgres wire protocol. Its catalog lacks LATERAL / WITH ORDINALITY,
/// so discovery uses the plain information_schema views instead of the pg_catalog query.
/// </summary>
public sealed class RedshiftDialectProvider : PostgresDialectProvider
{
    public override string Provider => "redshift";
    public override int DefaultPort => 5439;

    public override string BuildConnectionString(DatabaseConnection connection, int connectTimeoutSeconds = 30) =>
        new NpgsqlConnectionStringBuilder(base.BuildConnectionString(connection, connectTimeoutSeconds))
        {
            ServerCompatibilityMode = ServerCompatibilityMode.Redshift
        }.ConnectionString;

    protected override string SchemaDiscoverySql => """
        WITH keys AS (
            SELECT tc.constraint_type, ku.table_schema, ku.table_name, ku.column_name, tc.constraint_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage ku
                ON tc.constraint_name = ku.constraint_name
               AND tc.table_schema    = ku.table_schema
            WHERE tc.constraint_type IN ('PRIMARY KEY', 'FOREIGN KEY')
        ),
        fk AS (
            SELECT k.table_schema, k.table_name, k.column_name,
                   ccu.table_schema AS ref_schema, ccu.table_name AS ref_table, ccu.column_name AS ref_column
            FROM keys k
            JOIN information_schema.constraint_column_usage ccu
                ON ccu.constraint_name = k.constraint_name AND ccu.table_schema = k.table_schema
            WHERE k.constraint_type = 'FOREIGN KEY'
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
        LEFT JOIN keys pk ON pk.constraint_type = 'PRIMARY KEY'
                         AND c.table_schema = pk.table_schema
                         AND c.table_name   = pk.table_name
                         AND c.column_name  = pk.column_name
        LEFT JOIN fk ON c.table_schema = fk.table_schema
                    AND c.table_name   = fk.table_name
                    AND c.column_name  = fk.column_name
        WHERE t.table_type = 'BASE TABLE'
          AND c.table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_internal')
        ORDER BY c.table_schema, c.table_name, c.ordinal_position
        """;
}
