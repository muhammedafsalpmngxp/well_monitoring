using Microsoft.AspNetCore.Mvc;
using SmartOps.Dashboard.Domain.Dtos;
using SmartOps.Dashboard.Services;

namespace SmartOps.Dashboard.Controllers;

[ApiController]
[Route("api/dashboard")]
public class DashboardController(DashboardDataStore store, ActivitiesListService activitiesListSvc) : ControllerBase
{
    /// <summary>
    /// GET /api/dashboard/activities-progress
    /// Returns aggregated activity progress KPI data from in-memory store.
    /// Response time: &lt;5ms (data pre-loaded on startup).
    /// </summary>
    [HttpGet("activities-progress")]
    public IActionResult GetActivitiesProgress(
        [FromQuery] string odc = "all",
        [FromQuery] string? cluster = null,
        [FromQuery] string? projectId = null,
        [FromQuery] string? scheduleId = null,
        [FromQuery] string? wellId = null,
        [FromQuery] DateTime? startDate = null,
        [FromQuery] DateTime? endDate = null)
    {
        if (!store.IsReady)
            return StatusCode(503, new { error = "Service is loading data. Please retry in a moment.", lastRefresh = store.LastRefresh });

        var result = store.ComputeProgress(odc, cluster, projectId, scheduleId, wellId, startDate, endDate);

        var response = new ActivitiesProgressResponse(
            Data: result,
            Filters: new ActivitiesProgressFilters(odc, cluster, projectId, scheduleId, wellId, startDate, endDate)
        );

        return Ok(response);
    }

    /// <summary>
    /// GET /api/dashboard/activities-list
    /// Returns paginated activity rows from ActivityTaskPlan (NIMR &amp; MARMUL only).
    /// Supports cluster, wellId, and date range filtering.
    /// </summary>
    [HttpGet("activities-list")]
    public async Task<IActionResult> GetActivitiesList(
        [FromQuery] string? odc = null,
        [FromQuery] string? cluster = null,
        [FromQuery] string? wellId = null,
        [FromQuery] DateTime? startDate = null,
        [FromQuery] DateTime? endDate = null,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50,
        CancellationToken ct = default)
    {
        if (page < 1) page = 1;
        if (pageSize < 1) pageSize = 50;
        if (pageSize > 500) pageSize = 500;

        var result = await activitiesListSvc.GetActivitiesListAsync(
            odc, cluster, wellId, startDate, endDate, page, pageSize, ct);

        return Ok(result);
    }

    /// <summary>
    /// GET /api/dashboard/status
    /// Returns data freshness info.
    /// </summary>
    [HttpGet("status")]
    public IActionResult GetStatus()
    {
        return Ok(new
        {
            ready = store.IsReady,
            lastRefresh = store.LastRefresh,
            rowCount = store.Snapshot.Rows.Count
        });
    }
}
