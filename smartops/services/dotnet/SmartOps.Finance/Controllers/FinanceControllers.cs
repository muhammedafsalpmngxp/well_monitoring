using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SmartOps.Finance.Domain.Dtos;
using SmartOps.Finance.Services;

namespace SmartOps.Finance.Controllers;

[ApiController]
[Authorize]
[Route("jobcost")]
public sealed class JobCostController(IFinanceService svc) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<JobCostDto>>> List([FromQuery] string? wellId)
        => Ok(await svc.ListJobCostsAsync(wellId));

    [HttpGet("{wellId}")]
    public async Task<ActionResult<JobCostDto>> Get(string wellId)
        => (await svc.GetJobCostAsync(wellId)) is { } j ? Ok(j) : NotFound();

    [HttpPut, Authorize(Policy = "Manager")]
    public async Task<ActionResult<JobCostDto>> Upsert([FromBody] JobCostUpsertRequest request)
        => Ok(await svc.UpsertJobCostAsync(request));

    [HttpGet("summary")]
    public async Task<ActionResult<EvmSummaryDto>> Summary()
        => Ok(await svc.GetEvmSummaryAsync());
}

[ApiController]
[Authorize]
[Route("incentives")]
public sealed class IncentivesController(IFinanceService svc) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<IncentiveDto>>> List(
        [FromQuery] string? crewCode, [FromQuery] string? period, [FromQuery] string? status)
        => Ok(await svc.ListIncentivesAsync(crewCode, period, status));

    [HttpPost, Authorize(Policy = "Manager")]
    public async Task<ActionResult<IncentiveDto>> Create([FromBody] IncentiveCreateRequest request)
        => Created($"incentives/{request.CrewCode}", await svc.CreateIncentiveAsync(request));

    [HttpPatch("{id:int}/approve"), Authorize(Policy = "Manager")]
    public async Task<ActionResult<IncentiveDto>> Approve(int id)
    {
        var actor = User.Identity?.Name ?? User.FindFirst("email")?.Value ?? "unknown";
        var i = await svc.ApproveIncentiveAsync(id, actor);
        return i is null ? NotFound() : Ok(i);
    }
}

[ApiController]
[Authorize]
[Route("penalties")]
public sealed class PenaltiesController(IFinanceService svc) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<PenaltyDto>>> List(
        [FromQuery] string? wellId, [FromQuery] string? status)
        => Ok(await svc.ListPenaltiesAsync(wellId, status));

    [HttpPost, Authorize(Policy = "Manager")]
    public async Task<ActionResult<PenaltyDto>> Create([FromBody] PenaltyCreateRequest request)
        => Created($"penalties/{request.WellId}", await svc.CreatePenaltyAsync(request));
}

[ApiController]
[Authorize]
[Route("cmr")]
public sealed class CmrController(IFinanceService svc) : ControllerBase
{
    [HttpGet("export.xlsx"), Authorize(Policy = "Manager")]
    public async Task<IActionResult> ExportXlsx()
    {
        var bytes = await svc.ExportCmrAsync();
        return File(bytes,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            $"cmr-{DateTime.UtcNow:yyyyMMdd}.xlsx");
    }
}
