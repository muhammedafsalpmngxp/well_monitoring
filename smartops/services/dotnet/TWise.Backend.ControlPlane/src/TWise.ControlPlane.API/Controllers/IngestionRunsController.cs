using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Application.Features.Operations;
using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.API.Controllers;

/// <summary>Step 15 — Data ingestion run records (requires TenantSources)</summary>
[ApiController]
[Authorize(Policy = "Admin")]
[Route("ingestion-runs")]
[Tags("15. Ingestion Runs")]
public sealed class IngestionRunsController(ISender sender) : ControllerBase
{
    /// <summary>List all ingestion run records</summary>
    [HttpGet]
    [ProducesResponseType(typeof(PagedResult<IngestionRunDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> List([FromQuery] int page = 1, [FromQuery] int pageSize = 200, CancellationToken ct = default)
    {
        var result = await sender.Send(new ListIngestionRunsQuery(page, pageSize), ct);
        return result.IsSuccess ? Ok(result.Value) : StatusCode(500);
    }

    /// <summary>Get an ingestion run by ID (includes status, row counts, errors)</summary>
    [HttpGet("{id:long}")]
    [ProducesResponseType(typeof(IngestionRunDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Get(long id, CancellationToken ct)
    {
        var result = await sender.Send(new GetIngestionRunQuery(id), ct);
        return result.IsSuccess ? Ok(result.Value) : NotFound(new { message = result.ErrorMessage });
    }

    /// <summary>Record or trigger a new data-ingestion run for a tenant-source</summary>
    [HttpPost]
    [ProducesResponseType(typeof(IngestionRunDto), StatusCodes.Status201Created)]
    public async Task<IActionResult> Create([FromBody] IngestionRunCreateRequest request, CancellationToken ct)
    {
        var result = await sender.Send(new CreateIngestionRunCommand(request), ct);
        return result.IsSuccess ? Created(string.Empty, result.Value) : StatusCode(500);
    }

    /// <summary>Update run status (e.g. mark completed, failed, rows processed)</summary>
    [HttpPut("{id:long}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Update(long id, [FromBody] IngestionRunUpdateRequest request, CancellationToken ct)
    {
        var result = await sender.Send(new UpdateIngestionRunCommand(id, request), ct);
        return result.IsSuccess ? NoContent() : NotFound(new { message = result.ErrorMessage });
    }

    /// <summary>Delete an ingestion run record</summary>
    [HttpDelete("{id:long}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Delete(long id, CancellationToken ct)
    {
        var result = await sender.Send(new DeleteIngestionRunCommand(id), ct);
        return result.IsSuccess ? NoContent() : NotFound(new { message = result.ErrorMessage });
    }
}
