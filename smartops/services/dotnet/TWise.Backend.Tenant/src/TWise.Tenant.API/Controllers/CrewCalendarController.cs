using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Features.Legacy.CrewCalendar;

namespace TWise.Tenant.API.Controllers;

/// <remarks>
/// Crew calendar API backed by AlTasnimBI.dbo.crew_calendar_result. Its routes and response contract
/// match api/legacy-crews so the UI can switch by changing only the base path.
/// </remarks>
[Route("api/crews")]
[Authorize]
public class CrewCalendarController(ICrewCalendarService service, ILoggerFactory loggerFactory) : BaseApiController
{
    // MediatR resolves these handlers with the legacy service, so the shared handlers are invoked here with
    // the result-table service. These queries currently have no pipeline validators.
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
        var handler = new GetCrewCalendarHandler(service, loggerFactory.CreateLogger<GetCrewCalendarHandler>());
        var resultTask = handler.Handle(
            new GetCrewCalendarQuery(cluster, site, wellType, project, from, to, includeAssignments, includeRoster), ct);
        // Only preload the independent SQL source; shared-context assignment queries stay sequential.
        if (includeRoster)
            await Task.WhenAll(resultTask, service.PreloadRosterAsync(ct));
        return ToActionResult(await resultTask);
    }

    [HttpGet("unassigned")]
    public async Task<IActionResult> GetUnassignedCrews(
        [FromQuery] string? crewGroup,
        [FromQuery] string? from,
        [FromQuery] string? to,
        CancellationToken ct)
    {
        var handler = new GetUnassignedCrewsHandler(service, loggerFactory.CreateLogger<GetUnassignedCrewsHandler>());
        var result = await handler.Handle(new GetUnassignedCrewsQuery(crewGroup, from, to), ct);
        return ToActionResult(result);
    }

    [HttpGet("assignable-activities")]
    public async Task<IActionResult> GetAssignableActivities(
        [FromQuery] string? crewGroup,
        [FromQuery] string? crewTypeCode,
        CancellationToken ct)
    {
        var handler = new GetAssignableActivitiesHandler(service,
            loggerFactory.CreateLogger<GetAssignableActivitiesHandler>());
        var result = await handler.Handle(new GetAssignableActivitiesQuery(crewGroup, crewTypeCode), ct);
        return ToActionResult(result);
    }
}
