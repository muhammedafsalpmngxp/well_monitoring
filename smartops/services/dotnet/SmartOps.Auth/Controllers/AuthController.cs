using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SmartOps.Auth.Domain.Dtos;
using SmartOps.Auth.Services;

namespace SmartOps.Auth.Controllers;

[ApiController]
[Route("login")]
public sealed class AuthController(IUserService users) : ControllerBase
{
    [AllowAnonymous]
    [HttpPost]
    public async Task<ActionResult<TokenResponse>> Login([FromBody] LoginRequest request)
    {
        var result = await users.LoginAsync(request);
        return result is null ? Unauthorized(new { error = "Invalid credentials" }) : Ok(result);
    }
}

[ApiController]
[Authorize]
[Route("me")]
public sealed class MeController(IUserService users) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<UserDto>> Me()
    {
        var sub = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value
               ?? User.FindFirst("sub")?.Value;
        if (!int.TryParse(sub, out var id)) return Unauthorized();
        var user = await users.GetByIdAsync(id);
        return user is null ? NotFound() : Ok(user);
    }
}
