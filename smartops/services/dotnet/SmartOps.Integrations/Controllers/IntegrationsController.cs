using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SmartOps.Integrations.Connectors;
using SmartOps.Integrations.Domain.Dtos;
using SmartOps.Integrations.Domain.Entities;
using SmartOps.Integrations.Infrastructure;

namespace SmartOps.Integrations.Controllers;

[ApiController]
[Authorize(Policy = "Manager")]
[Route("endpoints")]
public sealed class EndpointsController(IntegrationsDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<EndpointDto>>> List()
    {
        var rows = await db.Endpoints.ToListAsync();
        return Ok(rows.Select(e => new EndpointDto(e.Id, e.Key, e.System, e.Name, e.BaseUrl,
            e.AuthType, JsonSerializer.Deserialize<object>(e.ConfigJson) ?? new { }, e.Status)));
    }

    [HttpPut]
    public async Task<ActionResult<EndpointDto>> Upsert([FromBody] EndpointUpsertRequest r)
    {
        var e = await db.Endpoints.FirstOrDefaultAsync(x => x.Key == r.Key)
                ?? new IntegrationEndpoint { Key = r.Key };
        if (e.Id == 0) db.Endpoints.Add(e);
        e.System = r.System; e.Name = r.Name; e.BaseUrl = r.BaseUrl;
        e.AuthType = r.AuthType ?? "oauth";
        e.ConfigJson = JsonSerializer.Serialize(r.Config);
        e.Status = r.Status;
        await db.SaveChangesAsync();
        return Ok(new EndpointDto(e.Id, e.Key, e.System, e.Name, e.BaseUrl,
            e.AuthType, r.Config, e.Status));
    }
}

[ApiController]
[Authorize(Policy = "Manager")]
[Route("sync")]
public sealed class SyncController(
    IntegrationsDbContext db,
    SapConnector sap,
    SalesforceConnector sf,
    ServiceNowConnector snow) : ControllerBase
{
    [HttpPost("trigger")]
    public async Task<ActionResult<SyncJobDto>> Trigger([FromBody] SyncTriggerRequest req)
    {
        var endpoint = await db.Endpoints.FirstOrDefaultAsync(e => e.Key == req.EndpointKey);
        if (endpoint is null) return NotFound(new { error = "Endpoint not found" });

        IConnector connector = endpoint.System switch
        {
            "SAP" => sap, "Salesforce" => sf, "ServiceNow" => snow,
            _ => throw new ArgumentException($"Unsupported system {endpoint.System}")
        };

        var job = new SyncJob { EndpointKey = endpoint.Key, Direction = req.Direction, Status = "running" };
        db.SyncJobs.Add(job);
        await db.SaveChangesAsync();

        var result = req.Direction == "inbound"
            ? await connector.SyncInboundAsync(endpoint.Key, HttpContext.RequestAborted)
            : await connector.SyncOutboundAsync(endpoint.Key, Array.Empty<object>(), HttpContext.RequestAborted);

        job.RecordsSent = result.Sent;
        job.RecordsReceived = result.Received;
        job.Errors = result.Errors;
        job.Status = "completed";
        job.FinishedAt = DateTime.UtcNow;
        job.Note = result.Note;
        await db.SaveChangesAsync();

        return Ok(new SyncJobDto(job.Id, job.EndpointKey, job.Direction, job.StartedAt,
            job.FinishedAt, job.RecordsSent, job.RecordsReceived, job.Errors, job.Status, job.Note));
    }

    [HttpGet("jobs")]
    public async Task<ActionResult<IReadOnlyList<SyncJobDto>>> List(
        [FromQuery] string? endpointKey, [FromQuery] string? status)
    {
        var q = db.SyncJobs.AsQueryable();
        if (!string.IsNullOrWhiteSpace(endpointKey)) q = q.Where(j => j.EndpointKey == endpointKey);
        if (!string.IsNullOrWhiteSpace(status)) q = q.Where(j => j.Status == status);
        var rows = await q.OrderByDescending(j => j.StartedAt).ToListAsync();
        return Ok(rows.Select(j => new SyncJobDto(j.Id, j.EndpointKey, j.Direction,
            j.StartedAt, j.FinishedAt, j.RecordsSent, j.RecordsReceived, j.Errors, j.Status, j.Note)));
    }
}
