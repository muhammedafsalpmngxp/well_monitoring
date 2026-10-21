using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text.Json;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TWise.Tenant.API.Auth;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Application.Features.Agents;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.API.Controllers;

/// <summary>
/// Agentic AI → AI Agents: agents built on Create New Agent, their tools and their test runs. Actions only
/// read the caller's identity and send a query or command (Features/Agents); the Python agent runtime runs
/// the agents. Validation failures become 400 via the ValidationExceptionMiddleware.
/// </summary>
[ApiController]
[Authorize]
[Route("api/agents")]
public sealed class AgentsController(ISender sender) : ControllerBase
{
    private const string Module = "agentic-ai.agents";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>The tenant's agents, most recently changed first, with run stats.</summary>
    [HttpGet]
    [RequireModulePermission(Module, ModulePermission.View)]
    [ProducesResponseType(typeof(IReadOnlyList<AiAgentDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> List(CancellationToken ct) =>
        TryGetTenantId(out var t) ? Ok(await sender.Send(new ListAiAgentsQuery(t), ct)) : Unauthorized();

    /// <summary>The tools a step can use: twise agents and the actions each accepts.</summary>
    [HttpGet("tools")]
    [RequireModulePermission(Module, ModulePermission.View)]
    [ProducesResponseType(typeof(AgentToolsDto), StatusCodes.Status200OK)]
    public async Task<IActionResult> Tools(CancellationToken ct) => Ok(await sender.Send(new ListAgentToolsQuery(), ct));

    /// <summary>The agent in the body (saved or not) as agentflow.json v1, the AgenticUIFramework's format.</summary>
    [HttpPost("agentflow")]
    [RequireModulePermission(Module, ModulePermission.View)]
    [ProducesResponseType(typeof(JsonElement), StatusCodes.Status200OK)]
    public async Task<IActionResult> ExportAgentFlow([FromBody] SaveAiAgentRequest agent, CancellationToken ct) =>
        TryGetTenantId(out var t)
            ? await RuntimeAsync(async () => Ok(await sender.Send(new ExportAgentFlowQuery(agent, t), ct)))
            : Unauthorized();

    /// <summary>Turns an agentflow.json v1 into an agent for the page (not saved); 400 with the reason when unusable.</summary>
    [HttpPost("agentflow/import")]
    [RequireModulePermission(Module, ModulePermission.Create)]
    [ProducesResponseType(typeof(AgentFlowImportDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public Task<IActionResult> ImportAgentFlow([FromBody] JsonElement flow, CancellationToken ct) =>
        RuntimeAsync(async () => Ok(await sender.Send(new ImportAgentFlowQuery(flow), ct)));

    /// <summary>Calls one Tool once with sample values: { status, result }. 400 with the reason when it may not be called.</summary>
    [HttpPost("tools/try")]
    [RequireModulePermission(Module, ModulePermission.Create)]
    [ProducesResponseType(typeof(JsonElement), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public Task<IActionResult> TryTool([FromBody] TryAgentToolRequest request, CancellationToken ct) =>
        TryGetTenantId(out var t)
            ? RuntimeAsync(async () => Ok(await sender.Send(new TryAgentToolQuery(t, request), ct)))
            : Task.FromResult<IActionResult>(Unauthorized());

    /// <summary>The data behind an Ask Data answer as a file (xlsx or docx): every row, re-read with the answer's SQL.</summary>
    [HttpPost("askdata/export")]
    [RequireModulePermission(Module, ModulePermission.View)]
    [ProducesResponseType(typeof(FileContentResult), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public Task<IActionResult> ExportAskData([FromBody] AskDataExportRequest request, CancellationToken ct) =>
        !TryGetTenantId(out var tenantId) ? Task.FromResult<IActionResult>(Unauthorized()) : RuntimeAsync(async () =>
        {
            var file = await sender.Send(new ExportAskDataQuery(request, tenantId), ct);
            return File(file.Body, file.ContentType, file.FileName);
        });

    /// <summary>Latest test runs of all the tenant's agents.</summary>
    [HttpGet("runs")]
    [RequireModulePermission(Module, ModulePermission.View)]
    [ProducesResponseType(typeof(IReadOnlyList<AiAgentRunDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> AllRuns([FromQuery] int take = 50, CancellationToken ct = default) =>
        TryGetTenantId(out var t) ? Ok(await sender.Send(new ListAiAgentRunsQuery(t, null, take), ct)) : Unauthorized();

    [HttpGet("{id:long}")]
    [RequireModulePermission(Module, ModulePermission.View)]
    [ProducesResponseType(typeof(AiAgentDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Get(long id, CancellationToken ct)
    {
        if (!TryGetTenantId(out var t)) return Unauthorized();
        return await sender.Send(new GetAiAgentQuery(t, id), ct) is { } a ? Ok(a) : NotFound();
    }

    /// <summary>A saved agent as an agentflow.json v1 download.</summary>
    [HttpGet("{id:long}/agentflow")]
    [RequireModulePermission(Module, ModulePermission.View)]
    [ProducesResponseType(typeof(JsonElement), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> DownloadAgentFlow(long id, CancellationToken ct)
    {
        if (!TryGetTenantId(out var t)) return Unauthorized();
        return await RuntimeAsync(async () => await sender.Send(new GetAgentFlowQuery(t, id), ct) is { } flow
            ? File(JsonSerializer.SerializeToUtf8Bytes(flow, new JsonSerializerOptions { WriteIndented = true }),
                "application/json", $"agent-{id}.agentflow.json")
            : NotFound());
    }

    /// <summary>Latest test runs of one agent.</summary>
    [HttpGet("{id:long}/runs")]
    [RequireModulePermission(Module, ModulePermission.View)]
    [ProducesResponseType(typeof(IReadOnlyList<AiAgentRunDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> Runs(long id, [FromQuery] int take = 50, CancellationToken ct = default) =>
        TryGetTenantId(out var t) ? Ok(await sender.Send(new ListAiAgentRunsQuery(t, id, take), ct)) : Unauthorized();

    // ── Evals: test cases, Run all, scores per version ────────────────────────

    /// <summary>The agent's test cases and its latest 20 eval runs (scores only).</summary>
    [HttpGet("{id:long}/evals")]
    [RequireModulePermission(Module, ModulePermission.View)]
    [ProducesResponseType(typeof(AiAgentEvalsDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Evals(long id, CancellationToken ct)
    {
        if (!TryGetTenantId(out var t)) return Unauthorized();
        return await sender.Send(new GetAiAgentEvalsQuery(t, id), ct) is { } e ? Ok(e) : NotFound();
    }

    /// <summary>One eval run with every case's result.</summary>
    [HttpGet("{id:long}/evals/runs/{evalRunId:long}")]
    [RequireModulePermission(Module, ModulePermission.View)]
    [ProducesResponseType(typeof(AiAgentEvalRunDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> EvalRun(long id, long evalRunId, CancellationToken ct)
    {
        if (!TryGetTenantId(out var t)) return Unauthorized();
        return await sender.Send(new GetAiAgentEvalRunQuery(t, id, evalRunId), ct) is { } r ? Ok(r) : NotFound();
    }

    [HttpPost("{id:long}/evals/cases")]
    [RequireModulePermission(Module, ModulePermission.Modify)]
    [ProducesResponseType(typeof(AiAgentEvalCaseDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> AddEvalCase(long id, [FromBody] SaveAiAgentEvalCaseRequest request, CancellationToken ct)
    {
        if (!TryGetTenantId(out var t)) return Unauthorized();
        try { return await sender.Send(new CreateAiAgentEvalCaseCommand(t, id, UserName(), request), ct) is { } c ? Ok(c) : NotFound(); }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    [HttpPut("{id:long}/evals/cases/{caseId:long}")]
    [RequireModulePermission(Module, ModulePermission.Modify)]
    [ProducesResponseType(typeof(AiAgentEvalCaseDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> UpdateEvalCase(long id, long caseId, [FromBody] SaveAiAgentEvalCaseRequest request, CancellationToken ct)
    {
        if (!TryGetTenantId(out var t)) return Unauthorized();
        return await sender.Send(new UpdateAiAgentEvalCaseCommand(t, id, caseId, request), ct) is { } c ? Ok(c) : NotFound();
    }

    [HttpDelete("{id:long}/evals/cases/{caseId:long}")]
    [RequireModulePermission(Module, ModulePermission.Modify)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> DeleteEvalCase(long id, long caseId, CancellationToken ct)
    {
        if (!TryGetTenantId(out var t)) return Unauthorized();
        return await sender.Send(new DeleteAiAgentEvalCaseCommand(t, id, caseId), ct) ? NoContent() : NotFound();
    }

    /// <summary>Runs the test cases (on the draft in the body, else the saved agent) and streams each result, then the score.</summary>
    [HttpPost("{id:long}/evals/run")]
    [RequireModulePermission(Module, ModulePermission.Create, ModulePermission.Modify)]
    [Produces("text/event-stream")]
    public async Task RunEvals(long id, [FromBody] RunAiAgentEvalRequest request, CancellationToken ct)
    {
        if (!TryGetTenantId(out var t)) { Response.StatusCode = StatusCodes.Status401Unauthorized; return; }
        await StreamAsync(sender.CreateStream(new RunAiAgentEvalStream(t, UserId(), UserName(), id, request), ct), ct);
    }

    // ── Triggers: schedules that run the published agent ──────────────────────

    /// <summary>The agent's triggers, each with its next five run times.</summary>
    [HttpGet("{id:long}/schedules")]
    [RequireModulePermission(Module, ModulePermission.View)]
    [ProducesResponseType(typeof(IReadOnlyList<AiAgentScheduleDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Schedules(long id, CancellationToken ct)
    {
        if (!TryGetTenantId(out var t)) return Unauthorized();
        return await sender.Send(new ListAiAgentSchedulesQuery(t, id), ct) is { } s ? Ok(s) : NotFound();
    }

    /// <summary>Adds a trigger. 400 when the agent is not published, has a Human Approval step or misses inputs.</summary>
    [HttpPost("{id:long}/schedules")]
    [RequireModulePermission(Module, ModulePermission.Modify)]
    [ProducesResponseType(typeof(AiAgentScheduleDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> AddSchedule(long id, [FromBody] SaveAiAgentScheduleRequest request, CancellationToken ct)
    {
        if (!TryGetTenantId(out var t)) return Unauthorized();
        try { return await sender.Send(new CreateAiAgentScheduleCommand(t, id, UserName(), request), ct) is { } s ? Ok(s) : NotFound(); }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    [HttpPut("{id:long}/schedules/{scheduleId:long}")]
    [RequireModulePermission(Module, ModulePermission.Modify)]
    [ProducesResponseType(typeof(AiAgentScheduleDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> UpdateSchedule(long id, long scheduleId, [FromBody] SaveAiAgentScheduleRequest request, CancellationToken ct)
    {
        if (!TryGetTenantId(out var t)) return Unauthorized();
        try { return await sender.Send(new UpdateAiAgentScheduleCommand(t, id, scheduleId, request), ct) is { } s ? Ok(s) : NotFound(); }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    [HttpDelete("{id:long}/schedules/{scheduleId:long}")]
    [RequireModulePermission(Module, ModulePermission.Modify)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> DeleteSchedule(long id, long scheduleId, CancellationToken ct)
    {
        if (!TryGetTenantId(out var t)) return Unauthorized();
        return await sender.Send(new DeleteAiAgentScheduleCommand(t, id, scheduleId), ct) ? NoContent() : NotFound();
    }

    /// <summary>Runs an active trigger now (within a minute). 202.</summary>
    [HttpPost("{id:long}/schedules/{scheduleId:long}/run")]
    [RequireModulePermission(Module, ModulePermission.Modify)]
    [ProducesResponseType(StatusCodes.Status202Accepted)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> RunScheduleNow(long id, long scheduleId, CancellationToken ct)
    {
        if (!TryGetTenantId(out var t)) return Unauthorized();
        try { return await sender.Send(new RunAiAgentScheduleNowCommand(t, id, scheduleId), ct) ? Accepted() : NotFound(); }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    /// <summary>When a cron / once spec would run: the reason it cannot, or the next five times (UTC).</summary>
    [HttpPost("schedules/preview")]
    [RequireModulePermission(Module, ModulePermission.View)]
    [ProducesResponseType(typeof(AgentSchedulePreviewDto), StatusCodes.Status200OK)]
    public async Task<IActionResult> PreviewSchedule([FromBody] AgentSchedulePreviewRequest request, CancellationToken ct) =>
        Ok(await sender.Send(new PreviewAgentScheduleQuery(request), ct));

    /// <summary>What the agent remembers between runs (Load / Preload Memory), newest first.</summary>
    [HttpGet("{id:long}/memories")]
    [RequireModulePermission(Module, ModulePermission.View)]
    [ProducesResponseType(typeof(IReadOnlyList<AiAgentMemoryDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Memories(long id, CancellationToken ct)
    {
        if (!TryGetTenantId(out var t)) return Unauthorized();
        return await sender.Send(new ListAiAgentMemoriesQuery(t, id), ct) is { } m ? Ok(m) : NotFound();
    }

    /// <summary>Forgets all of the agent's memories.</summary>
    [HttpDelete("{id:long}/memories")]
    [RequireModulePermission(Module, ModulePermission.Modify)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> ClearMemories(long id, CancellationToken ct)
    {
        if (!TryGetTenantId(out var t)) return Unauthorized();
        return await sender.Send(new DeleteAiAgentMemoriesCommand(t, id, null), ct) ? NoContent() : NotFound();
    }

    /// <summary>Forgets one memory.</summary>
    [HttpDelete("{id:long}/memories/{memoryId:long}")]
    [RequireModulePermission(Module, ModulePermission.Modify)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> DeleteMemory(long id, long memoryId, CancellationToken ct)
    {
        if (!TryGetTenantId(out var t)) return Unauthorized();
        return await sender.Send(new DeleteAiAgentMemoriesCommand(t, id, memoryId), ct) ? NoContent() : NotFound();
    }

    /// <summary>The agent's saved versions (every save that changed it), newest first.</summary>
    [HttpGet("{id:long}/versions")]
    [RequireModulePermission(Module, ModulePermission.View)]
    [ProducesResponseType(typeof(IReadOnlyList<AiAgentVersionDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Versions(long id, CancellationToken ct)
    {
        if (!TryGetTenantId(out var t)) return Unauthorized();
        return await sender.Send(new ListAiAgentVersionsQuery(t, id), ct) is { } v ? Ok(v) : NotFound();
    }

    /// <summary>One version as the agent object, to load into the editor (Restore); nothing is saved.</summary>
    [HttpGet("{id:long}/versions/{versionNo:int}")]
    [RequireModulePermission(Module, ModulePermission.View)]
    [ProducesResponseType(typeof(SaveAiAgentRequest), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Version(long id, int versionNo, CancellationToken ct)
    {
        if (!TryGetTenantId(out var t)) return Unauthorized();
        return await sender.Send(new GetAiAgentVersionQuery(t, id, versionNo), ct) is { } v ? Ok(v) : NotFound();
    }

    /// <summary>Saves a new agent as draft or published.</summary>
    [HttpPost]
    [RequireModulePermission(Module, ModulePermission.Create)]
    [ProducesResponseType(typeof(AiAgentDto), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> Create([FromBody] SaveAiAgentRequest request, CancellationToken ct)
    {
        if (!TryGetTenantId(out var t)) return Unauthorized();
        var agent = await sender.Send(new CreateAiAgentCommand(t, UserName(), request), ct);
        return CreatedAtAction(nameof(Get), new { id = agent.Id }, agent);
    }

    /// <summary>Replaces an agent's configuration and status (Save as Draft / Publish on an existing agent).</summary>
    [HttpPut("{id:long}")]
    [RequireModulePermission(Module, ModulePermission.Modify)]
    [ProducesResponseType(typeof(AiAgentDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Update(long id, [FromBody] SaveAiAgentRequest request, CancellationToken ct)
    {
        if (!TryGetTenantId(out var t)) return Unauthorized();
        return await sender.Send(new UpdateAiAgentCommand(t, id, UserName(), request), ct) is { } a ? Ok(a) : NotFound();
    }

    /// <summary>Admins only: switches an agent on ("active") or off ("inactive"). An inactive agent cannot be run.</summary>
    [HttpPut("{id:long}/state")]
    [RequireModulePermission(Module, ModulePermission.Modify)]
    [ProducesResponseType(typeof(AiAgentDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> SetState(long id, [FromBody] SetAiAgentStateRequest request, CancellationToken ct)
    {
        if (!TryGetTenantId(out var t)) return Unauthorized();
        if (!User.IsInRole("admin") && !User.IsInRole("tenant_admin")) return Forbid();
        var state = request.AgentState?.Trim().ToLowerInvariant();
        if (state is not (AgentMapping.Active or AgentMapping.Inactive))
            return BadRequest(new { message = "agentState must be \"active\" or \"inactive\"." });
        return await sender.Send(new SetAiAgentStateCommand(t, id, state), ct) is { } a ? Ok(a) : NotFound();
    }

    [HttpDelete("{id:long}")]
    [RequireModulePermission(Module, ModulePermission.Modify)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Delete(long id, CancellationToken ct)
    {
        if (!TryGetTenantId(out var t)) return Unauthorized();
        return await sender.Send(new DeleteAiAgentCommand(t, id), ct) ? NoContent() : NotFound();
    }

    /// <summary>
    /// Runs the agent configuration in the body (saved or not) and streams server-sent events:
    /// step, status and node while it runs, then done ({runId, ok, answer, steps, seconds}) or error ({message}).
    /// </summary>
    /// <summary>Human Approval: approve, edit or reject a waiting run; streams the rest of the run like test.</summary>
    [HttpPost("runs/{runId:long}/resume")]
    [RequireModulePermission(Module, ModulePermission.Create, ModulePermission.Modify)]
    [Produces("text/event-stream")]
    public async Task Resume(long runId, [FromBody] ResumeAiAgentRunRequest request, CancellationToken ct)
    {
        if (!TryGetTenantId(out var t)) { Response.StatusCode = StatusCodes.Status401Unauthorized; return; }
        await StreamAsync(sender.CreateStream(new ResumeAiAgentRunStream(t, UserId(), UserName(), runId, request), ct), ct);
    }

    [HttpPost("test")]
    [RequireModulePermission(Module, ModulePermission.Create, ModulePermission.Modify)]
    [Produces("text/event-stream")]
    public async Task Test([FromBody] TestAiAgentRequest request, CancellationToken ct)
    {
        if (!TryGetTenantId(out var t)) { Response.StatusCode = StatusCodes.Status401Unauthorized; return; }
        await StreamAsync(sender.CreateStream(new TestAiAgentStream(t, UserId(), UserName(), request), ct), ct);
    }

    /// <summary>Writes the events as server-sent events.</summary>
    private async Task StreamAsync(IAsyncEnumerable<AiAskEvent> events, CancellationToken ct)
    {
        Response.ContentType = "text/event-stream";
        Response.Headers.CacheControl = "no-cache";
        Response.Headers["X-Accel-Buffering"] = "no";
        await foreach (var ev in events)
        {
            await Response.WriteAsync($"event: {ev.Type}\ndata: {JsonSerializer.Serialize(ev.Data, Json)}\n\n", ct);
            await Response.Body.FlushAsync(ct);
        }
    }

    /// <summary>Runtime calls: an unusable file is 400 with { message }, an unreachable runtime 502.</summary>
    private static async Task<IActionResult> RuntimeAsync(Func<Task<IActionResult>> action)
    {
        try { return await action(); }
        catch (InvalidOperationException ex) { return new BadRequestObjectResult(new { message = ex.Message }); }
        catch (HttpRequestException ex) { return new ObjectResult(new { message = "The agent service is not reachable. " + ex.Message }) { StatusCode = 502 }; }
    }

    private string UserId() =>
        User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? "";

    private string UserName() =>
        User.FindFirst("email")?.Value ?? User.FindFirst(ClaimTypes.Email)?.Value ?? User.Identity?.Name ?? UserId();

    private bool TryGetTenantId(out long tenantId)
    {
        tenantId = 0;
        return long.TryParse(User.FindFirst("tenantId")?.Value, out tenantId) && tenantId > 0;
    }
}
