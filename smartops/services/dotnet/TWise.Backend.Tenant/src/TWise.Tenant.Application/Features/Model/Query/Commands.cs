using System.Globalization;
using System.Text.RegularExpressions;
using MediatR;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Features.Model.Datasets;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Features.Model.Query;

public record RunModelQueryCommand(QueryRequest Request, long TenantId) : IRequest<QueryResult>;

/// <summary>
/// Compiles the request against the dataset's cached snapshot, then answers from the result cache
/// when the same compiled query was run for the same row scope at the dataset's current version.
/// Otherwise the query runs, guarded by IModelQueryService, and its result is kept. Refresh reads
/// the snapshot and the rows again and keeps the new ones. Refusals and failures are thrown as
/// QueryException before anything is kept.
/// </summary>
// ponytail: two identical queries that miss at the same moment both run; add a per-key lock if that shows under load.
public sealed class RunModelQueryHandler(
    IDatasetRepository repo, IModelQueryService runner, ModelCache cache, ICurrentUserService currentUser, IViewRunRecorder runs)
    : IRequestHandler<RunModelQueryCommand, QueryResult>
{
    // Same list DashboardController authorises admin actions with.
    internal static readonly HashSet<string> AdminRoles = new(StringComparer.OrdinalIgnoreCase)
        { "admin", "tenant_admin", "TenantAdmin", "platform_admin", "PlatformAdmin" };

    public async Task<QueryResult> Handle(RunModelQueryCommand command, CancellationToken cancellationToken)
    {
        var request = command.Request;
        var snapshot = (await cache.SnapshotAsync(repo, request.DatasetId, command.TenantId, request.Refresh, cancellationToken)
            ?? throw new QueryException(QueryErrors.UnknownDataset, "The data model does not exist.")).Serving(request.Draft);
        if (snapshot.Connection is null)
            throw new QueryException(QueryErrors.UnknownDataset, "The data model's database connection no longer exists.");

        request = await ResolveTopFiltersAsync(request, command.TenantId, cancellationToken);
        var user = new UserScope(currentUser.Roles.Any(AdminRoles.Contains), currentUser.PlantCodes);
        var compiled = QueryCompiler.Compile(snapshot.Model(request.Measures, request.Values), request, user, snapshot.Catalog());

        var key = ResultKey.For(command.TenantId, snapshot, user, compiled);
        if (!request.Refresh && cache.Result(key) is { } cached) return cached with { FromCache = true, SkippedFilters = compiled.SkippedFilters };

        // Only a query that reaches the database is timed for the run log (cache hits are not loads).
        var run = new ViewRun { SourceName = snapshot.Dataset.Name, SourceType = "Dataset", Caller = ViewRunCallers.Dataset, UserId = ViewRunTiming.UserIdOf(currentUser) };
        var result = await runs.TimeAsync(run, () => runner.RunAsync(compiled, snapshot.Connection, command.TenantId, cancellationToken), r => (r.Rows.Count, null));
        if (!ReadsClock(compiled.Sql)) cache.SetResult(key, result);
        return result with { SkippedFilters = compiled.SkippedFilters };
    }

    private static readonly Regex Clock = new(@"\b(GETDATE|GETUTCDATE|SYSDATETIME|SYSUTCDATETIME|SYSDATETIMEOFFSET|CURRENT_TIMESTAMP)\b",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);

    /// <summary>
    /// True when the SQL reads the clock, from TODAY() in a formula or from a view that uses GETDATE() and the like. Such a
    /// query gives another answer tomorrow for the same SQL, so its rows are not kept. A bracketed name such as
    /// [getdate_col] does not count.
    /// </summary>
    public static bool ReadsClock(string sql) => Clock.IsMatch(sql);

    /// <summary>The name a top filter's ranking value is read under when it ranks by a field rather than a measure.</summary>
    private const string TopValueName = "Top N value";

    /// <summary>
    /// Top and bottom N filters, as in Power BI: each becomes an in filter on the field's N values with the highest or
    /// lowest measure, read with the request's other filters, so the N are counted among the rows those filters keep.
    /// </summary>
    private async Task<QueryRequest> ResolveTopFiltersAsync(QueryRequest request, long tenantId, CancellationToken ct)
    {
        var filters = request.Filters ?? [];
        if (!filters.Any(IsTop)) return request;
        var others = filters.Where(f => !IsTop(f)).ToList();
        var resolved = new List<QueryFilter>(others);
        foreach (var top in filters.Where(IsTop))
        {
            // Values are [count, measure], or [count, field, fn] to rank by a column's sum, average, and so on.
            var ranked = top.Values ?? [];
            if (ranked.Count is not (2 or 3) || !int.TryParse(ranked[0], NumberStyles.None, CultureInfo.InvariantCulture, out var n)
                || n is < 1 or > 1000 || ranked.Skip(1).Any(string.IsNullOrWhiteSpace))
                throw new QueryException(QueryErrors.InvalidFilter, $"The top or bottom filter on {top.Field} needs a count from 1 to 1000 and a measure or a field.");
            var byField = ranked.Count == 3 ? new FieldValue(TopValueName, ranked[1], ranked[2]) : null;
            var measure = byField?.Name ?? ranked[1];
            var inner = new QueryRequest(request.DatasetId, [top.Field], [measure], others, new QuerySort(measure, top.Op == "top"), n,
                request.Refresh, Draft: request.Draft,
                Values: byField is null ? request.Values?.Where(v => v.Name == measure).ToList() : [byField]);
            var rows = (await Handle(new RunModelQueryCommand(inner, tenantId), ct)).Rows;
            var values = rows.Select(r => r.GetValueOrDefault(top.Field)).Where(v => v is not null)
                .Select(v => v is DateTime date ? date.ToString("yyyy-MM-ddTHH:mm:ss.fff", CultureInfo.InvariantCulture) : Convert.ToString(v, CultureInfo.InvariantCulture)!)
                .Distinct().ToList();
            if (values.Count > 0)
            {
                resolved.Add(new QueryFilter(top.Field, "in", values));
            }
            else
            {
                // No value at all keeps no row: a field is never both blank and not blank.
                resolved.Add(new QueryFilter(top.Field, "is_null"));
                resolved.Add(new QueryFilter(top.Field, "not_null"));
            }
        }
        return request with { Filters = resolved };

        static bool IsTop(QueryFilter f) => f.Op is "top" or "bottom";
    }
}

