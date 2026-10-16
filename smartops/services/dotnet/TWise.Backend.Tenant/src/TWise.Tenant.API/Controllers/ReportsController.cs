using System.IdentityModel.Tokens.Jwt;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TWise.Tenant.Application.Features.Reports;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Application.Abstractions.Services;

namespace TWise.Tenant.API.Controllers;

[ApiController]
[Authorize]
[TypeFilter(typeof(TWise.Tenant.API.Auth.BiWritePermissionFilter))]
[Route("api/reports")]
public class ReportsController(ISender sender, IReportService reportService) : ControllerBase
{
    /// <summary>Get all reports. Filter by status: draft | published (inactive excluded by default)</summary>
    [HttpGet]
    public async Task<IActionResult> GetAll([FromQuery] string? status, CancellationToken ct)
    {
        if (!TryGetUserIdFromJwt(out var userId)) return Unauthorized();
        var isAdmin = IsAdminUser();
        return Ok(await sender.Send(new ListReportsQuery(status, userId, isAdmin), ct));
    }

    /// <summary>Get a single report by ID — only accessible by the creator</summary>
    [HttpGet("{id:long}")]
    public async Task<IActionResult> GetById(long id, CancellationToken ct)
    {
        if (!TryGetUserIdFromJwt(out var userId)) return Unauthorized();
        var report = await sender.Send(new GetReportByIdQuery(id, userId), ct);
        return report is null ? NotFound() : Ok(report);
    }

    /// <summary>Create a new report — userId and tenantId are extracted from JWT</summary>
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateReportRequest? request, CancellationToken ct)
    {
        if (request is null)
            return BadRequest("Request body is required.");

        if (!TryGetUserIdFromJwt(out var userId))
            return Unauthorized("Invalid or missing user identity in token.");

        if (!TryGetTenantIdFromJwt(out var tenantId))
            return Unauthorized("TenantId not found in token. Please login again.");

        var created = await sender.Send(new CreateReportCommand(request, userId, tenantId), ct);
        return CreatedAtAction(nameof(GetById), new { id = created.Id }, created);
    }

    [HttpPost("{id:long}/copy-to-draft")]
    public async Task<IActionResult> CopyToDraft(long id, CancellationToken ct)
    {
        if (!TryGetUserIdFromJwt(out var userId)) return Unauthorized();
        if (!TryGetTenantIdFromJwt(out var tenantId)) return Unauthorized("TenantId not found in token.");
        try
        {
            var result = await reportService.CopyToDraftAsync(id, userId, IsAdminUser(), tenantId, ct);
            return result is null ? NotFound() : Ok(result);
        }
        catch (UnauthorizedAccessException ex) { return Forbid(ex.Message); }
    }

    /// <summary>Update report — only creator can edit; only admin can publish</summary>
    [HttpPut("{id:long}")]
    public async Task<IActionResult> Update(long id, [FromBody] UpdateReportRequest request, CancellationToken ct)
    {
        if (!TryGetUserIdFromJwt(out var userId)) return Unauthorized();
        var isAdmin = IsAdminUser();
        var updated = await sender.Send(new UpdateReportCommand(id, request, userId, isAdmin), ct);
        return updated is null ? NotFound() : Ok(updated);
    }

    /// <summary>Soft-delete a report — only creator can delete</summary>
    [HttpDelete("{id:long}")]
    public async Task<IActionResult> Delete(long id, CancellationToken ct)
    {
        if (!TryGetUserIdFromJwt(out var userId)) return Unauthorized();
        var deleted = await sender.Send(new DeleteReportCommand(id, userId), ct);
        return deleted ? NoContent() : NotFound();
    }

    // ── Version history ──────────────────────────────────────────────────────

    /// <summary>
    /// Published version history for a report, newest first. A snapshot is appended on every
    /// publish, so this is empty for reports last published before version tracking existed.
    /// </summary>
    [HttpGet("{id:long}/versions")]
    [ProducesResponseType(typeof(IReadOnlyList<ReportVersionSummaryDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetVersions(long id, CancellationToken ct)
    {
        if (!TryGetUserIdFromJwt(out var userId)) return Unauthorized();
        if (!TryGetTenantIdFromJwt(out var tenantId)) return Unauthorized("TenantId not found in token.");

        var versions = await sender.Send(new GetReportVersionsQuery(id, userId, tenantId), ct);
        return versions is null ? NotFound() : Ok(versions);
    }

    /// <summary>
    /// Restore a report to an earlier published version (admin only).
    ///
    /// Append-only: the earlier definition is replayed onto the live report and the restore is
    /// recorded as a NEW version, so the faulty version that prompted the rollback stays visible
    /// in the history.
    /// </summary>
    [HttpPost("{id:long}/restore/{versionNo:int}")]
    [ProducesResponseType(typeof(RestoreReportVersionResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> RestoreVersion(long id, int versionNo, CancellationToken ct)
    {
        if (!TryGetUserIdFromJwt(out var userId)) return Unauthorized();
        if (!TryGetTenantIdFromJwt(out var tenantId)) return Unauthorized("TenantId not found in token.");

        try
        {
            var result = await sender.Send(
                new RestoreReportVersionCommand(id, versionNo, userId, IsAdminUser(), tenantId), ct);

            return result is null ? NotFound() : Ok(result);
        }
        catch (UnauthorizedAccessException ex) { return Forbid(ex.Message); }
        catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private bool TryGetUserIdFromJwt(out long userId)
    {
        userId = 0;
        var sub = User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value
               ?? User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        return sub is not null && long.TryParse(sub, out userId);
    }

    private bool IsAdminUser() => User.Claims
        .Where(c => c.Type == System.Security.Claims.ClaimTypes.Role || c.Type.Equals("role", StringComparison.OrdinalIgnoreCase) || c.Type.EndsWith("/role", StringComparison.OrdinalIgnoreCase))
        .Select(c => c.Value)
        .Any(IsAdminRole);

    private static bool IsAdminRole(string role) => role.Equals("admin", StringComparison.OrdinalIgnoreCase)
        || role.Equals("tenant_admin", StringComparison.OrdinalIgnoreCase)
        || role.Equals("tenantadmin", StringComparison.OrdinalIgnoreCase)
        || role.Equals("platform_admin", StringComparison.OrdinalIgnoreCase)
        || role.Equals("platformadmin", StringComparison.OrdinalIgnoreCase);

    private bool TryGetTenantIdFromJwt(out long tenantId)
    {
        tenantId = 0;
        var claim = User.FindFirst("tenantId")?.Value;
        return claim is not null && long.TryParse(claim, out tenantId) && tenantId > 0;
    }
}
