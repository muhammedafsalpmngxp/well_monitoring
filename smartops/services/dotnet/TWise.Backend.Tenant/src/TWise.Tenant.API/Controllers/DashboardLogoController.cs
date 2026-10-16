using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Features.Dashboards;

namespace TWise.Tenant.API.Controllers;

[ApiController]
[Authorize]
[Route("api/dashboard/logos")]
public sealed class DashboardLogoController(IDashboardLogoStorage storage, IDashboardRepository dashboards) : ControllerBase
{
    [HttpPost]
    [Consumes("multipart/form-data")]
    [RequestSizeLimit(2 * 1024 * 1024 + 16384)]
    public async Task<IActionResult> Upload([FromForm] IFormFile file, CancellationToken ct)
    {
        if (!TryGetTenantId(out var tenantId)) return Unauthorized();
        if (file is null || file.Length == 0) return BadRequest(new { message = "Choose a logo image." });
        try
        {
            await using var stream = file.OpenReadStream();
            return Ok(await storage.SaveAsync(tenantId, file.FileName, stream, ct));
        }
        catch (InvalidOperationException exception)
        {
            return BadRequest(new { message = exception.Message });
        }
    }

    [HttpGet("{assetId}")]
    public async Task<IActionResult> Get(string assetId, CancellationToken ct)
    {
        if (!TryGetTenantId(out var tenantId)) return Unauthorized();
        return ImageResult(await storage.ReadAsync(assetId, tenantId, ct));
    }

    [AllowAnonymous]
    [HttpGet("public/{dashboardId:int}/{assetId}")]
    public async Task<IActionResult> GetShared(int dashboardId, string assetId, [FromQuery] string token, CancellationToken ct)
    {
        var dashboard = await dashboards.GetDashboardDetailByIdAsync(dashboardId, ct);
        if (dashboard is null || !DashboardShareLink.HasToken(dashboard.ConfigJson, token)) return NotFound();
        try
        {
            var branding = JsonNode.Parse(dashboard.ConfigJson!)?["branding"];
            if (branding?["leftLogo"]?["assetId"]?.GetValue<string>() != assetId
                && branding?["rightLogo"]?["assetId"]?.GetValue<string>() != assetId) return NotFound();
        }
        catch (System.Text.Json.JsonException) { return NotFound(); }
        catch (InvalidOperationException) { return NotFound(); }
        return ImageResult(await storage.ReadAsync(assetId, null, ct));
    }

    private IActionResult ImageResult(DashboardLogoContent? content)
    {
        if (content is null) return NotFound();
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        Response.Headers.CacheControl = "no-store";
        return File(content.Bytes, content.ContentType);
    }

    private bool TryGetTenantId(out long tenantId) => long.TryParse(User.FindFirst("tenantId")?.Value, out tenantId) && tenantId > 0;
}