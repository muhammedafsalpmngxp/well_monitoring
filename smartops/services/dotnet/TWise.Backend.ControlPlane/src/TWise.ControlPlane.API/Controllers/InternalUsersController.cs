using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TWise.Backend.ControlPlane.API.Auth;
using TWise.Backend.ControlPlane.Application.Features.Access;
using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.API.Controllers;

/// <summary>Internal service-to-service endpoints (secured via API key)</summary>
[ApiController]
[Authorize(AuthenticationSchemes = InternalApiKeyHandler.SchemeName, Policy = InternalApiKeyHandler.PolicyName)]
[Route("internal/users")]
[Tags("Internal")]
public sealed class InternalUsersController(ISender sender) : ControllerBase
{
    /// <summary>Check whether a user exists and has access to a tenant (service-to-service)</summary>
    [HttpGet("check-exists")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> CheckExists([FromQuery] long userId, [FromQuery] long tenantId, CancellationToken ct)
    {
        if (userId <= 0)
            return BadRequest(new { error = "A valid userId query parameter is required." });
        if (tenantId <= 0)
            return BadRequest(new { error = "A valid tenantId query parameter is required." });

        var result = await sender.Send(new CheckUserExistsQuery(userId, tenantId), ct);
        return result.IsSuccess ? Ok(result.Value) : StatusCode(500);
    }

    /// <summary>
    /// Users of a tenant by id, and every user holding one of the role codes, with their roles and plants
    /// (service-to-service; the Tenant API's scheduled deliveries read owners and recipients here).
    /// </summary>
    [HttpPost("resolve")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> Resolve([FromBody] ResolveUsersRequest request, CancellationToken ct)
    {
        if (request.TenantId <= 0)
            return BadRequest(new { error = "A valid tenantId is required." });
        if ((request.UserIds?.Count ?? 0) + (request.RoleCodes?.Count ?? 0) > UserDirectory.MaxLookups)
            return BadRequest(new { error = $"At most {UserDirectory.MaxLookups} userIds and roleCodes together." });
        if ((request.UserIds?.Count ?? 0) + (request.RoleCodes?.Count ?? 0) == 0)
            return Ok(new List<DirectoryUserDto>());

        var result = await sender.Send(new ResolveUsersQuery(request), ct);
        return result.IsSuccess ? Ok(result.Value) : StatusCode(500);
    }
}
