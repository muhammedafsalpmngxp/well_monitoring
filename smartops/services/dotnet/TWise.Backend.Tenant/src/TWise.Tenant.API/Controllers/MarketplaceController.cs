using System.IdentityModel.Tokens.Jwt;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TWise.Tenant.API.Auth;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Application.Features.Marketplace;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.API.Controllers;

/// <summary>
/// Chart visual marketplace: browse a catalog of visuals and install them into this tenant.
///
/// An installed visual is stored as data and registered at runtime, so a tenant gains a new chart
/// shape without a code change or deployment. Catalogs are resolved from server configuration by
/// id — a caller cannot supply a URL.
/// </summary>
[ApiController]
[Authorize]
[Route("api/marketplace")]
public sealed class MarketplaceController(ISender sender) : ControllerBase
{
    private const string TenantIdMissing = "TenantId not found in token.";

    /// <summary>Catalogs this tenant has registered. Auth values are never returned.</summary>
    [HttpGet("catalogs")]
    [ProducesResponseType(typeof(IReadOnlyList<MarketplaceCatalogDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> Catalogs(CancellationToken ct)
    {
        if (!TryGetTenantId(out var tenantId)) return Unauthorized(TenantIdMissing);
        return Ok(await sender.Send(new ListCatalogsQuery(tenantId), ct));
    }

    /// <summary>Registers a catalog by URL. HTTPS only; private and loopback hosts are rejected.</summary>
    [HttpPost("catalogs")]
    [RequireModulePermission("settings.marketplace", 'c')]
    [ProducesResponseType(typeof(MarketplaceCatalogDto), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> AddCatalog([FromBody] SaveCatalogRequest request, CancellationToken ct)
    {
        if (!TryGetUserId(out var userId)) return Unauthorized();
        if (!TryGetTenantId(out var tenantId)) return Unauthorized(TenantIdMissing);
        try
        {
            var created = await sender.Send(new AddCatalogCommand(request, tenantId, userId), ct);
            return Created($"api/marketplace/catalogs/{created.CatalogKey}/plugins", created);
        }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    /// <summary>Updates a registered catalog. Leave the auth value blank to keep the stored one.</summary>
    [HttpPut("catalogs/{catalogKey}")]
    [RequireModulePermission("settings.marketplace", 'm')]
    [ProducesResponseType(typeof(MarketplaceCatalogDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> UpdateCatalog(string catalogKey, [FromBody] SaveCatalogRequest request, CancellationToken ct)
    {
        if (!TryGetTenantId(out var tenantId)) return Unauthorized(TenantIdMissing);
        try
        {
            var updated = await sender.Send(new UpdateCatalogCommand(catalogKey, request, tenantId), ct);
            return updated is null ? NotFound() : Ok(updated);
        }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    /// <summary>Removes a registered catalog. Visuals already installed from it stay installed.</summary>
    [HttpDelete("catalogs/{catalogKey}")]
    [RequireModulePermission("settings.marketplace", 'm')]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> RemoveCatalog(string catalogKey, CancellationToken ct)
    {
        if (!TryGetTenantId(out var tenantId)) return Unauthorized(TenantIdMissing);
        try { return await sender.Send(new RemoveCatalogCommand(catalogKey, tenantId), ct) ? NoContent() : NotFound(); }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    /// <summary>
    /// The built-in TWise Visuals catalog as a plugin array — the same shape a remote catalog URL
    /// returns, so another TWise instance can register this endpoint as a marketplace.
    /// </summary>
    [HttpGet("catalog")]
    [ProducesResponseType(typeof(IReadOnlyList<CatalogPluginDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> Catalog(CancellationToken ct)
        => Ok(await sender.Send(new GetBuiltInCatalogQuery(), ct));

    /// <summary>
    /// Catalogues a Power BI custom visual from its .pbiviz package: name, publisher, version, icon,
    /// data roles and formatting groups. The visual is listed under TWise Visuals for reference; it
    /// renders only inside an embedded Power BI report, so it cannot be installed.
    /// </summary>
    [HttpPost("catalog/pbiviz")]
    [RequireModulePermission("settings.marketplace", 'c')]
    [RequestSizeLimit(20 * 1024 * 1024)]
    [ProducesResponseType(typeof(CatalogPluginDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> ImportPowerBiVisual([FromForm] IFormFile file, CancellationToken ct)
    {
        if (!TryGetTenantId(out _)) return Unauthorized(TenantIdMissing);
        if (file is null || file.Length == 0) return BadRequest(new { message = "Choose a .pbiviz file." });
        if (!file.FileName.EndsWith(".pbiviz", StringComparison.OrdinalIgnoreCase))
            return BadRequest(new { message = "Only .pbiviz packages are accepted." });
        try
        {
            await using var stream = file.OpenReadStream();
            return Ok(await sender.Send(new ImportPowerBiVisualCommand(stream), ct));
        }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    /// <summary>Visuals installed in this tenant. The client registers these as renderers at startup.</summary>
    [HttpGet("installed")]
    [ProducesResponseType(typeof(IReadOnlyList<CustomVisualDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> Installed(CancellationToken ct)
    {
        if (!TryGetTenantId(out var tenantId)) return Unauthorized(TenantIdMissing);
        return Ok(await sender.Send(new ListInstalledVisualsQuery(tenantId), ct));
    }

    /// <summary>
    /// Catalog contents with this tenant's install state merged in, so the UI can show
    /// Install / Installed / Update without a second call.
    /// </summary>
    [HttpGet("catalogs/{catalogId}/plugins")]
    [ProducesResponseType(typeof(IReadOnlyList<MarketplaceListingDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> Browse(string catalogId, CancellationToken ct)
    {
        if (!TryGetTenantId(out var tenantId)) return Unauthorized(TenantIdMissing);

        try
        {
            return Ok(await sender.Send(new BrowseCatalogQuery(catalogId, tenantId), ct));
        }
        catch (InvalidOperationException ex)
        {
            // An unreachable or malformed catalog is the operator's problem, not a server fault.
            return BadRequest(new { message = ex.Message });
        }
        catch (HttpRequestException ex)
        {
            return BadRequest(new { message = $"The catalog could not be reached: {ex.Message}" });
        }
    }

    /// <summary>
    /// Installs a plugin, or updates it in place when it is already installed from this catalog.
    /// Rejected with 400 when the template fails validation or the visual key is already taken.
    /// </summary>
    [HttpPost("install")]
    [RequireModulePermission("settings.marketplace", 'c', 'm')]
    [ProducesResponseType(typeof(CustomVisualDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> Install([FromBody] InstallPluginRequest request, CancellationToken ct)
    {
        if (!TryGetUserId(out var userId)) return Unauthorized();
        if (!TryGetTenantId(out var tenantId)) return Unauthorized(TenantIdMissing);

        try
        {
            var listings = await sender.Send(new BrowseCatalogQuery(request.CatalogId, tenantId), ct);
            var installed = listings.Any(listing => listing.IsInstalled
                && string.Equals(listing.Plugin.Id, request.PluginId, StringComparison.OrdinalIgnoreCase));
            if (!ModulePermission.Has(User, "settings.marketplace", installed ? ModulePermission.Modify : ModulePermission.Create))
                return Forbid();
            return Ok(await sender.Send(new InstallPluginCommand(request, tenantId, userId), ct));
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (HttpRequestException ex)
        {
            return BadRequest(new { message = $"The catalog could not be reached: {ex.Message}" });
        }
    }

    /// <summary>
    /// Removes an installed plugin. Widgets already using it keep their saved definition but can
    /// no longer render, so callers should warn before calling this.
    /// </summary>
    [HttpDelete("catalogs/{catalogId}/plugins/{pluginId}")]
    [RequireModulePermission("settings.marketplace", 'm')]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Uninstall(string catalogId, string pluginId, CancellationToken ct)
    {
        if (!TryGetTenantId(out var tenantId)) return Unauthorized(TenantIdMissing);

        var removed = await sender.Send(new UninstallPluginCommand(catalogId, pluginId, tenantId), ct);
        return removed ? NoContent() : NotFound();
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
