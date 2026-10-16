using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Application.Features.Access;
using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.API.Controllers;

[ApiController]
[Authorize(Policy = "Admin")]
[Route("roles")]
[Tags("04. Roles")]
public sealed class RolesController(ISender sender) : ControllerBase
{
    private long CallerTenantId
    {
        get
        {
            var claim = User.FindFirst("tenantId")?.Value;
            if (string.IsNullOrEmpty(claim) || !long.TryParse(claim, out var tid))
                return -1;
            return tid;
        }
    }

    [HttpGet]
    [ProducesResponseType(typeof(PagedResult<RoleDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> List([FromQuery] int page = 1, [FromQuery] int pageSize = 200, CancellationToken ct = default)
    {
        var result = await sender.Send(new ListRolesQuery(CallerTenantId, page, pageSize), ct);
        return result.IsSuccess ? Ok(result.Value) : StatusCode(500);
    }

    [HttpGet("{id:int}")]
    [ProducesResponseType(typeof(RoleDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Get(int id, CancellationToken ct)
    {
        var result = await sender.Send(new GetRoleQuery(id, CallerTenantId), ct);
        return result.IsSuccess ? Ok(result.Value) : NotFound(new { message = result.ErrorMessage });
    }

    [HttpPost]
    [ProducesResponseType(typeof(RoleDto), StatusCodes.Status201Created)]
    public async Task<IActionResult> Create([FromBody] RoleCreateRequest request, CancellationToken ct)
    {
        var result = await sender.Send(new CreateRoleCommand(request, CallerTenantId), ct);
        return result.IsSuccess ? Created(string.Empty, result.Value) : StatusCode(500);
    }

    [HttpPut("{id:int}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Update(int id, [FromBody] RoleUpdateRequest request, CancellationToken ct)
    {
        var result = await sender.Send(new UpdateRoleCommand(id, request, CallerTenantId), ct);
        return result.IsSuccess ? NoContent() : NotFound(new { message = result.ErrorMessage });
    }

    [HttpDelete("{id:int}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Delete(int id, CancellationToken ct)
    {
        var result = await sender.Send(new DeleteRoleCommand(id, CallerTenantId), ct);
        return result.IsSuccess ? NoContent() : NotFound(new { message = result.ErrorMessage });
    }

    [HttpGet("{roleId:int}/permissions")]
    [ProducesResponseType(typeof(List<RoleModulePermissionDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetPermissions(int roleId, CancellationToken ct)
    {
        var result = await sender.Send(new GetRolePermissionsQuery(roleId, CallerTenantId), ct);
        return result.IsSuccess ? Ok(result.Value) : StatusCode(500);
    }

    [HttpPut("{roleId:int}/permissions")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> SetPermissions(int roleId, [FromBody] RoleModulePermissionBulkRequest request, CancellationToken ct)
    {
        var result = await sender.Send(new BulkUpsertRolePermissionsCommand(roleId, request, CallerTenantId), ct);
        return result.IsSuccess ? NoContent() : StatusCode(500);
    }
}
