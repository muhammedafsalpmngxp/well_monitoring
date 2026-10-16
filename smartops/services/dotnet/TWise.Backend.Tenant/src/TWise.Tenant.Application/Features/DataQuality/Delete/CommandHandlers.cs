using MediatR;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.DataQuality;

public sealed class DeleteValidationRuleHandler(
    IConfiguration configuration,
    IDatabaseViewService databaseViews,
    ILogger<DeleteValidationRuleHandler> logger)
    : IRequestHandler<DeleteValidationRuleCommand, Result<DeleteRuleResponse>>
{
    public async Task<Result<DeleteRuleResponse>> Handle(DeleteValidationRuleCommand cmd, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(cmd.RuleId))
            return Result<DeleteRuleResponse>.ValidationError("RuleId is required.");

        var cs = configuration.GetConnectionString("TenantDb")
            ?? throw new InvalidOperationException("ConnectionStrings:TenantDb is not configured.");
        await using var conn = new SqlConnection(cs);
        await conn.OpenAsync(ct);
        await using var tx = (SqlTransaction)await conn.BeginTransactionAsync(ct);
        long? viewId = null;
        string? sourceType = null, tableName = null, fields = null;

        try
        {
            const string viewIdSql = "SELECT view_id, source_type, table_name, fields FROM [core].[DataRules] WHERE rule_id = @RuleId;";
            await using (var viewIdCmd = new SqlCommand(viewIdSql, conn, tx) { CommandTimeout = 30 })
            {
                viewIdCmd.Parameters.AddWithValue("@RuleId", cmd.RuleId);
                await using var viewIdReader = await viewIdCmd.ExecuteReaderAsync(ct);
                if (!await viewIdReader.ReadAsync(ct))
                {
                    await tx.RollbackAsync(ct);
                    return Result<DeleteRuleResponse>.NotFound($"Rule '{cmd.RuleId}' not found.");
                }
                viewId = viewIdReader.IsDBNull(0) ? null : viewIdReader.GetInt64(0);
                sourceType = viewIdReader.IsDBNull(1) ? null : viewIdReader.GetString(1);
                tableName = viewIdReader.IsDBNull(2) ? null : viewIdReader.GetString(2);
                fields = viewIdReader.IsDBNull(3) ? null : viewIdReader.GetString(3);
            }

            const string deleteErrorsSql = "DELETE FROM [core].[ErrorLog] WHERE rule_id = @RuleId;";
            await using (var errCmd = new SqlCommand(deleteErrorsSql, conn, tx) { CommandTimeout = 30 })
            {
                errCmd.Parameters.AddWithValue("@RuleId", cmd.RuleId);
                await errCmd.ExecuteNonQueryAsync(ct);
            }

            const string sql = "DELETE FROM [core].[DataRules] WHERE rule_id = @RuleId;";
            await using var sqlCmd = new SqlCommand(sql, conn, tx) { CommandTimeout = 30 };
            sqlCmd.Parameters.AddWithValue("@RuleId", cmd.RuleId);
            var rows = await sqlCmd.ExecuteNonQueryAsync(ct);
            if (rows == 0)
            {
                await tx.RollbackAsync(ct);
                return Result<DeleteRuleResponse>.NotFound($"Rule '{cmd.RuleId}' not found.");
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
                await using var reliabilityCmd = new SqlCommand(reliabilitySql, conn, tx) { CommandTimeout = 30 };
                reliabilityCmd.Parameters.AddWithValue("@ViewId", viewId.Value);
                await reliabilityCmd.ExecuteNonQueryAsync(ct);
            }

            await tx.CommitAsync(ct);
        }
        catch
        {
            await tx.RollbackAsync(ct);
            throw;
        }

        if (!string.Equals(sourceType, "view", StringComparison.OrdinalIgnoreCase))
        {
            try
            {
                await databaseViews.RecalculateReliabilityForRuleAsync(tableName, fields, cmd.TenantId, ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning(ex, "View reliability could not be recalculated after deleting rule {RuleId}.", cmd.RuleId);
            }
        }

        return Result<DeleteRuleResponse>.Success(new DeleteRuleResponse(cmd.RuleId, "Rule deleted successfully."));
    }
}
