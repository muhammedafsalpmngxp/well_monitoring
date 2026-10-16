using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Application.Features.Access;
using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.API.Controllers;

/// <summary>Step 8 — Enable features for a tenant (requires Tenants + Features)</summary>
[ApiController]
[Authorize(Policy = "Admin")]
[Route("tenant-features")]
[Tags("08. Tenant Features")]
public sealed class TenantFeaturesController(ISender sender) : ControllerBase
{
    /// <summary>List all tenant-feature assignments</summary>
    [HttpGet]
    [ProducesResponseType(typeof(PagedResult<TenantFeatureDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> List([FromQuery] int page = 1, [FromQuery] int pageSize = 200, CancellationToken ct = default)
    {
        var result = await sender.Send(new ListTenantFeaturesQuery(page, pageSize), ct);
        return result.IsSuccess ? Ok(result.Value) : StatusCode(500);
    }

    /// <summary>Get a tenant-feature assignment by ID</summary>
    [HttpGet("{id:long}")]
    [ProducesResponseType(typeof(TenantFeatureDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Get(long id, CancellationToken ct)
    {
        var result = await sender.Send(new GetTenantFeatureQuery(id), ct);
        return result.IsSuccess ? Ok(result.Value) : NotFound(new { message = result.ErrorMessage });
    }

    /// <summary>Enable a feature for a specific tenant</summary>
    [HttpPost]
    [ProducesResponseType(typeof(TenantFeatureDto), StatusCodes.Status201Created)]
    public async Task<IActionResult> Create([FromBody] TenantFeatureCreateRequest request, CancellationToken ct)
    {
        var result = await sender.Send(new CreateTenantFeatureCommand(request), ct);
        return result.IsSuccess ? Created(string.Empty, result.Value) : StatusCode(500);
    }

    /// <summary>Update feature enablement settings for a tenant</summary>
    [HttpPut("{id:long}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Update(long id, [FromBody] TenantFeatureUpdateRequest request, CancellationToken ct)
    {
        var result = await sender.Send(new UpdateTenantFeatureCommand(id, request), ct);
        return result.IsSuccess ? NoContent() : NotFound(new { message = result.ErrorMessage });
    }

    /// <summary>Disable a feature for a tenant</summary>
    [HttpDelete("{id:long}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Delete(long id, CancellationToken ct)
    {
        var result = await sender.Send(new DeleteTenantFeatureCommand(id), ct);
        return result.IsSuccess ? NoContent() : NotFound(new { message = result.ErrorMessage });
    }
}
