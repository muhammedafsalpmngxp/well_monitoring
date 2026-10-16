using System.Data.Common;
using TWise.Tenant.Application.Abstractions.DataSources;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Infrastructure.DataSources.Sql;

/// <summary>
/// Shared plumbing for the SQL dialect providers. Subclasses supply the connection string,
/// the driver's connection type and the engine's schema-discovery query; the reader loop,
/// which is identical across engines once the column order is fixed, lives here.
/// </summary>
public abstract class SqlDialectProviderBase : ISqlDialectProvider
{
    public abstract string Provider { get; }
    public abstract int DefaultPort { get; }

    public abstract string BuildConnectionString(DatabaseConnection connection, int connectTimeoutSeconds = 30);
    public abstract DbConnection CreateConnection(string connectionString);
    public abstract string QuoteIdentifier(string identifier);
    public abstract bool IsTransportException(Exception exception);

    /// <summary>No preamble by default; SQL Server overrides this.</summary>
    public virtual IReadOnlyList<string> SessionPreambleStatements => Array.Empty<string>();

    /// <summary>
    /// Engine-specific discovery query. Must project exactly these columns, in this order:
    /// schema, table, column, data_type, is_nullable(bool), max_length(int?),
    /// ordinal_position(int), is_primary_key(bool), is_foreign_key(bool),
    /// fk_schema, fk_table, fk_column.
    /// </summary>
    protected abstract string SchemaDiscoverySql { get; }

    public async Task<IReadOnlyList<DiscoveredColumn>> DiscoverSchemaAsync(
        DbConnection connection, int commandTimeoutSeconds, CancellationToken cancellationToken = default)
    {
        var result = new List<DiscoveredColumn>();

        await using var cmd = connection.CreateCommand();
        cmd.CommandText = SchemaDiscoverySql;

        // Catalogue queries over a large schema legitimately take longer than the driver
        // default (30s), and hitting it surfaced as an opaque "Timeout during reading attempt".
        cmd.CommandTimeout = commandTimeoutSeconds;

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            var isFk = ReadBool(reader, 8);
            result.Add(new DiscoveredColumn(
                SchemaName: reader.GetString(0),
                TableName: reader.GetString(1),
                ColumnName: reader.GetString(2),
                DataType: reader.GetString(3),
                IsNullable: ReadBool(reader, 4),
                IsPrimaryKey: ReadBool(reader, 7),
                IsForeignKey: isFk,
                ForeignKeySchema: isFk && !reader.IsDBNull(9) ? reader.GetString(9) : null,
                ForeignKeyTable: isFk && !reader.IsDBNull(10) ? reader.GetString(10) : null,
                ForeignKeyColumn: isFk && !reader.IsDBNull(11) ? reader.GetString(11) : null,
                MaxLength: reader.IsDBNull(5) ? null : Convert.ToInt32(reader.GetValue(5)),
                OrdinalPosition: Convert.ToInt32(reader.GetValue(6))));
        }

        return result;
    }

    /// <summary>
    /// Engines disagree on how a boolean comes back: SQL Server sends 1/0 from a CASE,
    /// MySQL sends 1/0 or "YES"/"NO", Postgres sends a real bool. Normalise all of them.
    /// </summary>
    private static bool ReadBool(DbDataReader reader, int ordinal)
    {
        if (reader.IsDBNull(ordinal)) return false;

        var value = reader.GetValue(ordinal);
        return value switch
        {
            bool b => b,
            string s => s.Equals("YES", StringComparison.OrdinalIgnoreCase) || s == "1",
            _ => Convert.ToInt64(value) == 1
        };
    }

}
