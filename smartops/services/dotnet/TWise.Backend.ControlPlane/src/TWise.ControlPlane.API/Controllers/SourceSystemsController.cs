using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.OutputCaching;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Application.Features.Sources;
using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.API.Controllers;

/// <summary>Step 9 — External source systems (SAP, SCADA, IoT hubs…)</summary>
[ApiController]
[Authorize(Policy = "Admin")]
[Route("source-systems")]
[Tags("09. Source Systems")]
public sealed class SourceSystemsController(ISender sender) : ControllerBase
{
    /// <summary>List all registered source systems</summary>
    [HttpGet]
    [OutputCache(PolicyName = "ControlPlaneList")]
    [ProducesResponseType(typeof(PagedResult<SourceSystemDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> List([FromQuery] int page = 1, [FromQuery] int pageSize = 200, CancellationToken ct = default)
    {
        var result = await sender.Send(new ListSourceSystemsQuery(page, pageSize), ct);
        return result.IsSuccess ? Ok(result.Value) : StatusCode(500);
    }

    /// <summary>Get a source system by ID</summary>
    [HttpGet("{id:int}")]
    [ProducesResponseType(typeof(SourceSystemDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Get(int id, CancellationToken ct)
    {
        var result = await sender.Send(new GetSourceSystemQuery(id), ct);
        return result.IsSuccess ? Ok(result.Value) : NotFound(new { message = result.ErrorMessage });
    }

    /// <summary>Register a new external source system (SAP, SCADA, IoT hub, etc.)</summary>
    [HttpPost]
    [ProducesResponseType(typeof(SourceSystemDto), StatusCodes.Status201Created)]
    public async Task<IActionResult> Create([FromBody] SourceSystemCreateRequest request, CancellationToken ct)
    {
        var result = await sender.Send(new CreateSourceSystemCommand(request), ct);
        return result.IsSuccess ? Created(string.Empty, result.Value) : StatusCode(500);
    }

    /// <summary>Update source system connection or metadata</summary>
    [HttpPut("{id:int}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Update(int id, [FromBody] SourceSystemUpdateRequest request, CancellationToken ct)
    {
        var result = await sender.Send(new UpdateSourceSystemCommand(id, request), ct);
        return result.IsSuccess ? NoContent() : NotFound(new { message = result.ErrorMessage });
    }

    /// <summary>Deregister a source system</summary>
    [HttpDelete("{id:int}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Delete(int id, CancellationToken ct)
    {
        var result = await sender.Send(new DeleteSourceSystemCommand(id), ct);
        return result.IsSuccess ? NoContent() : NotFound(new { message = result.ErrorMessage });
    }
}
