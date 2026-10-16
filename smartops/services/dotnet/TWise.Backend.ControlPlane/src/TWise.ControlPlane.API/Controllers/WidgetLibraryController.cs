using System.IdentityModel.Tokens.Jwt;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TWise.Backend.ControlPlane.Application.Features.WidgetLibrary;
using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.API.Controllers;

/// <summary>Widget Library — master chart/tile templates shared across tenants.</summary>
[ApiController]
[Authorize(Policy = "Admin")]
[Route("widget-library")]
[Tags("Widget Library")]
public sealed class WidgetLibraryController(ISender sender) : ControllerBase
{
    /// <summary>List all widget library entries. Filter by ?type=chart or ?type=tile</summary>
    [HttpGet]
    public async Task<IActionResult> List([FromQuery] string? type, CancellationToken ct)
        => Ok(await sender.Send(new ListWidgetLibrariesQuery(type), ct));

    /// <summary>Get a single widget library entry by ID</summary>
    [HttpGet("{id:int}")]
    public async Task<IActionResult> Get(int id, CancellationToken ct)
    {
        var result = await sender.Send(new GetWidgetLibraryQuery(id), ct);
        return result is null ? NotFound() : Ok(result);
    }

    /// <summary>Create a new widget library entry</summary>
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateWidgetLibraryRequest request, CancellationToken ct)
    {
        if (!TryGetUserId(out var userId)) return Unauthorized();
        var created = await sender.Send(new CreateWidgetLibraryCommand(request, userId), ct);
        return CreatedAtAction(nameof(Get), new { id = created.Id }, created);
    }

    /// <summary>Update a widget library entry</summary>
    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, [FromBody] UpdateWidgetLibraryRequest request, CancellationToken ct)
    {
        if (!TryGetUserId(out var userId)) return Unauthorized();
        return await sender.Send(new UpdateWidgetLibraryCommand(id, request, userId), ct) ? NoContent() : NotFound();
    }

    /// <summary>Soft-delete a widget library entry</summary>
    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id, CancellationToken ct)
        => await sender.Send(new DeleteWidgetLibraryCommand(id), ct) ? NoContent() : NotFound();

    private bool TryGetUserId(out long userId)
    {
        userId = 0;
        var sub = User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value
               ?? User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        return sub is not null && long.TryParse(sub, out userId);
    }
}
