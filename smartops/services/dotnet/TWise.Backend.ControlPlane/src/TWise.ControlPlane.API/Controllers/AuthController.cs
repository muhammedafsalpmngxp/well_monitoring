using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TWise.Backend.ControlPlane.Application.Features.Auth;
using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.API.Controllers;

/// <summary>Authentication — login and obtain a JWT token</summary>
[ApiController]
[Route("auth")]
[Tags("00. Auth")]
public sealed class AuthController(ISender sender) : ControllerBase
{
    /// <summary>
    /// Login with email and password. Returns a JWT token containing
    /// userId (sub), email, role, tenantId. Use the token as a Bearer header
    /// on all subsequent requests.
    /// </summary>
    [HttpPost("login")]
    // Only login gets the tight per-IP limit; /session is called on every page and stays under the global limit.
    [Microsoft.AspNetCore.RateLimiting.EnableRateLimiting("auth")]
    [AllowAnonymous]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> Login([FromBody] LoginRequest request, CancellationToken ct)
    {
        var result = await sender.Send(new LoginCommand(request), ct);
        return result.IsSuccess
            ? Ok(result.Value)
            : Unauthorized(new { message = result.ErrorMessage });
    }

    /// <summary>
    /// Exchange a valid refresh token for a new access + refresh token pair.
    /// </summary>
    [HttpPost("refresh-token")]
    [AllowAnonymous]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> Refresh([FromBody] RefreshRequest request, CancellationToken ct)
    {
        var result = await sender.Send(new RefreshCommand(request.RefreshToken), ct);
        return result.IsSuccess
            ? Ok(result.Value)
            : Unauthorized(new { message = result.ErrorMessage });
    }

    /// <summary>Revokes the current login session using its refresh token, even if the access token has expired.</summary>
    [HttpPost("logout")]
    [AllowAnonymous]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> Logout([FromBody] LogoutRequest request, CancellationToken ct)
    {
        var result = await sender.Send(new LogoutCommand(request.RefreshToken), ct);
        return result.IsSuccess
            ? NoContent()
            : Unauthorized(new ProblemDetails { Status = StatusCodes.Status401Unauthorized, Title = "Invalid or expired session." });
    }

    // The Tenant API checks every request's session here, all from its own address, so a per-IP
    // limit would throttle every user at once. Only a valid token gets an answer.
    [Authorize]
    [Microsoft.AspNetCore.RateLimiting.DisableRateLimiting]
    [HttpGet("session")]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    public IActionResult Session() => NoContent();
}
