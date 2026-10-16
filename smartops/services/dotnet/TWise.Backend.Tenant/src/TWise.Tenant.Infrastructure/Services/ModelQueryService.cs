using System.Collections.Concurrent;
using System.Data;
using Microsoft.Data.SqlClient;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Features.Model.Query;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Infrastructure.Services;

/// <summary>
/// Runs a compiled dataset query. Guardrails for the shared QA instance: a command timeout, the
/// compiler's TOP cap, and a per-tenant concurrency gate. Only queries that reach the database
/// come here; RunModelQueryHandler answers cached ones without it.
/// </summary>
public sealed class ModelQueryService : IModelQueryService
{
    private const int CommandTimeoutSeconds = 30;

    // ponytail: in-process gate, so the limit is per API instance; move to a shared store if the API scales out.
    private const int MaxConcurrentQueriesPerTenant = 4;

    // A canvas sends one query per object at once, so extra queries wait for a free slot
    // instead of failing. Only a query still waiting after this long is refused as busy.
    private static readonly TimeSpan QueueWait = TimeSpan.FromSeconds(20);
    private static readonly ConcurrentDictionary<long, SemaphoreSlim> Gates = new();

    public async Task<QueryResult> RunAsync(
        CompiledQuery compiled, DatabaseConnection connection, long tenantId, CancellationToken cancellationToken = default)
    {
        var gate = Gates.GetOrAdd(tenantId, _ => new SemaphoreSlim(MaxConcurrentQueriesPerTenant));
        if (!await gate.WaitAsync(QueueWait, cancellationToken))
            throw new QueryException(QueryErrors.Busy, "Too many queries are running. Try again in a moment.");

        try
        {
            await using var conn = new SqlConnection(ConnectionPasswordHelper.BuildConnectionString(connection));
            await conn.OpenAsync(cancellationToken);
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = compiled.Sql;
            cmd.CommandTimeout = CommandTimeoutSeconds;
            foreach (var (name, value) in compiled.Parameters)
                cmd.Parameters.Add(Parameter(name, value));

            await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
            var rows = new List<Dictionary<string, object?>>();
            while (await reader.ReadAsync(cancellationToken))
            {
                var row = new Dictionary<string, object?>(compiled.Columns.Count);
                for (var i = 0; i < compiled.Columns.Count; i++)
                    row[compiled.Columns[i]] = reader.IsDBNull(i) ? null : reader.GetValue(i);
                rows.Add(row);
            }
            return new QueryResult(compiled.Columns, rows, DateTime.UtcNow);
        }
        catch (SqlException ex) when (ex.Number == -2)
        {
            throw new QueryException(QueryErrors.Timeout,
                $"The query took longer than {CommandTimeoutSeconds} seconds. Add a filter or remove some fields.");
        }
        finally
        {
            gate.Release();
        }
    }

    /// <summary>
    /// A parameter typed from its value, except that a DateTime is sent as datetime2: the inferred
    /// legacy datetime starts at 1753 and rounds to 3 ms, so 23:59:59.999 would become the next day.
    /// </summary>
    public static SqlParameter Parameter(string name, object value)
    {
        var parameter = new SqlParameter(name, value);
        if (value is DateTime) parameter.SqlDbType = SqlDbType.DateTime2;
        return parameter;
    }
}
