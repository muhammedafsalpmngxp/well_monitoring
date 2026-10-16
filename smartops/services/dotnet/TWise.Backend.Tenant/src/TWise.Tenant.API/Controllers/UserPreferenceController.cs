using System.IdentityModel.Tokens.Jwt;
using Microsoft.AspNetCore.Mvc;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.API.Controllers;

/// <summary>
/// Manages per-user favourites and recently-viewed records.
/// ControlTypeId: 1=Dashboard  2=Chart  3=Tile  4=Report
/// </summary>
[ApiController]
[Route("api/preferences")]
public class UserPreferenceController(IUserPreferenceService svc) : ControllerBase
{
    // ─── Favourites ────────────────────────────────────────────────────────────

    /// <summary>Toggle favourite for a control. Returns the updated preference row.</summary>
    [HttpPost("favourite")]
    public async Task<IActionResult> ToggleFavourite([FromBody] ToggleFavouriteRequest req, CancellationToken ct)
    {
        if (!TryGetUserId(out var userId)) return Unauthorized();
        var result = await svc.ToggleFavouriteAsync(userId, req.ControlTypeId, req.ControlId, ct);
        return Ok(result);
    }

    /// <summary>Get all favourites for the current user. Optionally filter by controlTypeId.</summary>
    [HttpGet("favourites")]
    public async Task<IActionResult> GetFavourites([FromQuery] int? controlTypeId, CancellationToken ct)
    {
        if (!TryGetUserId(out var userId)) return Unauthorized();
        var result = await svc.GetFavouritesAsync(userId, controlTypeId, ct);
        return Ok(result);
    }

    // ─── Recently Viewed ───────────────────────────────────────────────────────

    /// <summary>Track a view (call when a user opens a chart/tile/dashboard/report).</summary>
    [HttpPost("view")]
    public async Task<IActionResult> TrackView([FromBody] TrackViewRequest req, CancellationToken ct)
    {
        if (!TryGetUserId(out var userId)) return Unauthorized();
        await svc.TrackViewAsync(userId, req.ControlTypeId, req.ControlId, ct);
        return NoContent();
    }

    /// <summary>Get recently viewed items. Optionally filter by controlTypeId. Default limit = 20.</summary>
    [HttpGet("recently-viewed")]
    public async Task<IActionResult> GetRecentlyViewed(
        [FromQuery] int? controlTypeId,
        [FromQuery] int  limit = 20,
        CancellationToken ct = default)
    {
        if (!TryGetUserId(out var userId)) return Unauthorized();
        var result = await svc.GetRecentlyViewedAsync(userId, controlTypeId, limit, ct);
        return Ok(result);
    }

    // ─── Helper ────────────────────────────────────────────────────────────────

    private bool TryGetUserId(out long userId)
    {
        userId = 0;
        var sub = User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value
               ?? User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        return sub is not null && long.TryParse(sub, out userId);
    }
}
