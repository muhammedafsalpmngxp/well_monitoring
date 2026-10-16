using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Application.Features.Operations;
using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.API.Controllers;

/// <summary>Step 16 — Audit trail for all control-plane operations</summary>
[ApiController]
[Authorize(Policy = "Admin")]
[Route("audit-events")]
[Tags("16. Audit Events")]
public sealed class AuditEventsController(ISender sender) : ControllerBase
{
    /// <summary>List all audit events (most recent first)</summary>
    [HttpGet]
    [ProducesResponseType(typeof(PagedResult<AuditEventDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> List([FromQuery] int page = 1, [FromQuery] int pageSize = 200, CancellationToken ct = default)
    {
        var result = await sender.Send(new ListAuditEventsQuery(page, pageSize), ct);
        return result.IsSuccess ? Ok(result.Value) : StatusCode(500);
    }

    /// <summary>Get a single audit event by ID</summary>
    [HttpGet("{id:long}")]
    [ProducesResponseType(typeof(AuditEventDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Get(long id, CancellationToken ct)
    {
        var result = await sender.Send(new GetAuditEventQuery(id), ct);
        return result.IsSuccess ? Ok(result.Value) : NotFound(new { message = result.ErrorMessage });
    }

    /// <summary>Manually log an audit event (system events are auto-recorded)</summary>
    [HttpPost]
    [ProducesResponseType(typeof(AuditEventDto), StatusCodes.Status201Created)]
    public async Task<IActionResult> Create([FromBody] AuditEventCreateRequest request, CancellationToken ct)
    {
        var result = await sender.Send(new CreateAuditEventCommand(request), ct);
        return result.IsSuccess ? Created(string.Empty, result.Value) : StatusCode(500);
    }

    /// <summary>Update audit event metadata (e.g. add resolution notes)</summary>
    [HttpPut("{id:long}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Update(long id, [FromBody] AuditEventUpdateRequest request, CancellationToken ct)
    {
        var result = await sender.Send(new UpdateAuditEventCommand(id, request), ct);
        return result.IsSuccess ? NoContent() : NotFound(new { message = result.ErrorMessage });
    }

    /// <summary>Delete an audit event record (admin override only)</summary>
    [HttpDelete("{id:long}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Delete(long id, CancellationToken ct)
    {
        var result = await sender.Send(new DeleteAuditEventCommand(id), ct);
        return result.IsSuccess ? NoContent() : NotFound(new { message = result.ErrorMessage });
    }
}
