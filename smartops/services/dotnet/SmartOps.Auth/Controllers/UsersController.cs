using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SmartOps.Auth.Domain.Dtos;
using SmartOps.Auth.Services;

namespace SmartOps.Auth.Controllers;

[ApiController]
[Authorize(Policy = "Admin")]
[Route("users")]
public sealed class UsersController(IUserService users) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<UserDto>>> List() => Ok(await users.ListAsync());

    [HttpGet("{id:int}")]
    public async Task<ActionResult<UserDto>> Get(int id)
    {
        var u = await users.GetByIdAsync(id);
        return u is null ? NotFound() : Ok(u);
    }

    [HttpPost]
    public async Task<ActionResult<UserDto>> Create([FromBody] UserCreateRequest request)
    {
        var u = await users.CreateAsync(request);
        return CreatedAtAction(nameof(Get), new { id = u.Id }, u);
    }

    [HttpPatch("{id:int}")]
    public async Task<ActionResult<UserDto>> Update(int id, [FromBody] UserUpdateRequest request)
    {
        var u = await users.UpdateAsync(id, request);
        return u is null ? NotFound() : Ok(u);
    }
}

[ApiController]
[Authorize(Policy = "Admin")]
[Route("roles")]
public sealed class RolesController(IUserService users) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<RoleDto>>> List() => Ok(await users.ListRolesAsync());

    [HttpPut]
    public async Task<ActionResult<RoleDto>> Upsert([FromBody] RoleUpsertRequest request)
        => Ok(await users.UpsertRoleAsync(request));
}
