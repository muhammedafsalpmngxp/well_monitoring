using System.IdentityModel.Tokens.Jwt;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.API.Controllers;

/// <summary>
/// Per-user saved filter presets (Country/Sector/.../QuickRange/Date range) for a dashboard.
/// </summary>
[ApiController]
[Authorize]
[Route("api/dashboards/{dashboardId:int}/saved-filters")]
public class DashboardSavedFilterController(IDashboardSavedFilterService service) : ControllerBase
{
    /// <summary>List all saved filter presets for the current user on this dashboard.</summary>
    [HttpGet]
    public async Task<IActionResult> GetAll(int dashboardId, CancellationToken ct)
    {
        if (!TryGetUserId(out var userId)) return Unauthorized();
        if (!TryGetTenantId(out var tenantId)) return Unauthorized("TenantId not found in token.");
        var filters = await service.GetAllAsync(dashboardId, userId, tenantId, ct);
        return Ok(ApiEnvelope<IReadOnlyList<DashboardSavedFilterDto>>.Ok(filters));
    }

    /// <summary>Save a filter preset (same FilterName overwrites, otherwise creates a new preset),
    /// or apply an existing one when Id is supplied (no criteria changes).</summary>
    [HttpPost]
    public async Task<IActionResult> Save(int dashboardId, [FromBody] SaveDashboardSavedFilterRequest request, CancellationToken ct)
    {
        if (!TryGetUserId(out var userId)) return Unauthorized();
        if (!TryGetTenantId(out var tenantId)) return Unauthorized("TenantId not found in token.");

        if (request.Id is long id)
        {
            var applied = await service.ApplyAsync(id, userId, tenantId, ct);
            return applied is null
                ? NotFound(ApiEnvelope<DashboardSavedFilterDto>.Fail("Saved filter not found.", 404))
                : Ok(ApiEnvelope<DashboardSavedFilterDto>.Ok(applied));
        }

        if (string.IsNullOrWhiteSpace(request.FilterName))
            return BadRequest(ApiEnvelope<DashboardSavedFilterDto>.Fail("FilterName is required.", 400));
        var saved = await service.SaveAsync(dashboardId, userId, tenantId, request, ct);
        return Ok(ApiEnvelope<DashboardSavedFilterDto>.Ok(saved));
    }

    /// <summary>Rename an existing saved filter preset.</summary>
    [HttpPatch("{id:long}")]
    public async Task<IActionResult> Rename(int dashboardId, long id, [FromBody] RenameDashboardSavedFilterRequest request, CancellationToken ct)
    {
        if (!TryGetUserId(out var userId)) return Unauthorized();
        if (!TryGetTenantId(out var tenantId)) return Unauthorized("TenantId not found in token.");
        try
        {
            var renamed = await service.RenameAsync(id, userId, tenantId, request, ct);
            return renamed is null
                ? NotFound(ApiEnvelope<DashboardSavedFilterDto>.Fail("Saved filter not found.", 404))
                : Ok(ApiEnvelope<DashboardSavedFilterDto>.Ok(renamed));
        }
        catch (InvalidOperationException ex)
        {
            return Conflict(ApiEnvelope<DashboardSavedFilterDto>.Fail(ex.Message, 409));
        }
    }

    /// <summary>Delete a saved filter preset.</summary>
    [HttpDelete("{id:long}")]
    public async Task<IActionResult> Delete(int dashboardId, long id, CancellationToken ct)
    {
        if (!TryGetUserId(out var userId)) return Unauthorized();
        if (!TryGetTenantId(out var tenantId)) return Unauthorized("TenantId not found in token.");
        var deleted = await service.DeleteAsync(id, userId, tenantId, ct);
        return deleted
            ? Ok(ApiEnvelope<object>.Ok(new { }, "Deleted"))
            : NotFound(ApiEnvelope<object>.Fail("Saved filter not found.", 404));
    }

    /// <summary>Mark or unmark a saved filter preset as a favorite (favorites sort to the top of the list).</summary>
    [HttpPatch("{id:long}/favorite")]
    public async Task<IActionResult> SetFavorite(int dashboardId, long id, [FromBody] SetFavoriteDashboardSavedFilterRequest request, CancellationToken ct)
    {
        if (!TryGetUserId(out var userId)) return Unauthorized();
        if (!TryGetTenantId(out var tenantId)) return Unauthorized("TenantId not found in token.");
        var updated = await service.SetFavoriteAsync(id, userId, tenantId, request, ct);
        return updated is null
            ? NotFound(ApiEnvelope<DashboardSavedFilterDto>.Fail("Saved filter not found.", 404))
            : Ok(ApiEnvelope<DashboardSavedFilterDto>.Ok(updated));
    }

    /// <summary>Gets the dashboard's shared default filter (same for every user) set from Build/Edit Dashboard, if any.</summary>
    [HttpGet("default")]
    public async Task<IActionResult> GetDefault(int dashboardId, CancellationToken ct)
    {
        if (!TryGetTenantId(out var tenantId)) return Unauthorized("TenantId not found in token.");
        var found = await service.GetDefaultAsync(dashboardId, tenantId, ct);
        return Ok(ApiEnvelope<DashboardSavedFilterDto?>.Ok(found));
    }

    /// <summary>Saves the dashboard's shared default filter (same for every user) — called when the dashboard is saved.</summary>
    [HttpPost("default")]
    public async Task<IActionResult> SaveDefault(int dashboardId, [FromBody] SaveDashboardSavedFilterRequest request, CancellationToken ct)
    {
        if (!TryGetTenantId(out var tenantId)) return Unauthorized("TenantId not found in token.");
        var saved = await service.SaveDefaultAsync(dashboardId, tenantId, request, ct);
        return Ok(ApiEnvelope<DashboardSavedFilterDto>.Ok(saved));
    }

    // -- Helpers ---------------------------------------------------------------

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
