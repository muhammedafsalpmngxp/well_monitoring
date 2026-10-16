using System.IdentityModel.Tokens.Jwt;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TWise.Tenant.API.Auth;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Application.Features.PowerBi;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.API.Controllers;

/// <summary>
/// Power BI embedding ("embed for your customers"). The tenant configures a service principal
/// once; the app then lists the workspace's reports and embeds them with short-lived, view-only
/// embed tokens. The Azure AD token and client secret never reach the browser.
/// </summary>
[ApiController]
[Authorize]
[Route("api/powerbi")]
public sealed class PowerBiController(ISender sender) : ControllerBase
{
    private const string TenantIdMissing = "TenantId not found in token.";

    /// <summary>The tenant's connection, without the secret. 204 when not configured.</summary>
    [HttpGet("settings")]
    [ProducesResponseType(typeof(PowerBiSettingsDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Settings(CancellationToken ct)
    {
        if (!TryGetTenantId(out var tenantId)) return Unauthorized(TenantIdMissing);
        var settings = await sender.Send(new GetPowerBiSettingsQuery(tenantId), ct);
        return settings is null ? NoContent() : Ok(settings);
    }

    /// <summary>Saves the connection after verifying the credentials with Azure AD.</summary>
    [HttpPut("settings")]
    [RequireModulePermission("settings.power-bi", 'c', 'm')]
    [ProducesResponseType(typeof(PowerBiSettingsDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> SaveSettings([FromBody] SavePowerBiSettingsRequest request, CancellationToken ct)
    {
        if (!TryGetUserId(out var userId)) return Unauthorized();
        if (!TryGetTenantId(out var tenantId)) return Unauthorized(TenantIdMissing);
        try
        {
            var existing = await sender.Send(new GetPowerBiSettingsQuery(tenantId), ct);
            if (!ModulePermission.Has(User, "settings.power-bi", existing is null ? ModulePermission.Create : ModulePermission.Modify))
                return Forbid();
            return Ok(await sender.Send(new SavePowerBiSettingsCommand(request, tenantId, userId), ct));
        }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    /// <summary>Reports in the configured workspace.</summary>
    [HttpGet("reports")]
    [ProducesResponseType(typeof(IReadOnlyList<PowerBiReportDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> Reports(CancellationToken ct)
    {
        if (!TryGetTenantId(out var tenantId)) return Unauthorized(TenantIdMissing);
        try { return Ok(await sender.Send(new ListPowerBiReportsQuery(tenantId), ct)); }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    /// <summary>Embed URL and a fresh view-only embed token for one report. Call again before expiry.</summary>
    [HttpPost("reports/{reportId}/embed-token")]
    [ProducesResponseType(typeof(PowerBiEmbedConfigDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> EmbedToken(string reportId, CancellationToken ct)
    {
        if (!TryGetTenantId(out var tenantId)) return Unauthorized(TenantIdMissing);
        try { return Ok(await sender.Send(new GetPowerBiEmbedConfigQuery(reportId, tenantId), ct)); }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    private bool TryGetTenantId(out long tenantId)
    {
        tenantId = 0;
        var claim = User.FindFirst("tenantId")?.Value;
        return claim is not null && long.TryParse(claim, out tenantId) && tenantId > 0;
    }

    private bool TryGetUserId(out long userId)
    {
        userId = 0;
        var sub = User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value
               ?? User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        return sub is not null && long.TryParse(sub, out userId);
    }
}
