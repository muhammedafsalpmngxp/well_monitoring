using System.IdentityModel.Tokens.Jwt;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TWise.Tenant.Application.Features.Widgets;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.API.Controllers;

/// <summary>
/// Widget CRUD � handles both Charts and Tiles for a tenant.
/// Filter by ?type=chart or ?type=tile.
/// </summary>
[ApiController]
[Authorize]
[TypeFilter(typeof(TWise.Tenant.API.Auth.BiWritePermissionFilter))]
[Route("api/widgets")]
public class WidgetController(ISender sender) : ControllerBase
{
    /// <summary>List all widgets. Filter by ?status=draft|published and ?type=chart|tile</summary>
    [HttpGet]
    public async Task<IActionResult> GetAll([FromQuery] string? status, [FromQuery] string? type, CancellationToken ct)
    {
        if (!TryGetUserId(out var userId)) return Unauthorized();
        var isAdmin = User.IsInRole("admin");
        return Ok(await sender.Send(new ListWidgetsQuery(status, type, userId, isAdmin), ct));
    }

    /// <summary>Get a single widget by ID</summary>
    [HttpGet("{id:long}")]
    public async Task<IActionResult> GetById(long id, CancellationToken ct)
    {
        if (!TryGetUserId(out var userId)) return Unauthorized();
        var result = await sender.Send(new GetWidgetByIdQuery(id, userId), ct);
        return result is null ? NotFound() : Ok(result);
    }

    /// <summary>Create a chart or tile � userId and tenantId extracted from JWT</summary>
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateWidgetRequest request, CancellationToken ct)
    {
        if (!TryGetUserId(out var userId)) return Unauthorized();
        if (!TryGetTenantId(out var tenantId)) return Unauthorized("TenantId not found in token.");

        try
        {
            var created = await sender.Send(new CreateWidgetCommand(request, userId, tenantId), ct);
            return CreatedAtAction(nameof(GetById), new { id = created.Id }, created);
        }
        catch (InvalidOperationException ex)
        {
            return Conflict(new { error = ex.Message });
        }
    }

    [HttpPost("{id:long}/copy-to-draft")]
    public async Task<IActionResult> CopyToDraft(long id, CancellationToken ct)
    {
        if (!TryGetUserId(out var userId)) return Unauthorized();
        if (!TryGetTenantId(out var tenantId)) return Unauthorized("TenantId not found in token.");
        try
        {
            var result = await sender.Send(new CopyWidgetToDraftCommand(id, userId, User.IsInRole("admin"), tenantId), ct);
            return result is null ? NotFound() : Ok(result);
        }
        catch (UnauthorizedAccessException ex) { return Forbid(ex.Message); }
    }

    /// <summary>Update a widget — only creator can edit; only admin can publish</summary>
    [HttpPut("{id:long}")]
    public async Task<IActionResult> Update(long id, [FromBody] UpdateWidgetRequest request, CancellationToken ct)
    {
        if (!TryGetUserId(out var userId)) return Unauthorized();
        var isAdmin = User.IsInRole("admin");
        try
        {
            var result = await sender.Send(new UpdateWidgetCommand(id, request, userId, isAdmin), ct);
            return result is null ? NotFound() : Ok(result);
        }
        catch (InvalidOperationException ex)
        {
            return Conflict(new { error = ex.Message });
        }
    }

    /// <summary>Soft-delete a widget � only the creator can delete</summary>
    [HttpDelete("{id:long}")]
    public async Task<IActionResult> Delete(long id, CancellationToken ct)
    {
        if (!TryGetUserId(out var userId)) return Unauthorized();
        return await sender.Send(new DeleteWidgetCommand(id, userId), ct) ? NoContent() : NotFound();
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
