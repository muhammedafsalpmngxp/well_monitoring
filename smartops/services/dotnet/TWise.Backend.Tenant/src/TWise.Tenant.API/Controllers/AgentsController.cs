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

    /// <summary>The data behind an Ask Data answer as a file (xlsx or docx): every row, re-read with the answer's SQL.</summary>
    [HttpPost("askdata/export")]
    [RequireModulePermission(Module, ModulePermission.View)]
    [ProducesResponseType(typeof(FileContentResult), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public Task<IActionResult> ExportAskData([FromBody] AskDataExportRequest request, CancellationToken ct) =>
        RuntimeAsync(async () =>
        {
            var file = await sender.Send(new ExportAskDataQuery(request), ct);
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
        return await sender.Send(new UpdateAiAgentCommand(t, id, request), ct) is { } a ? Ok(a) : NotFound();
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
    [HttpPost("test")]
    [RequireModulePermission(Module, ModulePermission.Create, ModulePermission.Modify)]
    [Produces("text/event-stream")]
    public async Task Test([FromBody] TestAiAgentRequest request, CancellationToken ct)
    {
        if (!TryGetTenantId(out var t)) { Response.StatusCode = StatusCodes.Status401Unauthorized; return; }
        Response.ContentType = "text/event-stream";
        Response.Headers.CacheControl = "no-cache";
        Response.Headers["X-Accel-Buffering"] = "no";
        await foreach (var ev in sender.CreateStream(new TestAiAgentStream(t, UserId(), UserName(), request), ct))
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
