using System.Data;
using System.Globalization;
using System.Text.RegularExpressions;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Application.Features.Ai;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Infrastructure.Persistence;

namespace TWise.Tenant.Infrastructure.Services;

/// <summary>
/// Answers an AI question over every row of a view. A single SELECT or WITH view gets the spec
/// pushed down as SQL (QuerySpecSql), so only the result rows travel. A batch view (DECLARE, temp
/// tables) runs as written and its rows are streamed through the in-memory engine, keeping only
/// the columns the spec uses, up to a safety cap. Both run in a transaction that is rolled back.
/// </summary>
public sealed partial class AiViewQueryRunner(TenantDbContext db, IConfiguration configuration, IViewRunRecorder runs, ICurrentUserService user,
    ILogger<AiViewQueryRunner> logger) : IAiViewQueryRunner
{
    /// <summary>Rows a batch view may stream before the answer is marked partial.</summary>
    private const int MaxStreamRows = 500_000;

    [GeneratedRegex(@"^\s*CREATE\s+(OR\s+(REPLACE|ALTER)\s+)?VIEW\s+\S+\s+AS\s+", RegexOptions.IgnoreCase)]
    private static partial Regex CreateViewPrefix();

    private int TimeoutSeconds => configuration.GetValue<int?>("DatabaseView:PreviewCommandTimeoutSeconds") is int t and > 0 ? t : 300;

    /// <summary>Timed for the run log (caller ai), like every chart and view load.</summary>
    public async Task<AiQueryResult?> RunAsync(long viewId, long tenantId, AiQuerySpec spec, IReadOnlyList<string> columns, CancellationToken ct = default)
    {
        var opened = await OpenAsync(viewId, tenantId, ct);
        if (opened is null) return null;
        var (conn, viewSql, name) = opened.Value;
        await using var _ = conn;
        var run = new ViewRun { ViewId = viewId, SourceName = name, SourceType = "View", Caller = ViewRunCallers.Ai, UserId = ViewRunTiming.UserIdOf(user) };
        return await runs.TimeAsync(run, () => QueryAsync(conn, viewSql, viewId, spec, columns, ct), r => (r.TotalRows, null));
    }

    private async Task<AiQueryResult> QueryAsync(SqlConnection conn, string viewSql, long viewId, AiQuerySpec spec, IReadOnlyList<string> columns, CancellationToken ct)
    {
        var pushed = QuerySpecSql.Build(viewSql, spec, columns);
        if (pushed is not null)
        {
            try { return await PushDownAsync(conn, pushed, ct); }
            catch (SqlException ex) when (!IsTimeout(ex))
            {
                // The wrapper could not read this SQL as a row source after all (e.g. two SELECTs
                // without a separator). Running it as written is slower but still covers every row.
                logger.LogWarning(ex, "AI push-down failed for view {ViewId}; streaming its rows instead", viewId);
            }
        }
        return await StreamAsync(conn, viewSql, spec, columns, ct);
    }

    public async Task<IReadOnlyList<AiColumnStats>?> ProfileAsync(long viewId, long tenantId, IReadOnlyList<string> columns, CancellationToken ct = default)
    {
        var opened = await OpenAsync(viewId, tenantId, ct);
        if (opened is null) return null;
        var (conn, viewSql, _) = opened.Value;
        await using var _ = conn;
        try
        {
            var types = await ColumnTypesAsync(conn, viewSql, columns, ct);
            if (types is not null && ProfileSql.Stats(viewSql, types) is { } statsSql)
                return await ProfileInDatabaseAsync(conn, viewSql, statsSql, types, ct);
            return await ProfileStreamAsync(conn, viewSql, columns, ct);
        }
        catch (SqlException ex)
        {
            // Profiles only improve the prompt; without them the question still works.
            logger.LogWarning(ex, "Profiling view {ViewId} failed", viewId);
            return null;
        }
    }

    public async Task<IReadOnlyList<AiValueMatch>?> FindValuesAsync(long viewId, long tenantId, IReadOnlyList<string> textColumns, IReadOnlyList<string> terms, CancellationToken ct = default)
    {
        var opened = await OpenAsync(viewId, tenantId, ct);
        if (opened is null) return null;
        var (conn, viewSql, _) = opened.Value;
        await using var _ = conn;
        var sql = ProfileSql.Lookup(viewSql, textColumns, terms.Count, maxRows: 200);
        if (sql is null) return null;
        try
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = sql;
            cmd.CommandTimeout = TimeoutSeconds;
            for (var i = 0; i < terms.Count; i++)
            {
                var escaped = terms[i].Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_").Replace("[", "\\[");
                cmd.Parameters.Add(new SqlParameter($"@t{i}", SqlDbType.NVarChar, 400) { Value = $"%{escaped}%" });
            }
            var found = new List<(string, string, long)>();
            await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct)) found.Add((r.GetString(0), r.GetString(1), Convert.ToInt64(r.GetValue(2))));
            return ValueMatcher.Assign(terms, found);
        }
        catch (SqlException ex)
        {
            // Matching only improves the prompt; the question still works without it.
            logger.LogWarning(ex, "Value lookup on view {ViewId} failed", viewId);
            return null;
        }
    }

    /// <summary>The view's SQL (the hand-edited version when set, as Preview runs) and an open connection to its database.</summary>
    private async Task<(SqlConnection Conn, string Sql, string Name)?> OpenAsync(long viewId, long tenantId, CancellationToken ct)
    {
        // Only the SQL and the connection: a view row also carries its cached preview, which can be large.
        var view = await db.DatabaseViews.AsNoTracking()
            .Where(v => v.Id == viewId && v.TenantId == tenantId && !v.IsDeleted)
            .Select(v => new { v.ViewName, v.GeneratedSql, v.ManualSql, v.Connection })
            .FirstOrDefaultAsync(ct);
        if (view?.Connection is null || !string.Equals(view.Connection.Provider ?? "mssql", "mssql", StringComparison.OrdinalIgnoreCase)) return null;
        var viewSql = CreateViewPrefix().Replace(string.IsNullOrWhiteSpace(view.ManualSql) ? view.GeneratedSql : view.ManualSql, "").Trim();
        if (viewSql.Length == 0) return null;

        var conn = new SqlConnection(ConnectionPasswordHelper.BuildConnectionString(view.Connection));
        try { await conn.OpenAsync(ct); }
        catch (SqlException ex) { await conn.DisposeAsync(); throw new InvalidOperationException($"Could not connect to the dataset's database: {ex.Message}"); }
        return (conn, viewSql, view.ViewName);
    }

    /// <summary>Column types from the result metadata, without reading rows. Null for a batch view.</summary>
    private async Task<List<(string Column, string Type)>?> ColumnTypesAsync(SqlConnection conn, string viewSql, IReadOnlyList<string> columns, CancellationToken ct)
    {
        var w = ViewSqlWrapper.Wrap(viewSql, "_ai_src", stripOrderBy: true);
        if (w is null) return null;
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = $"{w.Head}SELECT TOP (0) * FROM {w.Relation}";
        cmd.CommandTimeout = TimeoutSeconds;
        await using var reader = await cmd.ExecuteReaderAsync(CommandBehavior.SchemaOnly, ct);
        var byName = Enumerable.Range(0, reader.FieldCount).ToDictionary(reader.GetName, reader.GetFieldType, StringComparer.OrdinalIgnoreCase);
        return columns.Select(c => (c, byName.TryGetValue(c, out var t) ? TypeName(t) : "text")).ToList();
    }

    private static string TypeName(Type t) =>
        t == typeof(byte[]) ? "binary"
        : t == typeof(bool) ? "boolean"
        : t == typeof(DateTime) || t == typeof(DateTimeOffset) ? "date"
        : t == typeof(TimeSpan) || t == typeof(Guid) || t == typeof(string) ? "text"
        : t.IsPrimitive || t == typeof(decimal) ? "number" : "text";

    private async Task<IReadOnlyList<AiColumnStats>> ProfileInDatabaseAsync(SqlConnection conn, string viewSql, string statsSql, List<(string Column, string Type)> types, CancellationToken ct)
    {
        long rows;
        var distinct = new long[types.Count];
        var nulls = new long[types.Count];
        var min = new string?[types.Count];
        var max = new string?[types.Count];
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = statsSql;
            cmd.CommandTimeout = TimeoutSeconds;
            await using var r = await cmd.ExecuteReaderAsync(ct);
            await r.ReadAsync(ct);
            object? Get(string name) { var i = r.GetOrdinal(name); return r.IsDBNull(i) ? null : r.GetValue(i); }
            rows = Convert.ToInt64(Get(ProfileSql.RowsColumn) ?? 0);
            for (var i = 0; i < types.Count; i++)
            {
                if (types[i].Type == "binary") continue;
                distinct[i] = Convert.ToInt64(Get($"d{i}") ?? 0);
                nulls[i] = Convert.ToInt64(Get($"n{i}") ?? 0);
                if (types[i].Type is "number" or "date") { min[i] = Format(Get($"mn{i}")); max[i] = Format(Get($"mx{i}")); }
            }
        }

        // Every value with its count for low-cardinality columns, in one grouped scan.
        var low = types.Select((t, i) => (Index: i, t.Column, t.Type)).Where(x => x.Type != "binary" && distinct[x.Index] is > 0 and <= ColumnProfiler.LowCardinality).ToList();
        var values = low.ToDictionary(x => x.Index, _ => new List<AiValueCount>());
        if (ProfileSql.Values(viewSql, low.Select(x => (x.Index, x.Column)).ToList()) is { } valuesSql)
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = valuesSql;
            cmd.CommandTimeout = TimeoutSeconds;
            await using var r = await cmd.ExecuteReaderAsync(ct);
            var countAt = r.GetOrdinal(ProfileSql.CountColumn);
            while (await r.ReadAsync(ct))
                foreach (var x in low)
                {
                    if (Convert.ToInt32(r.GetValue(r.GetOrdinal($"g{x.Index}"))) != 0) continue;
                    var at = r.GetOrdinal($"v{x.Index}");
                    if (r.IsDBNull(at) || r.GetString(at).Length == 0) continue;
                    values[x.Index].Add(new AiValueCount(r.GetString(at), Convert.ToInt64(r.GetValue(countAt))));
                }
        }

        return types.Select((t, i) =>
        {
            var top = values.TryGetValue(i, out var v) ? v.OrderByDescending(x => x.Count).ThenBy(x => x.Value).ToList() : [];
            return new AiColumnStats(t.Column, t.Type == "binary" ? "text" : t.Type, rows, t.Type == "binary" ? rows : nulls[i], distinct[i], false, min[i], max[i], top, []);
        }).ToList();
    }

    private async Task<IReadOnlyList<AiColumnStats>> ProfileStreamAsync(SqlConnection conn, string viewSql, IReadOnlyList<string> columns, CancellationToken ct)
    {
        await using var tx = (SqlTransaction)await conn.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
        try
        {
            await using var cmd = conn.CreateCommand();
            cmd.Transaction = tx;
            cmd.CommandText = viewSql;
            cmd.CommandTimeout = TimeoutSeconds;
            ViewRunTiming.NoteSql(viewSql);
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            // The view's rows are the last result set with columns.
            ColumnProfiler profiler = new(columns);
            do
            {
                if (reader.FieldCount == 0) continue;
                profiler = new ColumnProfiler(columns);
                var names = Enumerable.Range(0, reader.FieldCount).Select(reader.GetName).ToList();
                var count = 0;
                while (count++ < MaxStreamRows && await reader.ReadAsync(ct))
                {
                    var row = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
                    for (var i = 0; i < names.Count; i++) row[names[i]] = reader.IsDBNull(i) ? null : reader.GetValue(i);
                    profiler.Add(row);
                }
            } while (await reader.NextResultAsync(ct));
            return profiler.Build();
        }
        finally
        {
            await RollbackQuietlyAsync(tx);
        }
    }

    private static string? Format(object? v) => v switch
    {
        null => null,
        DateTime d => d.TimeOfDay == TimeSpan.Zero ? d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) : d.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture),
        IFormattable f => f.ToString(null, CultureInfo.InvariantCulture),
        _ => v.ToString(),
    };

    private async Task<AiQueryResult> PushDownAsync(SqlConnection conn, QuerySpecSql.Built built, CancellationToken ct)
    {
        await using var tx = (SqlTransaction)await conn.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
        try
        {
            await using var cmd = conn.CreateCommand();
            cmd.Transaction = tx;
            cmd.CommandText = built.Sql;
            ViewRunTiming.NoteSql(built.Sql);
            cmd.CommandTimeout = TimeoutSeconds; // on timeout SQL Server is told to cancel the query
            foreach (var (name, value) in built.Parameters) cmd.Parameters.Add(ToParameter(name, value));

            await using var reader = await cmd.ExecuteReaderAsync(ct);
            var names = Enumerable.Range(0, reader.FieldCount).Select(reader.GetName).ToList();
            var totalAt = names.IndexOf(QuerySpecSql.TotalColumn);
            var outCols = names.Where((_, i) => i != totalAt).ToList();
            var rows = new List<Dictionary<string, object?>>();
            var total = 0;
            while (await reader.ReadAsync(ct))
            {
                if (totalAt >= 0 && rows.Count == 0) total = Convert.ToInt32(reader.GetValue(totalAt));
                var row = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
                for (var i = 0; i < names.Count; i++)
                    if (i != totalAt) row[names[i]] = reader.IsDBNull(i) ? null : reader.GetValue(i);
                rows.Add(row);
            }
            // SourceRows is only shown for partial answers; a push-down answer always covers every row.
            return new AiQueryResult(outCols, rows, total, 0, false);
        }
        catch (SqlException ex) when (IsTimeout(ex))
        {
            throw new InvalidOperationException("The dataset query took too long. Ask for fewer groups or add a filter.");
        }
        finally
        {
            await RollbackQuietlyAsync(tx);
        }
    }

    private async Task<AiQueryResult> StreamAsync(SqlConnection conn, string viewSql, AiQuerySpec spec, IReadOnlyList<string> columns, CancellationToken ct)
    {
        var needed = UsedColumns(spec, columns);
        await using var tx = (SqlTransaction)await conn.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
        try
        {
            await using var cmd = conn.CreateCommand();
            cmd.Transaction = tx;
            cmd.CommandText = viewSql;
            cmd.CommandTimeout = TimeoutSeconds;
            ViewRunTiming.NoteSql(viewSql);
            await using var reader = await cmd.ExecuteReaderAsync(ct);

            // A batch may return several result sets; the view's rows are the last one with columns.
            var rows = new List<Dictionary<string, object?>>();
            var truncated = false;
            do
            {
                if (reader.FieldCount == 0) continue;
                rows.Clear();
                truncated = false;
                var keep = Enumerable.Range(0, reader.FieldCount).Where(i => needed.Contains(reader.GetName(i))).ToList();
                while (await reader.ReadAsync(ct))
                {
                    if (rows.Count >= MaxStreamRows) { truncated = true; break; }
                    var row = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
                    foreach (var i in keep) row[reader.GetName(i)] = reader.IsDBNull(i) ? null : reader.GetValue(i);
                    rows.Add(row);
                }
                if (truncated) break;
            } while (await reader.NextResultAsync(ct));

            return QuerySpecEngine.Execute(spec, columns, rows, truncated);
        }
        catch (SqlException ex) when (IsTimeout(ex))
        {
            throw new InvalidOperationException("The dataset query took too long. Ask for fewer groups or add a filter.");
        }
        catch (SqlException ex)
        {
            throw new InvalidOperationException($"The dataset could not be read: {ex.Message}");
        }
        finally
        {
            await RollbackQuietlyAsync(tx);
        }
    }

    /// <summary>Columns the spec reads; raw-row questions without a select list need them all.</summary>
    private static HashSet<string> UsedColumns(AiQuerySpec spec, IReadOnlyList<string> columns)
    {
        var used = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var measures = spec.Measures ?? [];
        if (measures.Count == 0 && spec.Select is not { Count: > 0 }) { used.UnionWith(columns); return used; }
        used.UnionWith(spec.Select ?? []);
        used.UnionWith(spec.GroupBy ?? []);
        used.UnionWith(measures.Where(m => m.Column is not null).Select(m => m.Column!));
        used.UnionWith((spec.Filters ?? []).Select(f => f.Column));
        return used;
    }

    private static SqlParameter ToParameter(string name, object value) => value switch
    {
        double d => new SqlParameter(name, SqlDbType.Float) { Value = d },
        int i => new SqlParameter(name, SqlDbType.Int) { Value = i },
        DateTime dt => new SqlParameter(name, SqlDbType.DateTime2) { Value = dt },
        _ => new SqlParameter(name, SqlDbType.NVarChar, 4000) { Value = value.ToString() ?? "" },
    };

    private static bool IsTimeout(SqlException ex) => ex.Number == -2;

    /// <summary>Nothing was written, so a rollback that fails (SQL Server may already have ended the transaction) is not an error.</summary>
    private static async Task RollbackQuietlyAsync(SqlTransaction tx)
    {
        try { await tx.RollbackAsync(CancellationToken.None); }
        catch (Exception ex) when (ex is InvalidOperationException or SqlException) { }
    }
}
