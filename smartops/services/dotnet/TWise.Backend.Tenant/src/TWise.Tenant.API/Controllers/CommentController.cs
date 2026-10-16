using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TWise.Tenant.API.Auth;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.API.Controllers;

/// <summary>
/// Threaded comments (1-level replies) with @mentions, attached to a dashboard/report/widget.
/// </summary>
[ApiController]
[Route("api/comments")]
[Authorize]
[TypeFilter(typeof(DashboardCommentPermissionFilter))]
public class CommentController(ICommentService svc, ICurrentUserService currentUser) : ControllerBase
{
    /// <summary>Get the comment thread for a target. e.g. GET /api/comments?targetType=Dashboard&amp;targetId=2072</summary>
    [HttpGet]
    public async Task<IActionResult> GetThread([FromQuery] string targetType, [FromQuery] int targetId, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(targetType)) return BadRequest("targetType is required.");
        var result = await svc.GetThreadAsync(targetType, targetId, ct);
        return Ok(result);
    }

    /// <summary>Post a new comment, or a reply when ParentCommentId is set.</summary>
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateCommentRequest request, CancellationToken ct)
    {
        if (!TryGetUserId(out var userId)) return Unauthorized();
        if (!TryGetTenantId(out var tenantId)) return Unauthorized("TenantId not found in token.");
        if (string.IsNullOrWhiteSpace(request.Body)) return BadRequest("Comment text is required.");
        if (string.IsNullOrWhiteSpace(request.TargetType)) return BadRequest("targetType is required.");

        var displayName = User.FindFirst("name")?.Value ?? "Unknown";
        var result = await svc.CreateAsync(tenantId, userId, displayName, request, ct);
        return StatusCode(StatusCodes.Status201Created, result);
    }

    /// <summary>Soft-delete a comment/reply (author or admin only).</summary>
    [HttpDelete("{commentId}")]
    public async Task<IActionResult> Delete(long commentId, CancellationToken ct)
    {
        if (!TryGetUserId(out var userId)) return Unauthorized();
        var isAdmin = currentUser.Roles.Any(r => r.Equals("admin", StringComparison.OrdinalIgnoreCase));

        var deleted = await svc.DeleteAsync(commentId, userId, isAdmin, ct);
        return deleted ? NoContent() : NotFound();
    }

    private bool TryGetUserId(out long userId)
    {
        userId = 0;
        var sub = User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value
               ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        return sub is not null && long.TryParse(sub, out userId);
    }

    private bool TryGetTenantId(out long tenantId)
    {
        tenantId = 0;
        var claim = User.FindFirst("tenantId")?.Value;
        return claim is not null && long.TryParse(claim, out tenantId) && tenantId > 0;
    }
}
