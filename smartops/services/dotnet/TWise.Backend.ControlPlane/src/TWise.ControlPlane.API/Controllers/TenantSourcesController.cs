using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Application.Features.Sources;
using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.API.Controllers;

/// <summary>Step 10 — Link source-systems to tenants (requires Tenants + SourceSystems)</summary>
[ApiController]
[Authorize(Policy = "Admin")]
[Route("tenant-sources")]
[Tags("10. Tenant Sources")]
public sealed class TenantSourcesController(ISender sender) : ControllerBase
{
    /// <summary>List all tenant-source links</summary>
    [HttpGet]
    [ProducesResponseType(typeof(PagedResult<TenantSourceDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> List([FromQuery] int page = 1, [FromQuery] int pageSize = 200, CancellationToken ct = default)
    {
        var result = await sender.Send(new ListTenantSourcesQuery(page, pageSize), ct);
        return result.IsSuccess ? Ok(result.Value) : StatusCode(500);
    }

    /// <summary>Get a tenant-source link by ID</summary>
    [HttpGet("{id:long}")]
    [ProducesResponseType(typeof(TenantSourceDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Get(long id, CancellationToken ct)
    {
        var result = await sender.Send(new GetTenantSourceQuery(id), ct);
        return result.IsSuccess ? Ok(result.Value) : NotFound(new { message = result.ErrorMessage });
    }

    /// <summary>Link a source system to a tenant (enables data ingestion)</summary>
    [HttpPost]
    [ProducesResponseType(typeof(TenantSourceDto), StatusCodes.Status201Created)]
    public async Task<IActionResult> Create([FromBody] TenantSourceCreateRequest request, CancellationToken ct)
    {
        var result = await sender.Send(new CreateTenantSourceCommand(request), ct);
        return result.IsSuccess ? Created(string.Empty, result.Value) : StatusCode(500);
    }

    /// <summary>Update tenant-source configuration (sync interval, credentials ref)</summary>
    [HttpPut("{id:long}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Update(long id, [FromBody] TenantSourceUpdateRequest request, CancellationToken ct)
    {
        var result = await sender.Send(new UpdateTenantSourceCommand(id, request), ct);
        return result.IsSuccess ? NoContent() : NotFound(new { message = result.ErrorMessage });
    }

    /// <summary>Unlink a source from a tenant</summary>
    [HttpDelete("{id:long}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Delete(long id, CancellationToken ct)
    {
        var result = await sender.Send(new DeleteTenantSourceCommand(id), ct);
        return result.IsSuccess ? NoContent() : NotFound(new { message = result.ErrorMessage });
    }
}
