using System.Text.RegularExpressions;
using MediatR;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.DataQuality;

public sealed class CreateValidationRuleHandler(
    IConfiguration configuration,
    ILogger<CreateValidationRuleHandler> logger) : IRequestHandler<CreateValidationRuleCommand, Result<CreateValidationRuleResponse>>
{
    private static readonly Regex DangerousSqlPattern = new(
        @"\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|EXEC|EXECUTE|xp_|sp_|GRANT|REVOKE|DENY|MERGE|INTO|WAITFOR|KILL|DBCC|BACKUP|RESTORE|RECONFIGURE|SHUTDOWN|USE|SET|OPENROWSET|OPENQUERY|OPENDATASOURCE|BULK)\b",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    public async Task<Result<CreateValidationRuleResponse>> Handle(CreateValidationRuleCommand cmd, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(cmd.Category))
            return Result<CreateValidationRuleResponse>.ValidationError("Category is required.");
        if (string.IsNullOrWhiteSpace(cmd.RuleName))
            return Result<CreateValidationRuleResponse>.ValidationError("RuleName is required.");
        if (cmd.RuleName.Length > 200)
            return Result<CreateValidationRuleResponse>.ValidationError("RuleName must not exceed 200 characters.");
        if (string.IsNullOrWhiteSpace(cmd.Table))
            return Result<CreateValidationRuleResponse>.ValidationError("Table is required.");
        if (string.IsNullOrWhiteSpace(cmd.Severity))
            return Result<CreateValidationRuleResponse>.ValidationError("Severity is required.");
        if (string.IsNullOrWhiteSpace(cmd.RuleDesc))
            return Result<CreateValidationRuleResponse>.ValidationError("Rule Description is required.");
        if (cmd.MaxRecords is <= 0 or > 10_000)
            return Result<CreateValidationRuleResponse>.ValidationError("MaxRecords must be between 1 and 10000.");
        if (!IsSafeCondition(cmd.AdditionalCondition))
            return Result<CreateValidationRuleResponse>.ValidationError("Additional condition contains unsupported SQL.");

        // Validate user-provided query
        if (!string.IsNullOrWhiteSpace(cmd.Query))
        {
            var stripped = Regex.Replace(cmd.Query, @"N?'([^']|'')*'", "''");
            if (DangerousSqlPattern.IsMatch(stripped))
                return Result<CreateValidationRuleResponse>.ValidationError("Query contains disallowed SQL operations. Only SELECT queries are permitted.");
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
                WHERE data_rule.view_id = @ViewId AND data_rule.category = @Category;";
            await using var duplicateViewRuleCmd = new SqlCommand(duplicateViewRuleSql, conn) { CommandTimeout = 15 };
            duplicateViewRuleCmd.Parameters.AddWithValue("@ViewId", cmd.ViewId.Value);
            duplicateViewRuleCmd.Parameters.AddWithValue("@Category", cmd.Category);
            var existingViewName = await duplicateViewRuleCmd.ExecuteScalarAsync(ct) as string;
            if (!string.IsNullOrWhiteSpace(existingViewName))
                return Result<CreateValidationRuleResponse>.Conflict($"{cmd.Category} already has one entry with view {existingViewName}");
        }

        // Check for duplicate rule name within the same category
        const string dupCheckSql = "SELECT COUNT(1) FROM [core].[DataRules] WHERE rule_name = @RuleName AND category = @Category;";
        await using (var dupCmd = new SqlCommand(dupCheckSql, conn) { CommandTimeout = 15 })
        {
            dupCmd.Parameters.AddWithValue("@RuleName", cmd.RuleName);
            dupCmd.Parameters.AddWithValue("@Category", cmd.Category);
            if (Convert.ToInt64(await dupCmd.ExecuteScalarAsync(ct)) > 0)
                return Result<CreateValidationRuleResponse>.Conflict($"Rule '{cmd.RuleName}' already exists under category '{cmd.Category}'.");
        }

        const string nextIdSql = @"
            SELECT ISNULL(MAX(CAST(SUBSTRING(rule_id, 2, LEN(rule_id)-1) AS INT)), 0) + 1
            FROM [core].[DataRules]
            WHERE rule_id LIKE 'R%'
              AND ISNUMERIC(SUBSTRING(rule_id, 2, LEN(rule_id)-1)) = 1;";

        int nextNum;
        await using (var cmdNext = new SqlCommand(nextIdSql, conn) { CommandTimeout = 30 })
        {
            var val = await cmdNext.ExecuteScalarAsync(ct);
            nextNum = val is null || val == DBNull.Value ? 1 : Convert.ToInt32(val);
        }
        var ruleId = $"R{nextNum:D2}";

        var (startDate, endDate) = CalculateDateRange(cmd.ValidationPeriod, cmd.CustomStartDate, cmd.CustomEndDate);

        // Logical rules require at least 2 fields for cross-field comparison, unless a Rule Condition is supplied
        if (cmd.Category == "Logical" && string.IsNullOrWhiteSpace(cmd.AdditionalCondition))
        {
            var fieldCount = (cmd.Fields ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Length;
            if (fieldCount < 2)
                return Result<CreateValidationRuleResponse>.ValidationError("Logical rules require at least 2 fields for cross-field comparison.");
        }

        // Auto-generate query if not provided
        var query = !string.IsNullOrWhiteSpace(cmd.Query) ? cmd.Query : GenerateQuery(cmd.Category, table, cmd.Fields, cmd.PrimaryField, cmd.MaxRecords, cmd.AdditionalCondition);

        const string insertSql = @"
            INSERT INTO [core].[DataRules] (rule_id, category, rule_name, table_name, severity, active_yn, query, max_records, start_date, end_date, primary_field, fields, rule_desc, source_type, view_id)
            VALUES (@RuleId, @Category, @RuleName, @Table, @Severity, 'Y', @Query, @MaxRecords, @StartDate, @EndDate, @PrimaryField, @Fields, @RuleDesc, @SourceType, @ViewId);";;

        await using var cmdInsert = new SqlCommand(insertSql, conn) { CommandTimeout = 30 };
        cmdInsert.Parameters.AddWithValue("@RuleId", ruleId);
        cmdInsert.Parameters.AddWithValue("@Category", cmd.Category);
        cmdInsert.Parameters.AddWithValue("@RuleName", cmd.RuleName);
        cmdInsert.Parameters.AddWithValue("@Table", table);
        cmdInsert.Parameters.AddWithValue("@Severity", cmd.Severity);
        cmdInsert.Parameters.AddWithValue("@Query", query);
        cmdInsert.Parameters.AddWithValue("@MaxRecords", (object?)cmd.MaxRecords ?? DBNull.Value);
        cmdInsert.Parameters.AddWithValue("@StartDate", (object?)startDate ?? DBNull.Value);
        cmdInsert.Parameters.AddWithValue("@EndDate", (object?)endDate ?? DBNull.Value);
        cmdInsert.Parameters.AddWithValue("@PrimaryField", (object?)cmd.PrimaryField ?? DBNull.Value);
        cmdInsert.Parameters.AddWithValue("@Fields", (object?)cmd.Fields ?? DBNull.Value);
        cmdInsert.Parameters.AddWithValue("@RuleDesc", (object?)cmd.RuleDesc ?? DBNull.Value);
        cmdInsert.Parameters.AddWithValue("@SourceType", (object?)NormalizeSourceType(cmd.SourceType) ?? DBNull.Value);
        cmdInsert.Parameters.AddWithValue("@ViewId", string.Equals(cmd.SourceType, "view", StringComparison.OrdinalIgnoreCase) ? (object?)cmd.ViewId ?? DBNull.Value : DBNull.Value);

        await cmdInsert.ExecuteNonQueryAsync(ct);
        logger.LogInformation("Validation rule created. RuleId={RuleId}", ruleId);

        return Result<CreateValidationRuleResponse>.Success(
            new CreateValidationRuleResponse(ruleId, "Rule created successfully.", "Y"));
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

    private static (string? startDate, string? endDate) CalculateDateRange(string? validationPeriod, string? customStart = null, string? customEnd = null)
    {
        if (string.IsNullOrWhiteSpace(validationPeriod)) return (null, null);
        var today = DateTime.Today;
        return validationPeriod switch
        {
            "Today" or "Daily" => (today.ToString("yyyy-MM-dd"), today.ToString("yyyy-MM-dd")),
            "This Week" or "Weekly" => (today.AddDays(-(int)today.DayOfWeek).ToString("yyyy-MM-dd"), today.ToString("yyyy-MM-dd")),
            "This Month" or "Monthly" => (new DateTime(today.Year, today.Month, 1).ToString("yyyy-MM-dd"), today.ToString("yyyy-MM-dd")),
            "This Quarter" or "Quarterly" => (new DateTime(today.Year, (today.Month - 1) / 3 * 3 + 1, 1).ToString("yyyy-MM-dd"), today.ToString("yyyy-MM-dd")),
            "This Year" => (new DateTime(today.Year, 1, 1).ToString("yyyy-MM-dd"), today.ToString("yyyy-MM-dd")),
            "Custom Date" => (customStart, customEnd),
            _ => (null, null),
        };
    }

    private static readonly Regex SafeIdentifier = new(@"^[a-zA-Z_][\w\.]*$", RegexOptions.Compiled);

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
        if (parts.Length == 2)
            return $"[{parts[0].TrimStart('[').TrimEnd(']')}].[{parts[1].TrimStart('[').TrimEnd(']')}]";
        return $"[{parts[0].TrimStart('[').TrimEnd(']')}]";
    }
}
