using MediatR;
using Microsoft.AspNetCore.Mvc;
using SmartOps.Wells.Application.Features.Crew;
using SmartOps.Wells.Contracts;

namespace SmartOps.Wells.API.Controllers;

[ApiController]
// [Authorize]
[Route("crews")]
public sealed class CrewController(IMediator mediator) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<CrewListResponse>> GetCrewList(
        [FromQuery] string? crewGroup,
        [FromQuery] string? cluster,
        [FromQuery] string? wellId,
        [FromQuery] DateOnly? from,
        [FromQuery] DateOnly? to,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50,
        CancellationToken ct = default)
        => Ok(await mediator.Send(
            new GetCrewListQuery(crewGroup, cluster, wellId, from, to, page, pageSize), ct));

    [HttpGet("activity-master/all-activities")]
    public async Task<ActionResult<IReadOnlyList<ActivityMasterAllActivitiesItemDto>>> GetActivityMasterAllActivities(
        CancellationToken ct = default)
        => Ok(await mediator.Send(new GetActivityMasterAllActivitiesQuery(), ct));

    [HttpGet("crew-master")]
    public async Task<ActionResult<IReadOnlyList<CrewMasterItemDto>>> GetCrewMaster(
        CancellationToken ct = default)
        => Ok(await mediator.Send(new GetCrewMasterQuery(), ct));

    /// <summary>
    /// GET /crews/calendar — Crew calendar timeline with activities from ActivityTaskPlan.
    /// Returns crews grouped by crew_type, with their activities overlapping the date window.
    /// All filters are optional.
    /// </summary>
    [HttpGet("calendar")]
    public async Task<ActionResult<CrewCalendarResponse>> GetCrewCalendar(
        [FromQuery] string?   cluster  = null,
        [FromQuery] string?   site     = null,
        [FromQuery] string?   wellType = null,
        [FromQuery] string?   project  = null,
        [FromQuery] DateOnly? from     = null,
        [FromQuery] DateOnly? to       = null,
        CancellationToken ct = default)
        => Ok(await mediator.Send(
            new GetCrewCalendarQuery(cluster, site, wellType, project, from, to), ct));

}
