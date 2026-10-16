using MediatR;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.DataQuality;

public sealed class ToggleRuleActiveHandler(IConfiguration configuration)
    : IRequestHandler<ToggleRuleActiveCommand, Result<ToggleActiveResponse>>
{
    public async Task<Result<ToggleActiveResponse>> Handle(ToggleRuleActiveCommand cmd, CancellationToken ct)
    {
        var val = cmd.ActiveYn?.Trim().ToUpperInvariant();
        if (val is not ("Y" or "N"))
            return Result<ToggleActiveResponse>.ValidationError("activeYn must be 'Y' or 'N'.");

        var cs = configuration.GetConnectionString("TenantDb")!;
        await using var conn = new SqlConnection(cs);
        await conn.OpenAsync(ct);

        const string sql = "UPDATE [core].[DataRules] SET active_yn = @ActiveYn WHERE rule_id = @RuleId;";
        await using var sqlCmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
        sqlCmd.Parameters.AddWithValue("@ActiveYn", val);
        sqlCmd.Parameters.AddWithValue("@RuleId", cmd.RuleId);
        var rows = await sqlCmd.ExecuteNonQueryAsync(ct);
        if (rows == 0) return Result<ToggleActiveResponse>.NotFound($"Rule '{cmd.RuleId}' not found.");
        return Result<ToggleActiveResponse>.Success(new ToggleActiveResponse(cmd.RuleId, val, "Active status updated."));
    }
}

public sealed class UpdateErrorActionHandler(IConfiguration configuration)
    : IRequestHandler<UpdateErrorActionCommand, Result<ErrorActionResponse>>
{
    private static readonly HashSet<string> Allowed = new(StringComparer.OrdinalIgnoreCase)
        { "Open", "Close", "In Progress", "On Hold", "Invalid" };

    public async Task<Result<ErrorActionResponse>> Handle(UpdateErrorActionCommand cmd, CancellationToken ct)
    {
        var val = cmd.Action?.Trim();
        if (string.IsNullOrWhiteSpace(val) || !Allowed.Contains(val))
            return Result<ErrorActionResponse>.ValidationError("Action must be one of: Open, Close, In Progress, On Hold, Invalid.");

        var cs = configuration.GetConnectionString("TenantDb")!;
        await using var conn = new SqlConnection(cs);
        await conn.OpenAsync(ct);

        const string sql = "UPDATE [core].[ErrorLog] SET status = @Action, changed_by = @ChangedBy WHERE error_id = @ErrorId;";
        await using var sqlCmd = new SqlCommand(sql, conn) { CommandTimeout = 15 };
        sqlCmd.Parameters.AddWithValue("@Action", val);
        sqlCmd.Parameters.AddWithValue("@ChangedBy", (object?)cmd.ChangedBy?.Trim() ?? DBNull.Value);
        sqlCmd.Parameters.AddWithValue("@ErrorId", cmd.ErrorId);
        var rows = await sqlCmd.ExecuteNonQueryAsync(ct);
        if (rows == 0) return Result<ErrorActionResponse>.NotFound($"Error record {cmd.ErrorId} not found.");
        return Result<ErrorActionResponse>.Success(new ErrorActionResponse(cmd.ErrorId, val, cmd.ChangedBy, "Action updated."));
    }
}

public sealed class UpdateErrorStatusHandler(IConfiguration configuration)
    : IRequestHandler<UpdateErrorStatusCommand, Result<ErrorStatusResponse>>
{
    private static readonly HashSet<string> Allowed = new(StringComparer.OrdinalIgnoreCase)
        { "Open", "Close", "In Progress", "On Hold", "Invalid" };

    public async Task<Result<ErrorStatusResponse>> Handle(UpdateErrorStatusCommand cmd, CancellationToken ct)
    {
        var val = cmd.Status?.Trim();
        if (string.IsNullOrWhiteSpace(val) || !Allowed.Contains(val))
            return Result<ErrorStatusResponse>.ValidationError("Status must be one of: Open, Close, In Progress, On Hold, Invalid.");

        var cs = configuration.GetConnectionString("TenantDb")!;
        await using var conn = new SqlConnection(cs);
        await conn.OpenAsync(ct);

        const string sql = "UPDATE [core].[ErrorLog] SET status = @Status, changed_by = @ChangedBy WHERE error_id = @ErrorId;";
        await using var sqlCmd = new SqlCommand(sql, conn) { CommandTimeout = 15 };
        sqlCmd.Parameters.AddWithValue("@Status", val);
        sqlCmd.Parameters.AddWithValue("@ChangedBy", (object?)cmd.ChangedBy?.Trim() ?? DBNull.Value);
        sqlCmd.Parameters.AddWithValue("@ErrorId", cmd.ErrorId);
        var rows = await sqlCmd.ExecuteNonQueryAsync(ct);
        if (rows == 0) return Result<ErrorStatusResponse>.NotFound($"Error record {cmd.ErrorId} not found.");
        return Result<ErrorStatusResponse>.Success(new ErrorStatusResponse(cmd.ErrorId, val, cmd.ChangedBy, "Status updated."));
    }
}
