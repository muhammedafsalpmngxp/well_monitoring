using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Application.Features.Access;
using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.API.Controllers;

/// <summary>Step 6 — Application users</summary>
[ApiController]
[Authorize(Policy = "Admin")]
[Route("users")]
[Tags("06. Users")]
public sealed class AppUsersController(ISender sender) : ControllerBase
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

    private long? CallerUserId
    {
        get
        {
            var claim = User.FindFirst(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub)?.Value
                     ?? User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
            return long.TryParse(claim, out var uid) ? uid : null;
        }
    }

    /// <summary>List all application users</summary>
    [HttpGet]
    [ProducesResponseType(typeof(PagedResult<AppUserDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> List([FromQuery] int page = 1, [FromQuery] int pageSize = 200, CancellationToken ct = default)
    {
        var result = await sender.Send(new ListUsersQuery(page, pageSize), ct);
        return result.IsSuccess ? Ok(result.Value) : StatusCode(500);
    }

    /// <summary>List users belonging to a specific tenant with their role</summary>
    [HttpGet("by-tenant/{tenantId:long}")]
    [ProducesResponseType(typeof(PagedResult<TenantUserDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> ListByTenant(long tenantId, [FromQuery] int page = 1, [FromQuery] int pageSize = 200, CancellationToken ct = default)
    {
        // TODO: IDOR — validate tenantId against the caller's JWT tenantId claim; allow cross-tenant only for platform_admin
        var result = await sender.Send(new ListUsersByTenantQuery(tenantId, page, pageSize), ct);
        return result.IsSuccess ? Ok(result.Value) : StatusCode(500);
    }

    /// <summary>Search internal employees from legacy directory</summary>
    [HttpGet("search")]
    [ProducesResponseType(typeof(IReadOnlyList<EmployeeSearchResult>), StatusCodes.Status200OK)]
    public async Task<IActionResult> Search([FromQuery] string q, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(q) || q.Length < 2) return Ok(Array.Empty<object>());
        var result = await sender.Send(new SearchEmployeesQuery(q.Trim()), ct);
        return result.IsSuccess ? Ok(result.Value) : StatusCode(500);
    }

    [HttpGet("check-duplicates")]
    [ProducesResponseType(typeof(UserDuplicateCheckResponse), StatusCodes.Status200OK)]
    public async Task<IActionResult> CheckDuplicates([FromQuery] string? email = null, [FromQuery] string? employeeId = null, CancellationToken ct = default)
    {
        var result = await sender.Send(new CheckUserDuplicatesQuery(email, employeeId), ct);
        return result.IsSuccess ? Ok(result.Value) : StatusCode(500);
    }

    /// <summary>Get a user by ID</summary>
    [HttpGet("{id:long}")]
    [ProducesResponseType(typeof(AppUserDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Get(long id, CancellationToken ct)
    {
        var result = await sender.Send(new GetUserQuery(id), ct);
        return result.IsSuccess ? Ok(result.Value) : NotFound(new { message = result.ErrorMessage });
    }

    /// <summary>Create a new user (email, display name, external identity)</summary>
    [HttpPost]
    [ProducesResponseType(typeof(AppUserDto), StatusCodes.Status201Created)]
    public async Task<IActionResult> Create([FromBody] AppUserCreateRequest request, CancellationToken ct)
    {
        var result = await sender.Send(new CreateUserCommand(request), ct);
        return result.IsSuccess ? Created(string.Empty, result.Value) : StatusCode(500);
    }

    /// <summary>Create user with role and plant access in one call</summary>
    [HttpPost("with-access")]
    [ProducesResponseType(typeof(CreateUserWithAccessResponse), StatusCodes.Status201Created)]
    public async Task<IActionResult> CreateWithAccess([FromBody] CreateUserWithAccessRequest request, CancellationToken ct)
    {
        var result = await sender.Send(new CreateUserWithAccessCommand(request, CallerTenantId), ct);
        return result.IsSuccess ? Created(string.Empty, result.Value) : StatusCode(500);
    }

    /// <summary>Update user profile (name, email, status)</summary>
    [HttpPut("{id:long}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Update(long id, [FromBody] AppUserUpdateRequest request, CancellationToken ct)
    {
        var result = await sender.Send(new UpdateUserCommand(id, request), ct);
        return result.IsSuccess ? NoContent() : NotFound(new { message = result.ErrorMessage });
    }

    /// <summary>Update user profile and plant access in a single transaction</summary>
    [HttpPut("{id:long}/with-access")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> UpdateWithAccess(long id, [FromBody] UpdateUserWithAccessRequest request, CancellationToken ct)
    {
        var result = await sender.Send(new UpdateUserWithAccessCommand(id, request, CallerTenantId), ct);
        return result.IsSuccess ? NoContent() : NotFound(new { message = result.ErrorMessage });
    }

    /// <summary>Delete a user (revokes all tenant-role assignments)</summary>
    [HttpDelete("{id:long}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Delete(long id, CancellationToken ct)
    {
        var result = await sender.Send(new DeleteUserCommand(id), ct);
        return result.IsSuccess ? NoContent() : NotFound(new { message = result.ErrorMessage });
    }

    /// <summary>Reset a user's password — generates a new strong password and returns it once</summary>
    [HttpPost("{id:long}/reset-password")]
    [ProducesResponseType(typeof(ResetPasswordResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> ResetPassword(long id, CancellationToken ct)
    {
        var result = await sender.Send(new ResetUserPasswordCommand(id, CallerTenantId, CallerUserId), ct);
        return result.IsSuccess ? Ok(result.Value) : NotFound(new { message = result.ErrorMessage });
    }

    /// <summary>Get plant access codes for a user</summary>
    [HttpGet("{id:long}/plant-access")]
    [ProducesResponseType(typeof(List<int>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetPlantAccess(long id, CancellationToken ct)
    {
        var result = await sender.Send(new GetUserPlantAccessQuery(id, CallerTenantId), ct);
        return result.IsSuccess ? Ok(result.Value) : NotFound(new { message = result.ErrorMessage });
    }

    /// <summary>Replace plant access for a user</summary>
    [HttpPut("{id:long}/plant-access")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> UpdatePlantAccess(long id, [FromBody] UpdateUserPlantAccessRequest request, CancellationToken ct)
    {
        var result = await sender.Send(new UpdateUserPlantAccessCommand(id, request.PlantCodes, CallerTenantId), ct);
        return result.IsSuccess ? NoContent() : NotFound(new { message = result.ErrorMessage });
    }
}
