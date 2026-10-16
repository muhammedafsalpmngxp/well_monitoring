using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Application.Features.Sources;
using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.API.Controllers;

/// <summary>Step 14 — Ingestion/transform capability profiles per tenant-source</summary>
[ApiController]
[Authorize(Policy = "Admin")]
[Route("capability-profiles")]
[Tags("14. Capability Profiles")]
public sealed class CapabilityProfilesController(ISender sender) : ControllerBase
{
    /// <summary>List all capability profiles</summary>
    [HttpGet]
    [ProducesResponseType(typeof(PagedResult<CapabilityProfileDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> List([FromQuery] int page = 1, [FromQuery] int pageSize = 200, CancellationToken ct = default)
    {
        var result = await sender.Send(new ListCapabilityProfilesQuery(page, pageSize), ct);
        return result.IsSuccess ? Ok(result.Value) : StatusCode(500);
    }

    /// <summary>Get a capability profile by ID</summary>
    [HttpGet("{id:long}")]
    [ProducesResponseType(typeof(CapabilityProfileDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Get(long id, CancellationToken ct)
    {
        var result = await sender.Send(new GetCapabilityProfileQuery(id), ct);
        return result.IsSuccess ? Ok(result.Value) : NotFound(new { message = result.ErrorMessage });
    }

    /// <summary>Define ingestion/transform capabilities for a tenant-source</summary>
    [HttpPost]
    [ProducesResponseType(typeof(CapabilityProfileDto), StatusCodes.Status201Created)]
    public async Task<IActionResult> Create([FromBody] CapabilityProfileCreateRequest request, CancellationToken ct)
    {
        var result = await sender.Send(new CreateCapabilityProfileCommand(request), ct);
        return result.IsSuccess ? Created(string.Empty, result.Value) : StatusCode(500);
    }

    /// <summary>Update capability profile (batch size, schedule, transforms)</summary>
    [HttpPut("{id:long}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Update(long id, [FromBody] CapabilityProfileUpdateRequest request, CancellationToken ct)
    {
        var result = await sender.Send(new UpdateCapabilityProfileCommand(id, request), ct);
        return result.IsSuccess ? NoContent() : NotFound(new { message = result.ErrorMessage });
    }

    /// <summary>Delete a capability profile</summary>
    [HttpDelete("{id:long}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Delete(long id, CancellationToken ct)
    {
        var result = await sender.Send(new DeleteCapabilityProfileCommand(id), ct);
        return result.IsSuccess ? NoContent() : NotFound(new { message = result.ErrorMessage });
    }
}
