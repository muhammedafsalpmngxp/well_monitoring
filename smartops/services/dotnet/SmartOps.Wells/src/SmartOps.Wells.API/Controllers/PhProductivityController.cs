using MediatR;
using Microsoft.AspNetCore.Mvc;
using SmartOps.Wells.Application.Features.PhProductivity;
using SmartOps.Wells.Contracts;

namespace SmartOps.Wells.API.Controllers;

[ApiController]
[Route("ph-productivity")]
public sealed class PhProductivityController(IMediator mediator) : ControllerBase
{
    /// <summary>
    /// GET /ph-productivity/report?from=2026-01-01&amp;to=2026-04-01&amp;category=nimr
    /// Returns the full PH Productivity Weekly Report computed live from source tables.
    /// </summary>
    [HttpGet("report")]
    public async Task<ActionResult<PhProductivityReportResponse>> GetReport(
        [FromQuery] string? from = null,
        [FromQuery] string? to = null,
        [FromQuery] string? category = null,
        CancellationToken ct = default)
    {
        var toDate = to ?? DateTime.UtcNow.ToString("yyyy-MM-dd");
        var fromDate = from ?? DateTime.UtcNow.AddMonths(-3).ToString("yyyy-MM-01");

        return Ok(await mediator.Send(
            new GetPhProductivityReportQuery(fromDate, toDate, category), ct));
    }
}
