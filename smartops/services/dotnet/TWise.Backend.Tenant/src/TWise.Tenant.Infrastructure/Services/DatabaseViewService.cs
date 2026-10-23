using System.Text.RegularExpressions;
using TWise.Tenant.Application.Features.Ai;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.DataSources;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Application.Features.DatabaseViews;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Infrastructure.Services;

public sealed class DatabaseViewService(
    IDatabaseViewRepository viewRepo,
    IDatabaseConnectionRepository connRepo,
    ISqlProviderFactory providerFactory,
    IReliabilityRepository reliabilityRepo,
    IConfiguration configuration,
    AiSqlReviewOptions sqlReview,
    IViewRunRecorder runs,
    ICurrentUserService user,
    ILogger<DatabaseViewService> logger) : IDatabaseViewService
{
    /// <summary>
    /// Wall-clock budget for a single preview execution. Heavy report queries (multi-statement
    /// temp-table batches) can run for several minutes, so this must stay above the reverse-proxy
    /// read timeout configured in infra/k8s/ingress.yaml.
    /// </summary>
    private int CommandTimeoutSeconds
    {
        get
        {
            var configured = configuration.GetValue<int?>("DatabaseView:PreviewCommandTimeoutSeconds");
            return configured is > 0 ? configured.Value : DefaultPreviewCommandTimeoutSeconds;
        }
    }

    private const int DefaultPreviewCommandTimeoutSeconds = 300;

    public async Task<IReadOnlyList<DatabaseViewListDto>> GetAllAsync(long tenantId, string? viewType = null, CancellationToken cancellationToken = default)
    {
        var entities = await viewRepo.GetAllAsync(tenantId, viewType, cancellationToken);
        return entities.Select(ToListDto).ToList();
    }

    public Task<string?> GetNameAsync(long id, long tenantId, CancellationToken cancellationToken = default)
        => viewRepo.GetNameAsync(id, tenantId, cancellationToken);

    public async Task<DatabaseViewDto?> GetByIdAsync(long id, long tenantId, CancellationToken cancellationToken = default)
    {
        var entity = await viewRepo.GetDetailAsync(id, tenantId, cancellationToken);
        return entity is null ? null : ToDto(entity);
    }

    public async Task<IReadOnlyList<ViewContractReportItem>> GetContractReportAsync(long tenantId, CancellationToken cancellationToken = default)
    {
        var views = await viewRepo.GetContractSourcesAsync(tenantId, cancellationToken);
        return views
            .Select(v => new ViewContractReportItem(v.Id, v.ViewName, v.ViewType, CheckContract(v)))
            .ToList();
    }

    public async Task<DatabaseViewDto> CreateAsync(
        CreateDatabaseViewRequest request, long userId, long tenantId, CancellationToken cancellationToken = default)
    {
        if (await viewRepo.ExistsByNameAsync(request.ViewName, tenantId, cancellationToken: cancellationToken))
            throw new InvalidOperationException($"A view named '{request.ViewName}' already exists.");

        if (await connRepo.GetByIdAsync(request.ConnectionId, tenantId, cancellationToken) is null)
            throw new InvalidOperationException("Database connection not found.");

        var entity = new DatabaseView
        {
            ConnectionId = request.ConnectionId,
            ViewName = request.ViewName,
            Description = request.Description,
            IsDistinct = request.IsDistinct,
            TablesJson = request.TablesJson,
            JoinsJson = request.JoinsJson,
            SelectedColumnsJson = request.SelectedColumnsJson,
            ColumnAliasesJson = request.ColumnAliasesJson,
            FiltersJson = request.FiltersJson,
            GeneratedSql = request.GeneratedSql,
            ManualSql = request.ManualSql,
            TablesUsed = request.TablesUsed,
            ColumnCount = request.ColumnCount,
            SourceType = DefaultSourceType,
            ViewType = request.ViewType ?? "view",
            ReferencedCteIdsJson = request.ReferencedCteIdsJson,
            ReferencedComponentIdsJson = request.ReferencedComponentIdsJson,
            TenantId = tenantId,
            CreatedBy = userId,
            CreatedAt = DateTime.UtcNow,
            ModifiedAt = DateTime.UtcNow
        };

        var (columnsUsed, tablesUsed) = await CollectViewUsageAsync(entity, tenantId, cancellationToken);
        entity.ColumnsUsed = columnsUsed.Count == 0
            ? null
            : string.Join(",", columnsUsed.Order(StringComparer.OrdinalIgnoreCase));
        if (tablesUsed.Count > 0)
            entity.TablesUsed = string.Join(",", tablesUsed.Order(StringComparer.OrdinalIgnoreCase));
        entity.Reliability = await CalculateReliabilityAsync(entity.ViewName, columnsUsed, null, cancellationToken);

        try
        {
            var saved = await viewRepo.AddAsync(entity, cancellationToken);
            logger.LogInformation("Database view '{ViewName}' created for tenant {TenantId}", request.ViewName, tenantId);
            return ToDto(saved);
        }
        catch (DbUpdateException ex) when (IsDuplicateKeyException(ex))
        {
            throw new InvalidOperationException($"A view named '{request.ViewName}' already exists.");
        }
    }

    public async Task<DatabaseViewDto?> UpdateAsync(
        long id, UpdateDatabaseViewRequest request, long userId, long tenantId, CancellationToken cancellationToken = default)
    {
        var entity = await viewRepo.GetByIdAsync(id, tenantId, cancellationToken);
        if (entity is null) return null;

        if (await viewRepo.ExistsByNameAsync(request.ViewName, tenantId, id, cancellationToken))
            throw new InvalidOperationException($"A view named '{request.ViewName}' already exists.");

        if (await connRepo.GetByIdAsync(request.ConnectionId, tenantId, cancellationToken) is null)
            throw new InvalidOperationException("Database connection not found.");

        entity.ConnectionId = request.ConnectionId;
        entity.ViewName = request.ViewName;
        entity.Description = request.Description;
        entity.IsDistinct = request.IsDistinct;
        entity.TablesJson = request.TablesJson;
        entity.JoinsJson = request.JoinsJson;
        entity.SelectedColumnsJson = request.SelectedColumnsJson;
        entity.ColumnAliasesJson = request.ColumnAliasesJson;
        entity.FiltersJson = request.FiltersJson;
        entity.GeneratedSql = request.GeneratedSql;
        entity.ManualSql = request.ManualSql;
        entity.TablesUsed = request.TablesUsed;
        entity.ColumnCount = request.ColumnCount;
        entity.ViewType = request.ViewType ?? entity.ViewType;
        entity.ReferencedCteIdsJson = request.ReferencedCteIdsJson;
        entity.ReferencedComponentIdsJson = request.ReferencedComponentIdsJson;
        entity.ModifiedBy = userId;
        entity.ModifiedAt = DateTime.UtcNow;

        var (columnsUsed, tablesUsed) = await CollectViewUsageAsync(entity, tenantId, cancellationToken);
        entity.ColumnsUsed = columnsUsed.Count == 0
            ? null
            : string.Join(",", columnsUsed.Order(StringComparer.OrdinalIgnoreCase));
        if (tablesUsed.Count > 0)
            entity.TablesUsed = string.Join(",", tablesUsed.Order(StringComparer.OrdinalIgnoreCase));
        entity.Reliability = await CalculateReliabilityAsync(entity.ViewName, columnsUsed, entity.Id, cancellationToken);

        try
        {
            await viewRepo.UpdateAsync(entity, cancellationToken);
            var reloaded = await viewRepo.GetByIdAsync(id, tenantId, cancellationToken);
            return reloaded is null ? null : ToDto(reloaded);
        }
        catch (DbUpdateException ex) when (IsDuplicateKeyException(ex))
        {
            throw new InvalidOperationException($"A view named '{request.ViewName}' already exists.");
        }
    }

    public async Task<bool> DeleteAsync(long id, long userId, long tenantId, CancellationToken cancellationToken = default)
        => await viewRepo.SoftDeleteAsync(id, userId, tenantId, cancellationToken);

    public async Task<int> RecalculateReliabilityForRuleAsync(
        string? tableName, string? fields, long tenantId, CancellationToken cancellationToken = default)
    {
        var ruleColumns = GetRuleColumns(new DataRule { TableName = tableName ?? "", Fields = fields });
        if (ruleColumns.Count == 0) return 0;

        var ruleTables = SplitCsv(tableName).Select(BareTableName).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var views = await viewRepo.GetWithColumnsUsedAsync(tenantId, cancellationToken);
        var affected = views
            .Where(view => SplitCsv(view.TablesUsed).Any(table => ruleTables.Contains(BareTableName(table)))
                && ruleColumns.Overlaps(SplitCsv(view.ColumnsUsed)))
            .ToList();
        if (affected.Count == 0) return 0;

        var rules = await reliabilityRepo.GetScoredRulesAsync(cancellationToken);
        foreach (var view in affected)
        {
            var columns = SplitCsv(view.ColumnsUsed).ToHashSet(StringComparer.OrdinalIgnoreCase);
            // Triggered by a table rule: only table-source rules count.
            await viewRepo.UpdateReliabilityAsync(view.Id, tenantId, ScoreForColumns(rules, columns, null), cancellationToken);
        }

        logger.LogInformation("Reliability recalculated for views {ViewIds} after rule on {Table} ran.",
            string.Join(",", affected.Select(view => view.Id)), tableName);
        return affected.Count;
    }

    private static IEnumerable<string> SplitCsv(string? value)
        => (value ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    private static string BareTableName(string table)
        => StripBrackets(table[(table.LastIndexOf('.') + 1)..].Trim());

    /// <summary>
    /// Table-source rules count when they cover a view column; view-source rules count only for their own view
    /// (viewId is null on create, so only table rules apply then).
    /// </summary>
    private static decimal? ScoreForColumns(IReadOnlyList<DataRule> rules, HashSet<string> viewColumns, long? viewId)
    {
        var scores = rules
            .Where(rule => string.Equals(rule.SourceType, "view", StringComparison.OrdinalIgnoreCase)
                ? viewId is not null && rule.ViewId == viewId
                : GetRuleColumns(rule).Overlaps(viewColumns))
            .Select(rule => rule.ReliabilityScore!.Value)
            .ToList();
        return scores.Count == 0 ? null : Math.Floor(scores.Average() * 100m) / 100m;
    }

    /// <summary>
    /// Columns ("schema.table.column") and table names (no schema) used by the view, from both the
    /// builder definition and the view SQL (generated or manual "Edit SQL").
    /// </summary>
    private async Task<(HashSet<string> Columns, HashSet<string> Tables)> CollectViewUsageAsync(
        DatabaseView view, long tenantId, CancellationToken cancellationToken)
    {
        var columns = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var tableKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        try
        {
            var (builderColumns, builderTables) = GetBuilderUsage(view);
            columns.UnionWith(builderColumns);
            tableKeys.UnionWith(builderTables);

            var (sqlColumns, sqlTables) = await ParseSqlUsageAsync(view, tenantId, cancellationToken);
            columns.UnionWith(sqlColumns);
            tableKeys.UnionWith(sqlTables);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "Columns used could not be resolved for view '{ViewName}'.", view.ViewName);
        }

        tableKeys.UnionWith(columns.Select(column => column[..column.LastIndexOf('.')]));
        var tables = tableKeys
            .Select(key => key[(key.LastIndexOf('.') + 1)..])
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        return (columns, tables);
    }

    /// <summary>
    /// Average reliability_score of the applicable DataRules (see <see cref="ScoreForColumns"/>).
    /// </summary>
    private async Task<decimal?> CalculateReliabilityAsync(string viewName, HashSet<string> viewColumns, long? viewId, CancellationToken cancellationToken)
    {
        if (viewColumns.Count == 0 && viewId is null) return null;
        try
        {
            var rules = await reliabilityRepo.GetScoredRulesAsync(cancellationToken);
            return ScoreForColumns(rules, viewColumns, viewId);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "Reliability could not be calculated for view '{ViewName}'.", viewName);
            return null;
        }
    }

    /// <summary>Resolves builder column keys ("alias.column") to "schema.table.column" plus the builder's "schema.table" list.</summary>
    private static (HashSet<string> Columns, HashSet<string> Tables) GetBuilderUsage(DatabaseView view)
    {
        var result = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var tableKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        List<BuilderTable> tables;
        List<string> keys;
        try
        {
            tables = System.Text.Json.JsonSerializer.Deserialize<List<BuilderTable>>(view.TablesJson ?? "[]", CamelCaseJsonOptions) ?? [];
            keys = System.Text.Json.JsonSerializer.Deserialize<List<string>>(view.SelectedColumnsJson ?? "[]", CamelCaseJsonOptions) ?? [];
        }
        catch (System.Text.Json.JsonException)
        {
            return (result, tableKeys);
        }

        var tableByRef = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var table in tables.Where(t => !string.IsNullOrWhiteSpace(t.Name)))
        {
            tableKeys.Add(TableKey(table.Name!));
            foreach (var reference in new[] { table.Id, table.Alias, table.Name }.Where(r => !string.IsNullOrWhiteSpace(r)))
                tableByRef[reference!] = table.Name!;
        }

        foreach (var key in keys)
        {
            var separator = key.IndexOf('.');
            if (separator <= 0 || separator == key.Length - 1) continue;
            var tableRef = key[..separator];
            var column = key[(separator + 1)..];
            if (tableByRef.TryGetValue(tableRef, out var tableName))
                result.Add(ColumnKey(tableName, column));
        }

        return (result, tableKeys);
    }

    private const string SqlIdentifierPart = @"(?:\[(?:[^\]]|\]\])+\]|[A-Za-z_#@][\w@#$]*)";

    private static readonly Regex SqlMultipartIdentifierPattern = new(
        $@"(?<![\w@#$\]]){SqlIdentifierPart}(?:\s*\.\s*{SqlIdentifierPart}){{0,3}}",
        RegexOptions.Compiled);

    private static readonly Regex SqlTableReferencePattern = new(
        $@"\b(?:FROM|JOIN)\s+(?<name>{SqlIdentifierPart}(?:\s*\.\s*{SqlIdentifierPart}){{0,3}})(?:\s+(?:AS\s+)?(?<alias>{SqlIdentifierPart}))?",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly HashSet<string> SqlNonAliasKeywords = new(StringComparer.OrdinalIgnoreCase)
    {
        "WHERE", "ON", "INNER", "LEFT", "RIGHT", "FULL", "CROSS", "OUTER", "JOIN", "GROUP", "ORDER", "HAVING",
        "UNION", "EXCEPT", "INTERSECT", "WITH", "AS", "OPTION", "SELECT", "PIVOT", "UNPIVOT", "APPLY", "WINDOW", "FOR"
    };

    private const int MaxReferencedTables = 200;

    /// <summary>
    /// Parses the view SQL (manual "Edit SQL" text, else generated SQL) for base-table references and every
    /// column token (SELECT, JOIN, WHERE, GROUP BY, CTEs, temp-table staging...). Tokens are kept only when they
    /// are real columns of a referenced table according to the source database metadata.
    /// </summary>
    private async Task<(HashSet<string> Columns, HashSet<string> Tables)> ParseSqlUsageAsync(
        DatabaseView view, long tenantId, CancellationToken cancellationToken)
    {
        var result = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var referencedTables = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var sql = StripCreateViewPrefix(string.IsNullOrWhiteSpace(view.ManualSql) ? view.GeneratedSql : view.ManualSql);
        if (string.IsNullOrWhiteSpace(sql)) return (result, referencedTables);

        var cleaned = Regex.Replace(StripComments(sql), @"N?'([^']|'')*'", "''");

        // alias / table name -> referenced table parts (schema may be null)
        var references = new List<(string? Schema, string Table, string? Alias)>();
        foreach (Match match in SqlTableReferencePattern.Matches(cleaned))
        {
            var parts = SplitIdentifier(match.Groups["name"].Value);
            if (parts[^1].StartsWith('#') || parts[^1].StartsWith('@')) continue;
            var alias = match.Groups["alias"].Success ? StripBrackets(match.Groups["alias"].Value) : null;
            if (alias is not null && SqlNonAliasKeywords.Contains(alias)) alias = null;
            references.Add((parts.Length >= 2 ? parts[^2] : null, parts[^1], alias));
        }
        if (references.Count == 0) return (result, referencedTables);

        var conn = await connRepo.GetByIdAsync(view.ConnectionId, tenantId, cancellationToken);
        if (conn is null) return (result, referencedTables);

        Dictionary<string, HashSet<string>> columnsByTable;
        try
        {
            columnsByTable = await LoadTableColumnsAsync(
                ConnectionPasswordHelper.BuildConnectionString(conn),
                references.Select(r => r.Table).Distinct(StringComparer.OrdinalIgnoreCase).Take(MaxReferencedTables).ToList(),
                cancellationToken);
        }
        catch (SqlException ex)
        {
            logger.LogWarning(ex, "Column metadata could not be loaded for view '{ViewName}'.", view.ViewName);
            return (result, referencedTables);
        }

        // Resolve each reference to the actual "schema.table" keys (bare names may exist in several schemas).
        var tablesByRef = new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase);
        foreach (var (schema, table, alias) in references)
        {
            var keys = columnsByTable.Keys
                .Where(key => key.EndsWith("." + table, StringComparison.OrdinalIgnoreCase)
                    && (schema is null || key.Equals($"{schema}.{table}", StringComparison.OrdinalIgnoreCase)))
                .ToList();
            if (keys.Count == 0) continue;
            // An unqualified name resolves to the default schema when it exists there.
            if (schema is null && keys.Count > 1 && keys.Contains($"dbo.{table}", StringComparer.OrdinalIgnoreCase))
                keys = [$"dbo.{table}"];

            referencedTables.UnionWith(keys);
            foreach (var reference in new[] { table, schema is null ? null : $"{schema}.{table}", alias })
            {
                if (reference is null) continue;
                if (!tablesByRef.TryGetValue(reference, out var set))
                    tablesByRef[reference] = set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                set.UnionWith(keys);
            }
        }
        if (referencedTables.Count == 0) return (result, referencedTables);

        foreach (Match match in SqlMultipartIdentifierPattern.Matches(cleaned))
        {
            var parts = SplitIdentifier(match.Value);
            var column = parts[^1];
            if (column.StartsWith('@') || column.StartsWith('#')) continue;

            IEnumerable<string> candidates;
            if (parts.Length == 1)
                candidates = referencedTables;
            else if (parts.Length >= 3 && tablesByRef.TryGetValue($"{parts[^3]}.{parts[^2]}", out var qualified))
                candidates = qualified;
            else if (tablesByRef.TryGetValue(parts[^2], out var byAlias))
                candidates = byAlias;
            else
                continue;

            foreach (var table in candidates)
            {
                if (columnsByTable[table].TryGetValue(column, out var actualColumn))
                    result.Add(ColumnKey(table, actualColumn));
            }
        }

        return (result, referencedTables);
    }

    private static async Task<Dictionary<string, HashSet<string>>> LoadTableColumnsAsync(
        string connectionString, IReadOnlyList<string> tableNames, CancellationToken cancellationToken)
    {
        var result = new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase);
        if (tableNames.Count == 0) return result;

        await using var sqlConn = new SqlConnection(connectionString);
        await sqlConn.OpenAsync(cancellationToken);
        await using var cmd = sqlConn.CreateCommand();
        cmd.CommandTimeout = 30;

        var parameterNames = new List<string>(tableNames.Count);
        for (var i = 0; i < tableNames.Count; i++)
        {
            var name = $"@t{i}";
            parameterNames.Add(name);
            cmd.Parameters.Add(name, System.Data.SqlDbType.NVarChar, 128).Value = tableNames[i];
        }
        cmd.CommandText = $@"
            SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME IN ({string.Join(", ", parameterNames)});";

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            var key = $"{reader.GetString(0)}.{reader.GetString(1)}";
            if (!result.TryGetValue(key, out var columns))
                result[key] = columns = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            columns.Add(reader.GetString(2));
        }

        return result;
    }

    private static string[] SplitIdentifier(string identifier)
        => Regex.Matches(identifier, SqlIdentifierPart).Select(m => StripBrackets(m.Value).Replace("]]", "]")).ToArray();

    /// <summary>
    /// Expands a rule's table_name ("schema.table[, ...]") and fields ("col" or "schema.table.col")
    /// into "schema.table.column" keys.
    /// </summary>
    private static HashSet<string> GetRuleColumns(DataRule rule)
        => ReliabilityColumns.ForRule(rule.TableName, rule.Fields);

    private static string ColumnKey(string table, string column) => ReliabilityColumns.ColumnKey(table, column);

    private static string TableKey(string table) => ReliabilityColumns.TableKey(table);

    private static string StripBrackets(string identifier) => ReliabilityColumns.StripBrackets(identifier);

    private sealed record BuilderTable(string? Id, string? Name, string? Alias);

    /// <summary>A saved view run as saved (no SQL sent) is timed for the run log; builder previews of edited SQL are not.</summary>
    public async Task<PreviewDatabaseViewResponse?> PreviewAsync(
        PreviewDatabaseViewRequest request, long tenantId, CancellationToken cancellationToken = default)
    {
        if (request.ViewId is not > 0 || !string.IsNullOrWhiteSpace(request.Sql))
            return await RunPreviewAsync(request, tenantId, null, cancellationToken);
        var run = new ViewRun
        {
            ViewId = request.ViewId, SourceName = await viewRepo.GetNameAsync(request.ViewId.Value, tenantId, cancellationToken) ?? $"View {request.ViewId}",
            SourceType = "View", Caller = ViewRunCallers.Preview, UserId = ViewRunTiming.UserIdOf(user),
        };
        return await runs.TimeAsync(run, () => RunPreviewAsync(request, tenantId, run, cancellationToken),
            r => r is null ? (null, ViewRunTiming.NoResult) : (r.Rows.Count, run.Error));
    }

    /// <param name="run">When the source fails and the stored preview is served instead, the failure is kept on it.</param>
    private async Task<PreviewDatabaseViewResponse?> RunPreviewAsync(
        PreviewDatabaseViewRequest request, long tenantId, ViewRun? run, CancellationToken cancellationToken)
    {
        var (connectionId, sql) = await ResolvePreviewSourceAsync(request, tenantId, cancellationToken);
        var hasAdvancedHierarchy = request.Filters?.Any(filter =>
            filter.AdvancedHierarchy is not null && ViewFilterHelper.IsActive(filter)) == true;

        IReadOnlyList<ViewFilterParamValue>? filterParameters = null;
        if (request.Filters is { Count: > 0 })
        {
            var filterResult = ViewFilterHelper.ApplyViewFilters(sql, request.Filters);
            if (filterResult.IsEmptyResult)
            {
                logger.LogWarning("Additional preview filter has no usable placeholder in view; returning empty preview");
                return new PreviewDatabaseViewResponse([], [], 0);
            }
            sql = filterResult.Sql;
            filterParameters = filterResult.Parameters;
        }

        sql = StripCreateViewPrefix(sql);
        ValidatePreviewSql(sql);

        var conn = await connRepo.GetByIdAsync(connectionId, tenantId, cancellationToken);
        if (conn is null) return null;

        // 0 or below means "return everything"; reports need the full result set.
        var maxRows = request.MaxRows > 0 ? request.MaxRows : int.MaxValue;

        var provider = providerFactory.Get(conn);

        PreviewDatabaseViewResponse result;
        try
        {
            result = await ExecutePreviewAsync(provider, conn, sql, maxRows, filterParameters, cancellationToken);
        }
        catch (Exception ex) when (!hasAdvancedHierarchy &&
            (provider.IsTransportException(ex) || ex is TimeoutException or OperationCanceledException))
        {
            var cached = await TryGetCachedPreviewAsync(request.ViewId, tenantId, ex, cancellationToken);
            if (cached is not null)
            {
                if (run is not null) run.Error = $"Served the stored preview: {ex.Message}";
                return cached;
            }
            throw;
        }

        // Small samples (builder 100 rows, shared value 1 row) would replace the stored preview the
        // view page shows first; only full-size runs refresh it.
        if (maxRows >= SnapshotMinRows && !hasAdvancedHierarchy)
            await CachePreviewAsync(request.ViewId, tenantId, result, cancellationToken);
        return result;
    }

    public async Task<(string Sql, SqlPlanFacts? Plan)?> ExplainAsync(AiSqlReviewRequest request, long tenantId, CancellationToken cancellationToken = default)
    {
        var (connectionId, sql) = await ResolvePreviewSourceAsync(new PreviewDatabaseViewRequest(request.ConnectionId, request.Sql, request.ViewId), tenantId, cancellationToken);
        sql = StripCreateViewPrefix(sql);
        ValidatePreviewSql(sql);
        var conn = await connRepo.GetByIdAsync(connectionId, tenantId, cancellationToken);
        if (conn is null) return null;
        if (!string.Equals(conn.Provider, "mssql", StringComparison.OrdinalIgnoreCase)) return (sql, null);
        try { return (sql, await SqlPlanReader.ReadAsync(providerFactory.Get(conn).BuildConnectionString(conn, CommandTimeoutSeconds), sql,
            sqlReview.PlanMaxListed, sqlReview.PlanTimeoutSeconds, cancellationToken)); }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // The AI can still review the text; the plan is an extra.
            logger.LogWarning(ex, "Estimated plan could not be read for connection {ConnectionId}", connectionId);
            return (sql, null);
        }
    }

    /// <summary>
    /// The view grid only carries summary data, so callers may send just a ViewId.
    /// The stored definition is resolved here rather than forcing the client to fetch it.
    /// </summary>
    private async Task<(long ConnectionId, string Sql)> ResolvePreviewSourceAsync(
        PreviewDatabaseViewRequest request, long tenantId, CancellationToken cancellationToken)
    {
        var connectionId = request.ConnectionId;
        var sql = request.Sql;

        if (!string.IsNullOrWhiteSpace(sql) && connectionId > 0)
            return (connectionId, sql);

        // Clients send 0 when no view is selected.
        if (request.ViewId is not > 0)
            throw new InvalidOperationException("Either an SQL query or a view id must be supplied.");

        var source = await viewRepo.GetDetailAsync(request.ViewId.Value, tenantId, cancellationToken)
            ?? throw new InvalidOperationException("Database view not found.");

        if (string.IsNullOrWhiteSpace(sql))
            sql = string.IsNullOrWhiteSpace(source.ManualSql) ? source.GeneratedSql : source.ManualSql;
        if (connectionId <= 0)
            connectionId = source.ConnectionId;

        return (connectionId, sql);
    }

    private async Task<PreviewDatabaseViewResponse?> TryGetCachedPreviewAsync(
        long? viewId, long tenantId, Exception cause, CancellationToken cancellationToken)
    {
        if (!viewId.HasValue) return null;

        var cached = await viewRepo.GetByIdAsync(viewId.Value, tenantId, cancellationToken);
        if (cached?.PreviewColumnsJson is null || cached.PreviewDataJson is null) return null;

        logger.LogWarning(cause, "Live preview failed for view {ViewId}, returning cached data.", viewId.Value);
        var cols = System.Text.Json.JsonSerializer.Deserialize<List<string>>(cached.PreviewColumnsJson, CamelCaseJsonOptions) ?? [];
        var rows = System.Text.Json.JsonSerializer.Deserialize<List<Dictionary<string, object?>>>(cached.PreviewDataJson, CamelCaseJsonOptions) ?? [];
        return new PreviewDatabaseViewResponse(cols, rows, rows.Count);
    }

    public async Task<PreviewSnapshotDto?> GetPreviewSnapshotAsync(
        long id, long tenantId, int maxRows, CancellationToken cancellationToken = default)
    {
        var snap = await viewRepo.GetPreviewSnapshotAsync(id, tenantId, maxRows, cancellationToken);
        if (snap?.ColumnsJson is null) return null;

        var cols = System.Text.Json.JsonSerializer.Deserialize<List<string>>(snap.Value.ColumnsJson, CamelCaseJsonOptions) ?? [];
        var rows = snap.Value.RowsJson is null ? [] :
            System.Text.Json.JsonSerializer.Deserialize<List<Dictionary<string, object?>>>(snap.Value.RowsJson, CamelCaseJsonOptions) ?? [];
        return new PreviewSnapshotDto(cols, rows, snap.Value.RowCount ?? rows.Count, snap.Value.ExecutedAt);
    }

    private async Task CachePreviewAsync(
        long? viewId, long tenantId, PreviewDatabaseViewResponse result, CancellationToken cancellationToken)
    {
        if (!viewId.HasValue) return;

        await viewRepo.SavePreviewAsync(
            viewId.Value, tenantId,
            System.Text.Json.JsonSerializer.Serialize(result.Columns, CamelCaseJsonOptions),
            System.Text.Json.JsonSerializer.Serialize(result.Rows, CamelCaseJsonOptions),
            result.TotalRows, cancellationToken);

        logger.LogInformation(
            "Preview saved for view {ViewId}: {RowCount} rows, {ColCount} columns",
            viewId.Value, result.TotalRows, result.Columns.Count);
    }

    private const string DefaultSourceType = "custom";

    private const int SnapshotMinRows = 1000;

    private static readonly System.Text.Json.JsonSerializerOptions CamelCaseJsonOptions = new()
    {
        PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase,
        WriteIndented = false
    };

    // Disallowed SQL keywords that indicate write/DDL/admin operations
    private static readonly Regex DangerousSqlPattern = new(
        @"\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|EXEC|EXECUTE|xp_|sp_|GRANT|REVOKE|DENY|MERGE|INTO|WAITFOR|KILL|DBCC|BACKUP|RESTORE|RECONFIGURE|SHUTDOWN|USE|SET|OPENROWSET|OPENQUERY|OPENDATASOURCE|BULK)\b",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    // These operations are never valid in a preview, including inside an otherwise permitted
    // temp-table statement. Check them before safe local constructs are removed.
    private static readonly Regex AlwaysForbiddenSqlPattern = new(
        @"\b(EXEC|EXECUTE|xp_|sp_|GRANT|REVOKE|DENY|MERGE|WAITFOR|KILL|DBCC|BACKUP|RESTORE|RECONFIGURE|SHUTDOWN|USE|OPENROWSET|OPENQUERY|OPENDATASOURCE|BULK)\b",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    // Matches DECLARE @name TYPE [= expression]; — rejects values containing dangerous SQL keywords
    private static readonly Regex SimpleDeclarePattern = new(
        @"^\s*DECLARE\s+@\w+\s+[\w(),.\s]+?(\s*=\s*(?!.*\b(DROP|ALTER|EXEC|EXECUTE|INSERT|UPDATE|DELETE|TRUNCATE|CREATE|xp_|sp_)\b)[^;]+)?;",
        RegexOptions.IgnoreCase | RegexOptions.Multiline | RegexOptions.Compiled);

    private static readonly Regex DeclareTablePattern = new(
        @"^\s*DECLARE\s+@\w+\s+TABLE\s*\((?:[^()]*|\([^()]*\))*\)\s*;?",
        RegexOptions.IgnoreCase | RegexOptions.Multiline | RegexOptions.Compiled);

    private static readonly Regex TableVarInsertPattern = new(
        @"\bINSERT\s+INTO\s+@\w+[\s\S]*?;",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    // Local temp-table operations (session-scoped, rolled back with the transaction)
    private static readonly Regex SelectIntoTempPattern = new(
        @"SELECT\b[\s\S]*?\bINTO\s+#\w+\b[\s\S]*?;",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex CreateTempIndexPattern = new(
        @"\bCREATE\s+(?:(?:NON)?CLUSTERED\s+)?INDEX\s+\w+\s+ON\s+#\w+\b[^;]*;",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex DropTempTablePattern = new(
        @"\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?#\w+(?:\s*,\s*#\w+)*\s*;",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex DeleteFromTempPattern = new(
        @"\bDELETE\s+FROM\s+#\w+\b[^;]*;",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex SafeSessionOptionPattern = new(
        @"^\s*SET\s+(?:NOCOUNT|ANSI_NULLS|QUOTED_IDENTIFIER)\s+(?:ON|OFF)\s*;",
        RegexOptions.IgnoreCase | RegexOptions.Multiline | RegexOptions.Compiled);

    private static readonly Regex GoBatchSeparatorPattern = new(
        @"^\s*GO\s*;?\s*$",
        RegexOptions.IgnoreCase | RegexOptions.Multiline | RegexOptions.Compiled);

    private static readonly Regex CtePrefixSemicolonPattern = new(
        @";\s*(?=WITH\b)",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex SetVarPattern = new(
        @"^\s*SET\s+@\w+\s*=\s*(?!.*\b(DROP|ALTER|EXEC|EXECUTE|INSERT|UPDATE|DELETE|TRUNCATE|CREATE|xp_|sp_)\b)[^;]*;",
        RegexOptions.IgnoreCase | RegexOptions.Multiline | RegexOptions.Compiled);

    private static readonly Regex SelectAssignPattern = new(
        @"^\s*SELECT\s+@\w+\s*=\s*(?!.*\b(DROP|ALTER|EXEC|EXECUTE|INSERT|UPDATE|DELETE|TRUNCATE|CREATE|xp_|sp_)\b)[^;]*;",
        RegexOptions.IgnoreCase | RegexOptions.Multiline | RegexOptions.Compiled);

    // "CREATE [OR ALTER|OR REPLACE] VIEW <name> AS" wrapper emitted by the view builder.
    private static readonly Regex CreateViewPrefixPattern = new(
        @"^\s*CREATE\s+(?:OR\s+(?:ALTER|REPLACE)\s+)?VIEW\s+\S+\s+AS\s+",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static string StripCreateViewPrefix(string sql)
        => CreateViewPrefixPattern.Replace(sql, string.Empty);

    private static void ValidatePreviewSql(string sql)
    {
        if (string.IsNullOrWhiteSpace(sql))
            throw new InvalidOperationException("SQL query cannot be empty.");

        if (GoBatchSeparatorPattern.IsMatch(sql))
            throw new InvalidOperationException("Preview SQL cannot contain GO batch separators. Remove GO and submit one SQL batch.");

        // Comments are removed only outside literals and identifiers. This prevents text such as
        // SELECT '--'; DELETE ... from hiding a write operation from validation.
        var stripped = StripComments(sql);

        var strippedNoStrings = Regex.Replace(stripped, @"N?'([^']|'')*'", "''");
        var strippedNoIdentifiers = Regex.Replace(strippedNoStrings, @"\[[^\]]*\]", "[]");
        if (AlwaysForbiddenSqlPattern.IsMatch(strippedNoIdentifiers))
            throw new InvalidOperationException("Preview SQL contains an operation that is not permitted.");

        // Strip safe variable-related constructs before checking for dangerous keywords
        var safe = StripSafeConstructs(stripped);

        // Replace string literals for pattern matching
        var noStrings = Regex.Replace(safe, @"N?'([^']|'')*'", "''");

        // Bracketed identifiers ([My Alias]) are names, never executable SQL — blank out their
        // contents so punctuation/keywords inside a column alias (e.g. "5 days; Hoist", "Set Date")
        // aren't mistaken for a statement separator or a write/DDL keyword below.
        var noIdentifiers = Regex.Replace(noStrings, @"\[[^\]]*\]", "[]");

        if (DangerousSqlPattern.IsMatch(noIdentifiers))
            throw new InvalidOperationException("Preview SQL must be a read-only SELECT statement. Write/DDL operations are not permitted.");

        // SQL Server conventionally prefixes each CTE with a defensive semicolon. Safe staging
        // statements have already been removed, so these are not arbitrary batch separators.
        noIdentifiers = CtePrefixSemicolonPattern.Replace(noIdentifiers, "");

        // Allow a leading ';' (common for CTEs: ;WITH ...) and a trailing ';' terminator.
        var normalized = noIdentifiers.Trim();
        if (normalized.StartsWith(';'))
            normalized = normalized.TrimStart(';').TrimStart();
        if (normalized.EndsWith(';'))
            normalized = normalized.TrimEnd(';').TrimEnd();

        if (normalized.Contains(';'))
            throw new InvalidOperationException("Preview SQL must be a single SELECT statement (no batches or multiple statements).");

        // Must start with SELECT, WITH (CTE), or DECLARE
        var trimmed = safe.TrimStart();
        if (trimmed.StartsWith(';'))
            trimmed = trimmed.TrimStart(';').TrimStart();
        if (!trimmed.StartsWith("SELECT", StringComparison.OrdinalIgnoreCase) &&
            !trimmed.StartsWith("WITH", StringComparison.OrdinalIgnoreCase) &&
            !trimmed.StartsWith("DECLARE", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Preview SQL must begin with SELECT, WITH (CTE), or DECLARE.");
    }

    private static string StripSafeConstructs(string sql)
    {
        var result = sql;
        result = SafeSessionOptionPattern.Replace(result, "");
        result = SelectIntoTempPattern.Replace(result, "");
        result = CreateTempIndexPattern.Replace(result, "");
        result = DropTempTablePattern.Replace(result, "");
        result = DeleteFromTempPattern.Replace(result, "");
        result = DeclareTablePattern.Replace(result, "");
        result = SimpleDeclarePattern.Replace(result, "");
        result = TableVarInsertPattern.Replace(result, "");
        result = SetVarPattern.Replace(result, "");
        result = SelectAssignPattern.Replace(result, "");
        return result;
    }

    private static string StripComments(string sql)
    {
        var result = new System.Text.StringBuilder(sql.Length);
        var i = 0;
        while (i < sql.Length)
        {
            if (sql[i] is '\'' or '"')
            {
                var quote = sql[i];
                result.Append(sql[i++]);
                while (i < sql.Length)
                {
                    result.Append(sql[i]);
                    if (sql[i] == quote)
                    {
                        if (i + 1 < sql.Length && sql[i + 1] == quote)
                            result.Append(sql[++i]);
                        else
                        {
                            i++;
                            break;
                        }
                    }
                    i++;
                }
            }
            else if (sql[i] == '[')
            {
                result.Append(sql[i++]);
                while (i < sql.Length)
                {
                    result.Append(sql[i]);
                    if (sql[i] == ']')
                    {
                        if (i + 1 < sql.Length && sql[i + 1] == ']')
                            result.Append(sql[++i]);
                        else
                        {
                            i++;
                            break;
                        }
                    }
                    i++;
                }
            }
            else if (i + 1 < sql.Length && sql[i] == '-' && sql[i + 1] == '-')
            {
                i += 2;
                while (i < sql.Length && sql[i] is not '\r' and not '\n') i++;
                result.Append(' ');
            }
            else if (i + 1 < sql.Length && sql[i] == '/' && sql[i + 1] == '*')
            {
                var depth = 1;
                i += 2;
                while (i + 1 < sql.Length && depth > 0)
                {
                    if (sql[i] == '/' && sql[i + 1] == '*') { depth++; i += 2; }
                    else if (sql[i] == '*' && sql[i + 1] == '/') { depth--; i += 2; }
                    else { i++; }
                }
                if (depth > 0)
                    throw new InvalidOperationException("Preview SQL contains an unclosed block comment.");
                result.Append(' ');
            }
            else
            {
                result.Append(sql[i]);
                i++;
            }
        }

        return result.ToString();
    }

    public async Task<ViewIndexAdviceResponse?> GetIndexAdviceAsync(
        ViewIndexAdviceRequest request, long tenantId, CancellationToken cancellationToken = default)
    {
        var conn = await connRepo.GetByIdAsync(request.ConnectionId, tenantId, cancellationToken);
        if (conn is null) return null;
        var provider = providerFactory.Get(conn);
        if (provider.Provider != "mssql")
            return new ViewIndexAdviceResponse(false, "Index suggestions are available for SQL Server connections only.", []);

        var usages = ViewIndexAnalysis.Analyze(StripCreateViewPrefix(request.Sql));
        if (usages is null)
            return new ViewIndexAdviceResponse(false, "The SQL could not be read, so its tables could not be found.", []);
        if (usages.Count == 0)
            return new ViewIndexAdviceResponse(true, "The view reads no tables directly (only CTEs or other views).", []);

        await using var sqlConn = provider.CreateConnection(provider.BuildConnectionString(conn, 30));
        await sqlConn.OpenAsync(cancellationToken);

        // Each catalog query is cheap but costs a network round trip, so every database is read in two:
        // one batch for all its tables (ids, schemas, row counts, index columns) and one missing-index read.
        var advice = new Dictionary<ViewTableUsage, ViewTableIndexAdvice>();
        foreach (var group in usages.GroupBy(u => u.Database ?? "", StringComparer.OrdinalIgnoreCase))
        {
            var database = group.First().Database;
            var names = group.ToDictionary(u => u, u => string.Join('.', new[] { u.Database, u.Schema, u.Table }
                .Where(p => !string.IsNullOrEmpty(p)).Select(p => ViewIndexAdvisor.Quote(p!))));
            var catalog = await ReadCatalogAsync(sqlConn, database, names.Values.Distinct().ToList(), cancellationToken);
            var missing = catalog.Values.Any(t => t.ObjectId is not null)
                ? await ReadMissingIndexesAsync(sqlConn, database, cancellationToken)
                : null;

            var db = database is null ? "" : $"{ViewIndexAdvisor.Quote(database)}.";
            foreach (var (usage, name) in names)
            {
                var t = catalog[name];
                advice[usage] = t.ObjectId is not { } id
                    ? ViewIndexAdvisor.Advise(usage, name, null, [], [])
                    : ViewIndexAdvisor.Advise(usage, $"{db}{ViewIndexAdvisor.Quote(t.Schema ?? usage.Schema ?? "dbo")}.{ViewIndexAdvisor.Quote(usage.Table)}",
                        t.RowCount, t.Indexes, missing![id].ToList());
            }
        }
        return new ViewIndexAdviceResponse(true, null, usages.Select(u => advice[u]).ToList());
    }

    /// <summary>Object id, schema, row count and indexes of each named table in one database, in one round trip.</summary>
    private static async Task<Dictionary<string, (int? ObjectId, string? Schema, long? RowCount, List<ExistingIndexInfo> Indexes)>> ReadCatalogAsync(
        System.Data.Common.DbConnection sqlConn, string? database, IReadOnlyList<string> names, CancellationToken cancellationToken)
    {
        // Catalog views live in each database; a three-part name reads that database's catalog.
        var db = database is null ? "" : $"{ViewIndexAdvisor.Quote(database)}.";
        await using var cmd = sqlConn.CreateCommand();
        cmd.CommandTimeout = 30;
        cmd.CommandText = $"""
            DECLARE @t TABLE (name nvarchar(1000), id int);
            INSERT @t SELECT n, OBJECT_ID(n) FROM (VALUES {string.Join(", ", names.Select((_, i) => $"(@n{i})"))}) v(n);
            SELECT t.name, t.id, s.name,
                   (SELECT SUM(p.rows) FROM {db}sys.partitions p WHERE p.object_id = t.id AND p.index_id IN (0, 1))
            FROM @t t
            LEFT JOIN {db}sys.objects o ON o.object_id = t.id
            LEFT JOIN {db}sys.schemas s ON s.schema_id = o.schema_id;
            SELECT i.object_id, i.name, i.type_desc, i.is_unique, i.is_primary_key, c.name, ic.is_included_column
            FROM {db}sys.indexes i
            JOIN {db}sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
            JOIN {db}sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
            WHERE i.object_id IN (SELECT id FROM @t) AND i.type > 0 AND i.is_hypothetical = 0
            ORDER BY i.object_id, i.index_id, ic.is_included_column, ic.key_ordinal, ic.index_column_id;
            """;
        for (var i = 0; i < names.Count; i++) AddParameter(cmd, $"@n{i}", names[i]);

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        var tables = new List<(string Name, int? Id, string? Schema, long? Rows)>();
        while (await reader.ReadAsync(cancellationToken))
            tables.Add((reader.GetString(0), reader.IsDBNull(1) ? null : reader.GetInt32(1),
                reader.IsDBNull(2) ? null : reader.GetString(2), reader.IsDBNull(3) ? null : Convert.ToInt64(reader.GetValue(3))));

        await reader.NextResultAsync(cancellationToken);
        var indexes = new List<(int ObjectId, string Name, string Type, bool Unique, bool Pk, List<string> Keys, List<string> Includes)>();
        while (await reader.ReadAsync(cancellationToken))
        {
            var objectId = reader.GetInt32(0);
            var name = reader.GetString(1);
            if (indexes.Count == 0 || indexes[^1].ObjectId != objectId || indexes[^1].Name != name)
                indexes.Add((objectId, name, reader.GetString(2), reader.GetBoolean(3), reader.GetBoolean(4), [], []));
            (reader.GetBoolean(6) ? indexes[^1].Includes : indexes[^1].Keys).Add(reader.GetString(5));
        }

        return tables.ToDictionary(t => t.Name, t => (t.Id, t.Schema, t.Rows, indexes.Where(i => i.ObjectId == t.Id)
            .Select(i => new ExistingIndexInfo(i.Name, i.Type, i.Unique, i.Pk, i.Keys, i.Includes)).ToList()));
    }

    /// <summary>SQL Server's missing-index statistics; empty when the login may not read server state.</summary>
    private async Task<ILookup<int, MissingIndexInfo>> ReadMissingIndexesAsync(
        System.Data.Common.DbConnection sqlConn, string? database, CancellationToken cancellationToken)
    {
        try
        {
            await using var cmd = sqlConn.CreateCommand();
            cmd.CommandTimeout = 30;
            cmd.CommandText = $"""
                SELECT d.equality_columns, d.inequality_columns, d.included_columns, s.avg_user_impact, d.object_id
                FROM sys.dm_db_missing_index_details d
                JOIN sys.dm_db_missing_index_groups g ON g.index_handle = d.index_handle
                JOIN sys.dm_db_missing_index_group_stats s ON s.group_handle = g.index_group_handle
                WHERE d.database_id = {(database is null ? "DB_ID()" : "DB_ID(@db)")}
                """;
            AddParameter(cmd, "@db", database ?? "");
            var rows = new List<(int ObjectId, MissingIndexInfo Row)>();
            await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
                rows.Add((reader.GetInt32(4), new MissingIndexInfo(
                    SplitColumns(reader, 0), SplitColumns(reader, 1), SplitColumns(reader, 2), Convert.ToDouble(reader.GetValue(3)))));
            return rows.ToLookup(r => r.ObjectId, r => r.Row);
        }
        catch (SqlException ex)
        {
            logger.LogInformation("Missing-index statistics not readable ({Message}); suggestions come from the view only", ex.Message);
            return Array.Empty<(int, MissingIndexInfo)>().ToLookup(r => r.Item1, r => r.Item2);
        }
    }

    /// <summary>"[a], [b]" → a, b.</summary>
    private static List<string> SplitColumns(System.Data.Common.DbDataReader reader, int ordinal)
        => reader.IsDBNull(ordinal) ? [] : reader.GetString(ordinal)
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(c => c.Trim('[', ']').Replace("]]", "]")).ToList();

    private static void AddParameter(System.Data.Common.DbCommand cmd, string name, object value)
    {
        var parameter = cmd.CreateParameter();
        parameter.ParameterName = name;
        parameter.Value = value;
        cmd.Parameters.Add(parameter);
    }

    private async Task<PreviewDatabaseViewResponse> ExecutePreviewAsync(
        ISqlDialectProvider provider, DatabaseConnection conn, string sql, int maxRows,
        IReadOnlyList<ViewFilterParamValue>? parameters, CancellationToken cancellationToken)
    {
        var connectionString = provider.BuildConnectionString(conn, CommandTimeoutSeconds);

        await using var sqlConn = provider.CreateConnection(connectionString);
        await sqlConn.OpenAsync(cancellationToken);

        // Execute within a transaction that is always rolled back, to prevent any data modification.
        // SQL Server opens it with the first statement (IMPLICIT_TRANSACTIONS) instead of a separate
        // round trip; other engines use an explicit transaction.
        var isMsSql = provider.Provider == "mssql";
        var transaction = isMsSql ? null
            : await sqlConn.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted, cancellationToken);
        await using var _ = transaction;

        try
        {
            var preamble = provider.SessionPreambleStatements;
            if (isMsSql)
                preamble = [.. preamble, "SET IMPLICIT_TRANSACTIONS ON"];
            // SET ROWCOUNT also truncates the "SELECT ... INTO #temp" steps of a multi-statement batch,
            // so it is used only for a single SELECT; otherwise the cap is applied while reading, and
            // closing the reader still pulls every remaining row from the server.
            if (maxRows < int.MaxValue && isMsSql && IsSingleSelect(sql))
                preamble = [.. preamble, $"SET ROWCOUNT {maxRows}"];

            // Execute the user's SQL directly — supports all SQL features:
            // SELECT, JOIN, WHERE, GROUP BY, HAVING, ORDER BY, UNION, CTEs, window functions, etc.
            // The preamble rides in the same batch (one round trip) on the SQL's first line, so
            // line numbers in SQL errors still match the user's text.
            await using var cmd = sqlConn.CreateCommand();
            cmd.Transaction = transaction;
            cmd.CommandText = string.Concat(preamble.Select(s => s + ";")) + sql;
            cmd.CommandTimeout = CommandTimeoutSeconds;

            if (parameters is { Count: > 0 })
            {
                foreach (var p in parameters)
                {
                    var param = cmd.CreateParameter();
                    param.ParameterName = p.Name;
                    param.Value = p.Value ?? DBNull.Value;
                    cmd.Parameters.Add(param);
                }
            }

            await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);

            // Temp-table staging steps produce column-less result sets first, so advance
            // to the first result set that actually projects columns.
            var hasColumns = reader.FieldCount > 0;
            while (!hasColumns && await reader.NextResultAsync(cancellationToken))
            {
                hasColumns = reader.FieldCount > 0;
            }

            var columns = new List<string>(reader.FieldCount);
            var seen = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            for (var i = 0; i < reader.FieldCount; i++)
            {
                var name = reader.GetName(i);
                if (seen.TryGetValue(name, out var count))
                {
                    count++;
                    seen[name] = count;
                    name = $"{name}_{count}";
                }
                else
                {
                    seen[name] = 0;
                }

                columns.Add(name);
            }
            var rows = new List<Dictionary<string, object?>>();
            while (rows.Count < maxRows && await reader.ReadAsync(cancellationToken))
            {
                var row = new Dictionary<string, object?>();
                for (var i = 0; i < reader.FieldCount; i++)
                    row[columns[i]] = reader.IsDBNull(i) ? null : reader.GetValue(i);
                rows.Add(row);
            }

            return new PreviewDatabaseViewResponse(columns, rows, rows.Count);
        }
        finally
        {
            // Always rollback — preview is read-only, this ensures no side effects
            if (transaction is not null)
            {
                await transaction.RollbackAsync(cancellationToken);
            }
            else
            {
                await using var rollback = sqlConn.CreateCommand();
                // Also clears the session options: the pooled connection is reused by other queries.
                rollback.CommandText = "IF @@TRANCOUNT > 0 ROLLBACK; SET IMPLICIT_TRANSACTIONS OFF; SET ROWCOUNT 0;";
                await rollback.ExecuteNonQueryAsync(cancellationToken);
            }
        }
    }

    private static bool IsSingleSelect(string sql)
    {
        var script = new Microsoft.SqlServer.TransactSql.ScriptDom.TSql160Parser(initialQuotedIdentifiers: true)
            .Parse(new StringReader(sql), out var errors);
        if (errors.Count > 0) return false;
        var statements = ((Microsoft.SqlServer.TransactSql.ScriptDom.TSqlScript)script).Batches.SelectMany(b => b.Statements).ToList();
        return statements is [Microsoft.SqlServer.TransactSql.ScriptDom.SelectStatement { Into: null }];
    }

    private static bool IsDuplicateKeyException(DbUpdateException ex)
        => ex.InnerException is SqlException sqlEx && (sqlEx.Number == 2601 || sqlEx.Number == 2627);

    private static DatabaseViewDto ToDto(DatabaseView e) => new(
        e.Id, e.ConnectionId, e.Connection?.ConnectionName,
        e.ViewName, e.Description, e.IsDistinct,
        e.TablesJson, e.JoinsJson, e.SelectedColumnsJson,
        e.ColumnAliasesJson, e.FiltersJson,
        e.GeneratedSql, e.ManualSql,
        // Preview snapshot omitted from the response — no consumer reads it and it bloats every getById payload.
        null, null, e.PreviewRowCount, e.PreviewExecutedAt,
        e.TablesUsed, e.ColumnCount, e.RowCount, e.Reliability,
        "The reliability score is calculated using validation rules that check data completeness, reference integrity, data integrity, valid ranges, calculation and formula accuracy, logical consistency, and format validation.",
        e.SourceType, e.ViewType,
        e.ReferencedCteIdsJson, e.ReferencedComponentIdsJson,
        e.TenantId, e.CreatedBy, e.CreatedAt, e.ModifiedBy, e.ModifiedAt,
        CheckContract(e));

    // Same SQL resolution as preview: the hand-edited SQL wins when present.
    private static IReadOnlyList<ViewContractViolation> CheckContract(DatabaseView e)
        => ViewContract.Check(string.IsNullOrWhiteSpace(e.ManualSql) ? e.GeneratedSql : e.ManualSql, e.Description);

    private static DatabaseViewListDto ToListDto(DatabaseView e) => new(
        e.Id, e.ViewName, e.Description,
        e.ConnectionId, e.Connection?.ConnectionName,
        e.TablesUsed, e.ColumnCount, e.RowCount, e.SourceType, e.ViewType,
        e.CreatedAt, e.ModifiedAt);
}
