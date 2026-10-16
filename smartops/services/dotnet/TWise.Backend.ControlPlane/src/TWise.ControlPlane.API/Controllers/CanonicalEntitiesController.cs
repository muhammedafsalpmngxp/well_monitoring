using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.OutputCaching;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Application.Features.Sources;
using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.API.Controllers;

/// <summary>Step 11 — Canonical data entities (Well, Crew, Task, Equipment…)</summary>
[ApiController]
[Authorize(Policy = "Admin")]
[Route("canonical-entities")]
[Tags("11. Canonical Entities")]
public sealed class CanonicalEntitiesController(ISender sender) : ControllerBase
{
    /// <summary>List all canonical data entities</summary>
    [HttpGet]
    [OutputCache(PolicyName = "ControlPlaneList")]
    [ProducesResponseType(typeof(PagedResult<CanonicalEntityDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> List([FromQuery] int page = 1, [FromQuery] int pageSize = 200, CancellationToken ct = default)
    {
        var result = await sender.Send(new ListCanonicalEntitiesQuery(page, pageSize), ct);
        return result.IsSuccess ? Ok(result.Value) : StatusCode(500);
    }

    /// <summary>Get a canonical entity by ID</summary>
    [HttpGet("{id:int}")]
    [ProducesResponseType(typeof(CanonicalEntityDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Get(int id, CancellationToken ct)
    {
        var result = await sender.Send(new GetCanonicalEntityQuery(id), ct);
        return result.IsSuccess ? Ok(result.Value) : NotFound(new { message = result.ErrorMessage });
    }

    /// <summary>Define a new canonical entity (Well, Crew, Task, Equipment…)</summary>
    [HttpPost]
    [ProducesResponseType(typeof(CanonicalEntityDto), StatusCodes.Status201Created)]
    public async Task<IActionResult> Create([FromBody] CanonicalEntityCreateRequest request, CancellationToken ct)
    {
        var result = await sender.Send(new CreateCanonicalEntityCommand(request), ct);
        return result.IsSuccess ? Created(string.Empty, result.Value) : StatusCode(500);
    }

    /// <summary>Bulk-create canonical entities (max 100 items per batch)</summary>
    [HttpPost("bulk")]
    [ProducesResponseType(typeof(IReadOnlyList<CanonicalEntityDto>), StatusCodes.Status201Created)]
    public async Task<IActionResult> BulkCreate([FromBody] BulkCanonicalEntityCreateRequest request, CancellationToken ct)
    {
        var result = await sender.Send(new BulkCreateCanonicalEntitiesCommand(request), ct);
        return result.IsSuccess ? Created(string.Empty, result.Value) : StatusCode(500);
    }

    /// <summary>Update canonical entity name or description</summary>
    [HttpPut("{id:int}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Update(int id, [FromBody] CanonicalEntityUpdateRequest request, CancellationToken ct)
    {
        var result = await sender.Send(new UpdateCanonicalEntityCommand(id, request), ct);
        return result.IsSuccess ? NoContent() : NotFound(new { message = result.ErrorMessage });
    }

    /// <summary>Bulk-update canonical entities (max 100 items per batch)</summary>
    [HttpPut("bulk")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> BulkUpdate([FromBody] BulkCanonicalEntityUpdateRequest request, CancellationToken ct)
    {
        var result = await sender.Send(new BulkUpdateCanonicalEntitiesCommand(request), ct);
        return result.IsSuccess ? NoContent() : NotFound(new { message = result.ErrorMessage });
    }

    /// <summary>Delete a canonical entity (cascades to fields and mappings)</summary>
    [HttpDelete("{id:int}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Delete(int id, CancellationToken ct)
    {
        var result = await sender.Send(new DeleteCanonicalEntityCommand(id), ct);
        return result.IsSuccess ? NoContent() : NotFound(new { message = result.ErrorMessage });
    }
}
