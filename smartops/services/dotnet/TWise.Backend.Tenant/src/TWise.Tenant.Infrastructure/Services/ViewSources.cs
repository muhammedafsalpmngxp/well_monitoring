using System.Data;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using TWise.Tenant.Application.Features.Model.Datasets;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Domain.Entities.Model;
using TWise.Tenant.Infrastructure.Persistence;

namespace TWise.Tenant.Infrastructure.Services;

/// <summary>
/// Loads View Builder views for datasets. Each view's stored SQL is checked by ViewSource.Prepare, and the
/// columns of a view that passes are read from SQL Server without running it.
/// </summary>
internal static class ViewSources
{
    // The key includes the SQL, so an edited view gets a new entry. The absolute limit bounds how long a column
    // dropped from a table under an unchanged view goes unseen.
    private static readonly MemoryCacheEntryOptions Kept = new()
        { SlidingExpiration = TimeSpan.FromMinutes(30), AbsoluteExpirationRelativeToNow = TimeSpan.FromHours(6), Size = 1 };

    public static async Task<IReadOnlyList<PreparedView>> LoadAsync(
        TenantDbContext db, IMemoryCache cache, DatabaseConnection connection, long tenantId, IReadOnlyCollection<long>? ids, CancellationToken ct)
    {
        // The DatabaseView query filter already leaves out deleted views.
        var rows = await db.DatabaseViews.AsNoTracking()
            .Where(v => v.TenantId == tenantId && v.ConnectionId == connection.Id && v.ViewType == "view"
                        && (ids == null || ids.Contains(v.Id)))
            .OrderBy(v => v.ViewName)
            .Select(v => new { v.Id, v.ViewName, v.Description, v.GeneratedSql, v.ManualSql })
            .ToListAsync(ct);

        // Views are not synced into the catalogue, so a view may read base tables only.
        var tables = (await db.DatabaseSchemas.AsNoTracking()
                .Where(c => c.ConnectionId == connection.Id && c.TenantId == tenantId && !c.IsDeleted)
                .Select(c => new { c.SchemaName, c.TableName })
                .Distinct()
                .ToListAsync(ct))
            .Select(t => $"{t.SchemaName}.{t.TableName}")
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var views = new List<PreparedView>(rows.Count);
        SqlConnection? sql = null;
        try
        {
            foreach (var row in rows)
            {
                // Same resolution as View Builder's preview: hand-edited SQL wins when present.
                var text = string.IsNullOrWhiteSpace(row.ManualSql) ? row.GeneratedSql : row.ManualSql;
                bool IsTable(string schema, string table) => tables.Contains($"{schema}.{table}");
                var (checkedSql, problems) = ViewSource.Prepare(text, row.Description, IsTable);
                if (checkedSql is null)
                {
                    // A view that cannot sit inside a query may still run as written, as a script source.
                    var scriptProblems = ScriptSource.Check(text, connection.DatabaseName, IsTable);
                    IReadOnlyList<ViewColumn> described = [];
                    if (scriptProblems.Count == 0)
                    {
                        (described, sql) = await DescribeCachedAsync(cache, sql, connection, text!, ct);
                        scriptProblems = ScriptSource.ColumnProblems(described);
                    }
                    views.Add(new PreparedView(row.Id, row.ViewName, row.Description, null, problems, [])
                        { Text = text, Script = new ScriptView(text ?? "", scriptProblems, described) });
                    continue;
                }

                var (columns, opened) = await DescribeCachedAsync(cache, sql, connection, checkedSql.Sql, ct);
                sql = opened;
                views.Add(new PreparedView(row.Id, row.ViewName, row.Description, checkedSql, ViewSource.ColumnProblems(columns), columns) { Text = text });
            }
        }
        finally
        {
            if (sql is not null) await sql.DisposeAsync();
        }
        return views;
    }

    /// <summary>
    /// Catalogue columns of the SQL stored on each view source, keyed ("view", view id, column), and of the batch stored
    /// on each script source, keyed ("script", view id, column) with row_order. Sources of one view hold the same SQL
    /// (DatasetRules.NewViewSource, NewScriptSource), so the first of them is described.
    /// </summary>
    public static async Task<IReadOnlyList<CatalogColumn>> StoredColumnsAsync(
        IMemoryCache cache, DatabaseConnection connection, IEnumerable<DatasetSource> sources, CancellationToken ct)
    {
        var stored = sources.Where(s => s.SourceKind is "view" or ScriptSource.Kind && !string.IsNullOrWhiteSpace(s.ViewSql))
            .DistinctBy(s => (s.SourceKind, s.SourceName))
            .ToList();
        var described = await DescribeAllAsync(cache, connection, stored.Select(s => s.ViewSql!), ct);
        var result = new List<CatalogColumn>();
        foreach (var source in stored)
        {
            var columns = described[source.ViewSql!];
            if (source.SourceKind == ScriptSource.Kind)
            {
                if (ScriptSource.ColumnProblems(columns).Count == 0) result.AddRange(ScriptSource.CatalogColumns(source.SourceName, columns));
                continue;
            }
            if (ViewSource.ColumnProblems(columns).Count > 0) continue;
            result.AddRange(columns.Select(c =>
                new CatalogColumn(ViewSource.Schema, source.SourceName, c.Name, false, false, null, null, null, c.DataType)));
        }
        return result;
    }

