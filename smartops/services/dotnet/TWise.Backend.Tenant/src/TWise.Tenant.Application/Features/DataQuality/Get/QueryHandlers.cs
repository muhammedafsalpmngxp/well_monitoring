using MediatR;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.DataQuality;

public sealed class ListValidationRulesHandler(IConfiguration configuration)
    : IRequestHandler<ListValidationRulesQuery, Result<ListRulesResponse>>
{
    public async Task<Result<ListRulesResponse>> Handle(ListValidationRulesQuery request, CancellationToken ct)
    {
        var cs = configuration.GetConnectionString("TenantDb")
            ?? throw new InvalidOperationException("ConnectionStrings:TenantDb is not configured.");
        await using var conn = new SqlConnection(cs);
        await conn.OpenAsync(ct);

        const string sql = @"
            SELECT rule_id, category, rule_name, table_name, severity, active_yn, query, max_records, start_date, end_date, primary_field, triggered_on, fields, rule_desc, source_type, view_id
            FROM [core].[DataRules]
            ORDER BY TRY_CONVERT(INT, SUBSTRING(rule_id, 2, LEN(rule_id) - 1)) DESC, rule_id DESC;";;

        var rules = new List<ValidationRuleDto>();
        await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            rules.Add(new ValidationRuleDto(
                reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.GetString(3),
                reader.GetString(4), reader.GetString(5), reader.IsDBNull(6) ? "" : reader.GetString(6),
                reader.IsDBNull(7) ? null : reader.GetInt32(7),
                reader.IsDBNull(8) ? null : reader.GetDateTime(8).ToString("yyyy-MM-dd"),
                reader.IsDBNull(9) ? null : reader.GetDateTime(9).ToString("yyyy-MM-dd"),
                reader.IsDBNull(10) ? null : reader.GetString(10),
                reader.IsDBNull(11) ? null : reader.GetDateTime(11).ToString("yyyy-MM-dd HH:mm"),
                reader.IsDBNull(12) ? null : reader.GetString(12),
                reader.IsDBNull(13) ? null : reader.GetString(13),
                reader.IsDBNull(14) ? null : reader.GetString(14),
                reader.IsDBNull(15) ? null : reader.GetInt64(15)));
        }
        return Result<ListRulesResponse>.Success(new ListRulesResponse(rules));
    }
}

public sealed class ListOpenErrorsHandler(IConfiguration configuration)
    : IRequestHandler<ListOpenErrorsQuery, Result<ListErrorsResponse>>
{
    public async Task<Result<ListErrorsResponse>> Handle(ListOpenErrorsQuery request, CancellationToken ct)
    {
        var cs = configuration.GetConnectionString("TenantDb")
            ?? throw new InvalidOperationException("ConnectionStrings:TenantDb is not configured.");
        await using var conn = new SqlConnection(cs);
        await conn.OpenAsync(ct);

        const string sql = @"
            SELECT TOP 5000 CAST(e.error_id AS NVARCHAR(10)) AS error_id, e.rule_id, e.severity, e.rule_name, e.primary_field, e.status, e.well, e.sla, e.created_at, e.changed_by, e.category, ISNULL(e.fields, r.fields) AS fields, ISNULL(e.rule_desc, r.rule_desc) AS rule_desc,
                   r.table_name AS table_name, ISNULL(e.records_total, r.max_records) AS max_records, e.records_found AS records_found
            FROM [core].[ErrorLog] e
            LEFT JOIN [core].[DataRules] r ON r.rule_id = e.rule_id
            WHERE e.status <> 'Close'
            ORDER BY e.created_at DESC;";;

        var errors = new List<ErrorLogDto>();
        await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            errors.Add(new ErrorLogDto(
                reader.GetString(0), reader.GetString(1),
                reader.IsDBNull(2) ? null : reader.GetString(2),
                reader.IsDBNull(3) ? null : reader.GetString(3),
                reader.IsDBNull(4) ? null : reader.GetString(4),
                reader.IsDBNull(5) ? "Open" : reader.GetString(5),
                reader.IsDBNull(6) ? null : reader.GetString(6),
                reader.IsDBNull(7) ? null : reader.GetString(7),
                reader.IsDBNull(8) ? null : reader.GetDateTime(8).ToString("yyyy-MM-dd HH:mm"),
                reader.IsDBNull(9) ? null : reader.GetString(9),
                reader.IsDBNull(10) ? null : reader.GetString(10),
                reader.IsDBNull(11) ? null : reader.GetString(11),
                reader.IsDBNull(12) ? null : reader.GetString(12),
                reader.IsDBNull(13) ? null : reader.GetString(13),
                reader.IsDBNull(14) ? null : reader.GetInt32(14),
                reader.IsDBNull(15) ? null : reader.GetInt32(15)));
        }
        return Result<ListErrorsResponse>.Success(new ListErrorsResponse(errors));
    }
}

