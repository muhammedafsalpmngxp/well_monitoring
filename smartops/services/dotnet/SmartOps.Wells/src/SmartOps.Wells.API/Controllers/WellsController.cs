using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SmartOps.Wells.Application.Features.Wells;
using SmartOps.Wells.Contracts;

namespace SmartOps.Wells.API.Controllers;

[ApiController]
[Authorize]
[Route("clusters")]
public sealed class ClustersController(IMediator mediator) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<ClusterDto>>> List(CancellationToken ct)
        => Ok(await mediator.Send(new ListClustersQuery(), ct));
}

[ApiController]
[Authorize]
[Route("wells")]
public sealed class WellsController(IMediator mediator) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<WellDto>>> List(
        [FromQuery] string? cluster,
        [FromQuery] string? status,
        [FromQuery(Name = "q")] string? search,
        CancellationToken ct)
        => Ok(await mediator.Send(new ListWellsQuery(cluster, status, search), ct));

    [HttpGet("{wellId}")]
    public async Task<ActionResult<WellDto>> Get(string wellId, CancellationToken ct)
    {
        var result = await mediator.Send(new GetWellQuery(wellId), ct);
        return result is null ? NotFound() : Ok(result);
    }

    [HttpGet("{wellId}/report-data"), AllowAnonymous]
    public async Task<ActionResult<WellReportDataDto>> GetReportData(string wellId, CancellationToken ct)
        => Ok(await mediator.Send(new GetWellReportDataQuery(wellId), ct));

    [HttpPost, Authorize(Policy = "Manager")]
    public async Task<ActionResult<WellDto>> Create(
        [FromBody] WellCreateRequest request, CancellationToken ct)
    {
        var result = await mediator.Send(new CreateWellCommand(request), ct);
        if (result.IsConflict)    return Conflict(result.ErrorMessage);
        return CreatedAtAction(nameof(Get), new { wellId = result.Value!.WellId }, result.Value);
    }

    [HttpPatch("{wellId}"), Authorize(Policy = "Manager")]
    public async Task<ActionResult<WellDto>> Update(
        string wellId, [FromBody] WellUpdateRequest request, CancellationToken ct)
    {
        var result = await mediator.Send(new UpdateWellCommand(wellId, request), ct);
        if (result.IsNotFound) return NotFound();
        return Ok(result.Value);
    }

    [HttpDelete("{wellId}"), Authorize(Policy = "Admin")]
    public async Task<IActionResult> Delete(string wellId, CancellationToken ct)
    {
        var result = await mediator.Send(new DeleteWellCommand(wellId), ct);
        return result.IsNotFound ? NotFound() : NoContent();
    }

    [HttpGet("{wellId}/progress/weekly"), AllowAnonymous]
    public async Task<ActionResult<WeeklyProgressTimelineResponse>> GetWeeklyProgress(
        string wellId,
        [FromQuery] string projectId,
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        [FromQuery] TimelineViewType viewType = TimelineViewType.Week,
        CancellationToken ct = default)
        => Ok(await mediator.Send(
            new GetWeeklyProgressQuery(projectId, wellId, from, to, viewType), ct));
}

[ApiController]
[Authorize]
[Route("milestones")]
public sealed class MilestonesController(IMediator mediator) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<MilestoneDto>>> List(
        [FromQuery] string? wellId, [FromQuery] string? status, CancellationToken ct)
        => Ok(await mediator.Send(new ListMilestonesQuery(wellId, status), ct));
}

[ApiController]
[Authorize]
[Route("watchlist")]
public sealed class WatchlistController(IMediator mediator) : ControllerBase
{
    private int? CurrentUserId =>
        int.TryParse(
            User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value
                ?? User.FindFirst("sub")?.Value,
            out var id) ? id : null;

    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<WatchlistEntryDto>>> List(CancellationToken ct)
    {
        var userId = CurrentUserId;
        if (userId is null) return Unauthorized();
        return Ok(await mediator.Send(new ListWatchlistQuery(userId.Value), ct));
    }

    [HttpPost]
    public async Task<ActionResult<WatchlistEntryDto>> Add(
        [FromBody] WatchlistAddRequest request, CancellationToken ct)
    {
        var userId = CurrentUserId;
        if (userId is null) return Unauthorized();

        var result = await mediator.Send(new AddWatchlistCommand(userId.Value, request), ct);
        if (result.IsConflict) return Conflict(result.ErrorMessage);
        return Created($"watchlist/{result.Value!.WellId}", result.Value);
    }

    [HttpDelete("{wellId}")]
    public async Task<IActionResult> Remove(string wellId, CancellationToken ct)
    {
        var userId = CurrentUserId;
        if (userId is null) return Unauthorized();

        var result = await mediator.Send(new RemoveWatchlistCommand(userId.Value, wellId), ct);
        return result.IsNotFound ? NotFound() : NoContent();
    }
}

[ApiController]
[Authorize]
[Route("critical-dates")]
public sealed class CriticalDatesController(IMediator mediator) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<CriticalDateDto>>> List(
        [FromQuery] string? wellId, CancellationToken ct)
        => Ok(await mediator.Send(new ListCriticalDatesQuery(wellId), ct));

    [HttpPost, Authorize(Policy = "Manager")]
    public async Task<ActionResult<CriticalDateDto>> Create(
        [FromBody] CriticalDateCreateRequest request, CancellationToken ct)
    {
        var result = await mediator.Send(new CreateCriticalDateCommand(request), ct);
        return Created($"critical-dates/{result.Value!.WellId}", result.Value);
    }
}
