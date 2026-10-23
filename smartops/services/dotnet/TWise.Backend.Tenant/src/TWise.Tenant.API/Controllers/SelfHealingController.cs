using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TWise.Tenant.API.Auth;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Application.Features.SelfHealing;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.API.Controllers;

/// <summary>Data Quality → Self-Healing AI: the scan of chart and view loads and of data loads.</summary>
[ApiController]
[Authorize]
[Route("api/self-healing")]
public sealed class SelfHealingController(ISender sender) : ControllerBase
{
    private const string Module = "data-quality.self-healing";

    /// <summary>Run totals, failing and slow views, failed or stale data loads and the failed or slow runs of the last
    /// <paramref name="days"/> days (one of SelfHealing:Days; omitted: the first). 400 for any other period.</summary>
    [HttpGet("overview")]
    [RequireModulePermission(Module, ModulePermission.View)]
    [ProducesResponseType(typeof(SelfHealingOverviewDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> Overview([FromQuery] int? days, CancellationToken ct)
    {
        if (!long.TryParse(User.FindFirst("tenantId")?.Value, out var tenantId) || tenantId <= 0) return Unauthorized();
        return Ok(await sender.Send(new GetSelfHealingOverviewQuery(tenantId, days), ct));
    }
}
