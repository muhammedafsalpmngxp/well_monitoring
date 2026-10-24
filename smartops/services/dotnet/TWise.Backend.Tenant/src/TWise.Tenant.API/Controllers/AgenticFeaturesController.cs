using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text.Json;
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
        catch (Exception ex) when (Failure(ex) is { } f) { return StatusCode(f.Status, new { message = f.Message }); }
    }

    /// <summary>The status and safe message of a failure this mapping knows; null for anything else (a real error).</summary>
    protected (int Status, string Message)? Failure(Exception ex)
    {
        switch (ex)
        {
            case AgentRuntimeException e: return (e.Status, e.Message);
            case FeatureConflictException e: return (StatusCodes.Status409Conflict, e.Message);
            case KeyNotFoundException e: return (StatusCodes.Status404NotFound, e.Message);
            case InvalidOperationException e: return (StatusCodes.Status400BadRequest, e.Message);
            case HttpRequestException e:
                logger.LogWarning(e, "Agentic Feature call failed: the agent runtime is not reachable.");
                return (StatusCodes.Status502BadGateway, "The agent service is not reachable. Try again in a moment.");
            default: return null;
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
public sealed class DailyReportController(IAgenticFeatureGateway gateway, IDailyReportAgent agent, IAiFeatureAnswerStore answers,
    ILogger<DailyReportController> logger)
    : AgenticFeatureControllerBase(logger)
{
    private static readonly JsonSerializerOptions SseJson = new(JsonSerializerDefaults.Web);

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
        Ok(await agent.BriefAsync(t, UserId(), BriefOf(request), ct)));

    /// <summary>The day brief saved for the date (prepared in the background or asked before), for the page to show the
    /// moment "Brief the day" is clicked while brief/stream checks it against the data. 204 when there is none.</summary>
    [HttpGet("brief/saved")]
    [RequireModulePermission(Module, ModulePermission.View)]
    [ProducesResponseType(typeof(SavedAiAnswerDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public Task<IActionResult> SavedBrief([FromQuery] string? reportDate, CancellationToken ct) => FeatureAsync(async t =>
    {
        if (!DateOnly.TryParseExact(reportDate, "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.None, out var day))
            throw new InvalidOperationException("Choose a report date.");
        var saved = await answers.LatestAsync(t, Feature, day, "brief", "day", ct);
        return saved is null ? NoContent() : Ok(saved);
    });

    /// <summary>The same brief as server-sent events: stage {stage} (data | writing | checking | revising | reused) and
    /// delta {text, replace?} while it is written (restart when a draft the checker rejected is written again), then one
    /// result {the brief, as POST brief returns it} or error {message, status}. A refusal before it starts (AI off, bad
    /// input) is an ordinary JSON error with its status.</summary>
    [HttpPost("brief/stream")]
    [RequireModulePermission(Module, ModulePermission.View)]
    [Produces("text/event-stream")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task BriefStream([FromBody] DailyReportBriefRequest request, CancellationToken ct)
    {
        if (!TryGetTenantId(out var tenantId)) { Response.StatusCode = StatusCodes.Status401Unauthorized; return; }
        IAsyncEnumerator<AgentRuntimeEvent>? events = null;
        var started = false;
        try
        {
            events = agent.BriefStreamAsync(tenantId, UserId(), BriefOf(request), ct).GetAsyncEnumerator(ct);
            var more = await events.MoveNextAsync();     // the AI provider, the saved answers and the runtime's own checks
            Response.ContentType = "text/event-stream";
            Response.Headers.CacheControl = "no-cache";
            Response.Headers["X-Accel-Buffering"] = "no";
            started = true;
            for (; more; more = await events.MoveNextAsync())
                await WriteEventAsync(events.Current.Type, events.Current.Data, ct);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { }   // the page was closed
        catch (Exception ex) when (Failure(ex) is { } f)
        {
            if (!started)
            {
                Response.StatusCode = f.Status;
                await Response.WriteAsJsonAsync(new { message = f.Message }, ct);
            }
            else await WriteEventAsync("error", JsonSerializer.SerializeToElement(new { message = f.Message, status = f.Status }, SseJson), ct);
        }
        finally
        {
            if (events is not null) await events.DisposeAsync();
        }
    }

    private async Task WriteEventAsync(string type, JsonElement data, CancellationToken ct)
    {
        await Response.WriteAsync($"event: {type}\ndata: {data.GetRawText()}\n\n", ct);
        await Response.Body.FlushAsync(ct);
    }

    /// <summary>Ask the agent a question about the report date.</summary>
    [HttpPost("ask")]
    [RequireModulePermission(Module, ModulePermission.View)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public Task<IActionResult> Ask([FromBody] DailyReportAskRequest request, CancellationToken ct) => FeatureAsync(async t =>
    {
        if (string.IsNullOrWhiteSpace(request.Question)) throw new InvalidOperationException("Type a question.");
        return Ok(await agent.AskAsync(t, UserId(), ReportDate(request.ReportDate), request.Question.Trim(), TodayOf(request.Today), ct));
    });

    private static DailyBrief BriefOf(DailyReportBriefRequest r) =>
        new(ReportDate(r.ReportDate), r.Scope ?? "day", r.WellId, r.TaskDailyId, TodayOf(r.Today));

    private static DateOnly ReportDate(DateOnly? date) => date ?? throw new InvalidOperationException("Choose a report date.");

    private static string Date(DateOnly? date) =>
        ReportDate(date).ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);

    /// <summary>The user's date (sent by the page, which knows the user's time zone), else the server's UTC date.</summary>
    private static DateOnly TodayOf(DateOnly? today) => today ?? DateOnly.FromDateTime(DateTime.UtcNow);

    private static string Today(DateOnly? today) =>
        TodayOf(today).ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);
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

    /// <summary>The compiled checks of a rule, or of one family member, with their SQL (read-only).</summary>
    [HttpGet("checks/{id}")]
    [RequireModulePermission(Module, ModulePermission.View)]
    [ProducesResponseType(typeof(IReadOnlyList<AnomalyCheckDto>), StatusCodes.Status200OK)]
    public Task<IActionResult> Checks(string id, CancellationToken ct) => FeatureAsync(async t => Ok(await anomaly.ChecksAsync(t, id, ct)));

    /// <summary>active (runs and scores), probation (runs, reported apart), draft or disabled (do not run).</summary>
    [HttpPut("rules/{ruleId}/status")]
    [RequireModulePermission(Module, ModulePermission.Modify)]
    [ProducesResponseType(typeof(AnomalyRuleDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public Task<IActionResult> SetRuleStatus(string ruleId, [FromBody] SetAnomalyRuleStatusRequest request, CancellationToken ct) =>
        FeatureAsync(async t => Ok(await anomaly.SetRuleStatusAsync(t, ruleId, request.Status, UserName(), ct)));

    /// <summary>Adds a rule (it runs once compiled).</summary>
    [HttpPost("rules")]
    [RequireModulePermission(Module, ModulePermission.Modify)]
    [ProducesResponseType(typeof(AnomalyRuleDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public Task<IActionResult> CreateRule([FromBody] SaveAnomalyRuleRequest request, CancellationToken ct) =>
        FeatureAsync(async t => Ok(await anomaly.CreateRuleAsync(t, request, UserName(), ct)));

    /// <summary>Edits a rule's definition (compile the rule to use the change).</summary>
    [HttpPut("rules/{ruleId}")]
    [RequireModulePermission(Module, ModulePermission.Modify)]
    [ProducesResponseType(typeof(AnomalyRuleDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public Task<IActionResult> UpdateRule(string ruleId, [FromBody] SaveAnomalyRuleRequest request, CancellationToken ct) =>
        FeatureAsync(async t => Ok(await anomaly.UpdateRuleAsync(t, ruleId, request, UserName(), ct)));

    /// <summary>A default rule back to its default text.</summary>
    [HttpPost("rules/{ruleId}/reset")]
    [RequireModulePermission(Module, ModulePermission.Modify)]
    [ProducesResponseType(typeof(AnomalyRuleDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public Task<IActionResult> ResetRule(string ruleId, CancellationToken ct) =>
        FeatureAsync(async t => Ok(await anomaly.ResetRuleAsync(t, ruleId, UserName(), ct)));

    /// <summary>Deletes a rule added here (default rules can only be disabled).</summary>
    [HttpDelete("rules/{ruleId}")]
    [RequireModulePermission(Module, ModulePermission.Modify)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public Task<IActionResult> DeleteRule(string ruleId, CancellationToken ct) =>
        FeatureAsync(async t =>
        {
            await anomaly.DeleteRuleAsync(t, ruleId, ct);
            return NoContent();
        });

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
        FeatureAsync(async t =>
        {
            // Whoever may start a run may cancel a run; a compile or discover is cancelled only by those who may start it.
            var job = await anomaly.JobAsync(t, id, ct);
            if (job.Kind != "run" && !ModulePermission.Has(User, Module, ModulePermission.Modify))
                return StatusCode(StatusCodes.Status403Forbidden,
                    new { message = $"Only someone who may change Data Anomaly rules can cancel a {job.Kind}." });
            return Ok(await anomaly.CancelJobAsync(t, id, UserName(), ct));
        });
}

/// <summary>
/// Agentic Features → Crew Management: every crew's availability and team, crew capacity against the delayed work each
/// crew type is needed for, and per live well the crew on each delayed activity with the free crews to approach (all
/// from the verified SQL, no AI), plus an AI brief that narrates a well's crew plan. Advisory only: nothing is assigned.
/// </summary>
[ApiController]
[Authorize]
[Route("api/agentic-features/crew-management")]
public sealed class CrewManagementController(IAgenticFeatureGateway gateway, ILogger<CrewManagementController> logger)
    : AgenticFeatureControllerBase(logger)
{
    private const string Module = "agentic-ai.crew-management";
    private const string Feature = AgenticFeatureCatalog.Crew;

    /// <summary>Every crew and its availability, capacity vs delayed work per crew type, and the wells needing crews.</summary>
    [HttpPost("overview")]
    [RequireModulePermission(Module, ModulePermission.View)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public Task<IActionResult> Overview([FromBody] CrewManagementRequest? request, CancellationToken ct) => FeatureAsync(async t =>
        Ok(await gateway.CallAsync(t, UserId(), Feature, "overview", new { fresh = request?.Fresh ?? false }, needsAi: false, ct)));

    /// <summary>One well's delayed activities, the crew on each and the free crews to approach. 404 for an unknown well.</summary>
    [HttpPost("well")]
    [RequireModulePermission(Module, ModulePermission.View)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public Task<IActionResult> Well([FromBody] CrewManagementRequest request, CancellationToken ct) => FeatureAsync(async t =>
        Ok(await gateway.CallAsync(t, UserId(), Feature, "well", new { wellId = request.WellId, fresh = request.Fresh }, needsAi: false, ct)));

    /// <summary>The well's crew plan with an AI brief (calls the AI; a provider failure comes back as briefError).</summary>
    [HttpPost("brief")]
    [RequireModulePermission(Module, ModulePermission.View)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public Task<IActionResult> Brief([FromBody] CrewManagementRequest request, CancellationToken ct) => FeatureAsync(async t =>
        Ok(await gateway.CallAsync(t, UserId(), Feature, "brief", new { wellId = request.WellId, fresh = request.Fresh }, needsAi: true, ct)));
}
