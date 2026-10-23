using TWise.Tenant.Application.Common;
using System.Text.RegularExpressions;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Infrastructure.Persistence;
using TWise.Tenant.Infrastructure.Services;

namespace TWise.Tenant.Infrastructure.Repositories;

public sealed partial class SourceRepository(TenantDbContext db, IConfiguration configuration, ILogger<SourceRepository> logger) : ISourceRepository
{
    [GeneratedRegex(@"^[A-Za-z_][A-Za-z0-9_]{0,127}$")]
    private static partial Regex SafeIdentifierRegex();

    private static bool IsValidIdentifier(string name) =>
        !string.IsNullOrWhiteSpace(name) && SafeIdentifierRegex().IsMatch(name);

    /// <summary>
    /// A column of a view as people name it ("Purpose Value", "Well ID"). Only ever written as [name]
    /// with "]" doubled, so spaces and punctuation are safe; control characters are not.
    /// </summary>
    private static bool IsValidColumnName(string name) =>
        !string.IsNullOrWhiteSpace(name) && name.Length <= 128 && !name.Any(char.IsControl);
    public async Task<IReadOnlyList<SourceDto>> ListSourcesAsync(CancellationToken ct = default)
    {
        return await db.Database
            .SqlQuery<SourceDto>($"""
                SELECT
                    t.name      AS Name,
                    'Table'     AS SourceType,
                    s.name      AS SchemaName,
                    (SELECT COUNT(*) FROM sys.columns c WHERE c.object_id = t.object_id) AS ColumnCount
                FROM sys.tables t
                JOIN sys.schemas s ON s.schema_id = t.schema_id
                WHERE s.name IN ('core', 'ref', 'raw', 'ml')
                  AND t.is_ms_shipped = 0

                UNION ALL

                SELECT
                    v.name      AS Name,
                    'View'      AS SourceType,
                    s.name      AS SchemaName,
                    (SELECT COUNT(*) FROM sys.columns c WHERE c.object_id = v.object_id) AS ColumnCount
                FROM sys.views v
                JOIN sys.schemas s ON s.schema_id = v.schema_id
                WHERE s.name IN ('core', 'ref', 'raw', 'ml')
                  AND v.is_ms_shipped = 0

                ORDER BY SourceType, Name
                """)
            .ToListAsync(ct);
    }

