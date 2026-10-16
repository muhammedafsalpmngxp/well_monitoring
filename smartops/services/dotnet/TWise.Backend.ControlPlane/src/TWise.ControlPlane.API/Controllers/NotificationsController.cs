using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TWise.Backend.ControlPlane.Application.Features.Notifications;

namespace TWise.Backend.ControlPlane.API.Controllers;

/// <summary>
/// Navbar-bell poll for this service — reads real persisted read/unread state from
/// control.Notification/NotificationRecipient. Deliberately NOT under the Admin-only
/// AppUsersController — callable by any authenticated user checking their own notifications.
/// </summary>
[ApiController]
[Authorize]
[Route("notifications")]
[Tags("06. Users")]
public sealed class NotificationsController(ISender sender) : ControllerBase
{
    private long CallerTenantId
    {
        get
        {
            var claim = User.FindFirst("tenantId")?.Value;
            return long.TryParse(claim, out var tid) ? tid : -1;
        }
    }

    private long? CallerUserId
    {
        get
        {
            var claim = User.FindFirst(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub)?.Value
                     ?? User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
            return long.TryParse(claim, out var uid) ? uid : null;
        }
    }

    [HttpGet]
    public async Task<IActionResult> Get([FromQuery] DateTime? since, CancellationToken ct)
    {
        if (CallerUserId is null) return Unauthorized();
        var result = await sender.Send(
            new GetNotificationsQuery(CallerUserId.Value, CallerTenantId, since ?? DateTime.UtcNow.AddDays(-30)), ct);
        return result.IsSuccess ? Ok(result.Value) : StatusCode(500);
    }

    [HttpPost("{id:long}/read")]
    public async Task<IActionResult> MarkAsRead(long id, CancellationToken ct)
    {
        if (CallerUserId is null) return Unauthorized();
        var result = await sender.Send(new MarkNotificationAsReadCommand(CallerTenantId, CallerUserId.Value, id), ct);
        if (!result.IsSuccess) return StatusCode(500);
        return result.Value ? Ok() : NotFound();
    }

    [HttpPost("read-all")]
    public async Task<IActionResult> MarkAllAsRead(CancellationToken ct)
    {
        if (CallerUserId is null) return Unauthorized();
        var result = await sender.Send(new MarkAllNotificationsAsReadCommand(CallerTenantId, CallerUserId.Value), ct);
        return result.IsSuccess ? Ok() : StatusCode(500);
    }
}