/// <summary>The first rows of one table or view (or a view run as written) on the dataset's connection, for the Get Data navigator.</summary>
public record PreviewSourceCommand(long DatasetId, SourcePreviewRequest Request, long TenantId) : IRequest<QueryResult>;

/// <summary>
/// Samples a table or view for administrators only: a raw sample has no row-level security, because the
/// plant column is chosen only when the source is added. It never goes through the result cache.
/// </summary>
public sealed class PreviewSourceHandler(
    IDatasetRepository repo, IModelQueryService runner, ModelCache cache, ICurrentUserService currentUser)
    : IRequestHandler<PreviewSourceCommand, QueryResult>
{
    private const int SampleRows = 50;

    public async Task<QueryResult> Handle(PreviewSourceCommand command, CancellationToken cancellationToken)
    {
        var snapshot = await cache.SnapshotAsync(repo, command.DatasetId, command.TenantId, reload: false, cancellationToken)
            ?? throw new QueryException(QueryErrors.UnknownDataset, "The data model does not exist.");
        if (snapshot.Connection is not { } connection)
            throw new QueryException(QueryErrors.UnknownDataset, "The data model's database connection no longer exists.");
        if (!currentUser.Roles.Any(RunModelQueryHandler.AdminRoles.Contains))
            throw new QueryException(QueryErrors.RowsHidden,
                "Row previews are shown to administrators only, because they are not filtered by plant. The columns are listed instead.");

        var request = command.Request;
        // A table of another database is read through the model's connection, as its queries will read it.
        var other = request.ConnectionId is { } otherId && otherId != connection.Id ? otherId : (long?)null;
        string? database = null;
        if (other is not null)
        {
            if (await DatasetFlow.OtherDatabaseProblemAsync(repo, snapshot.Dataset, other.Value, request.Kind, cancellationToken) is { } problem)
                throw new QueryException(QueryErrors.UnknownField, problem);
            database = (await repo.GetConnectionsAsync(command.TenantId, cancellationToken)).First(c => c.Id == other).DatabaseName;
        }
        ModelSource source;
        IReadOnlyList<CatalogColumn> columns;
        if (request.Kind == "view")
        {
            IReadOnlyList<PreparedView> views = long.TryParse(request.SourceName, NumberStyles.None, CultureInfo.InvariantCulture, out var id)
                ? await repo.GetViewsAsync(connection.Id, command.TenantId, [id], cancellationToken)
                : [];
            source = new ModelSource(0, "preview", ViewSource.Schema, request.SourceName, "none", null,
                ViewSource.Require("the selected view", request.SourceName, views));
            columns = views.SelectMany(ViewSource.CatalogColumns).ToList();
        }
        else if (request.Kind == ScriptSource.Kind)
        {
            IReadOnlyList<PreparedView> views = long.TryParse(request.SourceName, NumberStyles.None, CultureInfo.InvariantCulture, out var id)
                ? await repo.GetViewsAsync(connection.Id, command.TenantId, [id], cancellationToken)
                : [];
            if (views.FirstOrDefault() is not { Script: { IsUsable: true } script } view)
                throw new QueryException(QueryErrors.SourceNotContractCompliant,
                    views.FirstOrDefault()?.Script?.Problems.FirstOrDefault() ?? "The selected view cannot run as written.");
            // Sampled with the view's own defaults, as a query with no filter on its parameters runs it.
            source = new ModelSource(0, "preview", ScriptSource.Schema, request.SourceName, "none", null,
                Script: new ScriptSql(script.Text, script.Columns, new Dictionary<string, string>(), view.Name, connection.DatabaseName));
            columns = ScriptSource.CatalogColumns(request.SourceName, script.Columns).ToList();
        }
        else if (request.Kind == "table")
        {
            source = new ModelSource(0, "preview", request.SchemaName, request.SourceName, "none", null, Database: database);
            columns = (await repo.GetColumnsAsync(other ?? connection.Id, command.TenantId, [request.SourceName], cancellationToken))
                .Where(c => string.Equals(c.Schema, request.SchemaName, StringComparison.OrdinalIgnoreCase)
                            && string.Equals(c.Table, request.SourceName, StringComparison.OrdinalIgnoreCase))
                .ToList();
            if (columns.Count == 0)
                throw new QueryException(QueryErrors.UnknownField, "The table does not exist on this connection. Sync the connection's schema and try again.");
        }
        else
        {
            throw new QueryException(QueryErrors.UnknownField, "Choose a table or a view.");
        }

        var catalog = DatasetRules.Catalog(columns);
        var compiled = QueryCompiler.Sample(source, columns.Select(c => c.Column).ToList(), catalog, SampleRows);
        return await runner.RunAsync(compiled, connection, command.TenantId, cancellationToken);
    }
}