    // TEMPORARY: list all tables from AlTasnimBI — remove when no longer needed
    public async Task<IReadOnlyList<SourceDto>> ListBITablesAsync(CancellationToken ct = default)
    {
        var cs = configuration.GetConnectionString("AlTasnimBI")
            ?? throw new InvalidOperationException("ConnectionStrings:AlTasnimBI is not configured.");

        await using var conn = new SqlConnection(cs);
        await conn.OpenAsync(ct);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            SELECT
                t.name      AS Name,
                'Table'     AS SourceType,
                s.name      AS SchemaName,
                (SELECT COUNT(*) FROM sys.columns c WHERE c.object_id = t.object_id) AS ColumnCount
            FROM sys.tables t
            JOIN sys.schemas s ON s.schema_id = t.schema_id
            WHERE t.is_ms_shipped = 0
            ORDER BY s.name, t.name
            """;
        cmd.CommandTimeout = 15;

        await using var reader = await cmd.ExecuteReaderAsync(ct);
        var results = new List<SourceDto>();
        while (await reader.ReadAsync(ct))
        {
            results.Add(new SourceDto(
                reader.GetString(0),
                reader.GetString(1),
                reader.GetString(2),
                reader.GetInt32(3)));
        }
        return results;
    }

    public async Task<SyncTimeResponse?> GetSyncTimeAsync(CancellationToken ct = default)
    {
        var cs = configuration.GetConnectionString("AlTasnimBI")
            ?? throw new InvalidOperationException("ConnectionStrings:AlTasnimBI is not configured.");

        await using var conn = new SqlConnection(cs);
        await conn.OpenAsync(ct);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            SELECT TOP 1 DATEADD(HOUR, 4, success_timestamp) AS oman_timestamp
            FROM [log].[MigrationSuccessLog]
            ORDER BY success_timestamp DESC;
            """;
        cmd.CommandTimeout = 15;

        await using var reader = await cmd.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct) || await reader.IsDBNullAsync(0, ct))
            return null;

        return new SyncTimeResponse(new DateTimeOffset(reader.GetDateTime(0), TimeSpan.FromHours(4)));
    }

    public async Task<TableDataDto?> GetTableDataAsync(
        string sourceName, string sourceType, CancellationToken ct = default)
    {
        var isTable = sourceType.Equals("Table", StringComparison.OrdinalIgnoreCase);

        // Tables come from AlTasnimBI; views come from TenantDb
        System.Data.Common.DbConnection conn;
        bool ownedConnection;
        if (isTable)
        {
            var cs = configuration.GetConnectionString("AlTasnimBI")
                ?? throw new InvalidOperationException("ConnectionStrings:AlTasnimBI is not configured.");
            conn = new SqlConnection(cs);
            ownedConnection = true;
            await conn.OpenAsync(ct);
        }
        else
        {
            conn = db.Database.GetDbConnection();
            ownedConnection = false;
            if (conn.State != System.Data.ConnectionState.Open)
                await conn.OpenAsync(ct);
        }

        try
        {
            // Validate name exists and resolve the actual schema
            await using var validateCmd = conn.CreateCommand();
            validateCmd.CommandText = isTable
                ? """
                  SELECT TOP 1 s.name
                  FROM sys.tables t
                  JOIN sys.schemas s ON s.schema_id = t.schema_id
                  WHERE t.name = @name AND t.is_ms_shipped = 0
                  ORDER BY s.name
                  """
                : """
                  SELECT TOP 1 s.name
                  FROM sys.views v
                  JOIN sys.schemas s ON s.schema_id = v.schema_id
                  WHERE s.name IN ('core','ref','raw','ml') AND v.name = @name
                  ORDER BY CASE s.name WHEN 'core' THEN 1 WHEN 'ref' THEN 2 WHEN 'raw' THEN 3 ELSE 4 END
                  """;
            var param = validateCmd.CreateParameter();
            param.ParameterName = "@name";
            param.Value = sourceName;
            validateCmd.Parameters.Add(param);
            var schemaName = (await validateCmd.ExecuteScalarAsync(ct))?.ToString();
            if (string.IsNullOrEmpty(schemaName)) return null;

            // For views (TenantDb), restrict to known schemas; tables (AlTasnimBI) allow any schema
            if (!isTable)
            {
                var allowedSchemas = new[] { "core", "ref", "raw", "ml" };
                if (!allowedSchemas.Contains(schemaName, StringComparer.OrdinalIgnoreCase)) return null;
            }
            if (!IsValidIdentifier(schemaName)) return null;

            var primaryKeys = new List<string>();
            if (isTable)
            {
                await using var primaryKeyCmd = conn.CreateCommand();
                primaryKeyCmd.CommandText = """
                    SELECT column_record.name
                    FROM sys.key_constraints key_constraint
                    INNER JOIN sys.tables table_record ON table_record.object_id = key_constraint.parent_object_id
                    INNER JOIN sys.schemas schema_record ON schema_record.schema_id = table_record.schema_id
                    INNER JOIN sys.index_columns index_column
                        ON index_column.object_id = table_record.object_id
                       AND index_column.index_id = key_constraint.unique_index_id
                    INNER JOIN sys.columns column_record
                        ON column_record.object_id = table_record.object_id
                       AND column_record.column_id = index_column.column_id
                    WHERE key_constraint.type = 'PK'
                      AND schema_record.name = @schemaName
                      AND table_record.name = @tableName
                    ORDER BY index_column.key_ordinal;
                    """;
                var schemaParam = primaryKeyCmd.CreateParameter();
                schemaParam.ParameterName = "@schemaName";
                schemaParam.Value = schemaName;
                primaryKeyCmd.Parameters.Add(schemaParam);
                var tableParam = primaryKeyCmd.CreateParameter();
                tableParam.ParameterName = "@tableName";
                tableParam.Value = sourceName;
                primaryKeyCmd.Parameters.Add(tableParam);
                await using var primaryKeyReader = await primaryKeyCmd.ExecuteReaderAsync(ct);
                while (await primaryKeyReader.ReadAsync(ct))
                    primaryKeys.Add(primaryKeyReader.GetString(0));
            }

            // Name is validated — safe to bracket as identifier
            await using var dataCmd = conn.CreateCommand();
            dataCmd.CommandText = $"SELECT TOP 1000 * FROM [{schemaName}].[{sourceName.Replace("]", "]]")}]";
            dataCmd.CommandTimeout = 60;

            await using var reader = await dataCmd.ExecuteReaderAsync(ct);

            var rawColumns = Enumerable.Range(0, reader.FieldCount)
                .Select(i => reader.GetName(i))
                .ToList();
            var columnTypes = Enumerable.Range(0, reader.FieldCount)
                .ToDictionary(i => reader.GetName(i), i => reader.GetDataTypeName(i), StringComparer.OrdinalIgnoreCase);

            var isDeletedIdx = isTable
                ? rawColumns.FindIndex(c => c.Equals("IsDeleted", StringComparison.OrdinalIgnoreCase))
                : -1;

            var allRows = new List<Dictionary<string, object?>>();
            while (await reader.ReadAsync(ct))
            {
                if (isDeletedIdx >= 0 && !reader.IsDBNull(isDeletedIdx) && reader.GetValue(isDeletedIdx) is true)
                    continue;

                var row = new Dictionary<string, object?>();
                for (var i = 0; i < reader.FieldCount; i++)
                    row[rawColumns[i]] = reader.IsDBNull(i) ? null : reader.GetValue(i);
                allRows.Add(row);
            }

            List<string> columns;
            List<Dictionary<string, object?>> rows;
            if (isTable && isDeletedIdx >= 0)
            {
                var removedCol = rawColumns[isDeletedIdx];
                columns = rawColumns.Where(c => !c.Equals(removedCol, StringComparison.OrdinalIgnoreCase)).ToList();
                rows = allRows.Select(r => { r.Remove(removedCol); return r; }).ToList();
            }
            else
            {
                columns = rawColumns;
                rows = allRows;
            }

            return new TableDataDto(columns, rows, columnTypes, primaryKeys);
        }
        finally
        {
            if (ownedConnection)
                await conn.DisposeAsync();
        }
    }

    public async Task<AggregateResultDto?> GetAggregateAsync(
        AggregateRequestDto request, CancellationToken ct = default)
    {
        var agg = (request.Aggregation ?? "").Trim().ToLowerInvariant();
        var field = request.ValueField?.Trim();
        var needsField = request.Dax is null && agg is "countdistinct" or "total" or "sum" or "average" or "avg" or "value";
        // Any column that gets bracketed into SQL must be a safe identifier (injection guard).
        if (needsField && !IsValidIdentifier(field ?? "")) return null;
        if (request.Dax is null && agg == "count" && !string.IsNullOrEmpty(field) && !IsValidIdentifier(field)) return null;

        var isTable = request.SourceType.Equals("Table", StringComparison.OrdinalIgnoreCase);

        // Tables come from AlTasnimBI; views come from TenantDb (same split as GetTableDataAsync)
        System.Data.Common.DbConnection conn;
        bool ownedConnection;
        if (isTable)
        {
            var cs = configuration.GetConnectionString("AlTasnimBI")
                ?? throw new InvalidOperationException("ConnectionStrings:AlTasnimBI is not configured.");
            conn = new SqlConnection(cs);
            ownedConnection = true;
            await conn.OpenAsync(ct);
        }
        else
        {
            conn = db.Database.GetDbConnection();
            ownedConnection = false;
            if (conn.State != System.Data.ConnectionState.Open)
                await conn.OpenAsync(ct);
        }

        try
        {
            // Resolve the real schema and confirm the source exists (parameterized name — no injection)
            await using var validateCmd = conn.CreateCommand();
            validateCmd.CommandText = isTable
                ? """
                  SELECT TOP 1 s.name
                  FROM sys.tables t
                  JOIN sys.schemas s ON s.schema_id = t.schema_id
                  WHERE t.name = @name AND t.is_ms_shipped = 0
                  ORDER BY s.name
                  """
                : """
                  SELECT TOP 1 s.name
                  FROM sys.views v
                  JOIN sys.schemas s ON s.schema_id = v.schema_id
                  WHERE s.name IN ('core','ref','raw','ml') AND v.name = @name
                  ORDER BY CASE s.name WHEN 'core' THEN 1 WHEN 'ref' THEN 2 WHEN 'raw' THEN 3 ELSE 4 END
                  """;
            var nameParam = validateCmd.CreateParameter();
            nameParam.ParameterName = "@name";
            nameParam.Value = request.SourceName;
            validateCmd.Parameters.Add(nameParam);
            var schemaName = (await validateCmd.ExecuteScalarAsync(ct))?.ToString();
            if (string.IsNullOrEmpty(schemaName) || !IsValidIdentifier(schemaName)) return null;
            if (!isTable)
            {
                var allowedSchemas = new[] { "core", "ref", "raw", "ml" };
                if (!allowedSchemas.Contains(schemaName, StringComparer.OrdinalIgnoreCase)) return null;
            }

            var target = $"[{schemaName}].[{request.SourceName.Replace("]", "]]")}]";
            var col = string.IsNullOrEmpty(field) ? null : $"[{field.Replace("]", "]]")}]";

            // Exclude soft-deleted rows when the table has an IsDeleted column (mirrors GetTableDataAsync).
            var whereClause = "";
            if (isTable)
            {
                await using var colCmd = conn.CreateCommand();
                colCmd.CommandText = """
                    SELECT 1 FROM sys.columns c
                    JOIN sys.tables t ON t.object_id = c.object_id
                    JOIN sys.schemas s ON s.schema_id = t.schema_id
                    WHERE t.name = @name AND s.name = @schema AND c.name = 'IsDeleted'
                    """;
                var cn = colCmd.CreateParameter(); cn.ParameterName = "@name"; cn.Value = request.SourceName; colCmd.Parameters.Add(cn);
                var cs2 = colCmd.CreateParameter(); cs2.ParameterName = "@schema"; cs2.Value = schemaName; colCmd.Parameters.Add(cs2);
                if (await colCmd.ExecuteScalarAsync(ct) is not null)
                    whereClause = "WHERE ([IsDeleted] = 0 OR [IsDeleted] IS NULL)";
            }

            var (selectExpr, top) = agg switch
            {
                "count"            => (col is null ? "COUNT_BIG(*)" : $"COUNT_BIG({col})", false),
                "countdistinct"    => ($"COUNT_BIG(DISTINCT {col})", false),
                "total" or "sum"   => ($"SUM(TRY_CONVERT(float, {col}))", false),
                "average" or "avg" => ($"AVG(TRY_CONVERT(float, {col}))", false),
                "value"            => ($"TRY_CONVERT(float, {col})", true),
                _                  => (col is null ? "COUNT_BIG(*)" : $"COUNT_BIG({col})", false),
            };

            await using var dataCmd = conn.CreateCommand();
            dataCmd.CommandText = top
                ? $"SELECT TOP 1 {selectExpr} AS Val FROM {target} {whereClause}"
                : $"SELECT {selectExpr} AS Val FROM {target} {whereClause}";
            if (request.Dax is { } dax)
            {
                var compiled = new TileDaxSqlCompiler().Compile(dax.Expression, dax.Scope, $"SELECT * FROM {target} {whereClause}");
                dataCmd.CommandText = compiled.Sql;
                foreach (var parameter in compiled.Parameters) dataCmd.Parameters.Add(parameter);
            }
            dataCmd.CommandTimeout = 60;

            var scalar = await dataCmd.ExecuteScalarAsync(ct);
            var value = scalar is null or DBNull ? 0d : Convert.ToDouble(scalar);
            return new AggregateResultDto(value);
        }
        catch (SqlException ex) when (request.Dax is not null)
        {
            logger.LogWarning(ex, "Tile DAX calculation failed for {Source}", request.SourceName);
            throw new InvalidOperationException("The selected DAX measure could not be calculated. Check its columns and value types.", ex);
        }
        finally
        {
            if (ownedConnection)
                await conn.DisposeAsync();
        }
    }

    public async Task<TableDataDto?> GetFilteredChartDataAsync(
        ChartFilteredDataRequest request, CancellationToken ct = default)
    {
        var aggregateTile = request.Dax is not null || !string.IsNullOrWhiteSpace(request.Aggregation);
        if (aggregateTile && (request.ViewId.HasValue
            || !request.ChartSourceType.Equals("Table", StringComparison.OrdinalIgnoreCase)
            || (request.Dax is null && BuildFilteredAggregateSql("SELECT 1", request.Aggregation!, request.ValueField) is null)))
            return null;

        // Validate all user-supplied identifiers before any SQL construction. View-sourced filters
        // are never interpolated into SQL directly (only regex-escaped for @placeholder matching),
        // so real-world column/table names containing spaces etc. are allowed there; table-sourced
        // filters build dynamic SQL identifiers and must stay strictly validated.
        if (!request.ViewId.HasValue && !IsValidIdentifier(request.ChartSource))
            return null;
        if (!request.ViewId.HasValue)
        {
            foreach (var f in request.Filters)
            {
                if (!IsValidIdentifier(f.SourceColumn)) return null;
                if (!string.IsNullOrWhiteSpace(f.SourceTable) && !IsValidIdentifier(f.SourceTable)) return null;
            }
        }

        // Report filters and Top N name columns, always written as [column] (FilterPredicateBuilder and
        // the Top N ORDER BY double "]"), so a name with spaces is fine; a table name stays strict.
        foreach (var f in request.ReportFilters ?? [])
        {
            if (!IsValidColumnName(f.Field)) return null;
            if (!string.IsNullOrWhiteSpace(f.SourceTable) && !IsValidIdentifier(f.SourceTable)) return null;
        }

        if (request.TopN is not null && (!request.TopN.IsValid || !IsValidColumnName(request.TopN.OrderBy)))
            return null;

        System.Data.Common.DbConnection conn;
        bool ownsConnection = false;

        string sql = "";

        // An outer SELECT is added later for report filters and/or Top N. Knowing that up front
        // lets the base query skip its row cap so filtering sees every row, not the first page.
        var willWrap = aggregateTile || (request.ReportFilters?.Count ?? 0) > 0 || request.TopN is { IsValid: true };

        if (request.ViewId.HasValue)
        {
            var dbView = await db.DatabaseViews
                .AsNoTracking()
                .Include(v => v.Connection)
                .FirstOrDefaultAsync(v => v.Id == request.ViewId.Value, ct);
            if (dbView?.Connection is null) return null;
            sql = (dbView.GeneratedSql ?? "").Trim().TrimEnd(';');
            if (string.IsNullOrWhiteSpace(sql)) return null;

            // Use the view's own database connection (same as preview)
            var csb = new SqlConnectionStringBuilder
            {
                DataSource = dbView.Connection.Port == 1433 ? dbView.Connection.Server : $"{dbView.Connection.Server},{dbView.Connection.Port}",
                InitialCatalog = dbView.Connection.DatabaseName,
                UserID = dbView.Connection.Username,
                Password = ConnectionPasswordHelper.Decrypt(dbView.Connection.PasswordHash),
                TrustServerCertificate = dbView.Connection.TrustServerCertificate,
                ConnectTimeout = 15
            };
            conn = new SqlConnection(csb.ConnectionString);
            ownsConnection = true;
        }
        else
        {
            // Tables live in AlTasnimBI (same as GetTableDataAsync), not the tenant DB
            if (request.ChartSourceType.Equals("Table", StringComparison.OrdinalIgnoreCase))
            {
                var cs = configuration.GetConnectionString("AlTasnimBI")
                    ?? throw new InvalidOperationException("ConnectionStrings:AlTasnimBI is not configured.");
                conn = new SqlConnection(cs);
                ownsConnection = true;
            }
            else
            {
                conn = db.Database.GetDbConnection();
            }
        }

        // Capture before opening so finally knows whether to close
        var wasOpen = conn.State == System.Data.ConnectionState.Open;
        if (!wasOpen) await conn.OpenAsync(ct);

        // Views already have their SQL from GeneratedSql; table sources need a base SELECT built
        string? chartSchema = null;
        if (!request.ViewId.HasValue)
        {
            chartSchema = await ResolveSchemaAsync(conn, request.ChartSource, request.ChartSourceType, ct);
            if (chartSchema is null) return null;
            // The row cap is applied by the outermost query. Capping here would truncate BEFORE
            // report filters ran, so a filter would silently search only the first 1000 rows.
            sql = willWrap
                ? $"SELECT * FROM [{chartSchema}].[{request.ChartSource}]"
                : $"SELECT TOP {RowLimit} * FROM [{chartSchema}].[{request.ChartSource}]";
        }

        try
        {
            var activeFilters = request.Filters
                .Where(f => f.Values?.Count > 0 || (!string.IsNullOrWhiteSpace(f.Value)
                         && !f.Value.Equals("All", StringComparison.OrdinalIgnoreCase)))
                .ToList();

            var parameters = new List<System.Data.Common.DbParameter>();

            if (!string.IsNullOrWhiteSpace(request.Mode))
            {
                var mode = request.Mode.ToLowerInvariant();
                if (mode is not ("weekly" or "monthly" or "quarterly" or "yearly")) return null;

                if (request.ViewId.HasValue)
                {
                    var placeholder = FindDeclaredPlaceholder(sql, "mode");
                    if (placeholder is null)
                    {
                        // View doesn't support trend mode grouping — not a hard failure, same as an
                        // interactive filter with no matching @placeholder.
                        logger.LogWarning("View {ViewId} does not declare @mode; requested mode {Mode} was not applied",
                            request.ViewId, mode);
                    }
                    else
                    {
                        const string paramName = "@pMode";
                        var overridden = OverrideDeclaredPlaceholder(sql, placeholder, paramName);
                        if (overridden == sql)
                        {
                            logger.LogWarning("Could not override @mode in view {ViewId}; requested mode {Mode} was not applied",
                                request.ViewId, mode);
                        }
                        else
                        {
                            sql = overridden;
                            var parameter = conn.CreateCommand().CreateParameter();
                            parameter.ParameterName = paramName;
                            parameter.Value = mode;
                            parameters.Add(parameter);
                        }
                    }
                }
            }

            if (request.ViewId.HasValue && !ShouldPreserveFutureDateRange(sql, request))
            {
                if (!TryOverrideDatePlaceholder(request.FromDate, "start_date", "@pFrom")) return null;
                var endDatePlaceholder = FindDeclaredPlaceholder(sql, "future_date") is not null
                    ? "future_date"
                    : "end_date";
                if (!TryOverrideDatePlaceholder(request.ToDate, endDatePlaceholder, "@pTo")) return null;
            }

            bool TryOverrideDatePlaceholder(string? value, string placeholderName, string paramName)
            {
                if (string.IsNullOrWhiteSpace(value)) return true;
                if (!DateOnly.TryParseExact(value, "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture,
                        System.Globalization.DateTimeStyles.None, out var date)) return false;

                var placeholder = FindDeclaredPlaceholder(sql, placeholderName);
                if (placeholder is null)
                {
                    // View doesn't declare this date placeholder (e.g. no global date-range support) —
                    // skip applying it instead of failing the whole request, same tolerance as
                    // unmatched interactive filters below.
                    logger.LogWarning("View {ViewId} does not declare @{Placeholder}; date {Date} was not applied",
                        request.ViewId, placeholderName, value);
                    return true;
                }

                var overridden = OverrideDeclaredPlaceholder(sql, placeholder, paramName);
                if (overridden == sql)
                {
                    logger.LogWarning("Could not override @{Placeholder} in view {ViewId}; date {Date} was not applied",
                        placeholderName, request.ViewId, value);
                    return true;
                }

                sql = overridden;
                var parameter = conn.CreateCommand().CreateParameter();
                parameter.ParameterName = paramName;
                parameter.Value = date.ToDateTime(TimeOnly.MinValue);
                parameters.Add(parameter);
                return true;
            }

            if (activeFilters.Count > 0 && request.ViewId.HasValue)
            {
                var filterResult = ViewFilterHelper.ApplyViewFilters(sql, activeFilters, baseParamIndex: parameters.Count);
                if (filterResult.IsEmptyResult)
                {
                    logger.LogWarning("Additional dashboard filter has no usable placeholder in view {ViewId}; returning no data",
                        request.ViewId);
                    return new TableDataDto([], []);
                }
                sql = filterResult.Sql;
                foreach (var p in filterResult.Parameters)
                {
                    var parameter = conn.CreateCommand().CreateParameter();
                    parameter.ParameterName = p.Name;
                    parameter.Value = p.Value ?? DBNull.Value;
                    parameters.Add(parameter);
                }
            }
            else if (activeFilters.Count > 0)
            {
                // Table source: same-table filters use a direct WHERE; cross-table filters are
                // joined in via foreign-key paths (same discovery used for views).
                const string baseAlias = "_base";
                var joinClauses = new System.Text.StringBuilder();
                var whereParts = new List<string>();
                var joinAliasSeq = 0;

                string FilterPredicate(string column, ChartFilterParam filter)
                {
                    var values = filter.ControlType.Equals("MultiSelect", StringComparison.OrdinalIgnoreCase)
                        ? filter.Values?.ToArray() ?? filter.Value.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                        : new[] { filter.Value };
                    if (values.Length == 0) return "1 = 0";
                    var names = new List<string>();
                    foreach (var value in values)
                    {
                        var parameter = conn.CreateCommand().CreateParameter();
                        parameter.ParameterName = $"@p{parameters.Count}";
                        parameter.Value = value;
                        parameters.Add(parameter);
                        names.Add(parameter.ParameterName);
                    }
                    return $"{column} IN ({string.Join(", ", names)})";
                }

                foreach (var filter in activeFilters)
                {
                    var safeFilterCol = filter.SourceColumn.Replace("]", "]]");
                    var sameTable = string.IsNullOrWhiteSpace(filter.SourceTable)
                                 || filter.SourceTable.Equals(request.ChartSource, StringComparison.OrdinalIgnoreCase);

                    if (sameTable)
                    {
                        // Schema drift guard: a saved filter may reference a column that was since
                        // renamed/removed — skip it instead of letting SQL fail the whole chart.
                        if (!await ColumnExistsAsync(conn, chartSchema!, request.ChartSource, filter.SourceColumn, ct))
                        {
                            logger.LogWarning("Filter column {Column} no longer exists on {Table} \u2014 {FilterResult}",
                                filter.SourceColumn, request.ChartSource,
                                filter.DashboardAdditional ? "returning no data" : "filter ignored");
                            if (filter.DashboardAdditional) return new TableDataDto([], []);
                            continue;
                        }
                        whereParts.Add(FilterPredicate($"{baseAlias}.[{safeFilterCol}]", filter));
                    }
                    else
                    {
                        var path = await FindFkPathAsync(conn,
                            new HashSet<string>(StringComparer.OrdinalIgnoreCase) { request.ChartSource },
                            filter.SourceTable, ct);
                        if (path is null || path.Count == 0)
                        {
                            // Best-effort global filter (e.g. cluster/plant): if the source table has no
                            // FK path to the filter table, skip it and leave the data unfiltered.
                            if (filter.Optional)
                            {
                                logger.LogInformation("Optional filter table {FilterTable} has no FK path into {ChartSource} \u2014 filter skipped",
                                    filter.SourceTable, request.ChartSource);
                                continue;
                            }
                            logger.LogWarning("Cannot join filter table {FilterTable} into table {ChartSource}; filtered request rejected",
                                filter.SourceTable, request.ChartSource);
                            return null;
                        }

                        var lastEdge = path[^1];
                        if (!await ColumnExistsAsync(conn, lastEdge.TargetSchema, lastEdge.TargetTable, filter.SourceColumn, ct))
                        {
                            logger.LogWarning("Filter column {Column} no longer exists on {Table} \u2014 {FilterResult}",
                                filter.SourceColumn, filter.SourceTable,
                                filter.DashboardAdditional ? "returning no data" : "filter ignored");
                            if (filter.DashboardAdditional) return new TableDataDto([], []);
                            continue;
                        }

                        var fromAlias = baseAlias;
                        var lastAlias = baseAlias;
                        foreach (var edge in path)
                        {
                            var newAlias = $"_j{joinAliasSeq++}";
                            var st = edge.TargetSchema.Replace("]", "]]");
                            var tt = edge.TargetTable.Replace("]", "]]");
                            var tc = edge.TargetColumn.Replace("]", "]]");
                            var sc = edge.SourceColumn.Replace("]", "]]");
                            joinClauses.Append($"\nINNER JOIN [{st}].[{tt}] {newAlias} ON {newAlias}.[{tc}] = {fromAlias}.[{sc}]");
                            fromAlias = newAlias;
                            lastAlias = newAlias;
                        }
                        whereParts.Add(FilterPredicate($"{lastAlias}.[{safeFilterCol}]", filter));
                    }
                }

                var safeChartSource = request.ChartSource.Replace("]", "]]");
                var topClause = willWrap ? "" : $"TOP {RowLimit} ";
                sql = $"SELECT {topClause}{baseAlias}.* FROM [{chartSchema}].[{safeChartSource}] {baseAlias}"
                    + joinClauses;
                if (whereParts.Count > 0)
                    sql += " WHERE " + string.Join(" AND ", whereParts);
            }

            // Apply global date range filter (table sources only — views manage dates via their own SQL)
            if (!request.ViewId.HasValue
                && (!string.IsNullOrWhiteSpace(request.FromDate) || !string.IsNullOrWhiteSpace(request.ToDate)))
            {
                var dateCol = FindDateColumn(sql, conn, ct);
                if (dateCol is not null)
                {
                    var hasWhere = sql.Contains(" WHERE ", StringComparison.OrdinalIgnoreCase);
                    var safeDate = dateCol.Replace("]", "]]");
                    // Rows where the guessed date column is NULL aren't excluded — the column may be an
                    // unrelated business date (e.g. a PO date) rather than the row's actual record date.
                    if (!string.IsNullOrWhiteSpace(request.FromDate))
                    {
                        var pName = $"@pFrom";
                        sql += (hasWhere ? " AND " : " WHERE ") + $"([{safeDate}] IS NULL OR [{safeDate}] >= {pName})";
                        hasWhere = true;
                        var p = conn.CreateCommand().CreateParameter();
                        p.ParameterName = pName;
                        p.Value = request.FromDate;
                        parameters.Add(p);
                    }
                    if (!string.IsNullOrWhiteSpace(request.ToDate))
                    {
                        var pName = $"@pTo";
                        sql += (hasWhere ? " AND " : " WHERE ") + $"([{safeDate}] IS NULL OR [{safeDate}] <= {pName})";
                        var p = conn.CreateCommand().CreateParameter();
                        p.ParameterName = pName;
                        p.Value = request.ToDate;
                        parameters.Add(p);
                    }
                }
            }

            // ── Report-level filters (operators, AND/OR, relative dates) ──────────
            // Applied by wrapping the query built so far, so neither a view's stored SQL nor
            // the table path's joins have to be rewritten.
            var reportFilters = request.ReportFilters ?? [];
            if (reportFilters.Count > 0)
            {
                // A WITH view is read through one more CTE named _rf; a plain SELECT as a derived table.
                // The view's own ORDER BY is dropped: SQL Server rejects it inside a wrapped query, and
                // keeping it meant the filters were skipped and every row came back.
                if (ViewSqlWrapper.Wrap(sql, "_rf", stripOrderBy: true) is { } rfSource)
                {
                    var predicate = FilterPredicateBuilder.Build(
                        reportFilters, "_rf", () => conn.CreateCommand().CreateParameter(), parameters.Count);

                    foreach (var reason in predicate.Skipped)
                        logger.LogWarning("Report filter skipped for {Source}: {Reason}", request.ChartSource, reason);

                    if (predicate.Sql.Length > 0)
                    {
                        // Cap here unless Top N is about to wrap again and impose its own.
                        var cap = aggregateTile || request.TopN is { IsValid: true } ? "" : $"TOP {RowLimit} ";
                        sql = $"{rfSource.Head}SELECT {cap}* FROM {rfSource.Relation} WHERE {predicate.Sql}";
                        parameters.AddRange(predicate.Parameters);
                    }
                }
                else
                {
                    // A multi-statement view (DECLARE/temp tables) cannot be used as a subquery.
                    // Skipping loudly beats emitting SQL that fails or silently ignores filters.
                    logger.LogWarning(
                        "Report filters ignored for ViewId {ViewId}: its SQL is a multi-statement batch and cannot be wrapped.",
                        request.ViewId);
                }
            }

            // ── Top N / Bottom N ──────────────────────────────────────────────────
            if (request.TopN is { IsValid: true } topN)
            {
                // Top N orders by its own column, so the view's ORDER BY is not needed.
                if (ViewSqlWrapper.Wrap(sql, "_tn", stripOrderBy: true) is { } tnSource)
                {
                    var direction = topN.IsBottom ? "ASC" : "DESC";
                    var orderCol = topN.OrderBy.Replace("]", "]]");
                    // Count is an int validated > 0, so it is safe to inline; SQL Server does not
                    // allow a parameter in TOP without OFFSET/FETCH.
                    sql = $"{tnSource.Head}SELECT TOP ({topN.Count}) * FROM {tnSource.Relation} ORDER BY _tn.[{orderCol}] {direction}";
                }
                else
                {
                    logger.LogWarning(
                        "Top N ignored for ViewId {ViewId}: its SQL is a multi-statement batch and cannot be wrapped.",
                        request.ViewId);
                }
            }

            if (aggregateTile)
            {
                if (await ColumnExistsAsync(conn, chartSchema!, request.ChartSource, "IsDeleted", ct))
                    sql = $"SELECT * FROM ({sql}) _active WHERE ([IsDeleted] = 0 OR [IsDeleted] IS NULL)";
                if (request.Dax is { } dax)
                {
                    var compiled = new TileDaxSqlCompiler().Compile(dax.Expression, dax.Scope, sql);
                    sql = compiled.Sql;
                    parameters.AddRange(compiled.Parameters);
                }
                else
                    sql = BuildFilteredAggregateSql(sql, request.Aggregation!, request.ValueField)!;
            }

            logger.LogDebug("Filtered chart SQL generated for ViewId {ViewId} (length {Length})", request.ViewId, sql.Length);

            await using var cmd = conn.CreateCommand();
            cmd.CommandText = sql;
            cmd.CommandTimeout = 60;
            foreach (var p in parameters) cmd.Parameters.Add(p);

            // SQL Server may raise a conversion error either on execute or on the first read,
            // depending on the plan — so both are covered by one guard.
            try
            {
                await using var reader = await cmd.ExecuteReaderAsync(ct);

                var rawColumns = Enumerable.Range(0, reader.FieldCount).Select(i => reader.GetName(i)).ToList();
                var rows = new List<Dictionary<string, object?>>();
                while (await reader.ReadAsync(ct))
                {
                    if (rows.Count >= RowLimit) break;
                    var row = new Dictionary<string, object?>();
                    for (var i = 0; i < reader.FieldCount; i++)
                        row[rawColumns[i]] = reader.IsDBNull(i) ? null : reader.GetValue(i);
                    rows.Add(row);
                }

                return new TableDataDto(rawColumns, rows);
            }
            catch (SqlException ex) when (request.Dax is not null)
            {
                logger.LogWarning(ex, "Filtered tile DAX calculation failed for {Source}", request.ChartSource);
                throw new InvalidOperationException("The selected DAX measure could not be calculated. Check its columns and value types.", ex);
            }
            catch (SqlException ex) when (ex.Number is ConversionFailedError or OperandTypeClashError)
            {
                // A filter value that will not convert to the column's type (e.g. text typed
                // into a numeric field). User-fixable, so it must not surface as a 502.
                logger.LogWarning(ex, "Filter value type mismatch for {Source}", request.ChartSource);
                throw new InvalidOperationException(
                    "A filter value does not match the type of the column it filters on. " +
                    "Check that numeric and date filters use matching values.", ex);
            }
        }
        finally
        {
            if (ownsConnection) await conn.DisposeAsync();
            else if (!wasOpen) conn.Close();
        }
    }

    /// Extracts table names from FROM/JOIN clauses (e.g. "core.Well" → "Well")
    private static HashSet<string> ExtractTablesFromSql(string sql)
    {
        var tables = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var pattern = new System.Text.RegularExpressions.Regex(
            @"(?:FROM|JOIN)\s+(?:\[?(\w+)\]?\.)?\[?(\w+)\]?",
            System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        foreach (System.Text.RegularExpressions.Match m in pattern.Matches(sql))
            tables.Add(m.Groups[2].Value);
        return tables;
    }

    private record FkEdge(string SourceTable, string SourceSchema, string SourceColumn,
                          string TargetTable, string TargetSchema, string TargetColumn);

    private static async Task<bool> ColumnExistsAsync(
        System.Data.Common.DbConnection conn, string schema, string table, string column, CancellationToken ct)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            SELECT 1
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @table AND COLUMN_NAME = @column
            """;

        foreach (var (name, value) in new[] { ("@schema", schema), ("@table", table), ("@column", column) })
        {
            var parameter = cmd.CreateParameter();
            parameter.ParameterName = name;
            parameter.Value = value;
            cmd.Parameters.Add(parameter);
        }

        return await cmd.ExecuteScalarAsync(ct) is not null;
    }

    /// BFS through sys.foreign_key_columns to find a path from any table in the view to the filter table.
    private static async Task<List<FkEdge>?> FindFkPathAsync(
        System.Data.Common.DbConnection conn, HashSet<string> sourceTables,
        string targetTable, CancellationToken ct)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
            SELECT pt.name, ps.name, COL_NAME(fkc.parent_object_id, fkc.parent_column_id),
                   rt.name, rs.name, COL_NAME(fkc.referenced_object_id, fkc.referenced_column_id)
            FROM sys.foreign_key_columns fkc
            JOIN sys.tables pt ON pt.object_id = fkc.parent_object_id
            JOIN sys.schemas ps ON ps.schema_id = pt.schema_id
            JOIN sys.tables rt ON rt.object_id = fkc.referenced_object_id
            JOIN sys.schemas rs ON rs.schema_id = rt.schema_id
            WHERE ps.name NOT IN ('sys','INFORMATION_SCHEMA') AND rs.name NOT IN ('sys','INFORMATION_SCHEMA')";
        var allEdges = new List<FkEdge>();
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
            allEdges.Add(new FkEdge(reader.GetString(0), reader.GetString(1), reader.GetString(2),
                                    reader.GetString(3), reader.GetString(4), reader.GetString(5)));

        // Build adjacency list (bidirectional)
        var adj = new Dictionary<string, List<(string Neighbor, FkEdge Edge, bool Reversed)>>(StringComparer.OrdinalIgnoreCase);
        foreach (var e in allEdges)
        {
            if (!adj.ContainsKey(e.SourceTable)) adj[e.SourceTable] = [];
            if (!adj.ContainsKey(e.TargetTable)) adj[e.TargetTable] = [];
            adj[e.SourceTable].Add((e.TargetTable, e, false));
            adj[e.TargetTable].Add((e.SourceTable, e, true));
        }

        if (!adj.ContainsKey(targetTable)) return null;

        // BFS from each source table, find shortest path to targetTable
        var queue = new Queue<(string Table, List<FkEdge> Path)>();
        var visited = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var src in sourceTables.Where(adj.ContainsKey))
        {
            queue.Enqueue((src, []));
            visited.Add(src);
        }

        while (queue.Count > 0)
        {
            var (current, path) = queue.Dequeue();
            if (current.Equals(targetTable, StringComparison.OrdinalIgnoreCase))
                return path;

            if (!adj.TryGetValue(current, out var neighbors)) continue;
            foreach (var (neighbor, edge, reversed) in neighbors)
            {
                if (visited.Contains(neighbor)) continue;
                visited.Add(neighbor);
                var edgeForPath = reversed
                    ? new FkEdge(edge.TargetTable, edge.TargetSchema, edge.TargetColumn,
                                 edge.SourceTable, edge.SourceSchema, edge.SourceColumn)
                    : edge;
                var newPath = new List<FkEdge>(path) { edgeForPath };
                queue.Enqueue((neighbor, newPath));
            }
        }
        return null;
    }

    /// Builds "INNER JOIN [schema].[Table] _fN ON ..." snippet for a FK path.
    private static string BuildJoinSnippet(List<FkEdge> path)
    {
        var sb = new System.Text.StringBuilder();
        for (int i = 0; i < path.Count; i++)
        {
            var e = path[i];
            var alias = $"_f{i}";
            var safeTarget = e.TargetTable.Replace("]", "]]");
            var safeTgtCol = e.TargetColumn.Replace("]", "]]");
            var safeSrcCol = e.SourceColumn.Replace("]", "]]");
            // For the first hop, join against the source table's alias used in the view SQL.
            // We match by finding the alias in the existing FROM/JOIN for that table.
            if (i == 0)
            {
                sb.Append($"\nINNER JOIN [{e.TargetSchema}].[{safeTarget}] {alias} ON {alias}.[{safeTgtCol}] = ");
                // The source column reference needs the alias from the original SQL — 
                // we use a regex replacement later to resolve it, so just emit table.col here
                sb.Append($"/*src*/.[{safeSrcCol}]");
            }
            else
            {
                var prevAlias = $"_f{i - 1}";
                sb.Append($"\nINNER JOIN [{e.TargetSchema}].[{safeTarget}] {alias} ON {alias}.[{safeTgtCol}] = {prevAlias}.[{safeSrcCol}]");
            }
        }
        return sb.ToString();
    }

    /// Injects JOIN + WHERE into each top-level SELECT block of the SQL.
    private static string InjectFilterIntoSql(string sql, string joinSnippet,
        string filterAlias, string filterColumn, string paramName)
    {
        // Split the SQL into CTE prefix and main body
        string ctePrefix = "";
        string body = sql.TrimStart(';').TrimStart();

        if (body.StartsWith("WITH ", StringComparison.OrdinalIgnoreCase))
        {
            int d = 0;
            bool pastCte = false;
            int mainStart = -1;
            for (int i = 0; i <= body.Length - 6; i++)
            {
                if (body[i] == '(') d++;
                else if (body[i] == ')') { d--; if (d == 0) pastCte = true; }
                else if (d == 0 && pastCte
                         && string.Compare(body, i, "SELECT", 0, 6, StringComparison.OrdinalIgnoreCase) == 0
                         && (i == 0 || !char.IsLetterOrDigit(body[i - 1]))
                         && (i + 6 >= body.Length || !char.IsLetterOrDigit(body[i + 6])))
                {
                    mainStart = i;
                    break;
                }
            }
            if (mainStart > 0)
            {
                ctePrefix = body[..mainStart];
                body = body[mainStart..];
            }
        }

        // Split body on top-level UNION ALL
        var blocks = SplitOnTopLevelUnion(body);

        var sb = new System.Text.StringBuilder();
        sb.Append(ctePrefix);

        for (int bi = 0; bi < blocks.Count; bi++)
        {
            if (bi > 0) sb.Append("\nUNION ALL\n");
            var block = blocks[bi];

            // Find the alias of the source table in this block's FROM clause
            var resolvedJoin = ResolveJoinSourceAlias(block, joinSnippet);

            // Find WHERE position to inject the filter condition
            int wherePos = FindTopLevelKeyword(block, "WHERE");
            int groupByPos = FindTopLevelKeyword(block, "GROUP BY");
            int havingPos = FindTopLevelKeyword(block, "HAVING");
            int orderByPos = FindTopLevelKeyword(block, "ORDER BY");

            // Find the end of the FROM/JOIN clause to inject our JOINs
            int insertJoinAt = FindJoinInsertPosition(block);

            var result = new System.Text.StringBuilder();
            result.Append(block[..insertJoinAt]);
            result.Append(resolvedJoin);

            string remainder = block[insertJoinAt..].TrimStart();
            if (remainder.Length > 0) result.Append('\n');

            var safeFilterCol = filterColumn.Replace("]", "]]");
            string filterCondition = $"{filterAlias}.[{safeFilterCol}] = {paramName}";

            int whereInRemainder = FindTopLevelKeyword(remainder, "WHERE");
            if (whereInRemainder >= 0)
            {
                // WHERE exists: insert AND after WHERE keyword+space
                int afterWhere = whereInRemainder + 5;
                while (afterWhere < remainder.Length && char.IsWhiteSpace(remainder[afterWhere])) afterWhere++;
                result.Append(remainder[..afterWhere]);
                result.Append(filterCondition).Append(" AND\n  ");
                result.Append(remainder[afterWhere..]);
            }
            else
            {
                // No WHERE: insert before GROUP BY / HAVING / ORDER BY or at end
                int insertWhereAt = remainder.Length;
                foreach (var kw in new[] { "GROUP BY", "HAVING", "ORDER BY" })
                {
                    int pos = FindTopLevelKeyword(remainder, kw);
                    if (pos >= 0 && pos < insertWhereAt) insertWhereAt = pos;
                }
                result.Append(remainder[..insertWhereAt]);
                result.Append($"\n  WHERE {filterCondition}");
                if (insertWhereAt < remainder.Length)
                    result.Append('\n').Append(remainder[insertWhereAt..]);
            }

            sb.Append(result);
        }

        return sb.ToString();
    }

    /// Resolves the /*src*/ placeholder in the join snippet to the actual alias used for
    /// the FK source table in the SQL block.
    private static string ResolveJoinSourceAlias(string block, string joinSnippet)
    {
        if (!joinSnippet.Contains("/*src*/")) return joinSnippet;

        // Extract the source column name from the join snippet
        var srcMatch = System.Text.RegularExpressions.Regex.Match(joinSnippet, @"/\*src\*/\.\[(\w+)\]");
        if (!srcMatch.Success) return joinSnippet;
        var srcCol = srcMatch.Groups[1].Value;

        // Find which alias in the block references this column via FROM/JOIN
        // Look for patterns like: alias.col or [schema].[table] alias
        var fromJoinPattern = new System.Text.RegularExpressions.Regex(
            @"(?:FROM|JOIN)\s+(?:\[?\w+\]?\.)?\[?(\w+)\]?\s+(\w+)",
            System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        foreach (System.Text.RegularExpressions.Match m in fromJoinPattern.Matches(block))
        {
            var alias = m.Groups[2].Value;
            // Check if this alias is used with the source column elsewhere in the block
            if (block.Contains($"{alias}.{srcCol}", StringComparison.OrdinalIgnoreCase)
                || block.Contains($"{alias}.[{srcCol}]", StringComparison.OrdinalIgnoreCase))
            {
                return joinSnippet.Replace("/*src*/", alias);
            }
        }

        // Fallback: find any alias from a FROM clause
        var fallback = fromJoinPattern.Match(block);
        if (fallback.Success)
            return joinSnippet.Replace("/*src*/", fallback.Groups[2].Value);

        return joinSnippet.Replace("/*src*/", "t0");
    }

    /// Splits SQL on top-level UNION ALL (not inside parentheses).
    private static List<string> SplitOnTopLevelUnion(string sql)
    {
        var blocks = new List<string>();
        int depth = 0, start = 0;
        for (int i = 0; i < sql.Length; i++)
        {
            if (sql[i] == '(') depth++;
            else if (sql[i] == ')') depth--;
            else if (depth == 0 && i + 9 <= sql.Length
                     && string.Compare(sql, i, "UNION ALL", 0, 9, StringComparison.OrdinalIgnoreCase) == 0)
            {
                blocks.Add(sql[start..i].Trim());
                start = i + 9;
            }
        }
        blocks.Add(sql[start..].Trim());
        return blocks;
    }

    /// Finds position to insert JOINs: after the last FROM/JOIN ... alias clause before WHERE/GROUP BY.
    private static int FindJoinInsertPosition(string block)
    {
        int depth = 0, lastJoinEnd = -1;
        var keywords = new[] { "FROM", "JOIN" };
        for (int i = 0; i < block.Length; i++)
        {
            if (block[i] == '(') depth++;
            else if (block[i] == ')') depth--;
            else if (depth == 0)
            {
                foreach (var kw in keywords)
                {
                    if (i + kw.Length <= block.Length
                        && string.Compare(block, i, kw, 0, kw.Length, StringComparison.OrdinalIgnoreCase) == 0
                        && (i == 0 || !char.IsLetterOrDigit(block[i - 1]))
                        && (i + kw.Length >= block.Length || !char.IsLetterOrDigit(block[i + kw.Length])))
                    {
                        // Scan past the table reference and optional alias
                        int j = i + kw.Length;
                        while (j < block.Length && char.IsWhiteSpace(block[j])) j++;
                        // Skip schema.table or [schema].[table]
                        while (j < block.Length && (char.IsLetterOrDigit(block[j]) || block[j] == '.' || block[j] == '[' || block[j] == ']' || block[j] == '_')) j++;
                        while (j < block.Length && char.IsWhiteSpace(block[j])) j++;
                        // Skip alias
                        while (j < block.Length && (char.IsLetterOrDigit(block[j]) || block[j] == '_')) j++;
                        // Skip ON clause for JOINs
                        if (kw != "FROM")
                        {
                            int onPos = FindTopLevelKeyword(block[j..], "ON");
                            if (onPos >= 0)
                            {
                                j += onPos + 2;
                                // Skip past the ON condition (until next top-level keyword)
                                int condDepth = 0;
                                while (j < block.Length)
                                {
                                    if (block[j] == '(') condDepth++;
                                    else if (block[j] == ')') condDepth--;
                                    else if (condDepth == 0)
                                    {
                                        bool isKw = false;
                                        foreach (var next in new[] { "WHERE", "GROUP", "HAVING", "ORDER", "INNER", "LEFT", "RIGHT", "CROSS", "JOIN", "UNION" })
                                        {
                                            if (j + next.Length <= block.Length
                                                && string.Compare(block, j, next, 0, next.Length, StringComparison.OrdinalIgnoreCase) == 0
                                                && (j == 0 || !char.IsLetterOrDigit(block[j - 1])))
                                            {
                                                isKw = true;
                                                break;
                                            }
                                        }
                                        if (isKw) break;
                                    }
                                    j++;
                                }
                            }
                        }
                        lastJoinEnd = j;
                    }
                }
            }
        }
        return lastJoinEnd > 0 ? lastJoinEnd : block.Length;
    }

    /// Finds the position of a top-level SQL keyword (not inside parentheses).
    private static int FindTopLevelKeyword(string sql, string keyword)
    {
        int depth = 0;
        for (int i = 0; i <= sql.Length - keyword.Length; i++)
        {
            if (sql[i] == '(') depth++;
            else if (sql[i] == ')') depth--;
            else if (depth == 0
                     && string.Compare(sql, i, keyword, 0, keyword.Length, StringComparison.OrdinalIgnoreCase) == 0
                     && (i == 0 || !char.IsLetterOrDigit(sql[i - 1]))
                     && (i + keyword.Length >= sql.Length || !char.IsLetterOrDigit(sql[i + keyword.Length])))
                return i;
        }
        return -1;
    }

    private static string? ResolveChartFilterPlaceholder(string sql, ChartFilterParam filter) =>
        ViewFilterHelper.ResolveChartFilterPlaceholder(sql, filter);

    private static bool CanApplyAdditionalViewFilters(string sql, IReadOnlyList<ChartFilterParam> filters) =>
        ViewFilterHelper.CanApplyAdditionalFilters(sql, filters);

    private static string? NormalizePlaceholderName(string? name) =>
        ViewFilterHelper.NormalizePlaceholderName(name);

    private static bool ShouldPreserveFutureDateRange(string sql, ChartFilteredDataRequest request) =>
        request.ViewId.HasValue && request.PreserveFutureDateRange &&
        FindDeclaredPlaceholder(sql, "future_date") is not null;

    private static string? FindDeclaredPlaceholder(string sql, string? name) =>
        ViewFilterHelper.FindDeclaredPlaceholder(sql, name);

    private static string OverrideDeclaredPlaceholder(string sql, string placeholder, string paramName) =>
        ViewFilterHelper.OverrideDeclaredPlaceholder(sql, placeholder, paramName);

    private static async Task<string?> ResolveSchemaAsync(
        System.Data.Common.DbConnection conn, string name, string sourceType, CancellationToken ct)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = sourceType.Equals("View", StringComparison.OrdinalIgnoreCase)
            ? "SELECT TOP 1 s.name FROM sys.views v JOIN sys.schemas s ON s.schema_id = v.schema_id WHERE s.name IN ('core','ref','raw','ml') AND v.name = @name ORDER BY CASE s.name WHEN 'core' THEN 1 WHEN 'ref' THEN 2 WHEN 'raw' THEN 3 ELSE 4 END"
            : "SELECT TOP 1 s.name FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE t.name = @name AND t.is_ms_shipped = 0 ORDER BY s.name";
        var p = cmd.CreateParameter();
        p.ParameterName = "@name";
        p.Value = name;
        cmd.Parameters.Add(p);
        return (await cmd.ExecuteScalarAsync(ct))?.ToString();
    }

    /// Finds the first datetime/date column in the source table to use for date range filtering.
    private static string? FindDateColumn(string sql, System.Data.Common.DbConnection conn, CancellationToken ct)
    {
        // Extract table name from SQL like "FROM [schema].[Table]" or "FROM [Table]"
        var m = System.Text.RegularExpressions.Regex.Match(sql,
            @"FROM\s+(?:\[?\w+\]?\.)?\[?(\w+)\]?", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        if (!m.Success) return null;
        var tableName = m.Groups[1].Value;

        using var colCmd = conn.CreateCommand();
        colCmd.CommandText = @"
            SELECT TOP 1 c.COLUMN_NAME
            FROM INFORMATION_SCHEMA.COLUMNS c
            WHERE c.TABLE_NAME = @tbl
              AND c.DATA_TYPE IN ('date','datetime','datetime2','datetimeoffset')
            ORDER BY CASE
              WHEN c.COLUMN_NAME LIKE '%Date%' THEN 0
              WHEN c.COLUMN_NAME LIKE '%Time%' THEN 1
              WHEN c.COLUMN_NAME LIKE '%Created%' THEN 2
              ELSE 3 END, c.ORDINAL_POSITION";
        var p = colCmd.CreateParameter();
        p.ParameterName = "@tbl";
        p.Value = tableName;
        colCmd.Parameters.Add(p);
        return colCmd.ExecuteScalar()?.ToString();
    }

    public async Task<IReadOnlyList<PlantFilterDto>> GetPlantFiltersAsync(CancellationToken ct = default)
    {
        // plant_description lives in AlTasnimBI, which is a different server than TenantDb —
        // must use its own connection, not a cross-server 3-part name over the tenant connection.
        var cs = configuration.GetConnectionString("AlTasnimBI")
            ?? throw new InvalidOperationException("ConnectionStrings:AlTasnimBI is not configured.");
        await using var conn = new SqlConnection(cs);
        await conn.OpenAsync(ct);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            SELECT [plant_code], [plant_description], [cluster],
                   [division], [business_unit], [sector], [country]
            FROM [dbo].[plant_description]
            ORDER BY [plant_code]
            """;
        cmd.CommandTimeout = 30;

        await using var reader = await cmd.ExecuteReaderAsync(ct);
        var results = new List<PlantFilterDto>();
        while (await reader.ReadAsync(ct))
        {
            results.Add(new PlantFilterDto(
                PlantCode: reader.GetInt32(0),
                PlantDescription: reader.IsDBNull(1) ? "" : reader.GetString(1),
                Cluster: reader.IsDBNull(2) ? "" : reader.GetString(2),
                Division: reader.IsDBNull(3) ? "" : reader.GetString(3),
                BusinessUnit: reader.IsDBNull(4) ? "" : reader.GetString(4),
                Sector: reader.IsDBNull(5) ? "" : reader.GetString(5),
                Country: reader.IsDBNull(6) ? "" : reader.GetString(6)
            ));
        }
        return results;
    }

    public async Task<AdvancedFilterDataDto> GetAdvancedFilterDataAsync(CancellationToken ct = default)
    {
        // Organization_Structure and company live in AlTasnimBI, a different server than TenantDb —
        // must use its own connection, not a cross-server 3-part name over the tenant connection.
        var cs = configuration.GetConnectionString("AlTasnimBI")
            ?? throw new InvalidOperationException("ConnectionStrings:AlTasnimBI is not configured.");
        await using var conn = new SqlConnection(cs);
        await conn.OpenAsync(ct);

        {
            // Organisation structure
            await using var orgCmd = conn.CreateCommand();
            orgCmd.CommandText = """
                SELECT os.[PlantCode], ISNULL(os.[SiteManagerA],'') AS SiteManagerA,
                       ISNULL(os.[SiteManagerB],'') AS SiteManagerB,
                       ISNULL(os.[ClusterManager],'') AS ClusterManager,
                       ISNULL(os.[ProjectDirectorID],0) AS ProjectDirectorID,
                       ISNULL(pd.[director_name],'') AS ProjectDirectorName,
                       ISNULL(os.[ExecutiveVicePresident],'') AS ExecutiveVicePresident,
                       ISNULL(os.[CEO],'') AS CEO
                FROM [dbo].[Organization_Structure] AS os
                LEFT JOIN [project].[project_director] AS pd ON os.[ProjectDirectorID] = pd.[director_id]
                """;
            orgCmd.CommandTimeout = 30;

            var orgRows = new List<OrgStructureRow>();
            await using (var reader = await orgCmd.ExecuteReaderAsync(ct))
            {
                while (await reader.ReadAsync(ct))
                {
                    orgRows.Add(new OrgStructureRow(
                        PlantCode: reader.GetInt32(0),
                        SiteManagerA: reader.GetString(1),
                        SiteManagerB: reader.GetString(2),
                        ClusterManager: reader.GetString(3),
                        ProjectDirectorID: reader.GetInt32(4),
                        ProjectDirectorName: reader.GetString(5),
                        ExecutiveVicePresident: reader.GetString(6),
                        CEO: reader.GetString(7)
                    ));
                }
            }

            // Companies (exclude Al Tasnim ids 2, 35, 39)
            await using var compCmd = conn.CreateCommand();
            compCmd.CommandText = """
                SELECT [company_id], [company_name]
                FROM [ref].[company]
                WHERE [company_id] NOT IN (2, 35, 39)
                ORDER BY [company_name]
                """;
            compCmd.CommandTimeout = 30;

            var companies = new List<CompanyRow>();
            await using (var reader2 = await compCmd.ExecuteReaderAsync(ct))
            {
                while (await reader2.ReadAsync(ct))
                {
                    companies.Add(new CompanyRow(
                        CompanyId: reader2.GetInt32(0),
                        CompanyName: reader2.IsDBNull(1) ? "" : reader2.GetString(1)
                    ));
                }
            }

            await using var resourceCmd = conn.CreateCommand();
            resourceCmd.CommandText = """
                SELECT DISTINCT LTRIM(RTRIM([resource])) AS [resource]
                FROM [ref].[local_filters]
                WHERE NULLIF(LTRIM(RTRIM([resource])), '') IS NOT NULL
                ORDER BY [resource]
                """;
            resourceCmd.CommandTimeout = 30;
            var resourceTypes = new List<string>();
            string? resourceTypesError = null;
            try
            {
                await using var resourceReader = await resourceCmd.ExecuteReaderAsync(ct);
                while (await resourceReader.ReadAsync(ct))
                    resourceTypes.Add(resourceReader.GetString(0));
            }
            catch (SqlException ex) when (!ct.IsCancellationRequested)
            {
                logger.LogError(ex, "Failed to load Advanced Filter resource options from ref.local_filters.");
                resourceTypes.Clear();
                resourceTypesError = "Unable to load Resource Type options. Contact your administrator.";
            }

            return new AdvancedFilterDataDto(orgRows, companies, resourceTypes, resourceTypesError);
        }
    }


    /// <summary>Maximum rows returned to a chart, applied by the outermost query.</summary>
    private static string? BuildFilteredAggregateSql(string sql, string aggregation, string? valueField)
    {
        var field = valueField?.Trim();
        if (!string.IsNullOrEmpty(field) && !IsValidIdentifier(field)) return null;
        var column = string.IsNullOrEmpty(field) ? null : $"_tile.[{field}]";
        var expression = aggregation.Trim().ToLowerInvariant() switch
        {
            "count" => column is null ? "COUNT_BIG(*)" : $"COUNT_BIG({column})",
            "countdistinct" when column is not null => $"COUNT_BIG(DISTINCT {column})",
            "total" or "sum" when column is not null => $"SUM(TRY_CONVERT(float, {column}))",
            "average" or "avg" when column is not null => $"AVG(TRY_CONVERT(float, {column}))",
            "value" when column is not null => $"TOP 1 TRY_CONVERT(float, {column})",
            _ => null,
        };
        return expression is null ? null : $"SELECT {expression} AS [Value] FROM ({sql}) _tile";
    }

    private const int RowLimit = 1000;

    /// <summary>SQL Server: "Conversion failed when converting ...".</summary>
    private const int ConversionFailedError = 245;

    /// <summary>SQL Server: "Operand type clash".</summary>
    private const int OperandTypeClashError = 206;
}
