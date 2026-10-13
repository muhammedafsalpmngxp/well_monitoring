using System.IdentityModel.Tokens.Jwt;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TWise.Tenant.Application.Features.DaxModels;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.API.Controllers;

/// <summary>
/// Saved DAX models listed on Settings → Dax Model, stored in core.DaxModels. Each user sees and edits
/// only the models they created; admins see and edit every user's models.
/// </summary>
[ApiController]
[Authorize]
[Route("api/dax-models")]
public sealed class DaxModelsController(ISender sender) : ControllerBase
{
    /// <summary>
    /// A page of models, newest first. Filters by name (search), status (Active | Draft) and
    /// created in the last N days (sinceDays). The totals cover every model, unfiltered.
    /// </summary>
    [HttpGet]
    [ProducesResponseType(typeof(DaxModelPageDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> List(
        [FromQuery] string? search, [FromQuery] string? status, [FromQuery] int? sinceDays,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 20, CancellationToken ct = default)
    {
        if (!TryGetUserId(out var userId) || !TryGetTenantId(out var tenantId)) return Unauthorized();
        return Ok(await sender.Send(new ListDaxModelsQuery(search, status, sinceDays, userId, IsAdmin, tenantId, page, pageSize), ct));
    }

    /// <summary>Saves a new model (Settings → Dax Model → Create DAX Model).</summary>
    [HttpPost]
    [ProducesResponseType(typeof(DaxModelDto), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> Create([FromBody] DaxModelSaveRequest request, CancellationToken ct)
    {
        if (!TryGetUserId(out var userId)) return Unauthorized();
        var created = await sender.Send(new CreateDaxModelCommand(request, userId), ct);
        return CreatedAtAction(nameof(List), new { id = created.Id }, created);
    }

    /// <summary>Replaces an existing model's definition (Settings → Dax Model → Edit).</summary>
    [HttpPut("{id:long}")]
    [ProducesResponseType(typeof(DaxModelDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Update(long id, [FromBody] DaxModelSaveRequest request, CancellationToken ct)
    {
        if (!TryGetUserId(out var userId)) return Unauthorized();
        var updated = await sender.Send(new UpdateDaxModelCommand(id, request, userId, IsAdmin), ct);
        return updated is null ? NotFound() : Ok(updated);
    }

    /// <summary>Deletes a model (Settings → Dax Model → Delete). A model still used in a saved chart is kept (409).</summary>
    [HttpDelete("{id:long}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<IActionResult> Delete(long id, CancellationToken ct)
    {
        if (!TryGetUserId(out var userId)) return Unauthorized();
        var result = await sender.Send(new DeleteDaxModelCommand(id, userId, IsAdmin), ct);
        return result.Status switch
        {
            DeleteDaxModelStatus.NotFound => NotFound(),
            DeleteDaxModelStatus.InUse => Conflict(new { message = InUseMessage(result.Name!, result.UsedInCharts!) }),
            _ => NoContent(),
        };
    }

    /// <summary>e.g. "test222" is used in the chart "Wells by Plant" and can't be deleted. Remove it from that chart first.</summary>
    private static string InUseMessage(string model, IReadOnlyList<string> charts)
    {
        var names = string.Join(", ", charts.Select(c => $"\"{c}\""));
        return charts.Count == 1
            ? $"\"{model}\" is used in the chart {names} and can't be deleted. Remove it from that chart first."
            : $"\"{model}\" is used in {charts.Count} charts ({names}) and can't be deleted. Remove it from those charts first.";
    }

    private bool IsAdmin => User.IsInRole("admin");

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
