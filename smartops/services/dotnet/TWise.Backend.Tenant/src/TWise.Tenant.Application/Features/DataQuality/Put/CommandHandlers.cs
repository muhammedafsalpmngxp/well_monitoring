using System.Text.RegularExpressions;
using MediatR;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.DataQuality;

public sealed class UpdateValidationRuleHandler(IConfiguration configuration)
    : IRequestHandler<UpdateValidationRuleCommand, Result<UpdateRuleResponse>>
{
    private static readonly Regex DangerousSqlPattern = new(
        @"\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|EXEC|EXECUTE|xp_|sp_|GRANT|REVOKE|DENY|MERGE|INTO|WAITFOR|KILL|DBCC|BACKUP|RESTORE|RECONFIGURE|SHUTDOWN|USE|SET|OPENROWSET|OPENQUERY|OPENDATASOURCE|BULK)\b",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex SafeIdentifier = new(@"^[a-zA-Z_][\w\.]*$", RegexOptions.Compiled);

    public async Task<Result<UpdateRuleResponse>> Handle(UpdateValidationRuleCommand cmd, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(cmd.RuleId))
            return Result<UpdateRuleResponse>.ValidationError("RuleId is required.");
        if (string.IsNullOrWhiteSpace(cmd.Category))
            return Result<UpdateRuleResponse>.ValidationError("Category is required.");
        if (string.IsNullOrWhiteSpace(cmd.RuleName))
            return Result<UpdateRuleResponse>.ValidationError("RuleName is required.");
        if (string.IsNullOrWhiteSpace(cmd.Table))
            return Result<UpdateRuleResponse>.ValidationError("Table is required.");
        if (string.IsNullOrWhiteSpace(cmd.Severity))
            return Result<UpdateRuleResponse>.ValidationError("Severity is required.");
        if (string.IsNullOrWhiteSpace(cmd.RuleDesc))
            return Result<UpdateRuleResponse>.ValidationError("Rule Description is required.");
        if (cmd.MaxRecords is <= 0 or > 10_000)
            return Result<UpdateRuleResponse>.ValidationError("MaxRecords must be between 1 and 10000.");
        if (!IsSafeCondition(cmd.AdditionalCondition))
            return Result<UpdateRuleResponse>.ValidationError("Additional condition contains unsupported SQL.");

        if (!string.IsNullOrWhiteSpace(cmd.Query))
        {
            var stripped = Regex.Replace(cmd.Query, @"N?'([^']|'')*'", "''");
            if (DangerousSqlPattern.IsMatch(stripped))
                return Result<UpdateRuleResponse>.ValidationError("Query contains disallowed SQL operations. Only SELECT queries are permitted.");
        }

        var cs = configuration.GetConnectionString("TenantDb")
            ?? throw new InvalidOperationException("ConnectionStrings:TenantDb is not configured.");
        await using var conn = new SqlConnection(cs);
        await conn.OpenAsync(ct);

        var table = await ResolveSchemaQualifiedTableAsync(cmd.Table, conn, ct);

        if (string.Equals(cmd.SourceType, "view", StringComparison.OrdinalIgnoreCase) && cmd.ViewId is not null)
        {
            const string duplicateViewRuleSql = @"
                SELECT TOP 1 view_record.view_name
                FROM [core].[DataRules] data_rule
                INNER JOIN [core].[DatabaseViews] view_record ON view_record.id = data_rule.view_id
                WHERE data_rule.view_id = @ViewId AND data_rule.category = @Category AND data_rule.rule_id <> @RuleId;";
            await using var duplicateViewRuleCmd = new SqlCommand(duplicateViewRuleSql, conn) { CommandTimeout = 15 };
            duplicateViewRuleCmd.Parameters.AddWithValue("@ViewId", cmd.ViewId.Value);
            duplicateViewRuleCmd.Parameters.AddWithValue("@Category", cmd.Category);
            duplicateViewRuleCmd.Parameters.AddWithValue("@RuleId", cmd.RuleId);
            var existingViewName = await duplicateViewRuleCmd.ExecuteScalarAsync(ct) as string;
            if (!string.IsNullOrWhiteSpace(existingViewName))
                return Result<UpdateRuleResponse>.Conflict($"{cmd.Category} already has one entry with view {existingViewName}");
        }

        var (startDate, endDate) = CalculateDateRange(cmd.ValidationPeriod, cmd.CustomStartDate, cmd.CustomEndDate);

        if (cmd.Category == "Logical" && string.IsNullOrWhiteSpace(cmd.AdditionalCondition))
        {
            var fieldCount = (cmd.Fields ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Length;
            if (fieldCount < 2)
                return Result<UpdateRuleResponse>.ValidationError("Logical rules require at least 2 fields for cross-field comparison.");
        }

        var query = !string.IsNullOrWhiteSpace(cmd.Query) ? cmd.Query : GenerateQuery(cmd.Category, table, cmd.Fields, cmd.PrimaryField, cmd.MaxRecords, cmd.AdditionalCondition);

        const string sql = @"
            UPDATE [core].[DataRules]
            SET category = @Category, rule_name = @RuleName, table_name = @Table, severity = @Severity,
                query = @Query, max_records = @MaxRecords,
                start_date = COALESCE(@StartDate, start_date),
                end_date = COALESCE(@EndDate, end_date),
                primary_field = @PrimaryField, fields = @Fields, rule_desc = @RuleDesc,
                source_type = COALESCE(@SourceType, source_type),
                view_id = @ViewId
            WHERE rule_id = @RuleId;";;

        await using var sqlCmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
        sqlCmd.Parameters.AddWithValue("@RuleId", cmd.RuleId);
        sqlCmd.Parameters.AddWithValue("@Category", cmd.Category);
        sqlCmd.Parameters.AddWithValue("@RuleName", cmd.RuleName);
        sqlCmd.Parameters.AddWithValue("@Table", table);
        sqlCmd.Parameters.AddWithValue("@Severity", cmd.Severity);
        sqlCmd.Parameters.AddWithValue("@Query", query);
        sqlCmd.Parameters.AddWithValue("@MaxRecords", (object?)cmd.MaxRecords ?? DBNull.Value);
        sqlCmd.Parameters.AddWithValue("@StartDate", (object?)startDate ?? DBNull.Value);
        sqlCmd.Parameters.AddWithValue("@EndDate", (object?)endDate ?? DBNull.Value);
        sqlCmd.Parameters.AddWithValue("@PrimaryField", (object?)cmd.PrimaryField ?? DBNull.Value);
        sqlCmd.Parameters.AddWithValue("@Fields", (object?)cmd.Fields ?? DBNull.Value);
        sqlCmd.Parameters.AddWithValue("@RuleDesc", (object?)cmd.RuleDesc ?? DBNull.Value);
        sqlCmd.Parameters.AddWithValue("@SourceType", (object?)NormalizeSourceType(cmd.SourceType) ?? DBNull.Value);
        sqlCmd.Parameters.AddWithValue("@ViewId", string.Equals(cmd.SourceType, "view", StringComparison.OrdinalIgnoreCase) ? (object?)cmd.ViewId ?? DBNull.Value : DBNull.Value);

        var rows = await sqlCmd.ExecuteNonQueryAsync(ct);
        if (rows == 0) return Result<UpdateRuleResponse>.NotFound($"Rule '{cmd.RuleId}' not found.");
        return Result<UpdateRuleResponse>.Success(new UpdateRuleResponse(cmd.RuleId, "Rule updated successfully."));
    }

    private async Task<string> ResolveSchemaQualifiedTableAsync(string table, SqlConnection conn, CancellationToken ct)
    {
        if (table.Contains(','))
        {
            var resolved = new List<string>();
            foreach (var part in table.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
                resolved.Add(await ResolveSchemaQualifiedTableAsync(part, conn, ct));
            return string.Join(", ", resolved);
        }

        var parts = table.Trim().Split('.', 2, StringSplitOptions.TrimEntries);
        if (parts.Length == 2)
        {
            if (!parts.All(p => SafeIdentifier.IsMatch(p.TrimStart('[').TrimEnd(']'))))
                throw new InvalidOperationException($"Invalid table identifier: {table}");
            return table.Trim();
        }

        if (!SafeIdentifier.IsMatch(parts[0].TrimStart('[').TrimEnd(']')))
            throw new InvalidOperationException($"Invalid table identifier: {table}");

        var tenantMatches = await FindSchemaQualifiedMatchesAsync(parts[0], conn, ct);
        if (tenantMatches.Count > 0) return ResolveSingleMatch(table, tenantMatches);

        // Fall back to the AlTasnimBI database — tables may live there instead of TenantDb
        var biCs = configuration.GetConnectionString("AlTasnimBI");
        if (!string.IsNullOrWhiteSpace(biCs))
        {
            await using var biConn = new SqlConnection(biCs);
            await biConn.OpenAsync(ct);
            var biMatches = await FindSchemaQualifiedMatchesAsync(parts[0], biConn, ct);
            if (biMatches.Count > 0) return ResolveSingleMatch(table, biMatches);
        }

        throw new InvalidOperationException($"Table or view '{table}' was not found.");
    }

    private static async Task<List<string>> FindSchemaQualifiedMatchesAsync(string tableName, SqlConnection conn, CancellationToken ct)
    {
        const string sql = @"
            SELECT TOP 2 s.name + '.' + o.name
            FROM sys.objects o
            INNER JOIN sys.schemas s ON s.schema_id = o.schema_id
            WHERE o.name = @TableName AND o.type IN ('U', 'V')
            ORDER BY s.name;";
        await using var command = new SqlCommand(sql, conn) { CommandTimeout = 15 };
        command.Parameters.AddWithValue("@TableName", tableName.TrimStart('[').TrimEnd(']'));
        await using var reader = await command.ExecuteReaderAsync(ct);
        var matches = new List<string>();
        while (await reader.ReadAsync(ct)) matches.Add(reader.GetString(0));
        return matches;
    }

    private static string ResolveSingleMatch(string table, List<string> matches) => matches.Count switch
    {
        1 => matches[0],
        _ => throw new InvalidOperationException($"Table or view '{table}' exists in multiple schemas; provide schema.table."),
    };

    private static (string? startDate, string? endDate) CalculateDateRange(string? period, string? customStart, string? customEnd)
    {
        if (string.IsNullOrWhiteSpace(period)) return (null, null);
        var today = DateOnly.FromDateTime(DateTime.Today);
        return period switch
        {
            "Today" => (today.ToString("yyyy-MM-dd"), today.ToString("yyyy-MM-dd")),
            "This Week" => (today.AddDays(-(int)today.DayOfWeek).ToString("yyyy-MM-dd"), today.ToString("yyyy-MM-dd")),
            "This Month" => (new DateOnly(today.Year, today.Month, 1).ToString("yyyy-MM-dd"), today.ToString("yyyy-MM-dd")),
            "This Quarter" => (new DateOnly(today.Year, (today.Month - 1) / 3 * 3 + 1, 1).ToString("yyyy-MM-dd"), today.ToString("yyyy-MM-dd")),
            "This Year" => (new DateOnly(today.Year, 1, 1).ToString("yyyy-MM-dd"), today.ToString("yyyy-MM-dd")),
            "Custom Date" => (customStart, customEnd),
            _ => (null, null),
        };
    }

    private static string GenerateQuery(string category, string table, string? fieldsCsv, string? primaryFieldsCsv, int? maxRecords, string? additionalCondition)
    {
        var rawFields = (fieldsCsv ?? "")
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(c => c.TrimStart('[').TrimEnd(']'))
            .Where(c => SafeIdentifier.IsMatch(c))
            .ToList();

        if (rawFields.Count == 0)
        {
            var topAsterisk = maxRecords.HasValue ? $"TOP {maxRecords.Value} " : "";
            return $"SELECT {topAsterisk}* FROM {QuoteTable(table)}";
        }

        var byTable = GroupFieldsByTable(rawFields);
        if (byTable != null && byTable.Count > 1)
        {
            return BuildMultiTableQuery(category, byTable, maxRecords, additionalCondition);
        }

        var columns = (byTable != null && byTable.Count == 1)
            ? byTable.First().Value.Select(c => $"[{c}]").ToList()
            : rawFields.Select(c => $"[{c}]").ToList();

        var primaryKeyColumns = (primaryFieldsCsv ?? "")
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(column => column.TrimStart('[').TrimEnd(']'))
            .Where(column => SafeIdentifier.IsMatch(column))
            .Where(column => !rawFields.Contains(column, StringComparer.OrdinalIgnoreCase))
            .Select(column => $"[{column}]")
            .ToList();

        var targetTable = (byTable != null && byTable.Count == 1)
            ? byTable.First().Key
            : table;

        var top = maxRecords.HasValue ? $"TOP {maxRecords.Value} " : "";
        var colList = string.Join(", ", columns);
        var projectedColList = string.Join(", ", primaryKeyColumns.Concat(columns));
        var whereCondition = string.IsNullOrWhiteSpace(additionalCondition) ? "" : $" WHERE ({additionalCondition.Trim()})";

        return category switch
        {
            "Completeness" => $"SELECT {top}{projectedColList} FROM {QuoteTable(targetTable)} WHERE "
                + WrapWhereClause(string.Join(" OR ", columns.Select(c => $"({c} IS NULL OR LTRIM(RTRIM(CAST({c} AS NVARCHAR(MAX)))) = '')")), additionalCondition),

            "Reference" or "Data Integrity" => $"SELECT {FormatPrimaryKeyAggregates(primaryKeyColumns)}{colList}, COUNT(*) AS dup_count FROM {QuoteTable(targetTable)}{whereCondition} GROUP BY {colList} HAVING COUNT(*) > 1",

            "Range Check" => $"SELECT {top}{projectedColList} FROM {QuoteTable(targetTable)} WHERE "
                + (string.IsNullOrWhiteSpace(additionalCondition)
                    ? string.Join(" OR ", columns.Select(RangeCheckPredicate))
                    : additionalCondition.Trim()),

            "Logical" when !string.IsNullOrWhiteSpace(additionalCondition) =>
                $"SELECT {top}{projectedColList} FROM {QuoteTable(targetTable)} WHERE {additionalCondition.Trim()}",
            "Logical" when columns.Count >= 2 => $"SELECT {top}{projectedColList} FROM {QuoteTable(targetTable)} WHERE {columns[0]} IS NOT NULL AND {columns[1]} IS NOT NULL AND {columns[0]} > {columns[1]}",

            "Calculation" or "Formula" or "Calculation / Formula" => $"SELECT {top}{projectedColList} FROM {QuoteTable(targetTable)} WHERE "
                + WrapWhereClause(string.Join(" OR ", columns.Select(RangeCheckPredicate)), additionalCondition),

            "Format Validation" => $"SELECT {top}{projectedColList} FROM {QuoteTable(targetTable)} WHERE "
                + WrapWhereClause(string.Join(" OR ", columns.Select(c => $"({c} IS NOT NULL AND LTRIM(RTRIM(CAST({c} AS NVARCHAR(MAX)))) <> '' AND TRY_CAST({c} AS DATE) IS NULL AND TRY_CAST({c} AS FLOAT) IS NULL)")), additionalCondition),

            _ => $"SELECT {top}{projectedColList} FROM {QuoteTable(targetTable)} WHERE "
                + WrapWhereClause(string.Join(" OR ", columns.Select(c => $"({c} IS NULL OR LTRIM(RTRIM(CAST({c} AS NVARCHAR(MAX)))) = '')")), additionalCondition),
        };
    }

    private static string FormatPrimaryKeyAggregates(List<string> primaryKeyColumns) =>
        primaryKeyColumns.Count == 0
            ? ""
            : string.Join(", ", primaryKeyColumns.Select(column => $"MIN({column}) AS {column}")) + ", ";

    private static string WrapWhereClause(string baseOrClause, string? additionalCondition)
    {
        if (string.IsNullOrWhiteSpace(additionalCondition))
            return baseOrClause;
        return $"({baseOrClause}) AND ({additionalCondition.Trim()})";
    }

    private static string RangeCheckPredicate(string column)
    {
        var value = $"CAST({column} AS NVARCHAR(MAX))";
        return $"(TRY_CONVERT(FLOAT, {value}) IS NULL AND TRY_CONVERT(DATETIME2, {value}) IS NULL"
            + $" AND {column} IS NOT NULL AND LTRIM(RTRIM({value})) <> '')";
    }

    private static Dictionary<string, List<string>>? GroupFieldsByTable(List<string> rawFields)
    {
        var dict = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);
        foreach (var field in rawFields)
        {
            var parts = field.Split('.');
            if (parts.Length < 3) return null;
            var tbl = $"{parts[0]}.{parts[1]}";
            var col = string.Join(".", parts.Skip(2));
            if (!dict.TryGetValue(tbl, out var list))
            {
                list = new List<string>();
                dict[tbl] = list;
            }
            if (!list.Contains(col, StringComparer.OrdinalIgnoreCase))
                list.Add(col);
        }
        return dict;
    }

    private static string BuildMultiTableQuery(string category, Dictionary<string, List<string>> byTable, int? maxRecords, string? additionalCondition)
    {
        var top = maxRecords.HasValue ? $"TOP {maxRecords.Value} " : "";
        var condition = additionalCondition?.Trim();
        var selects = new List<string>();

        foreach (var (tbl, columns) in byTable)
        {
            var quotedTable = QuoteTable(tbl);
            var tableLiteral = tbl.Replace("'", "''");
            var columnsSql = string.Join(", ", columns.Select(c => $"[{c}]"));

            if (category is "Reference" or "Data Integrity")
            {
                var where = string.IsNullOrWhiteSpace(condition) ? "" : $" WHERE ({condition})";
                selects.Add($"SELECT '{tableLiteral}' AS source_table, COUNT(*) AS duplicate_count FROM {quotedTable}{where} GROUP BY {columnsSql} HAVING COUNT(*) > 1");
                continue;
            }

            if (category is "Logical" && columns.Count >= 2)
            {
                var first = $"[{columns[0]}]";
                var second = $"[{columns[1]}]";
                var where = !string.IsNullOrWhiteSpace(condition) ? condition : $"{first} IS NOT NULL AND {second} IS NOT NULL AND {first} > {second}";
                selects.Add($"SELECT {top}'{tableLiteral}' AS source_table, {columnsSql} FROM {quotedTable} WHERE {where}");
                continue;
            }

            foreach (var col in columns)
            {
                var quotedCol = $"[{col}]";
                var colLiteral = col.Replace("'", "''");
                string check = category switch
                {
                    "Range Check" => string.IsNullOrWhiteSpace(condition) ? RangeCheckPredicate(quotedCol) : condition,
                    "Calculation" or "Formula" or "Calculation / Formula" => RangeCheckPredicate(quotedCol),
                    "Format Validation" => $"({quotedCol} IS NOT NULL AND LTRIM(RTRIM(CAST({quotedCol} AS NVARCHAR(MAX)))) <> '' AND TRY_CAST({quotedCol} AS DATE) IS NULL AND TRY_CAST({quotedCol} AS FLOAT) IS NULL)",
                    _ => $"({quotedCol} IS NULL OR LTRIM(RTRIM(CAST({quotedCol} AS NVARCHAR(MAX)))) = '')"
                };

                var where = check;
                selects.Add($"SELECT {top}'{tableLiteral}' AS source_table, '{colLiteral}' AS column_name, CAST({quotedCol} AS NVARCHAR(4000)) AS value FROM {quotedTable} WHERE {where}");
            }
        }

        return string.Join("\nUNION ALL\n", selects);
    }

    private static string? NormalizeSourceType(string? sourceType) =>
        sourceType?.Trim().ToLowerInvariant() switch
        {
            "table" => "table",
            "view" => "view",
            _ => null,
        };

    private static bool IsSafeCondition(string? condition)
    {
        if (string.IsNullOrWhiteSpace(condition)) return true;
        var stripped = Regex.Replace(condition, @"N?'([^']|'')*'", "''");
        return !DangerousSqlPattern.IsMatch(stripped)
            && !condition.Contains(';')
            && !condition.Contains("--", StringComparison.Ordinal)
            && Regex.IsMatch(condition, @"^[a-zA-Z0-9_\[\]().,\s'<>=!+*/%:-]+$");
    }

    private static string QuoteTable(string table)
    {
        var parts = table.Split('.', 2);
        foreach (var p in parts)
        {
            var clean = p.TrimStart('[').TrimEnd(']');
            if (!SafeIdentifier.IsMatch(clean))
                throw new InvalidOperationException($"Invalid table identifier: {p}");
        }
        return parts.Length == 2
            ? $"[{parts[0].TrimStart('[').TrimEnd(']')}].[{parts[1].TrimStart('[').TrimEnd(']')}]"
            : $"[{parts[0].TrimStart('[').TrimEnd(']')}]";
    }
}
