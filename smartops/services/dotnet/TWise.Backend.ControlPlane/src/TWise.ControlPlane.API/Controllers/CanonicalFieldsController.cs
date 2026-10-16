using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.OutputCaching;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Application.Features.Sources;
using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.API.Controllers;

/// <summary>Step 12 — Fields within canonical entities (requires CanonicalEntities)</summary>
[ApiController]
[Authorize(Policy = "Admin")]
[Route("canonical-fields")]
[Tags("12. Canonical Fields")]
public sealed class CanonicalFieldsController(ISender sender) : ControllerBase
{
    /// <summary>List all canonical fields across entities</summary>
    [HttpGet]
    [OutputCache(PolicyName = "ControlPlaneList")]
    [ProducesResponseType(typeof(PagedResult<CanonicalFieldDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> List([FromQuery] int page = 1, [FromQuery] int pageSize = 200, CancellationToken ct = default)
    {
        var result = await sender.Send(new ListCanonicalFieldsQuery(page, pageSize), ct);
        return result.IsSuccess ? Ok(result.Value) : StatusCode(500);
    }

    /// <summary>Get a canonical field by ID</summary>
    [HttpGet("{id:int}")]
    [ProducesResponseType(typeof(CanonicalFieldDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Get(int id, CancellationToken ct)
    {
        var result = await sender.Send(new GetCanonicalFieldQuery(id), ct);
        return result.IsSuccess ? Ok(result.Value) : NotFound(new { message = result.ErrorMessage });
    }

    /// <summary>Add a field to a canonical entity (name, type, constraints)</summary>
    [HttpPost]
    [ProducesResponseType(typeof(CanonicalFieldDto), StatusCodes.Status201Created)]
    public async Task<IActionResult> Create([FromBody] CanonicalFieldCreateRequest request, CancellationToken ct)
    {
        var result = await sender.Send(new CreateCanonicalFieldCommand(request), ct);
        return result.IsSuccess ? Created(string.Empty, result.Value) : StatusCode(500);
    }

    /// <summary>Bulk-create canonical fields (max 100 items per batch)</summary>
    [HttpPost("bulk")]
    [ProducesResponseType(typeof(IReadOnlyList<CanonicalFieldDto>), StatusCodes.Status201Created)]
    public async Task<IActionResult> BulkCreate([FromBody] BulkCanonicalFieldCreateRequest request, CancellationToken ct)
    {
        var result = await sender.Send(new BulkCreateCanonicalFieldsCommand(request), ct);
        return result.IsSuccess ? Created(string.Empty, result.Value) : StatusCode(500);
    }

    /// <summary>Update field definition (type, nullable, default)</summary>
    [HttpPut("{id:int}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Update(int id, [FromBody] CanonicalFieldUpdateRequest request, CancellationToken ct)
    {
        var result = await sender.Send(new UpdateCanonicalFieldCommand(id, request), ct);
        return result.IsSuccess ? NoContent() : NotFound(new { message = result.ErrorMessage });
    }

    /// <summary>Bulk-update canonical fields (max 100 items per batch)</summary>
    [HttpPut("bulk")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> BulkUpdate([FromBody] BulkCanonicalFieldUpdateRequest request, CancellationToken ct)
    {
        var result = await sender.Send(new BulkUpdateCanonicalFieldsCommand(request), ct);
        return result.IsSuccess ? NoContent() : NotFound(new { message = result.ErrorMessage });
    }

    /// <summary>Delete a canonical field</summary>
    [HttpDelete("{id:int}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Delete(int id, CancellationToken ct)
    {
        var result = await sender.Send(new DeleteCanonicalFieldCommand(id), ct);
        return result.IsSuccess ? NoContent() : NotFound(new { message = result.ErrorMessage });
    }
}