public sealed class GetReliabilityDetailHandler(IConfiguration configuration)
    : IRequestHandler<GetReliabilityDetailQuery, Result<ReliabilityDetailResponse>>
{
    private const string NoData = "N/a";

    public async Task<Result<ReliabilityDetailResponse>> Handle(GetReliabilityDetailQuery request, CancellationToken ct)
    {
        var tableName = string.IsNullOrWhiteSpace(request.TableName) ? null : request.TableName.Trim();
        if (tableName is null && request.ViewId is null)
            return Result<ReliabilityDetailResponse>.ValidationError("Either tableName or viewId is required.");

        var unqualifiedTableName = tableName is not null && tableName.Contains('.')
            ? tableName[(tableName.LastIndexOf('.') + 1)..]
            : tableName;

        var cs = configuration.GetConnectionString("TenantDb")
            ?? throw new InvalidOperationException("ConnectionStrings:TenantDb is not configured.");
        await using var conn = new SqlConnection(cs);
        await conn.OpenAsync(ct);

        if (request.ViewId is not null)
        {
            var viewBreakdown = await GetViewBreakdownAsync(conn, request.ViewId.Value, ct);
            if (viewBreakdown is not null)
                return Result<ReliabilityDetailResponse>.Success(viewBreakdown);
        }

        // Latest still-open execution per rule drives the per-rule reliability.
        const string sql = @"
            SELECT r.rule_id, r.rule_name, r.rule_desc, r.category, r.severity, r.max_records, r.triggered_on,
                   e.records_found, e.records_total, e.created_at
            FROM [core].[DataRules] r
            OUTER APPLY (
                SELECT TOP 1 el.records_found, el.records_total, el.created_at
                FROM [core].[ErrorLog] el
                WHERE el.rule_id = r.rule_id AND el.status <> 'Close'
                ORDER BY el.created_at DESC
            ) e
            WHERE (@ViewId IS NOT NULL AND r.view_id = @ViewId)
               OR (@TableName IS NOT NULL AND (r.table_name = @TableName OR PARSENAME(r.table_name, 1) = @UnqualifiedTableName))
            ORDER BY r.rule_id;";

        await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
        cmd.Parameters.AddWithValue("@ViewId", (object?)request.ViewId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@TableName", (object?)tableName ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@UnqualifiedTableName", (object?)unqualifiedTableName ?? DBNull.Value);

        var rows = new List<(string RuleId, string RuleName, string? RuleDesc, string? Category, string? Severity,
            int? RecordsFound, int? RecordsTotal, string? TriggeredOn, decimal? Score, DateTime CreatedAt)>();
        await using (var reader = await cmd.ExecuteReaderAsync(ct))
        {
            while (await reader.ReadAsync(ct))
            {
                var ruleId = reader.GetString(0);
                var ruleName = reader.IsDBNull(1) ? "" : reader.GetString(1);
                var ruleDesc = reader.IsDBNull(2) ? null : reader.GetString(2);
                var category = reader.IsDBNull(3) ? null : reader.GetString(3);
                var severity = reader.IsDBNull(4) ? null : reader.GetString(4);
                var maxRecords = reader.IsDBNull(5) ? (int?)null : reader.GetInt32(5);
                var triggeredOn = reader.IsDBNull(6) ? null : reader.GetDateTime(6).ToString("yyyy-MM-dd HH:mm");
                var recordsFound = reader.IsDBNull(7) ? (int?)null : reader.GetInt32(7);
                var recordsTotal = (reader.IsDBNull(8) ? (int?)null : reader.GetInt32(8)) ?? maxRecords;
                var createdAt = reader.IsDBNull(9) ? DateTime.MinValue : reader.GetDateTime(9);

                decimal? score = recordsFound.HasValue && recordsTotal is > 0
                    ? Math.Floor(Math.Clamp(100m - ((decimal)recordsFound.Value / recordsTotal.Value * 100m), 0m, 100m) * 100m) / 100m
                    : null;

                rows.Add((ruleId, ruleName, ruleDesc, category, severity, recordsFound, recordsTotal, triggeredOn, score, createdAt));
            }
        }

        // Overall score mirrors the badge: average of the latest scored rule per category.
        var latestByCategory = rows
            .Where(rule => rule.Score.HasValue)
            .GroupBy(rule => rule.Category ?? "", StringComparer.OrdinalIgnoreCase)
            .Select(group => group.OrderByDescending(rule => rule.CreatedAt).First())
            .ToList();
        var contributingRuleIds = latestByCategory.Select(rule => rule.RuleId).ToHashSet(StringComparer.OrdinalIgnoreCase);

        var rules = rows
            .Select(rule => new ReliabilityRuleDto(
                rule.RuleId, rule.RuleName, rule.RuleDesc, rule.Category, rule.Severity,
                rule.RecordsFound, rule.RecordsTotal,
                rule.RecordsTotal.HasValue ? $"{rule.RecordsFound ?? 0}/{rule.RecordsTotal}" : "",
                rule.Score, rule.TriggeredOn, contributingRuleIds.Contains(rule.RuleId)))
            .ToList();

        decimal? overall = latestByCategory.Count == 0
            ? null
            : Math.Floor(latestByCategory.Average(rule => rule.Score!.Value) * 100m) / 100m;

        var categories = latestByCategory
            .Select(rule => rule.Category)
            .Where(category => !string.IsNullOrWhiteSpace(category))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(category => category)
            .ToArray();

        var breakdown = categories.Length == 0
            ? NoData
            : $"The reliability score is calculated using validation rules that check {string.Join(", ", categories)}.";

        return Result<ReliabilityDetailResponse>.Success(
            new ReliabilityDetailResponse(tableName ?? $"View #{request.ViewId}", overall, breakdown, rules));
    }

    /// <summary>
    /// For a view with a stored reliability, lists the rules that feed it: table rules covering the view's
    /// columns_used plus view rules tied to this view. Returns null when the view has no stored score.
    /// </summary>
    private static async Task<ReliabilityDetailResponse?> GetViewBreakdownAsync(SqlConnection conn, long viewId, CancellationToken ct)
    {
        const string viewSql = @"
            SELECT view_name, reliability, columns_used
            FROM [core].[DatabaseViews]
            WHERE id = @ViewId AND is_deleted = 0;";
        string viewName;
        decimal? viewReliability;
        HashSet<string> viewColumns;
        await using (var viewCmd = new SqlCommand(viewSql, conn) { CommandTimeout = 30 })
        {
            viewCmd.Parameters.AddWithValue("@ViewId", viewId);
            await using var reader = await viewCmd.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct)) return null;
            viewName = reader.IsDBNull(0) ? $"View #{viewId}" : reader.GetString(0);
            viewReliability = reader.IsDBNull(1) ? null : Convert.ToDecimal(reader.GetValue(1));
            viewColumns = (reader.IsDBNull(2) ? "" : reader.GetString(2))
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
        }
        if (viewReliability is null) return null;

        const string rulesSql = @"
            SELECT r.rule_id, r.rule_name, r.rule_desc, r.category, r.severity, r.max_records, r.triggered_on,
                   r.source_type, r.view_id, r.table_name, r.fields, r.reliability_score,
                   e.records_found, e.records_total
            FROM [core].[DataRules] r
            OUTER APPLY (
                SELECT TOP 1 el.records_found, el.records_total
                FROM [core].[ErrorLog] el
                WHERE el.rule_id = r.rule_id AND el.status <> 'Close'
                ORDER BY el.created_at DESC
            ) e
            WHERE r.reliability_score IS NOT NULL
              AND (r.view_id = @ViewId OR ISNULL(r.source_type, '') <> 'view')
            ORDER BY r.rule_id;";

        var rules = new List<ReliabilityRuleDto>();
        await using (var rulesCmd = new SqlCommand(rulesSql, conn) { CommandTimeout = 30 })
        {
            rulesCmd.Parameters.AddWithValue("@ViewId", viewId);
            await using var reader = await rulesCmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                var sourceType = reader.IsDBNull(7) ? null : reader.GetString(7);
                var isViewRule = string.Equals(sourceType, "view", StringComparison.OrdinalIgnoreCase);
                var ruleViewId = reader.IsDBNull(8) ? (long?)null : Convert.ToInt64(reader.GetValue(8));
                var applies = isViewRule
                    ? ruleViewId == viewId
                    : ReliabilityColumns.ForRule(reader.IsDBNull(9) ? null : reader.GetString(9),
                        reader.IsDBNull(10) ? null : reader.GetString(10)).Overlaps(viewColumns);
                if (!applies) continue;

                var maxRecords = reader.IsDBNull(5) ? (int?)null : reader.GetInt32(5);
                var recordsFound = reader.IsDBNull(12) ? (int?)null : reader.GetInt32(12);
                var recordsTotal = (reader.IsDBNull(13) ? (int?)null : reader.GetInt32(13)) ?? maxRecords;
                rules.Add(new ReliabilityRuleDto(
                    reader.GetString(0),
                    reader.IsDBNull(1) ? "" : reader.GetString(1),
                    reader.IsDBNull(2) ? null : reader.GetString(2),
                    reader.IsDBNull(3) ? null : reader.GetString(3),
                    reader.IsDBNull(4) ? null : reader.GetString(4),
                    recordsFound, recordsTotal,
                    recordsTotal.HasValue ? $"{recordsFound ?? 0}/{recordsTotal}" : "",
                    Convert.ToDecimal(reader.GetValue(11)),
                    reader.IsDBNull(6) ? null : reader.GetDateTime(6).ToString("yyyy-MM-dd HH:mm"),
                    true));
            }
        }

        var categories = rules
            .Select(rule => rule.Category)
            .Where(category => !string.IsNullOrWhiteSpace(category))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(category => category)
            .ToArray();
        var breakdown = categories.Length == 0
            ? NoData
            : $"The reliability score is calculated using validation rules that check {string.Join(", ", categories)}.";

        return new ReliabilityDetailResponse(viewName, viewReliability, breakdown, rules);
    }
}
