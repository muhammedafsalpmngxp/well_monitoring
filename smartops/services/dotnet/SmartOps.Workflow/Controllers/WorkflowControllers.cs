using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SmartOps.Workflow.Domain.Dtos;
using SmartOps.Workflow.Domain.Entities;
using SmartOps.Workflow.Infrastructure;

namespace SmartOps.Workflow.Controllers;

// Helpers
file static class Json
{
    public static object Deserialize(string s)
        => string.IsNullOrEmpty(s) ? new { } : JsonSerializer.Deserialize<object>(s) ?? new { };
    public static IReadOnlyList<string> Strings(string s)
        => string.IsNullOrEmpty(s) ? Array.Empty<string>()
           : JsonSerializer.Deserialize<List<string>>(s) ?? new();
}

[ApiController]
[Authorize]
[Route("flows")]
public sealed class FlowsController(WorkflowDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<FlowDto>>> List()
    {
        var rows = await db.Flows.ToListAsync();
        return Ok(rows.Select(f => new FlowDto(f.Id, f.Key, f.Name, f.Description,
            Json.Deserialize(f.NodesJson), Json.Deserialize(f.EdgesJson), f.Status)));
    }

    [HttpPut, Authorize(Policy = "Manager")]
    public async Task<ActionResult<FlowDto>> Upsert([FromBody] FlowUpsertRequest r)
    {
        var f = await db.Flows.FirstOrDefaultAsync(x => x.Key == r.Key) ?? new FlowDefinition { Key = r.Key };
        if (f.Id == 0) db.Flows.Add(f);
        f.Name = r.Name; f.Description = r.Description;
        f.NodesJson = JsonSerializer.Serialize(r.Nodes);
        f.EdgesJson = JsonSerializer.Serialize(r.Edges);
        f.Status = r.Status;
        await db.SaveChangesAsync();
        return Ok(new FlowDto(f.Id, f.Key, f.Name, f.Description,
            Json.Deserialize(f.NodesJson), Json.Deserialize(f.EdgesJson), f.Status));
    }
}

[ApiController]
[Authorize]
[Route("connections")]
public sealed class ConnectionsController(WorkflowDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<ConnectionDto>>> List()
    {
        var rows = await db.Connections.ToListAsync();
        return Ok(rows.Select(c => new ConnectionDto(c.Id, c.Name, c.Kind,
            Json.Deserialize(c.ConfigJson), c.Status)));
    }
}

[ApiController]
[Authorize]
[Route("agents")]
public sealed class AgentsController(WorkflowDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<AgentDto>>> List()
    {
        var rows = await db.Agents.ToListAsync();
        return Ok(rows.Select(a => new AgentDto(a.Id, a.Name, a.Description, a.SystemPrompt,
            Json.Strings(a.ToolsJson), a.Model, a.Status)));
    }

    [HttpPost, Authorize(Policy = "Manager")]
    public async Task<ActionResult<AgentDto>> Create([FromBody] AgentUpsertRequest r)
    {
        var a = new AiAgent
        {
            Name = r.Name, Description = r.Description, SystemPrompt = r.SystemPrompt,
            ToolsJson = JsonSerializer.Serialize(r.Tools), Model = r.Model, Status = r.Status
        };
        db.Agents.Add(a);
        await db.SaveChangesAsync();
        return Created($"agents/{a.Id}", new AgentDto(a.Id, a.Name, a.Description, a.SystemPrompt,
            r.Tools, a.Model, a.Status));
    }
}

[ApiController]
[Authorize]
[Route("agent-runs")]
public sealed class AgentRunsController(WorkflowDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<AgentRunDto>>> List([FromQuery] int? agentId)
    {
        var q = db.AgentRuns.AsQueryable();
        if (agentId is not null) q = q.Where(r => r.AgentId == agentId);
        var rows = await q.OrderByDescending(r => r.StartedAt).ToListAsync();
        return Ok(rows.Select(r => new AgentRunDto(r.Id, r.AgentId, r.TriggeredBy,
            Json.Deserialize(r.InputJson),
            r.OutputJson is null ? null : Json.Deserialize(r.OutputJson),
            r.Status, r.StartedAt, r.FinishedAt)));
    }

    [HttpPost]
    public async Task<ActionResult<AgentRunDto>> Trigger([FromBody] AgentRunRequest r)
    {
        // Stub completion. Real LLM call happens in the Python jenny_ai service.
        var run = new AgentRun
        {
            AgentId = r.AgentId,
            TriggeredBy = User.FindFirst("email")?.Value ?? "unknown",
            InputJson = JsonSerializer.Serialize(r.Input),
            OutputJson = JsonSerializer.Serialize(new { summary = "Forwarded to Jenny AI runtime." }),
            Status = "completed", FinishedAt = DateTime.UtcNow
        };
        db.AgentRuns.Add(run);
        await db.SaveChangesAsync();
        return Created($"agent-runs/{run.Id}", new AgentRunDto(run.Id, run.AgentId, run.TriggeredBy,
            Json.Deserialize(run.InputJson), Json.Deserialize(run.OutputJson!),
            run.Status, run.StartedAt, run.FinishedAt));
    }
}

