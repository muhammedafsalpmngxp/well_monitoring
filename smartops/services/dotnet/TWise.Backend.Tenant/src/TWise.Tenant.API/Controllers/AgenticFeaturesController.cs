using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TWise.Tenant.API.Auth;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Application.Features.Ai.AgenticFeatures;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.API.Controllers;

/// <summary>
/// What every Agentic Feature controller shares: the caller's identity and one mapping of failures to responses.
/// The agent runtime's refusals keep its status and message (400 bad input or a table the feature may not read, 404 not
/// found, 409 busy, 503 database or AI provider unavailable, 504 stopped responding); AI that is off or out of quota is
/// 400 with the reason; an unreachable runtime is 502 (its details go to the log, not to the user).
/// </summary>
public abstract class AgenticFeatureControllerBase(ILogger logger) : ControllerBase
{
    protected async Task<IActionResult> FeatureAsync(Func<long, Task<IActionResult>> action)
    {
        if (!TryGetTenantId(out var tenantId)) return Unauthorized();
        try { return await action(tenantId); }
        catch (AgentRuntimeException ex) { return StatusCode(ex.Status, new { message = ex.Message }); }
        catch (FeatureConflictException ex) { return Conflict(new { message = ex.Message }); }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
        catch (HttpRequestException ex)
        {
            logger.LogWarning(ex, "Agentic Feature call failed: the agent runtime is not reachable.");
            return StatusCode(StatusCodes.Status502BadGateway, new { message = "The agent service is not reachable. Try again in a moment." });
        }
    }

    protected string UserId() =>
        User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? "";

    /// <summary>Who to show as having done something: the e-mail from the token, else the user id.</summary>
    protected string UserName() =>
        User.FindFirst(JwtRegisteredClaimNames.Email)?.Value ?? User.FindFirst(ClaimTypes.Email)?.Value
        ?? User.FindFirst("email")?.Value ?? UserId();

    protected bool TryGetTenantId(out long tenantId)
    {
        tenantId = 0;
        return long.TryParse(User.FindFirst("tenantId")?.Value, out tenantId) && tenantId > 0;
    }
}

