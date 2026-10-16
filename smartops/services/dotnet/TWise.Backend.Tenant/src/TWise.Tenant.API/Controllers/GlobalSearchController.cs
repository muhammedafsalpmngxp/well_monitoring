using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TWise.Tenant.Application.Features.GlobalSearch;

namespace TWise.Tenant.API.Controllers;

/// <summary>
/// Global search across boards (dashboards), charts, tiles and reports.
/// </summary>
[Route("api/search")]
[Authorize]
public class GlobalSearchController(IMediator mediator) : BaseApiController
{
    /// <summary>Search boards, charts, tiles and reports by name. e.g. GET /api/search?q=profit</summary>
    [HttpGet]
    public async Task<IActionResult> Search([FromQuery] string? q, CancellationToken ct)
    {
        var result = await mediator.Send(new GlobalSearchQuery(q ?? string.Empty), ct);
        return ToActionResult(result);
    }
}
