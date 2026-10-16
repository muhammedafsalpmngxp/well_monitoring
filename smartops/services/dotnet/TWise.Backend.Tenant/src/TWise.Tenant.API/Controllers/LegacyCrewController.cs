using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TWise.Tenant.Application.Features.Legacy.CrewCalendar;
using TWise.Tenant.Domain.DTOs.Legacy;

namespace TWise.Tenant.API.Controllers;

/// <remarks>LEGACY: reads from AppMasterDB. Remove when data migrates to tenant DB.</remarks>
[Route("api/legacy-crews")]
[Authorize]
public class LegacyCrewController(IMediator mediator) : BaseApiController
{
    [HttpGet("calendar")]
    public async Task<IActionResult> GetCrewCalendar(
        [FromQuery] string? cluster,
        [FromQuery] string? site,
        [FromQuery] string? wellType,
        [FromQuery] string? project,
        [FromQuery] string? from,
        [FromQuery] string? to,
        [FromQuery] bool includeAssignments,
        [FromQuery] bool includeRoster,
        CancellationToken ct)
    {
        var result = await mediator.Send(
            new GetCrewCalendarQuery(cluster, site, wellType, project, from, to, includeAssignments, includeRoster), ct);
        return ToActionResult(result);
    }

    [HttpGet("unassigned")]
    public async Task<IActionResult> GetUnassignedCrews(
        [FromQuery] string? crewGroup,
        [FromQuery] string? from,
        [FromQuery] string? to,
        CancellationToken ct)
    {
        var result = await mediator.Send(new GetUnassignedCrewsQuery(crewGroup, from, to), ct);
        return ToActionResult(result);
    }

    [HttpGet("assignable-activities")]
    public async Task<IActionResult> GetAssignableActivities(
        [FromQuery] string? crewGroup,
        [FromQuery] string? crewTypeCode,
        CancellationToken ct)
    {
        var result = await mediator.Send(new GetAssignableActivitiesQuery(crewGroup, crewTypeCode), ct);
        return ToActionResult(result);
    }
}