[ApiController]
[Authorize]
[Route("forms")]
public sealed class FormsController(WorkflowDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<FormDto>>> List()
    {
        var rows = await db.Forms.ToListAsync();
        return Ok(rows.Select(f => new FormDto(f.Id, f.Key, f.Name,
            Json.Deserialize(f.SchemaJson), Json.Deserialize(f.UiLayoutJson))));
    }

    [HttpGet("{key}")]
    public async Task<ActionResult<FormDto>> Get(string key)
    {
        var f = await db.Forms.FirstOrDefaultAsync(x => x.Key == key);
        return f is null ? NotFound() : Ok(new FormDto(f.Id, f.Key, f.Name,
            Json.Deserialize(f.SchemaJson), Json.Deserialize(f.UiLayoutJson)));
    }
}

[ApiController]
[Authorize]
[Route("catalogue")]
public sealed class CatalogueController(WorkflowDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<CatalogueDto>>> List([FromQuery] string? category)
    {
        var q = db.Catalogue.AsQueryable();
        if (!string.IsNullOrWhiteSpace(category)) q = q.Where(c => c.Category == category);
        var rows = await q.ToListAsync();
        return Ok(rows.Select(c => new CatalogueDto(c.Id, c.Key, c.Name, c.Category, c.Description, c.Icon)));
    }
}

[ApiController]
[Authorize]
[Route("requests")]
public sealed class RequestsController(WorkflowDbContext db) : ControllerBase
{
    [HttpPost]
    public async Task<ActionResult<RequestDto>> Submit([FromBody] RequestCreateRequest r)
    {
        var sub = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value
               ?? User.FindFirst("sub")?.Value;
        if (!int.TryParse(sub, out var uid)) return Unauthorized();
        var req = new ServiceRequest
        {
            UserId = uid, CatalogueKey = r.CatalogueKey,
            FormDataJson = JsonSerializer.Serialize(r.FormData), Status = "submitted"
        };
        db.Requests.Add(req);
        await db.SaveChangesAsync();
        return Created($"requests/{req.Id}", new RequestDto(req.Id, req.UserId,
            req.CatalogueKey, Json.Deserialize(req.FormDataJson),
            req.Status, req.AssignedTo, req.CreatedAt));
    }

    [HttpGet("my")]
    public async Task<ActionResult<IReadOnlyList<RequestDto>>> Mine()
    {
        var sub = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value
               ?? User.FindFirst("sub")?.Value;
        if (!int.TryParse(sub, out var uid)) return Unauthorized();
        var rows = await db.Requests.Where(x => x.UserId == uid)
                     .OrderByDescending(x => x.CreatedAt).ToListAsync();
        return Ok(rows.Select(req => new RequestDto(req.Id, req.UserId, req.CatalogueKey,
            Json.Deserialize(req.FormDataJson), req.Status, req.AssignedTo, req.CreatedAt)));
    }

    [HttpGet, Authorize(Policy = "Manager")]
    public async Task<ActionResult<IReadOnlyList<RequestDto>>> All([FromQuery] string? status)
    {
        var q = db.Requests.AsQueryable();
        if (!string.IsNullOrWhiteSpace(status)) q = q.Where(r => r.Status == status);
        var rows = await q.OrderByDescending(r => r.CreatedAt).ToListAsync();
        return Ok(rows.Select(req => new RequestDto(req.Id, req.UserId, req.CatalogueKey,
            Json.Deserialize(req.FormDataJson), req.Status, req.AssignedTo, req.CreatedAt)));
    }
}
