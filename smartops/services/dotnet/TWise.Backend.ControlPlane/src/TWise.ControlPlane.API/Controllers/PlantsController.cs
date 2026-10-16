using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.OutputCaching;
using TWise.Backend.ControlPlane.Application.Features.Access;
using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.API.Controllers;

[ApiController]
[Authorize(Policy = "Admin")]
[Route("plants")]
[Tags("09. Plants")]
public sealed class PlantsController(ISender sender) : ControllerBase
{
    /// <summary>List all plants from directory</summary>
    [HttpGet]
    [OutputCache(PolicyName = "ControlPlaneList")]
    [ProducesResponseType(typeof(IReadOnlyList<EmployeePlantAccess>), StatusCodes.Status200OK)]
    public async Task<IActionResult> List(CancellationToken ct)
    {
        var result = await sender.Send(new ListPlantsQuery(), ct);
        return result.IsSuccess ? Ok(result.Value) : StatusCode(500);
    }
}
