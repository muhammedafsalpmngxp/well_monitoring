using System.IdentityModel.Tokens.Jwt;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TWise.Tenant.Application.Features.ReportTemplates;
using TWise.Tenant.Domain;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.API.Controllers;

[ApiController]
[Authorize]
[Route("api/report-templates")]
public class ReportTemplatesController(ISender sender) : ControllerBase
{
    /// <summary>Get the current user's saved design template(s) matching the given filters, or an empty list if none exist yet.</summary>
    [HttpGet]
    public async Task<IActionResult> Get([FromQuery] string? sourceName, [FromQuery] string? sourceType, [FromQuery] string type, [FromQuery] string? customName, CancellationToken ct)
    {
        if (!TryGetUserIdFromJwt(out var userId)) return Unauthorized();
        var templates = await sender.Send(new GetReportTemplateQuery(sourceName, sourceType, userId, type, customName), ct);
        var message = templates.Count == 0 ? $"No saved template found for {type}." : "OK";
        return Ok(ApiEnvelope<List<ReportTemplateDto>>.Ok(templates, message));
    }

    /// <summary>Create or update (upsert) the current user's design template for a data source.</summary>
    [HttpPost]
    public async Task<IActionResult> Save([FromBody] SaveReportTemplateRequest request, CancellationToken ct)
    {
        if (!TryGetUserIdFromJwt(out var userId))
            return Unauthorized("Invalid or missing user identity in token.");

        if (!TryGetTenantIdFromJwt(out var tenantId))
            return Unauthorized("TenantId not found in token. Please login again.");

        var saved = await sender.Send(new SaveReportTemplateCommand(request, userId, tenantId), ct);
        return Ok(ApiEnvelope<ReportTemplateDto>.Ok(saved));
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private bool TryGetUserIdFromJwt(out long userId)
    {
        userId = 0;
        var sub = User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value
               ?? User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        return sub is not null && long.TryParse(sub, out userId);
    }

    private bool TryGetTenantIdFromJwt(out long tenantId)
    {
        tenantId = 0;
        var claim = User.FindFirst("tenantId")?.Value;
        return claim is not null && long.TryParse(claim, out tenantId) && tenantId > 0;
    }
}
