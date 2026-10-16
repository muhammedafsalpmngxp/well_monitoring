using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Application.Features.Access;
using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.API.Controllers;

[ApiController]
[Authorize(Policy = "Admin")]
[Route("user-tenant-roles")]
[Tags("07. User-Tenant-Roles")]
public sealed class UserTenantRolesController(ISender sender) : ControllerBase
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
    [ProducesResponseType(typeof(PagedResult<UserTenantRoleDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> List([FromQuery] int page = 1, [FromQuery] int pageSize = 200, CancellationToken ct = default)
    {
        var result = await sender.Send(new ListUserTenantRolesQuery(CallerTenantId, page, pageSize), ct);
        return result.IsSuccess ? Ok(result.Value) : StatusCode(500);
    }

    [HttpGet("{id:long}")]
    [ProducesResponseType(typeof(UserTenantRoleDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Get(long id, CancellationToken ct)
    {
        var result = await sender.Send(new GetUserTenantRoleQuery(id, CallerTenantId), ct);
        return result.IsSuccess ? Ok(result.Value) : NotFound(new { message = result.ErrorMessage });
    }

    [HttpPost]
    [ProducesResponseType(typeof(UserTenantRoleDto), StatusCodes.Status201Created)]
    public async Task<IActionResult> Create([FromBody] UserTenantRoleCreateRequest request, CancellationToken ct)
    {
        var result = await sender.Send(new CreateUserTenantRoleCommand(request, CallerTenantId), ct);
        return result.IsSuccess ? Created(string.Empty, result.Value) : StatusCode(500);
    }

    [HttpPut("{id:long}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Update(long id, [FromBody] UserTenantRoleUpdateRequest request, CancellationToken ct)
    {
        var result = await sender.Send(new UpdateUserTenantRoleCommand(id, request, CallerTenantId), ct);
        return result.IsSuccess ? NoContent() : NotFound(new { message = result.ErrorMessage });
    }

    [HttpDelete("{id:long}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Delete(long id, CancellationToken ct)
    {
        var result = await sender.Send(new DeleteUserTenantRoleCommand(id, CallerTenantId), ct);
        return result.IsSuccess ? NoContent() : NotFound(new { message = result.ErrorMessage });
    }
}
