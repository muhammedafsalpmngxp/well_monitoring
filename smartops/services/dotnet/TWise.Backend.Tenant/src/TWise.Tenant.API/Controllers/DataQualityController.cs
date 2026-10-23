using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Features.DataQuality;
using TWise.Tenant.Application.Features.Reliability;

namespace TWise.Tenant.API.Controllers;

[Route("api/data-quality")]
[Authorize]
public class DataQualityController(IMediator mediator, ICurrentUserService currentUser,
    IDashboardShareAccessService shareAccess, IControlPlaneNotificationClient notifications) : BaseApiController
{
    // ─── Rules CRUD ──────────────────────────────────────────────────────

    [HttpPost("rules")]
    public async Task<IActionResult> CreateRule([FromBody] CreateRuleRequest request, CancellationToken ct)
    {
        var command = new CreateValidationRuleCommand(
            request.Category ?? "", request.RuleName ?? "", request.Table ?? "",
            request.Severity ?? "", request.Query, request.ValidationPeriod,
            request.MaxRecords, request.CustomStartDate, request.CustomEndDate,
            request.PrimaryField, request.Fields, request.RuleDesc, request.AdditionalCondition, request.SourceType, request.ViewId);
        return ToActionResult(await mediator.Send(command, ct));
    }

    [HttpGet("rules")]
    public async Task<IActionResult> ListRules(CancellationToken ct)
        => ToActionResult(await mediator.Send(new ListValidationRulesQuery(), ct));

    [HttpPut("rules/{ruleId}")]
    public async Task<IActionResult> UpdateRule(string ruleId, [FromBody] UpdateRuleRequest request, CancellationToken ct)
    {
        var command = new UpdateValidationRuleCommand(
            ruleId, request.Category ?? "", request.RuleName ?? "", request.Table ?? "",
            request.Severity ?? "", request.Query ?? "", request.ValidationPeriod,
            request.MaxRecords, request.CustomStartDate, request.CustomEndDate,
            request.PrimaryField, request.Fields, request.RuleDesc, request.AdditionalCondition, request.SourceType, request.ViewId);
        return ToActionResult(await mediator.Send(command, ct));
    }

    [HttpPatch("rules/{ruleId}/active")]
    public async Task<IActionResult> ToggleRuleActive(string ruleId, [FromBody] ToggleActiveRequest request, CancellationToken ct)
        => ToActionResult(await mediator.Send(new ToggleRuleActiveCommand(ruleId, request.ActiveYn ?? ""), ct));

    [HttpPost("rules/{ruleId}/execute")]
    public async Task<IActionResult> ExecuteRule(string ruleId, CancellationToken ct)
    {
        if (!TryGetTenantId(out var tenantId)) return Unauthorized("TenantId not found in token.");
        return ToActionResult(await mediator.Send(new ExecuteValidationRuleCommand(ruleId, tenantId), ct));
    }

    /// <summary>Publishes the result of a completed validation-rule batch to the notification bell.</summary>
    [HttpPost("rules/batch-completion")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> PublishRuleBatchCompletion(
        [FromBody] PublishRuleBatchCompletionRequest request, CancellationToken ct)
    {
        if (!TryGetTenantId(out var tenantId)) return Unauthorized("TenantId not found in token.");
        if (request.SuccessCount < 0 || request.FailedCount < 0)
            return BadRequest("SuccessCount and FailedCount must be non-negative.");

        var description = $"{request.SuccessCount} success and {request.FailedCount} failed.";
        await notifications.PublishAsync(
            tenantId,
            "DataQualityRuleBatchCompleted",
            "Rule batch execution completed",
            description,
            "/data-quality/error-log-rules",
            Array.Empty<long>(),
            "data-quality.error-log",
            ct);

        return NoContent();
    }

    [HttpDelete("rules/{ruleId}")]
    public async Task<IActionResult> DeleteRule(string ruleId, CancellationToken ct)
    {
        if (!TryGetTenantId(out var tenantId)) return Unauthorized("TenantId not found in token.");
        return ToActionResult(await mediator.Send(new DeleteValidationRuleCommand(ruleId, tenantId), ct));
    }

    // ─── Error Log ───────────────────────────────────────────────────────

    [HttpGet("open-errors")]
    public async Task<IActionResult> ListOpenErrors(CancellationToken ct)
        => ToActionResult(await mediator.Send(new ListOpenErrorsQuery(), ct));

    [HttpPatch("open-errors/{errorId}/action")]
    public async Task<IActionResult> UpdateErrorAction(string errorId, [FromBody] UpdateActionRequest request, CancellationToken ct)
        => ToActionResult(await mediator.Send(new UpdateErrorActionCommand(errorId, request.Action ?? "", currentUser.UserId ?? "system"), ct));

    [HttpPatch("open-errors/{errorId}/status")]
    public async Task<IActionResult> UpdateErrorStatus(string errorId, [FromBody] UpdateStatusRequest request, CancellationToken ct)
        => ToActionResult(await mediator.Send(new UpdateErrorStatusCommand(errorId, request.Status ?? "", currentUser.UserId ?? "system"), ct));

    // ─── Reliability ─────────────────────────────────────────────────────

    [AllowAnonymous]
    [HttpGet("reliability/table")]
    public async Task<IActionResult> GetTableReliability([FromQuery] string tableName,
        [FromQuery] int? shareDashboardId, [FromQuery] string? shareToken, CancellationToken ct)
    {
        if (!await CanReadReliabilityAsync(tableName, null, shareDashboardId, shareToken, ct)) return Forbid();
        return Ok(await mediator.Send(new GetTableReliabilityQuery(tableName ?? ""), ct));
    }

    [AllowAnonymous]
    [HttpGet("reliability/rules")]
    public async Task<IActionResult> GetReliabilityRules([FromQuery] string? tableName, [FromQuery] long? viewId,
        [FromQuery] int? shareDashboardId, [FromQuery] string? shareToken, CancellationToken ct)
    {
        if (!await CanReadReliabilityAsync(tableName, viewId, shareDashboardId, shareToken, ct)) return Forbid();
        return ToActionResult(await mediator.Send(new GetReliabilityDetailQuery(tableName, viewId), ct));
    }

    private async Task<bool> CanReadReliabilityAsync(string? tableName, long? viewId,
        int? dashboardId, string? token, CancellationToken ct)
    {
        if (User.Identity?.IsAuthenticated == true) return true;
        if (dashboardId is null || string.IsNullOrWhiteSpace(token)) return false;
        if (viewId.HasValue
            && await shareAccess.FindSharedViewWidgetAsync(dashboardId.Value, token, viewId.Value, ct) is null)
            return false;
        if (!string.IsNullOrWhiteSpace(tableName)
            && await shareAccess.FindSharedTableWidgetAsync(dashboardId.Value, token, tableName, "Table", ct) is null)
            return false;
        return viewId.HasValue || !string.IsNullOrWhiteSpace(tableName);
    }

    // ─── Request DTOs ────────────────────────────────────────────────────

    public sealed record CreateRuleRequest(string? Category, string? RuleName, string? Table, string? Severity,
        string? Query, string? ValidationPeriod, int? MaxRecords, string? CustomStartDate, string? CustomEndDate,
        string? PrimaryField, string? Fields, string? RuleDesc, string? AdditionalCondition, string? SourceType, long? ViewId);

    public sealed record UpdateRuleRequest(string? Category, string? RuleName, string? Table, string? Severity,
        string? Query, string? ValidationPeriod, int? MaxRecords, string? CustomStartDate, string? CustomEndDate,
        string? PrimaryField, string? Fields, string? RuleDesc, string? AdditionalCondition, string? SourceType, long? ViewId);

    public sealed record ToggleActiveRequest(string? ActiveYn);
    /// <summary>Successful and failed rule totals for a completed validation-rule batch.</summary>
    public sealed record PublishRuleBatchCompletionRequest(int SuccessCount, int FailedCount);
    public sealed record UpdateActionRequest(string? Action);
    public sealed record UpdateStatusRequest(string? Status);

    private bool TryGetTenantId(out long tenantId)
    {
        tenantId = 0;
        var claim = User.FindFirst("tenantId")?.Value;
        return claim is not null && long.TryParse(claim, out tenantId) && tenantId > 0;
    }
}
