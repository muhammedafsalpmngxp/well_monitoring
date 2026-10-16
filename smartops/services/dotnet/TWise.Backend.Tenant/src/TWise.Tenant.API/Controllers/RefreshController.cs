using System.IdentityModel.Tokens.Jwt;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TWise.Tenant.Application.Features.Refresh;
using TWise.Tenant.Domain.DTOs;

using TWise.Tenant.API.Auth;

namespace TWise.Tenant.API.Controllers;

/// <summary>
/// Scheduled, manual and incremental refresh of connector-backed datasets, plus the execution
/// history and freshness indicators behind the Data Sync screen.
///
/// A refresh re-runs the original ingest through the same connector and updates the dataset in
/// place, so charts and tiles built on it keep working without being rewired.
/// </summary>
[ApiController]
[Authorize]
[Route("api/refresh")]
public sealed class RefreshController(ISender sender) : ControllerBase
{
    private const string TenantIdMissing = "TenantId not found in token.";
    private const int DefaultJobHistoryLimit = 200;

    // ── Schedules ────────────────────────────────────────────────────────────

    /// <summary>All recurring refresh schedules for the tenant.</summary>
    [HttpGet("schedules")]
    [ProducesResponseType(typeof(IReadOnlyList<RefreshScheduleDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetSchedules(CancellationToken ct)
    {
        if (!TryGetTenantId(out var tenantId)) return Unauthorized(TenantIdMissing);
        return Ok(await sender.Send(new ListRefreshSchedulesQuery(tenantId), ct));
    }

    [HttpGet("schedules/{id:long}")]
    [ProducesResponseType(typeof(RefreshScheduleDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetSchedule(long id, CancellationToken ct)
    {
        if (!TryGetTenantId(out var tenantId)) return Unauthorized(TenantIdMissing);

        var result = await sender.Send(new GetRefreshScheduleQuery(id, tenantId), ct);
        return result is null ? NotFound() : Ok(result);
    }

    /// <summary>
    /// Create a schedule. The cron expression is validated against the given time zone and the
    /// first fire time is computed immediately, so an invalid schedule cannot be saved.
    /// </summary>
    [HttpPost("schedules")]
    [RequireModulePermission("settings.data-sync", 'c')]
    [ProducesResponseType(typeof(RefreshScheduleDto), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> CreateSchedule([FromBody] CreateRefreshScheduleRequest request, CancellationToken ct)
    {
        if (!TryGetUserId(out var userId)) return Unauthorized();
        if (!TryGetTenantId(out var tenantId)) return Unauthorized(TenantIdMissing);

        try
        {
            var created = await sender.Send(new CreateRefreshScheduleCommand(request, userId, tenantId), ct);
            return CreatedAtAction(nameof(GetSchedule), new { id = created.Id }, created);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpPut("schedules/{id:long}")]
    [RequireModulePermission("settings.data-sync", 'm')]
    [ProducesResponseType(typeof(RefreshScheduleDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> UpdateSchedule(long id, [FromBody] UpdateRefreshScheduleRequest request, CancellationToken ct)
    {
        if (!TryGetUserId(out var userId)) return Unauthorized();
        if (!TryGetTenantId(out var tenantId)) return Unauthorized(TenantIdMissing);

        try
        {
            var result = await sender.Send(new UpdateRefreshScheduleCommand(id, request, userId, tenantId), ct);
            return result is null ? NotFound() : Ok(result);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    /// <summary>Soft-delete a schedule. Its job history is kept.</summary>
    [HttpDelete("schedules/{id:long}")]
    [RequireModulePermission("settings.data-sync", 'm')]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> DeleteSchedule(long id, CancellationToken ct)
    {
        if (!TryGetTenantId(out var tenantId)) return Unauthorized(TenantIdMissing);
        return await sender.Send(new DeleteRefreshScheduleCommand(id, tenantId), ct) ? NoContent() : NotFound();
    }

    /// <summary>
    /// Run a schedule now. This is an extra run — the schedule's next fire time is unchanged.
    /// </summary>
    [HttpPost("schedules/{id:long}/run")]
    [RequireModulePermission("settings.data-sync", 'm')]
    [ProducesResponseType(typeof(RefreshJobDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> RunSchedule(long id, CancellationToken ct)
    {
        if (!TryGetUserId(out var userId)) return Unauthorized();
        if (!TryGetTenantId(out var tenantId)) return Unauthorized(TenantIdMissing);

        var result = await sender.Send(new RunRefreshScheduleCommand(id, userId, tenantId), ct);
        return result is null ? NotFound() : Ok(result);
    }

    // ── Jobs ─────────────────────────────────────────────────────────────────

    /// <summary>
    /// Refresh history, newest first. A failed run keeps its error message, so this doubles as
    /// the failure log.
    /// </summary>
    [HttpGet("jobs")]
    [ProducesResponseType(typeof(IReadOnlyList<RefreshJobDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetJobs([FromQuery] int? limit, CancellationToken ct)
    {
        if (!TryGetTenantId(out var tenantId)) return Unauthorized(TenantIdMissing);
        return Ok(await sender.Send(new ListRefreshJobsQuery(tenantId, limit ?? DefaultJobHistoryLimit), ct));
    }

    /// <summary>
    /// Run an ad-hoc refresh that is not attached to a schedule. Runs synchronously and returns
    /// the completed job, so the caller sees the outcome rather than having to poll.
    /// </summary>
    [HttpPost("run")]
    [RequireModulePermission("settings.data-sync", 'm')]
    [ProducesResponseType(typeof(RefreshJobDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> RunManual([FromBody] RunRefreshRequest request, CancellationToken ct)
    {
        if (!TryGetUserId(out var userId)) return Unauthorized();
        if (!TryGetTenantId(out var tenantId)) return Unauthorized(TenantIdMissing);

        try
        {
            return Ok(await sender.Send(new RunManualRefreshCommand(request, userId, tenantId), ct));
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    /// <summary>Re-run a job. The original attempt stays in the history with its error.</summary>
    [HttpPost("jobs/{id:long}/retry")]
    [RequireModulePermission("settings.data-sync", 'm')]
    [ProducesResponseType(typeof(RefreshJobDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> RetryJob(long id, CancellationToken ct)
    {
        if (!TryGetUserId(out var userId)) return Unauthorized();
        if (!TryGetTenantId(out var tenantId)) return Unauthorized(TenantIdMissing);

        var result = await sender.Send(new RetryRefreshJobCommand(id, userId, tenantId), ct);
        return result is null ? NotFound() : Ok(result);
    }

    // ── Monitoring ───────────────────────────────────────────────────────────

    /// <summary>
    /// Freshness of every imported dataset: when it was last refreshed, whether the last attempt
    /// failed (so what is displayed is stale), and when the next run is due.
    /// </summary>
    [HttpGet("datasets")]
    [ProducesResponseType(typeof(IReadOnlyList<DatasetRefreshStatusDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetDatasetStatuses(CancellationToken ct)
    {
        if (!TryGetTenantId(out var tenantId)) return Unauthorized(TenantIdMissing);
        return Ok(await sender.Send(new ListDatasetRefreshStatusQuery(tenantId), ct));
    }

    /// <summary>
    /// Validate a cron expression and preview its next fire times — used by the schedule form so
    /// a user sees what they built before saving.
    /// </summary>
    [HttpGet("cron/preview")]
    [ProducesResponseType(typeof(CronPreviewResponse), StatusCodes.Status200OK)]
    public async Task<IActionResult> PreviewCron(
        [FromQuery] string cron, [FromQuery] string? timeZone, [FromQuery] int? count, CancellationToken ct)
        => Ok(await sender.Send(new PreviewCronQuery(cron, timeZone ?? "UTC", count ?? 5), ct));

    // ── Helpers ──────────────────────────────────────────────────────────────

    private bool TryGetUserId(out long userId)
    {
        userId = 0;
        var sub = User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value
               ?? User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        return sub is not null && long.TryParse(sub, out userId);
    }

    private bool TryGetTenantId(out long tenantId)
    {
        tenantId = 0;
        var claim = User.FindFirst("tenantId")?.Value;
        return claim is not null && long.TryParse(claim, out tenantId) && tenantId > 0;
    }
}
