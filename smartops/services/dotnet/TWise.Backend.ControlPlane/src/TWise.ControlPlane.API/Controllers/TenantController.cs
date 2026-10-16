using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.OutputCaching;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Application.Features.Tenants;
using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.API.Controllers;

/// <summary>Step 2 — Tenants (requires Region)</summary>
[ApiController]
[Authorize(Policy = "Admin")]
[Route("tenants")]
[Tags("02. Tenants")]
public sealed class TenantsController(ISender sender) : ControllerBase
{
    /// <summary>List all tenants</summary>
    [HttpGet]
    [OutputCache(PolicyName = "ControlPlaneList")]
    [ProducesResponseType(typeof(PagedResult<TenantDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> List([FromQuery] int page = 1, [FromQuery] int pageSize = 200, CancellationToken ct = default)
    {
        var result = await sender.Send(new ListTenantsQuery(page, pageSize), ct);
        return result.IsSuccess ? Ok(result.Value) : StatusCode(500);
    }

    /// <summary>Get a tenant by ID</summary>
    [HttpGet("{id:long}")]
    [ProducesResponseType(typeof(TenantDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Get(long id, CancellationToken ct)
    {
        var result = await sender.Send(new GetTenantQuery(id), ct);
        return result.IsSuccess ? Ok(result.Value) : NotFound(new { message = result.ErrorMessage });
    }

    /// <summary>Create a new tenant and assign to a region</summary>
    [HttpPost]
    [ProducesResponseType(typeof(TenantDto), StatusCodes.Status201Created)]
    public async Task<IActionResult> Create([FromBody] TenantCreateRequest request, CancellationToken ct)
    {
        var result = await sender.Send(new CreateTenantCommand(request), ct);
        return result.IsSuccess ? Created(string.Empty, result.Value) : StatusCode(500);
    }

    /// <summary>Update tenant metadata (name, slug, settings)</summary>
    [HttpPut("{id:long}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Update(long id, [FromBody] TenantUpdateRequest request, CancellationToken ct)
    {
        var result = await sender.Send(new UpdateTenantCommand(id, request), ct);
        return result.IsSuccess ? NoContent() : NotFound(new { message = result.ErrorMessage });
    }

    /// <summary>Delete a tenant (soft-delete; data retained)</summary>
    [HttpDelete("{id:long}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Delete(long id, CancellationToken ct)
    {
        var result = await sender.Send(new DeleteTenantCommand(id), ct);
        return result.IsSuccess ? NoContent() : NotFound(new { message = result.ErrorMessage });
    }

    /// <summary>Trigger infrastructure provisioning for a tenant (async)</summary>
    [HttpPost("{id:long}/provision")]
    [ProducesResponseType(StatusCodes.Status202Accepted)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<IActionResult> Provision(long id, CancellationToken ct)
    {
        var result = await sender.Send(new ProvisionTenantCommand(id), ct);
        return result.Status switch
        {
            Application.Common.ResultStatus.Success => Accepted(),
            Application.Common.ResultStatus.NotFound => NotFound(result.ErrorMessage),
            Application.Common.ResultStatus.Conflict => Conflict(result.ErrorMessage),
            Application.Common.ResultStatus.ValidationError => BadRequest(result.ErrorMessage),
            _ => Problem(
                detail: result.ErrorMessage,
                statusCode: StatusCodes.Status500InternalServerError)
        };
    }

    /// <summary>Retry a failed provisioning attempt</summary>
    [HttpPost("{id:long}/retry-provision")]
    [ProducesResponseType(StatusCodes.Status202Accepted)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> RetryProvision(long id, CancellationToken ct)
    {
        var result = await sender.Send(new RetryProvisionCommand(id), ct);
        return result.IsSuccess ? Accepted() : NotFound(result.ErrorMessage);
    }

    /// <summary>Decommission a tenant and release resources</summary>
    [HttpPost("{id:long}/decommission")]
    [ProducesResponseType(StatusCodes.Status202Accepted)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Decommission(long id, CancellationToken ct)
    {
        var result = await sender.Send(new DecommissionTenantCommand(id), ct);
        return result.IsSuccess ? Accepted() : NotFound(result.ErrorMessage);
    }

    /// <summary>Get current provisioning status for a tenant</summary>
    [HttpGet("{id:long}/provision-status")]
    [ProducesResponseType(typeof(TenantProvisionStatusDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> ProvisionStatus(long id, CancellationToken ct)
    {
        var result = await sender.Send(new GetProvisionStatusQuery(id), ct);
        return result.IsSuccess ? Ok(result.Value) : NotFound(new { message = result.ErrorMessage });
    }
}
