using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Application.Features.Sources;
using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.API.Controllers;

/// <summary>Step 13 — Map source fields → canonical fields (requires TenantSources + CanonicalFields)</summary>
[ApiController]
[Authorize(Policy = "Admin")]
[Route("field-mappings")]
[Tags("13. Field Mappings")]
public sealed class FieldMappingsController(ISender sender) : ControllerBase
{
    /// <summary>List all field mappings (source → canonical)</summary>
    [HttpGet]
    [ProducesResponseType(typeof(PagedResult<FieldMappingDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> List([FromQuery] int page = 1, [FromQuery] int pageSize = 200, CancellationToken ct = default)
    {
        var result = await sender.Send(new ListFieldMappingsQuery(page, pageSize), ct);
        return result.IsSuccess ? Ok(result.Value) : StatusCode(500);
    }

    /// <summary>Get a field mapping by ID</summary>
    [HttpGet("{id:long}")]
    [ProducesResponseType(typeof(FieldMappingDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Get(long id, CancellationToken ct)
    {
        var result = await sender.Send(new GetFieldMappingQuery(id), ct);
        return result.IsSuccess ? Ok(result.Value) : NotFound(new { message = result.ErrorMessage });
    }

    /// <summary>Map a source-system field to a canonical field (with transform rule)</summary>
    [HttpPost]
    [ProducesResponseType(typeof(FieldMappingDto), StatusCodes.Status201Created)]
    public async Task<IActionResult> Create([FromBody] FieldMappingCreateRequest request, CancellationToken ct)
    {
        var result = await sender.Send(new CreateFieldMappingCommand(request), ct);
        return result.IsSuccess ? Created(string.Empty, result.Value) : StatusCode(500);
    }

    /// <summary>Bulk-create field mappings (max 100 items per batch)</summary>
    [HttpPost("bulk")]
    [ProducesResponseType(typeof(IReadOnlyList<FieldMappingDto>), StatusCodes.Status201Created)]
    public async Task<IActionResult> BulkCreate([FromBody] BulkFieldMappingCreateRequest request, CancellationToken ct)
    {
        var result = await sender.Send(new BulkCreateFieldMappingsCommand(request), ct);
        return result.IsSuccess ? Created(string.Empty, result.Value) : StatusCode(500);
    }

    /// <summary>Update mapping transform expression or target field</summary>
    [HttpPut("{id:long}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Update(long id, [FromBody] FieldMappingUpdateRequest request, CancellationToken ct)
    {
        var result = await sender.Send(new UpdateFieldMappingCommand(id, request), ct);
        return result.IsSuccess ? NoContent() : NotFound(new { message = result.ErrorMessage });
    }

    /// <summary>Bulk-update field mappings (max 100 items per batch)</summary>
    [HttpPut("bulk")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> BulkUpdate([FromBody] BulkFieldMappingUpdateRequest request, CancellationToken ct)
    {
        var result = await sender.Send(new BulkUpdateFieldMappingsCommand(request), ct);
        return result.IsSuccess ? NoContent() : NotFound(new { message = result.ErrorMessage });
    }

    /// <summary>Delete a field mapping</summary>
    [HttpDelete("{id:long}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Delete(long id, CancellationToken ct)
    {
        var result = await sender.Send(new DeleteFieldMappingCommand(id), ct);
        return result.IsSuccess ? NoContent() : NotFound(new { message = result.ErrorMessage });
    }
}
