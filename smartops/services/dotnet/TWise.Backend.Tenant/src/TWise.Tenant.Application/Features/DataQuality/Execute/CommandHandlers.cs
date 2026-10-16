using System.Text.RegularExpressions;
using MediatR;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.DataQuality;

public sealed class ExecuteValidationRuleHandler(
    IConfiguration configuration,
    IControlPlaneNotificationClient notifications,
    IDatabaseViewService databaseViews,
    ILogger<ExecuteValidationRuleHandler> logger)
    : IRequestHandler<ExecuteValidationRuleCommand, Result<ExecuteRuleResponse>>
{
    // Only SELECT/WITH are allowed in validation queries
    private static readonly Regex DangerousSqlPattern = new(
        @"\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|EXEC|EXECUTE|xp_|sp_|GRANT|REVOKE|DENY|MERGE|INTO|WAITFOR|KILL|DBCC|BACKUP|RESTORE|RECONFIGURE|SHUTDOWN|USE|SET|OPENROWSET|OPENQUERY|OPENDATASOURCE|BULK)\b",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    public async Task<Result<ExecuteRuleResponse>> Handle(ExecuteValidationRuleCommand cmd, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(cmd.RuleId))
            return Result<ExecuteRuleResponse>.ValidationError("RuleId is required.");

        var cs = configuration.GetConnectionString("TenantDb")
            ?? throw new InvalidOperationException("ConnectionStrings:TenantDb is not configured.");
        await using var conn = new SqlConnection(cs);
        await conn.OpenAsync(ct);

        // Fetch the rule
        const string fetchSql = @"
            SELECT rule_name, severity, query, max_records, primary_field, category, fields, active_yn, rule_desc, table_name, source_type, view_id
            FROM [core].[DataRules] WHERE rule_id = @RuleId;";
        string? ruleName = null, severity = null, query = null, primaryFieldCsv = null, category = null, fields = null, ruleDesc = null, table = null, sourceType = null;
        string activeYn = "Y";
        int? maxRecords = null;
        long? viewId = null;

        await using (var fetchCmd = new SqlCommand(fetchSql, conn) { CommandTimeout = 30 })
        {
            fetchCmd.Parameters.AddWithValue("@RuleId", cmd.RuleId);
            await using var reader = await fetchCmd.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct))
                return Result<ExecuteRuleResponse>.NotFound($"Rule '{cmd.RuleId}' not found.");
            ruleName = reader.GetString(0);
            severity = reader.GetString(1);
            query = reader.IsDBNull(2) ? null : reader.GetString(2);
            maxRecords = reader.IsDBNull(3) ? null : reader.GetInt32(3);
            primaryFieldCsv = reader.IsDBNull(4) ? null : reader.GetString(4);
            category = reader.IsDBNull(5) ? null : reader.GetString(5);
            fields = reader.IsDBNull(6) ? null : reader.GetString(6);
            activeYn = reader.IsDBNull(7) ? "Y" : reader.GetString(7);
            ruleDesc = reader.IsDBNull(8) ? null : reader.GetString(8);
            table = reader.IsDBNull(9) ? null : reader.GetString(9);
            sourceType = reader.IsDBNull(10) ? null : reader.GetString(10);
            viewId = reader.IsDBNull(11) ? null : reader.GetInt64(11);
        }

        if (!string.Equals(activeYn, "Y", StringComparison.OrdinalIgnoreCase))
            return Result<ExecuteRuleResponse>.ValidationError("Cannot execute an inactive rule. Activate it first.");

        if (string.IsNullOrWhiteSpace(query))
            return Result<ExecuteRuleResponse>.ValidationError("Rule has no stored query.");

        // Reject write/DDL operations in stored queries
        var stripped = Regex.Replace(query, @"N?'([^']|'')*'", "''");
        if (DangerousSqlPattern.IsMatch(stripped))
            return Result<ExecuteRuleResponse>.ValidationError("Rule query contains disallowed SQL operations. Only SELECT queries are permitted.");

        var trimmed = stripped.TrimStart();
        if (!trimmed.StartsWith("SELECT", StringComparison.OrdinalIgnoreCase) &&
            !trimmed.StartsWith("WITH", StringComparison.OrdinalIgnoreCase) &&
            !trimmed.StartsWith("DECLARE", StringComparison.OrdinalIgnoreCase))
            return Result<ExecuteRuleResponse>.ValidationError("Rule query must begin with SELECT, WITH, or DECLARE.");

        // Execute the rule's query
        List<Dictionary<string, object?>> results;
        int? tableTotalRows = null;
        var dataConn = await OpenDataConnectionAsync(table, conn, ct);
        try
        {
            await using var execCmd = new SqlCommand(query, dataConn) { CommandTimeout = 120 };
            await using var execReader = await execCmd.ExecuteReaderAsync(ct);
            results = [];
            var fieldNames = new List<string>();
            for (int i = 0; i < execReader.FieldCount; i++)
                fieldNames.Add(execReader.GetName(i));
            while (await execReader.ReadAsync(ct) && (maxRecords is null || results.Count < maxRecords.Value))
            {
                var row = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
                for (int i = 0; i < execReader.FieldCount; i++)
                    row[fieldNames[i]] = execReader.IsDBNull(i) ? null : execReader.GetValue(i);
                results.Add(row);
            }
            await execReader.DisposeAsync();

            // No configured cap: the ratio denominator is the source table row count.
            if (maxRecords is null && !string.IsNullOrWhiteSpace(table) && !table.Contains(','))
            {
                await using var countCmd = new SqlCommand($"SELECT COUNT(*) FROM {QuoteTable(table)}", dataConn) { CommandTimeout = 60 };
                tableTotalRows = Convert.ToInt32(await countCmd.ExecuteScalarAsync(ct));
            }
            else if (maxRecords is null && !string.IsNullOrWhiteSpace(table))
            {
                tableTotalRows = await CountSourceRowsAsync(table, dataConn, ct);
            }

            if (!ReferenceEquals(dataConn, conn)) await dataConn.DisposeAsync();
        }
        catch (Exception ex)
        {
            if (!ReferenceEquals(dataConn, conn)) await dataConn.DisposeAsync();
            logger.LogError(ex, "Rule {RuleId} query execution failed", cmd.RuleId);
            return Result<ExecuteRuleResponse>.ValidationError(
                "The validation query could not be executed. Verify that the rule's source table and selected fields still exist.");
        }

        // Keep the rule trigger and all matching error-log dates identical for this execution.
        var triggeredOn = DateTime.Now;
        var recordsTotal = maxRecords ?? tableTotalRows;
        // Round down so any issue keeps the score below 100.
        decimal? reliabilityScore = recordsTotal is > 0
            ? Math.Floor(Math.Clamp(100m - ((decimal)results.Count / recordsTotal.Value * 100m), 0m, 100m) * 100m) / 100m
            : null;
        const string trigSql = @"
            UPDATE [core].[DataRules]
            SET triggered_on = @TriggeredOn, reliability_score = @ReliabilityScore
            WHERE rule_id = @RuleId;

            UPDATE [core].[ErrorLog]
            SET created_at = @TriggeredOn
            WHERE rule_id = @RuleId;";
        await using (var trigCmd = new SqlCommand(trigSql, conn) { CommandTimeout = 15 })
        {
            trigCmd.Parameters.AddWithValue("@RuleId", cmd.RuleId);
            trigCmd.Parameters.AddWithValue("@TriggeredOn", triggeredOn);
            var scoreParam = trigCmd.Parameters.Add("@ReliabilityScore", System.Data.SqlDbType.Decimal);
            scoreParam.Precision = 5;
            scoreParam.Scale = 2;
            scoreParam.Value = (object?)reliabilityScore ?? DBNull.Value;
            await trigCmd.ExecuteNonQueryAsync(ct);
        }

        // One aggregated ErrorLog row per rule, storing the latest matched-row count (records_found / max_records ratio).
        const string existingRowSql = @"
            SELECT TOP 1 error_id FROM [core].[ErrorLog]
            WHERE rule_id = @RuleId
            ORDER BY created_at ASC, error_id ASC;";
        long? existingErrorId = null;
        await using (var existingRowCmd = new SqlCommand(existingRowSql, conn) { CommandTimeout = 15 })
        {
            existingRowCmd.Parameters.AddWithValue("@RuleId", cmd.RuleId);
            var val = await existingRowCmd.ExecuteScalarAsync(ct);
            if (val is not null && val != DBNull.Value) existingErrorId = Convert.ToInt64(val);
        }

        int inserted;
        if (existingErrorId is null)
        {
            const string insertSql = @"
                INSERT INTO [core].[ErrorLog] (rule_id, severity, rule_name, primary_field, status, well, sla, created_at, category, fields, rule_desc, records_found, records_total)
                VALUES (@RuleId, @Severity, @RuleName, NULL, 'Open', NULL, NULL, @TriggeredOn, @Category, @Fields, @RuleDesc, @RecordsFound, @RecordsTotal);";
            await using var insertCmd = new SqlCommand(insertSql, conn) { CommandTimeout = 15 };
            insertCmd.Parameters.AddWithValue("@RuleId", cmd.RuleId);
            insertCmd.Parameters.AddWithValue("@Severity", severity!);
            insertCmd.Parameters.AddWithValue("@RuleName", ruleName!);
            insertCmd.Parameters.AddWithValue("@TriggeredOn", triggeredOn);
            insertCmd.Parameters.AddWithValue("@Category", (object?)category ?? DBNull.Value);
            insertCmd.Parameters.AddWithValue("@Fields", (object?)fields ?? DBNull.Value);
            insertCmd.Parameters.AddWithValue("@RuleDesc", (object?)ruleDesc ?? DBNull.Value);
            insertCmd.Parameters.AddWithValue("@RecordsFound", results.Count);
            insertCmd.Parameters.AddWithValue("@RecordsTotal", (object?)recordsTotal ?? DBNull.Value);
            await insertCmd.ExecuteNonQueryAsync(ct);
            inserted = 1;
        }
        else
        {
            const string updateSql = @"
                UPDATE [core].[ErrorLog]
                SET records_found = @RecordsFound, records_total = @RecordsTotal, severity = @Severity, category = @Category, fields = @Fields, rule_desc = @RuleDesc,
                    status = 'Open', created_at = @TriggeredOn
                WHERE error_id = @ErrorId;";
            await using var updateCmd = new SqlCommand(updateSql, conn) { CommandTimeout = 15 };
            updateCmd.Parameters.AddWithValue("@ErrorId", existingErrorId.Value);
            updateCmd.Parameters.AddWithValue("@TriggeredOn", triggeredOn);
            updateCmd.Parameters.AddWithValue("@RecordsFound", results.Count);
            updateCmd.Parameters.AddWithValue("@RecordsTotal", (object?)recordsTotal ?? DBNull.Value);
            updateCmd.Parameters.AddWithValue("@Severity", severity!);
            updateCmd.Parameters.AddWithValue("@Category", (object?)category ?? DBNull.Value);
            updateCmd.Parameters.AddWithValue("@Fields", (object?)fields ?? DBNull.Value);
            updateCmd.Parameters.AddWithValue("@RuleDesc", (object?)ruleDesc ?? DBNull.Value);
            await updateCmd.ExecuteNonQueryAsync(ct);
            inserted = 0;
        }

        if (string.Equals(sourceType, "view", StringComparison.OrdinalIgnoreCase) && viewId is not null)
        {
            const string reliabilitySql = @"
                UPDATE [core].[DatabaseViews]
                SET reliability = (
                    SELECT ROUND(AVG(100.0 - (CAST(error.records_found AS DECIMAL(18, 6)) / error.records_total * 100.0)), 2, 1)
                    FROM [core].[DataRules] data_rule
                    INNER JOIN [core].[ErrorLog] error ON error.rule_id = data_rule.rule_id
                    WHERE data_rule.view_id = @ViewId
                      AND data_rule.active_yn = 'Y'
                      AND error.records_found IS NOT NULL
                      AND error.records_total > 0
                ),
                modified_at = GETDATE()
                WHERE id = @ViewId AND is_deleted = 0;";
            await using var reliabilityCmd = new SqlCommand(reliabilitySql, conn) { CommandTimeout = 15 };
            reliabilityCmd.Parameters.AddWithValue("@ViewId", viewId.Value);
            await reliabilityCmd.ExecuteNonQueryAsync(ct);
        }
        else if (string.Equals(sourceType, "table", StringComparison.OrdinalIgnoreCase))
        {
            try
            {
                await databaseViews.RecalculateReliabilityForRuleAsync(table, fields, cmd.TenantId, ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning(ex, "View reliability could not be recalculated after rule {RuleId}.", cmd.RuleId);
            }
        }

        var msg = results.Count == 0
            ? "Validation rule executed successfully. No issues found."
            : inserted > 0
            ? $"Validation rule executed successfully. {results.Count} issues found."
            : $"Validation rule executed successfully. Existing entry updated with {results.Count} issues found.";
        logger.LogInformation("Rule {RuleId} executed: {Inserted}/{Total}", cmd.RuleId, inserted, results.Count);

        if (results.Count > 0)
        {
            // Broadcast — not filtered per user; ControlPlane resolves every user in this tenant
            // whose role has view access on the Data Quality module (moduleCode, no recipient list).
            await notifications.PublishAsync(cmd.TenantId, "DataQualityError", "Found data reliability issue",
                $"{ruleName} rule found {results.Count} violations in {table}",
                $"/data-quality/error-log-rules?errorRuleId={Uri.EscapeDataString(cmd.RuleId)}",
                [], "data-quality.error-log", ct);
        }

        return Result<ExecuteRuleResponse>.Success(new ExecuteRuleResponse(cmd.RuleId, msg, inserted, results.Count));
    }

    private async Task<SqlConnection> OpenDataConnectionAsync(string? table, SqlConnection tenantConnection, CancellationToken ct)
    {
        var biConnectionString = configuration.GetConnectionString("AlTasnimBI")
            ?? throw new InvalidOperationException("ConnectionStrings:AlTasnimBI is not configured.");
        var biConnection = new SqlConnection(biConnectionString);
        await biConnection.OpenAsync(ct);

        if (await IsTableSourceAsync(table, biConnection, ct))
            return biConnection;

        await biConnection.DisposeAsync();
        return tenantConnection;
    }

    // table_name may be a comma-separated list (multi-table Completeness rules) — every listed
    // table must resolve to the BI database for the whole query to be routed there.
    private static async Task<bool> IsTableSourceAsync(string? table, SqlConnection biConnection, CancellationToken ct)
    {
        var refs = (table ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (refs.Length == 0) return false;

        foreach (var tableRef in refs)
        {
            var parts = tableRef.Trim().Split('.', 2, StringSplitOptions.TrimEntries);
            var tableName = (parts.Length == 2 ? parts[1] : parts[0]).Trim('[', ']');
            var schemaName = parts.Length == 2 ? parts[0].Trim('[', ']') : null;
            if (string.IsNullOrWhiteSpace(tableName)) return false;

            const string sql = @"
                SELECT COUNT(1)
                FROM sys.tables t
                INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
                WHERE t.name = @TableName
                  AND (@SchemaName IS NULL OR s.name = @SchemaName);";
            await using var command = new SqlCommand(sql, biConnection) { CommandTimeout = 15 };
            command.Parameters.AddWithValue("@TableName", tableName);
            command.Parameters.AddWithValue("@SchemaName", (object?)schemaName ?? DBNull.Value);
            if (Convert.ToInt32(await command.ExecuteScalarAsync(ct)) == 0) return false;
        }
        return true;
    }

    private static readonly Regex SafeIdentifier = new(@"^[a-zA-Z_]\w*$", RegexOptions.Compiled);

    private static async Task<int> CountSourceRowsAsync(string tables, SqlConnection connection, CancellationToken ct)
    {
        var total = 0;
        foreach (var table in tables.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            await using var command = new SqlCommand($"SELECT COUNT(*) FROM {QuoteTable(table)}", connection) { CommandTimeout = 60 };
            total = checked(total + Convert.ToInt32(await command.ExecuteScalarAsync(ct)));
        }
        return total;
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
