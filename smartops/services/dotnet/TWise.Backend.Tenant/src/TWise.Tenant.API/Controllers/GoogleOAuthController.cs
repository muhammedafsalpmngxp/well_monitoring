using System.IdentityModel.Tokens.Jwt;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TWise.Tenant.API.Auth;
using TWise.Tenant.Application.Abstractions.DataSources;
using TWise.Tenant.Application.Features.DataSources;

namespace TWise.Tenant.API.Controllers;

/// <summary>
/// Google OAuth 2.0 consent flow for Google Sheets and Google Drive data sources.
///
/// Flow: the UI calls <c>start</c> for an existing data source and opens the returned URL.
/// The user consents in Google, Google redirects to <c>callback</c>, and the refresh token is
/// encrypted onto the connection. The callback is anonymous by necessity — a browser redirect
/// carries no JWT — so the identity travels in a signed state parameter instead.
/// </summary>
[ApiController]
[Route("api/oauth/google")]
public sealed class GoogleOAuthController(
    ISender sender,
    IGoogleOAuthService oauth,
    IConfiguration configuration,
    ILogger<GoogleOAuthController> logger) : ControllerBase
{
    private const string TenantIdMissing = "TenantId not found in token.";

    /// <summary>
    /// Begin the consent flow for a data source. Returns the Google URL for the UI to open —
    /// it does not redirect, so the caller can open it in a popup and keep the app state.
    /// </summary>
    [HttpGet("start")]
    [RequireModulePermission("settings.data-sources", 'm')]
    [Authorize]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> Start([FromQuery] long connectionId, [FromQuery] bool includeDrive, CancellationToken ct)
    {
        if (!TryGetUserId(out var userId)) return Unauthorized();
        if (!TryGetTenantId(out var tenantId)) return Unauthorized(TenantIdMissing);

        if (!oauth.IsConfigured)
            return BadRequest(new { error = "Google integration is not configured on this server." });

        // Confirm the connection exists and belongs to this tenant before sending the user to
        // Google, so a bad id fails here rather than after the consent screen.
        var connection = await sender.Send(new GetDataSourceQuery(connectionId, tenantId), ct);
        if (connection is null) return NotFound(new { error = "Data source not found." });

        var state = GoogleOAuthState.Create(connectionId, userId, tenantId, GetSigningKey());
        var url = oauth.BuildAuthorizationUrl(state, includeDrive);

        return Ok(new { authorizationUrl = url });
    }

    /// <summary>
    /// Google's redirect target. Verifies the signed state, exchanges the code for a refresh
    /// token, stores it, and redirects the browser back to the UI with a status flag.
    /// </summary>
    [HttpGet("callback")]
    [AllowAnonymous]
    [ProducesResponseType(StatusCodes.Status302Found)]
    public async Task<IActionResult> Callback(
        [FromQuery] string? code,
        [FromQuery] string? state,
        [FromQuery] string? error,
        CancellationToken ct)
    {
        if (!string.IsNullOrWhiteSpace(error))
        {
            logger.LogInformation("Google consent was not granted: {Error}", error);
            return RedirectToUi("error", error);
        }

        var payload = GoogleOAuthState.Verify(state, GetSigningKey());
        if (payload is null)
        {
            // Covers tampering, replay and an expired consent screen alike — all mean "start again".
            logger.LogWarning("Google OAuth callback rejected: state failed verification.");
            return RedirectToUi("error", "invalid_state");
        }

        if (string.IsNullOrWhiteSpace(code))
            return RedirectToUi("error", "missing_code");

        try
        {
            var token = await oauth.ExchangeCodeAsync(code, ct);

            if (string.IsNullOrWhiteSpace(token.RefreshToken))
            {
                logger.LogWarning(
                    "Google returned no refresh token for data source {ConnectionId}", payload.ConnectionId);
                return RedirectToUi("error", "no_refresh_token");
            }

            var saved = await sender.Send(
                new SaveGoogleTokenCommand(payload.ConnectionId, token.RefreshToken, payload.UserId, payload.TenantId), ct);

            if (!saved) return RedirectToUi("error", "connection_not_found");

            logger.LogInformation(
                "Google authorisation completed for data source {ConnectionId}, tenant {TenantId}",
                payload.ConnectionId, payload.TenantId);

            return RedirectToUi("success", null);
        }
        catch (InvalidOperationException ex)
        {
            logger.LogWarning(ex, "Google token exchange failed for data source {ConnectionId}", payload.ConnectionId);
            return RedirectToUi("error", "exchange_failed");
        }
    }

    /// <summary>
    /// Sends the browser back to the UI. The target is configured rather than derived from the
    /// request so the callback cannot be used as an open redirect.
    /// </summary>
    private IActionResult RedirectToUi(string status, string? reason)
    {
        var target = configuration["Google:PostAuthRedirectUri"];

        if (string.IsNullOrWhiteSpace(target))
        {
            // No UI target configured — show the outcome rather than redirecting nowhere.
            return Ok(new { status, reason });
        }

        var separator = target.Contains('?') ? '&' : '?';
        var url = $"{target}{separator}google={Uri.EscapeDataString(status)}";

        if (!string.IsNullOrWhiteSpace(reason))
            url += $"&reason={Uri.EscapeDataString(reason)}";

        return Redirect(url);
    }

    /// <summary>
    /// The state signature reuses the JWT secret — it is already required, already rotated with
    /// the deployment, and never leaves the server.
    /// </summary>
    private string GetSigningKey() =>
        configuration["JwtSettings:SecretKey"]
        ?? throw new InvalidOperationException("JwtSettings:SecretKey is not configured.");

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
