using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Infrastructure.Services;

/// <summary>
/// The Ask Data database's user schemas, tables / views and columns, as Ask Data itself reads them
/// (INFORMATION_SCHEMA.COLUMNS; system schemas left out). Read-only; cached for two minutes so the settings page
/// and a save that follows it do not read the catalog twice.
/// </summary>
public sealed class AskDataCatalogReader(IConfiguration config, IMemoryCache cache, ILogger<AskDataCatalogReader> logger) : IAskDataCatalogReader
{
    private const string CacheKey = "askdata-catalog";
    private static readonly string[] SystemSchemas = ["sys", "INFORMATION_SCHEMA", "guest"];

    public async Task<AskDataCatalogDto> ReadAsync(CancellationToken ct)
    {
        if (cache.TryGetValue(CacheKey, out AskDataCatalogDto? hit)) return hit!;
        var builder = new SqlConnectionStringBuilder(AgentRuntimeClient.AskDataConnection(config)) { ConnectTimeout = 15, ApplicationIntent = ApplicationIntent.ReadOnly };
        var tables = new SortedDictionary<(string Schema, string Table), List<string>>(Comparer<(string, string)>.Create((a, b) =>
        {
            var c = StringComparer.OrdinalIgnoreCase.Compare(a.Item1, b.Item1);
            return c != 0 ? c : StringComparer.OrdinalIgnoreCase.Compare(a.Item2, b.Item2);
        }));
        try
        {
            await using var conn = new SqlConnection(builder.ConnectionString);
            await conn.OpenAsync(ct);
            await using var cmd = conn.CreateCommand();
            cmd.CommandTimeout = 60;
            cmd.CommandText = $"""
                SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA NOT IN ({string.Join(", ", SystemSchemas.Select((_, i) => $"@s{i}"))}) AND TABLE_SCHEMA NOT LIKE 'db[_]%'
                ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION
                """;
            for (var i = 0; i < SystemSchemas.Length; i++) cmd.Parameters.AddWithValue($"@s{i}", SystemSchemas[i]);
            await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
            {
                var key = (r.GetString(0), r.GetString(1));
                if (!tables.TryGetValue(key, out var cols)) tables[key] = cols = [];
                cols.Add(r.GetString(2));
            }
        }
        catch (SqlException ex)
        {
            logger.LogWarning(ex, "Ask Data catalog could not be read from {Database}", builder.InitialCatalog);
            throw new InvalidOperationException($"The Ask Data database ({builder.InitialCatalog}) could not be read: {ex.Message}");
        }

        var schemas = tables.GroupBy(t => t.Key.Schema, StringComparer.OrdinalIgnoreCase)
            .Select(g => new AskDataCatalogSchemaDto(g.Key, g.Select(t => new AskDataCatalogTableDto(t.Key.Table, t.Value)).ToList()))
            .ToList();
        var catalog = new AskDataCatalogDto(builder.InitialCatalog, schemas);
        cache.Set(CacheKey, catalog, TimeSpan.FromMinutes(2));
        return catalog;
    }
}
