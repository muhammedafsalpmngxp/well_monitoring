using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TWise.Tenant.Application.Features.DaxFunctions;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.API.Controllers;

/// <summary>DAX function catalog for smart compose in the DAX expression editors.</summary>
[ApiController]
[Authorize]
[Route("api/dax-functions")]
public sealed class DaxFunctionsController(ISender sender) : ControllerBase
{
    /// <summary>Enabled functions starting with the prefix (or a dotted segment of it), best first.</summary>
    [HttpGet("suggest")]
    [ProducesResponseType(typeof(IReadOnlyList<DaxFunctionSuggestionDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> Suggest([FromQuery] string prefix, [FromQuery] string? returnType, [FromQuery] int top = 10, CancellationToken ct = default)
        => Ok(await sender.Send(new SuggestDaxFunctionsQuery(prefix ?? "", returnType, top), ct));
}