    /// <summary>
    /// The described columns of the batch stored on each script source, by the batch's text. The draft and the published
    /// version may hold two batches of one view, so each is described on its own (ModelSnapshot.Batches).
    /// </summary>
    public static async Task<IReadOnlyDictionary<string, IReadOnlyList<ViewColumn>>> BatchesAsync(
        IMemoryCache cache, DatabaseConnection connection, IEnumerable<DatasetSource> sources, CancellationToken ct)
        => await DescribeAllAsync(cache, connection,
            sources.Where(s => s.SourceKind == ScriptSource.Kind && !string.IsNullOrWhiteSpace(s.ViewSql)).Select(s => s.ViewSql!), ct);

    /// <summary>Each distinct text described, from the cache or on one connection opened when first needed.</summary>
    private static async Task<Dictionary<string, IReadOnlyList<ViewColumn>>> DescribeAllAsync(
        IMemoryCache cache, DatabaseConnection connection, IEnumerable<string> texts, CancellationToken ct)
    {
        var described = new Dictionary<string, IReadOnlyList<ViewColumn>>();
        SqlConnection? sql = null;
        try
        {
            foreach (var text in texts.Distinct())
            {
                var (columns, opened) = await DescribeCachedAsync(cache, sql, connection, text, ct);
                sql = opened;
                described[text] = columns;
            }
        }
        finally
        {
            if (sql is not null) await sql.DisposeAsync();
        }
        return described;
    }

    /// <summary>The described columns of the SQL, from the cache or from SQL Server, opening the connection when first needed.</summary>
    private static async Task<(IReadOnlyList<ViewColumn> Columns, SqlConnection? Sql)> DescribeCachedAsync(
        IMemoryCache cache, SqlConnection? sql, DatabaseConnection connection, string text, CancellationToken ct)
    {
        var columns = await CachedAsync(cache, connection.Id, text, async () =>
        {
            if (sql is null)
            {
                sql = new SqlConnection(ConnectionPasswordHelper.BuildConnectionString(connection));
                await sql.OpenAsync(ct);
            }
            return await DescribeAsync(sql, text, ct);
        });
        return (columns, sql);
    }

    /// <summary>The kept description of the SQL on the connection, or describe's, which is kept unless it is empty.</summary>
    internal static async Task<IReadOnlyList<ViewColumn>> CachedAsync(
        IMemoryCache cache, long connectionId, string text, Func<Task<IReadOnlyList<ViewColumn>>> describe)
    {
        var key = $"model:view-columns:{connectionId}:{Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text)))}";
        if (cache.TryGetValue(key, out IReadOnlyList<ViewColumn>? kept) && kept is not null) return kept;

        var columns = await describe();
        if (columns.Count > 0) cache.Set(key, columns, Kept);
        return columns;
    }

    /// <summary>The result columns SQL Server would return; empty when it cannot describe the SQL.</summary>
    private static async Task<IReadOnlyList<ViewColumn>> DescribeAsync(SqlConnection sql, string text, CancellationToken ct)
    {
        await using var cmd = sql.CreateCommand();
        // The text is a parameter and is only described, never run. A failure comes back as a row with an
        // error_number, which the WHERE leaves out, so the view gets no columns and a plain problem.
        cmd.CommandText = """
            SELECT name, system_type_name
            FROM sys.dm_exec_describe_first_result_set(@sql, NULL, 0)
            WHERE error_number IS NULL
            ORDER BY column_ordinal
            """;
        cmd.CommandTimeout = 30;
        cmd.Parameters.Add(new SqlParameter("@sql", SqlDbType.NVarChar, -1) { Value = text });

        var columns = new List<ViewColumn>();
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
            columns.Add(new ViewColumn(reader.IsDBNull(0) ? "" : reader.GetString(0), reader.IsDBNull(1) ? "" : reader.GetString(1)));
        return columns;
    }
}
