using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.OutputCaching;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Application.Features.Tenants;
using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.API.Controllers;

/// <summary>Step 3 — Schema versions (defines data-model version for a tenant)</summary>
[ApiController]
[Authorize(Policy = "Admin")]
[Route("schema-versions")]
[Tags("03. Schema Versions")]
public sealed class SchemaVersionsController(ISender sender) : ControllerBase
{
    /// <summary>List all schema versions</summary>
    [HttpGet]
    [OutputCache(PolicyName = "ControlPlaneList")]
    [ProducesResponseType(typeof(PagedResult<SchemaVersionDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> List([FromQuery] int page = 1, [FromQuery] int pageSize = 200, CancellationToken ct = default)
    {
        var result = await sender.Send(new ListSchemaVersionsQuery(page, pageSize), ct);
        return result.IsSuccess ? Ok(result.Value) : StatusCode(500);
    }

    /// <summary>Get a schema version by ID</summary>
    [HttpGet("{id:int}")]
    [ProducesResponseType(typeof(SchemaVersionDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Get(int id, CancellationToken ct)
    {
        var result = await sender.Send(new GetSchemaVersionQuery(id), ct);
        return result.IsSuccess ? Ok(result.Value) : NotFound(new { message = result.ErrorMessage });
    }

    /// <summary>Create a schema version (e.g. v1.0, v2.0) for tenant data model</summary>
    [HttpPost]
    [ProducesResponseType(typeof(SchemaVersionDto), StatusCodes.Status201Created)]
    public async Task<IActionResult> Create([FromBody] SchemaVersionCreateRequest request, CancellationToken ct)
    {
        var result = await sender.Send(new CreateSchemaVersionCommand(request), ct);
        return result.IsSuccess ? Created(string.Empty, result.Value) : StatusCode(500);
    }

    /// <summary>Update schema version label or status</summary>
    [HttpPut("{id:int}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Update(int id, [FromBody] SchemaVersionUpdateRequest request, CancellationToken ct)
    {
        var result = await sender.Send(new UpdateSchemaVersionCommand(id, request), ct);
        return result.IsSuccess ? NoContent() : NotFound(new { message = result.ErrorMessage });
    }

    /// <summary>Delete a schema version (only if no tenants reference it)</summary>
    [HttpDelete("{id:int}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Delete(int id, CancellationToken ct)
    {
        var result = await sender.Send(new DeleteSchemaVersionCommand(id), ct);
        return result.IsSuccess ? NoContent() : NotFound(new { message = result.ErrorMessage });
    }
}