/// <summary>Agentic AI → Agentic Features: the landing page and what all features share.</summary>
[ApiController]
[Authorize]
[Route("api/agentic-features")]
public sealed class AgenticFeaturesController(ISender sender, IAiFeatureQueryStore queries, ILogger<AgenticFeaturesController> logger)
    : AgenticFeatureControllerBase(logger)
{
    /// <summary>The features the caller may open (View on the feature's module), whether AI is on and whether an admin
    /// has chosen the tables each may read.</summary>
    [HttpGet]
    [RequireModulePermission(AgenticFeatureCatalog.LandingModule, ModulePermission.View)]
    [ProducesResponseType(typeof(IReadOnlyList<AgenticFeatureSummaryDto>), StatusCodes.Status200OK)]
    public Task<IActionResult> List(CancellationToken ct) => FeatureAsync(async t =>
        Ok((await sender.Send(new ListAgenticFeaturesQuery(t), ct)).Where(f => ModulePermission.Has(User, f.ModuleCode, ModulePermission.View))));

    /// <summary>A verified-SQL feature's queries (read-only), to show what it reads.</summary>
    [HttpGet("{feature}/queries")]
    [ProducesResponseType(typeof(IReadOnlyList<AgenticFeatureQueryDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public Task<IActionResult> Queries(string feature, CancellationToken ct) => FeatureAsync(async t =>
    {
        if (!AgenticFeatureCatalog.IsKnown(feature)) return NotFound();
        if (!ModulePermission.Has(User, AgenticFeatureCatalog.ModuleCode(feature), ModulePermission.View)) return Forbid();
        return Ok(await queries.ListAsync(t, feature, ct));
    });
}

/// <summary>
/// Agentic Features → Slippage: wells that missed contractual milestones, their late tasks and crews (verified SQL,
/// no AI), and the advisor that explains a well's or a task's delay and how to recover (AI).
/// </summary>
[ApiController]
[Authorize]
[Route("api/agentic-features/slippage")]
public sealed class SlippageController(IAgenticFeatureGateway gateway, ILogger<SlippageController> logger)
    : AgenticFeatureControllerBase(logger)
{
    private const string Module = "agentic-ai.slippage";
    private const string Feature = AgenticFeatureCatalog.Slippage;

    /// <summary>One verified query: { key, columns, rows, truncated }. activity_delay needs wellId.</summary>
    [HttpPost("query")]
    [RequireModulePermission(Module, ModulePermission.View)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public Task<IActionResult> Query([FromBody] SlippageQueryRequest request, CancellationToken ct) => FeatureAsync(async t =>
        Ok(await gateway.CallAsync(t, UserId(), Feature, "query", new { key = request.Key ?? "", wellId = request.WellId }, needsAi: false, ct)));

    /// <summary>Why this well is delayed and how to overcome it (calls the AI unless an answer on the same data exists).</summary>
    [HttpPost("advise-well")]
    [RequireModulePermission(Module, ModulePermission.View)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public Task<IActionResult> AdviseWell([FromBody] SlippageAdviseRequest request, CancellationToken ct) => FeatureAsync(async t =>
        Ok(await gateway.CallAsync(t, UserId(), Feature, "advise-well", new { wellId = request.WellId, fresh = request.Fresh }, needsAi: true, ct)));

    /// <summary>How to recover one late task, and whether another delay holds it up. 404 when it is not one of the
    /// well's current tasks.</summary>
    [HttpPost("advise-task")]
    [RequireModulePermission(Module, ModulePermission.View)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public Task<IActionResult> AdviseTask([FromBody] SlippageAdviseRequest request, CancellationToken ct) => FeatureAsync(async t =>
        Ok(await gateway.CallAsync(t, UserId(), Feature, "advise-task",
            new { wellId = request.WellId, taskCode = request.TaskCode, fresh = request.Fresh }, needsAi: true, ct)));
}

/// <summary>
/// Agentic Features → Daily Report: the daily operations brief of a report date from the verified SQL (no AI), the
/// upcoming deadlines, an Excel export, and the AI briefs (day / well / task) and questions, checked number by number.
/// </summary>
[ApiController]
[Authorize]
[Route("api/agentic-features/daily-report")]
public sealed class DailyReportController(IAgenticFeatureGateway gateway, ILogger<DailyReportController> logger)
    : AgenticFeatureControllerBase(logger)
{
    private const string Module = "agentic-ai.daily-report";
    private const string Feature = AgenticFeatureCatalog.DailyReport;

    /// <summary>Recent report dates that have entries (for the date picker).</summary>
    [HttpGet("dates")]
    [RequireModulePermission(Module, ModulePermission.View)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public Task<IActionResult> Dates([FromQuery] int? limit, CancellationToken ct) => FeatureAsync(async t =>
        Ok(await gateway.CallAsync(t, UserId(), Feature, "dates", new { limit }, needsAi: false, ct)));

    /// <summary>The day's counters and the summary grouped by status → WBS → activity (task cards when the day is small).</summary>
    [HttpPost("summary")]
    [RequireModulePermission(Module, ModulePermission.View)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public Task<IActionResult> Summary([FromBody] DailyReportDayRequest request, CancellationToken ct) => FeatureAsync(async t =>
        Ok(await gateway.CallAsync(t, UserId(), Feature, "summary",
            new { reportDate = Date(request.ReportDate), refresh = request.Refresh }, needsAi: false, ct)));

    /// <summary>The wells and tasks behind one summary figure (status / WBS / activity / unit filters).</summary>
    [HttpPost("group-details")]
    [RequireModulePermission(Module, ModulePermission.View)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public Task<IActionResult> GroupDetails([FromBody] DailyReportDayRequest request, CancellationToken ct) => FeatureAsync(async t =>
        Ok(await gateway.CallAsync(t, UserId(), Feature, "group-details", new
        {
            reportDate = Date(request.ReportDate), refresh = request.Refresh, status = request.Status, wbs = request.Wbs,
            activityCode = request.ActivityCode, uom = request.Uom,
        }, needsAi: false, ct)));

    /// <summary>Task activity per live well as of the date; with WellId, that well and its incomplete tasks.</summary>
    [HttpPost("well-activity")]
    [RequireModulePermission(Module, ModulePermission.View)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public Task<IActionResult> WellActivity([FromBody] DailyReportDayRequest request, CancellationToken ct) => FeatureAsync(async t =>
        Ok(await gateway.CallAsync(t, UserId(), Feature, "well-activity",
            new { reportDate = Date(request.ReportDate), refresh = request.Refresh, wellId = request.WellId }, needsAi: false, ct)));

    /// <summary>One well's tasks on the date (or its open work when it has no entry that day). 404 when unknown.</summary>
    [HttpPost("well")]
    [RequireModulePermission(Module, ModulePermission.View)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public Task<IActionResult> Well([FromBody] DailyReportDayRequest request, CancellationToken ct) => FeatureAsync(async t =>
    {
        if (request.WellId is null) throw new InvalidOperationException("Choose a well.");
        return Ok(await gateway.CallAsync(t, UserId(), Feature, "well",
            new { reportDate = Date(request.ReportDate), wellId = request.WellId }, needsAi: false, ct));
    });

    /// <summary>Lifecycle deadlines coming up (and overdue) for live wells.</summary>
    [HttpPost("milestones")]
    [RequireModulePermission(Module, ModulePermission.View)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public Task<IActionResult> Milestones([FromBody] DailyReportMilestonesRequest request, CancellationToken ct) => FeatureAsync(async t =>
        Ok(await gateway.CallAsync(t, UserId(), Feature, "milestones",
            new { windowDays = request.WindowDays, today = Today(request.Today) }, needsAi: false, ct)));

    /// <summary>The date's records as an Excel workbook.</summary>
    [HttpPost("export")]
    [RequireModulePermission(Module, ModulePermission.View)]
    [ProducesResponseType(typeof(FileContentResult), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public Task<IActionResult> Export([FromBody] DailyReportDayRequest request, CancellationToken ct) => FeatureAsync(async t =>
    {
        var file = await gateway.FileAsync(t, Feature, "export", new { reportDate = Date(request.ReportDate) }, ct);
        return File(file.Body, file.ContentType, file.FileName);
    });

    /// <summary>The AI brief of the day, a well or a task (calls the AI unless an answer on the same data exists).</summary>
    [HttpPost("brief")]
    [RequireModulePermission(Module, ModulePermission.View)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public Task<IActionResult> Brief([FromBody] DailyReportBriefRequest request, CancellationToken ct) => FeatureAsync(async t =>
        Ok(await gateway.CallAsync(t, UserId(), Feature, "agent/brief", new
        {
            reportDate = Date(request.ReportDate), scope = request.Scope ?? "day", wellId = request.WellId,
            taskDailyId = request.TaskDailyId, today = Today(request.Today),
        }, needsAi: true, ct)));

    /// <summary>Ask the agent a question about the report date.</summary>
    [HttpPost("ask")]
    [RequireModulePermission(Module, ModulePermission.View)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public Task<IActionResult> Ask([FromBody] DailyReportAskRequest request, CancellationToken ct) => FeatureAsync(async t =>
    {
        if (string.IsNullOrWhiteSpace(request.Question)) throw new InvalidOperationException("Type a question.");
        return Ok(await gateway.CallAsync(t, UserId(), Feature, "agent/ask",
            new { reportDate = Date(request.ReportDate), question = request.Question.Trim(), today = Today(request.Today) }, needsAi: true, ct));
    });

    private static string Date(DateOnly? date) =>
        (date ?? throw new InvalidOperationException("Choose a report date.")).ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);

    /// <summary>The user's date (sent by the page, which knows the user's time zone), else the server's UTC date.</summary>
    private static string Today(DateOnly? today) =>
        (today ?? DateOnly.FromDateTime(DateTime.UtcNow)).ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);
}

/// <summary>
/// Agentic Features → Data Anomaly: rules written in plain English, compiled by the AI into checked SQL, run against the
/// schemas an admin allowed, scored, with Excel / Word reports; Discover proposes new rules for an admin to accept or
/// reject. Compile, run and discover are jobs (core.AiFeatureJob) the background worker runs; the page polls them.
/// View reads everything; Create starts a run; Modify changes rules, decides proposals and starts compile / discover.
/// </summary>
[ApiController]
[Authorize]
[Route("api/agentic-features/data-anomaly")]
public sealed class DataAnomalyController(IDataAnomalyService anomaly, IAgenticFeatureGateway gateway, ILogger<DataAnomalyController> logger)
    : AgenticFeatureControllerBase(logger)
{
    private const string Module = "agentic-ai.data-anomaly";

    [HttpGet("overview")]
    [RequireModulePermission(Module, ModulePermission.View)]
    [ProducesResponseType(typeof(AnomalyOverviewDto), StatusCodes.Status200OK)]
    public Task<IActionResult> Overview(CancellationToken ct) => FeatureAsync(async t => Ok(await anomaly.OverviewAsync(t, ct)));

    /// <summary>What the feature may read in the database: tables, columns, the schema fingerprint.</summary>
    [HttpGet("schema")]
    [RequireModulePermission(Module, ModulePermission.View)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public Task<IActionResult> Schema([FromQuery] bool refresh = false, CancellationToken ct = default) => FeatureAsync(async t =>
        Ok(await gateway.CallAsync(t, UserId(), AgenticFeatureCatalog.Anomaly, "introspect", new { refresh }, needsAi: false, ct)));

    [HttpGet("rules")]
    [RequireModulePermission(Module, ModulePermission.View)]
    [ProducesResponseType(typeof(IReadOnlyList<AnomalyRuleDto>), StatusCodes.Status200OK)]
    public Task<IActionResult> Rules(CancellationToken ct) => FeatureAsync(async t => Ok(await anomaly.RulesAsync(t, ct)));

    /// <summary>active (runs and scores), probation (runs, reported apart), draft or disabled (do not run).</summary>
    [HttpPut("rules/{ruleId}/status")]
    [RequireModulePermission(Module, ModulePermission.Modify)]
    [ProducesResponseType(typeof(AnomalyRuleDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public Task<IActionResult> SetRuleStatus(string ruleId, [FromBody] SetAnomalyRuleStatusRequest request, CancellationToken ct) =>
        FeatureAsync(async t => Ok(await anomaly.SetRuleStatusAsync(t, ruleId, request.Status, UserName(), ct)));

    [HttpGet("runs")]
    [RequireModulePermission(Module, ModulePermission.View)]
    [ProducesResponseType(typeof(IReadOnlyList<AnomalyRunSummaryDto>), StatusCodes.Status200OK)]
    public Task<IActionResult> Runs([FromQuery] int take = 30, CancellationToken ct = default) =>
        FeatureAsync(async t => Ok(await anomaly.RunsAsync(t, take, ct)));

    [HttpGet("runs/{runId}")]
    [RequireModulePermission(Module, ModulePermission.View)]
    [ProducesResponseType(typeof(AnomalyRunDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public Task<IActionResult> Run(string runId, CancellationToken ct) => FeatureAsync(async t => Ok(await anomaly.RunAsync(t, runId, ct)));

    /// <summary>The run's Excel (xlsx) or Word (docx) report.</summary>
    [HttpGet("runs/{runId}/reports/{format}")]
    [RequireModulePermission(Module, ModulePermission.View)]
    [ProducesResponseType(typeof(FileContentResult), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public Task<IActionResult> Report(string runId, string format, CancellationToken ct) => FeatureAsync(async t =>
    {
        var file = await anomaly.ReportAsync(t, runId, format, ct);
        return File(file.Body, file.ContentType, file.FileName);
    });

    [HttpGet("proposals")]
    [RequireModulePermission(Module, ModulePermission.View)]
    [ProducesResponseType(typeof(IReadOnlyList<AnomalyProposalDto>), StatusCodes.Status200OK)]
    public Task<IActionResult> Proposals([FromQuery] string? status, CancellationToken ct) =>
        FeatureAsync(async t => Ok(await anomaly.ProposalsAsync(t, status, ct)));

    [HttpPost("proposals/{id:long}/accept")]
    [RequireModulePermission(Module, ModulePermission.Modify)]
    [ProducesResponseType(typeof(AnomalyProposalDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public Task<IActionResult> Accept(long id, [FromBody] DecideAnomalyProposalRequest? request, CancellationToken ct) =>
        FeatureAsync(async t => Ok(await anomaly.AcceptProposalAsync(t, id, request ?? new(null, null, null), UserName(), ct)));

    [HttpPost("proposals/{id:long}/reject")]
    [RequireModulePermission(Module, ModulePermission.Modify)]
    [ProducesResponseType(typeof(AnomalyProposalDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public Task<IActionResult> Reject(long id, [FromBody] DecideAnomalyProposalRequest? request, CancellationToken ct) =>
        FeatureAsync(async t => Ok(await anomaly.RejectProposalAsync(t, id, request ?? new(null, null, null), UserName(), ct)));

    /// <summary>Queues a compile, run or discover (202). 409 while another Data Anomaly job is queued or running.</summary>
    [HttpPost("jobs")]
    [RequireModulePermission(Module, ModulePermission.Create, ModulePermission.Modify)]
    [ProducesResponseType(typeof(AiFeatureJobDto), StatusCodes.Status202Accepted)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public Task<IActionResult> StartJob([FromBody] StartAnomalyJobRequest request, CancellationToken ct) => FeatureAsync(async t =>
    {
        // A run only reads; compile and discover change the checks or the rules and spend AI calls.
        var needed = string.Equals(request.Kind?.Trim(), "run", StringComparison.OrdinalIgnoreCase) ? ModulePermission.Create : ModulePermission.Modify;
        if (!ModulePermission.Has(User, Module, needed)) return Forbid();
        var job = await anomaly.StartJobAsync(t, request, UserName(), ct);
        return Accepted($"api/agentic-features/data-anomaly/jobs/{job.Id}", job);
    });

    [HttpGet("jobs")]
    [RequireModulePermission(Module, ModulePermission.View)]
    [ProducesResponseType(typeof(IReadOnlyList<AiFeatureJobDto>), StatusCodes.Status200OK)]
    public Task<IActionResult> Jobs([FromQuery] int take = 20, CancellationToken ct = default) =>
        FeatureAsync(async t => Ok(await anomaly.JobsAsync(t, take, ct)));

    [HttpGet("jobs/{id:long}")]
    [RequireModulePermission(Module, ModulePermission.View)]
    [ProducesResponseType(typeof(AiFeatureJobDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public Task<IActionResult> Job(long id, CancellationToken ct) => FeatureAsync(async t => Ok(await anomaly.JobAsync(t, id, ct)));

    [HttpPost("jobs/{id:long}/cancel")]
    [RequireModulePermission(Module, ModulePermission.Create, ModulePermission.Modify)]
    [ProducesResponseType(typeof(AiFeatureJobDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public Task<IActionResult> CancelJob(long id, CancellationToken ct) =>
        FeatureAsync(async t => Ok(await anomaly.CancelJobAsync(t, id, UserName(), ct)));
}
