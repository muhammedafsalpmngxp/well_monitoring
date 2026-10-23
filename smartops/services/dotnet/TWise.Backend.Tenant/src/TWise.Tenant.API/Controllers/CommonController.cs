using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Features.Common;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.API.Controllers;

/// <summary>
/// Common lookup APIs shared across all features.
/// Provides reference data for dropdowns and form population.
/// </summary>
[ApiController]
[Authorize]
[Route("api/common")]
public class CommonController(ISender sender, IDashboardShareAccessService shareAccess) : ControllerBase
{
    /// <summary>
    /// List all tables and views in the core schema.
    /// Use SourceName + SourceType to populate the report source fields.
    /// </summary>
    [HttpGet("sources")]
    public async Task<IActionResult> GetSources(CancellationToken ct)
        => Ok(await sender.Send(new ListSourcesQuery(), ct));

    /// <summary>TEMPORARY: list all tables from AlTasnimBI database.</summary>
    [HttpGet("bi-sources")]
    public async Task<IActionResult> GetBISources(CancellationToken ct)
        => Ok(await sender.Send(new ListBISourcesQuery(), ct));

    /// <summary>Get the latest AlTasnimBI migration sync time in Oman (UTC+04:00).</summary>
    [HttpGet("sync-time")]
    [ProducesResponseType(typeof(SyncTimeResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<SyncTimeResponse>> GetSyncTime(CancellationToken ct)
    {
        var result = await sender.Send(new GetSyncTimeQuery(), ct);
        if (result is null)
            return Problem(
                statusCode: StatusCodes.Status404NotFound,
                title: "Sync time not found",
                detail: "No successful migration sync timestamp is available.");

        return Ok(result);
    }

    /// <summary>
    /// Get all rows and columns from a core schema table or view (max 500 rows).
    /// Used for live preview in the report builder, and by anonymous visitors of an
    /// externally shared dashboard (via shareDashboardId/shareToken) whose widgets use this source.
    /// </summary>
    [AllowAnonymous]
    [HttpGet("table-data")]
    public async Task<IActionResult> GetTableData(
        [FromQuery] string sourceName,
        [FromQuery] string sourceType,
        [FromQuery] int? shareDashboardId,
        [FromQuery] string? shareToken,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(sourceName) || string.IsNullOrWhiteSpace(sourceType))
            return BadRequest("sourceName and sourceType are required.");

        if (!sourceType.Equals("Table", StringComparison.OrdinalIgnoreCase) &&
            !sourceType.Equals("View", StringComparison.OrdinalIgnoreCase))
            return BadRequest("sourceType must be either 'Table' or 'View'.");

        if (User.Identity?.IsAuthenticated != true)
        {
            if (shareDashboardId is null || string.IsNullOrWhiteSpace(shareToken))
                return Unauthorized();
            var widget = await shareAccess.FindSharedTableWidgetAsync(shareDashboardId.Value, shareToken, sourceName, sourceType, ct);
            if (widget is null) return Forbid();
        }

        var result = await sender.Send(new GetTableDataQuery(sourceName, sourceType), ct);
        return result is null ? NotFound($"'{sourceName}' not found in any available schema.") : Ok(result);
    }

    /// <summary>
    /// Compute a single aggregate value (count / count distinct / sum / average / value) in SQL for a
    /// table or view source, so tiles on very large tables show the correct number instead of a
    /// browser-side count over the first 1000 rows.
    /// </summary>
    [AllowAnonymous]
    [HttpPost("aggregate")]
    public async Task<IActionResult> GetAggregate(
        [FromBody] AggregateRequestDto request,
        [FromQuery] int? shareDashboardId,
        [FromQuery] string? shareToken,
        CancellationToken ct)
    {
        if (request is null || string.IsNullOrWhiteSpace(request.SourceName) || string.IsNullOrWhiteSpace(request.SourceType))
            return BadRequest("sourceName and sourceType are required.");
        if (!request.SourceType.Equals("Table", StringComparison.OrdinalIgnoreCase) &&
            !request.SourceType.Equals("View", StringComparison.OrdinalIgnoreCase))
            return BadRequest("sourceType must be either 'Table' or 'View'.");

        // Anonymous visitors of an externally shared dashboard may aggregate only a source that one
        // of that dashboard's widgets actually uses (validated by token), same as table-data above.
        if (User.Identity?.IsAuthenticated != true)
        {
            if (shareDashboardId is null || string.IsNullOrWhiteSpace(shareToken))
                return Unauthorized();
            var widget = await shareAccess.FindSharedTableWidgetAsync(shareDashboardId.Value, shareToken, request.SourceName, request.SourceType, ct);
            if (widget is null) return Forbid();
        }

        try
        {
            var result = await sender.Send(new GetAggregateQuery(request), ct);
            return result is null ? NotFound($"'{request.SourceName}' not found or column invalid.") : Ok(result);
        }
        catch (Exception ex) when (request.Dax is not null && ex is ArgumentException or InvalidOperationException)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    [AllowAnonymous]
    [HttpPost("chart-data/filtered")]
    public async Task<IActionResult> GetFilteredChartData(
        [FromBody] ChartFilteredDataRequest request,
        [FromQuery] int? shareDashboardId, [FromQuery] string? shareToken, CancellationToken ct)
    {
        if (request is null || request.Filters is null) return BadRequest();
        if (User.Identity?.IsAuthenticated != true)
        {
            if (shareDashboardId is null || string.IsNullOrWhiteSpace(shareToken)) return Unauthorized();
            var widget = request.ViewId.HasValue
                ? await shareAccess.FindSharedViewWidgetAsync(shareDashboardId.Value, shareToken, request.ViewId.Value, ct)
                : await shareAccess.FindSharedTableWidgetAsync(shareDashboardId.Value, shareToken,
                    request.ChartSource, request.ChartSourceType, ct);
            if (widget is null) return Forbid();

            if (!request.ViewId.HasValue)
            {
                foreach (var source in request.Filters.Select(filter => filter.SourceTable)
                    .Where(source => !string.IsNullOrWhiteSpace(source)
                        && !source.Equals(request.ChartSource, StringComparison.OrdinalIgnoreCase))
                    .Distinct(StringComparer.OrdinalIgnoreCase))
                {
                    var filterWidget = await shareAccess.FindSharedTableWidgetAsync(shareDashboardId.Value,
                        shareToken, source, "Table", ct)
                        ?? await shareAccess.FindSharedTableWidgetAsync(shareDashboardId.Value,
                            shareToken, source, "View", ct);
                    if (filterWidget is null) return Forbid();
                }
            }
        }

        try
        {
            var result = await sender.Send(new GetFilteredChartDataQuery(request), ct);
            return result is null ? NotFound() : Ok(result);
        }
        catch (InvalidOperationException ex)
        {
            // A filter the user can correct (e.g. text typed into a numeric filter).
            return BadRequest(new { error = ex.Message });
        }
        catch (ArgumentException ex) when (request.Dax is not null)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    /// <summary>
    /// Operators, connectors, scopes and relative-date ranges the report filter builder can use.
    /// Served from the server so the UI cannot drift from what the query layer supports.
    /// </summary>
    [HttpGet("filters/options")]
    [ProducesResponseType(typeof(FilterOptionsResponse), StatusCodes.Status200OK)]
    public IActionResult GetFilterOptions() => Ok(FilterOptions.All);

    /// <summary>Reference data for the plant/cluster filter dropdowns. Also usable anonymously via
    /// shareDashboardId/shareToken when viewing an externally shared dashboard.</summary>
    [AllowAnonymous]
    [HttpGet("plant-filters")]
    public async Task<IActionResult> GetPlantFilters([FromQuery] int? shareDashboardId, [FromQuery] string? shareToken, CancellationToken ct)
    {
        if (User.Identity?.IsAuthenticated != true
            && (shareDashboardId is null || string.IsNullOrWhiteSpace(shareToken)
                || !await shareAccess.IsValidShareTokenAsync(shareDashboardId.Value, shareToken, ct)))
            return Unauthorized();

        return Ok(await sender.Send(new GetPlantFiltersQuery(), ct));
    }

    /// <summary>Reference data for the Advanced Filter panel. Also usable anonymously via
    /// shareDashboardId/shareToken when viewing an externally shared dashboard.</summary>
    [AllowAnonymous]
    [HttpGet("advanced-filters")]
    public async Task<IActionResult> GetAdvancedFilters([FromQuery] int? shareDashboardId, [FromQuery] string? shareToken, CancellationToken ct)
    {
        if (User.Identity?.IsAuthenticated != true
            && (shareDashboardId is null || string.IsNullOrWhiteSpace(shareToken)
                || !await shareAccess.IsValidShareTokenAsync(shareDashboardId.Value, shareToken, ct)))
            return Unauthorized();

        return Ok(await sender.Send(new GetAdvancedFilterDataQuery(), ct));
    }
}
