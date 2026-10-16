using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SmartOps.Reports.Domain.Dtos;
using SmartOps.Reports.Domain.Entities;
using SmartOps.Reports.Hubs;
using SmartOps.Reports.Infrastructure;
using SmartOps.Reports.Services;

namespace SmartOps.Reports.Controllers;

file static class Json
{
    public static object Obj(string s) => string.IsNullOrEmpty(s) ? new { }
        : JsonSerializer.Deserialize<object>(s) ?? new { };
    public static IReadOnlyList<string> Strs(string s) => string.IsNullOrEmpty(s) ? Array.Empty<string>()
        : JsonSerializer.Deserialize<List<string>>(s) ?? new();
}

[ApiController]
[Authorize]
[Route("reports")]
public sealed class ReportsController(ReportsDbContext db, IReportRenderer renderer) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<ReportDto>>> List([FromQuery] string? category)
    {
        var q = db.Reports.AsQueryable();
        if (!string.IsNullOrWhiteSpace(category)) q = q.Where(r => r.Category == category);
        var rows = await q.ToListAsync();
        return Ok(rows.Select(r => new ReportDto(r.Id, r.Key, r.Name, r.Category,
            r.Description, Json.Obj(r.LayoutJson), r.CreatedAt)));
    }

    [HttpGet("{key}")]
    public async Task<ActionResult<ReportDto>> Get(string key)
    {
        var r = await db.Reports.FirstOrDefaultAsync(x => x.Key == key);
        return r is null ? NotFound() : Ok(new ReportDto(r.Id, r.Key, r.Name, r.Category,
            r.Description, Json.Obj(r.LayoutJson), r.CreatedAt));
    }

    [HttpPost, Authorize(Policy = "Manager")]
    public async Task<ActionResult<ReportDto>> Create([FromBody] ReportCreateRequest req)
    {
        if (await db.Reports.AnyAsync(r => r.Key == req.Key))
            return Conflict(new { error = "Report key already exists" });
        var r = new Report { Key = req.Key, Name = req.Name, Category = req.Category,
                             Description = req.Description, LayoutJson = JsonSerializer.Serialize(req.Layout) };
        db.Reports.Add(r);
        await db.SaveChangesAsync();
        return Created($"reports/{r.Key}", new ReportDto(r.Id, r.Key, r.Name, r.Category,
            r.Description, req.Layout, r.CreatedAt));
    }

    [HttpGet("{key}/pdf")]
    public async Task<IActionResult> Pdf(string key)
    {
        var r = await db.Reports.FirstOrDefaultAsync(x => x.Key == key);
        if (r is null) return NotFound();
        var bytes = await renderer.RenderPdfAsync(r);
        return File(bytes, "application/pdf", $"{key}.pdf");
    }

    [HttpGet("{key}/xlsx")]
    public async Task<IActionResult> Xlsx(string key)
    {
        var r = await db.Reports.FirstOrDefaultAsync(x => x.Key == key);
        if (r is null) return NotFound();
        var bytes = await renderer.RenderXlsxAsync(r);
        return File(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            $"{key}.xlsx");
    }
}

[ApiController]
[Authorize]
[Route("schedules")]
public sealed class SchedulesController(ReportsDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<ScheduleDto>>> List()
    {
        var rows = await db.Schedules.ToListAsync();
        return Ok(rows.Select(s => new ScheduleDto(s.Id, s.ReportKey, s.Cron,
            Json.Strs(s.RecipientsJson), s.Format, s.LastRun, s.NextRun, s.Status)));
    }

    [HttpPost, Authorize(Policy = "Manager")]
    public async Task<ActionResult<ScheduleDto>> Create([FromBody] ScheduleCreateRequest r)
    {
        var s = new ReportSchedule
        {
            ReportKey = r.ReportKey, Cron = r.Cron,
            RecipientsJson = JsonSerializer.Serialize(r.Recipients),
            Format = r.Format
        };
        db.Schedules.Add(s);
        await db.SaveChangesAsync();
        return Created($"schedules/{s.Id}", new ScheduleDto(s.Id, s.ReportKey, s.Cron,
            r.Recipients, s.Format, s.LastRun, s.NextRun, s.Status));
    }
}

[ApiController]
[Authorize]
[Route("briefings")]
public sealed class BriefingsController(ReportsDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<BriefingDto>>> List(
        [FromQuery] string? audience, [FromQuery] string? period)
    {
        var q = db.Briefings.AsQueryable();
        if (!string.IsNullOrWhiteSpace(audience)) q = q.Where(b => b.Audience == audience);
        if (!string.IsNullOrWhiteSpace(period)) q = q.Where(b => b.Period == period);
        var rows = await q.OrderByDescending(b => b.CreatedAt).ToListAsync();
        return Ok(rows.Select(b => new BriefingDto(b.Id, b.Audience, b.Period, b.Headline,
            Json.Obj(b.BodyJson), b.CreatedAt)));
    }
}

[ApiController]
[Authorize]
[Route("execsummary")]
public sealed class ExecSummaryController(ReportsDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<BriefingDto>> Latest()
    {
        var b = await db.Briefings.Where(x => x.Audience == "exec")
                  .OrderByDescending(x => x.CreatedAt).FirstOrDefaultAsync();
        return b is null ? NotFound() : Ok(new BriefingDto(b.Id, b.Audience, b.Period,
            b.Headline, Json.Obj(b.BodyJson), b.CreatedAt));
    }
}

[ApiController]
[Authorize]
[Route("mdbriefing")]
public sealed class MdBriefingController(ReportsDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<BriefingDto>> Latest()
    {
        var b = await db.Briefings.Where(x => x.Audience == "md")
                  .OrderByDescending(x => x.CreatedAt).FirstOrDefaultAsync();
        return b is null ? NotFound() : Ok(new BriefingDto(b.Id, b.Audience, b.Period,
            b.Headline, Json.Obj(b.BodyJson), b.CreatedAt));
    }
}

[ApiController]
[Authorize]
[Route("alerts")]
public sealed class AlertsController(ReportsDbContext db, IAlertsBroadcaster broadcaster) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<AlertDto>>> List(
        [FromQuery] string? severity, [FromQuery] string? wellId)
    {
        var q = db.Alerts.AsQueryable();
        if (!string.IsNullOrWhiteSpace(severity)) q = q.Where(a => a.Severity == severity);
        if (!string.IsNullOrWhiteSpace(wellId)) q = q.Where(a => a.WellId == wellId);
        var rows = await q.OrderByDescending(a => a.CreatedAt).ToListAsync();
        return Ok(rows.Select(a => new AlertDto(a.Id, a.Category, a.Severity, a.Title,
            a.Detail, a.WellId, Json.Obj(a.PayloadJson), a.CreatedAt, a.Acknowledged)));
    }

    [HttpPost]
    public async Task<ActionResult<AlertDto>> Create([FromBody] AlertCreateRequest r)
    {
        var a = new Alert
        {
            Category = r.Category, Severity = r.Severity, Title = r.Title,
            Detail = r.Detail, WellId = r.WellId,
            PayloadJson = JsonSerializer.Serialize(r.Payload)
        };
        db.Alerts.Add(a);
        await db.SaveChangesAsync();

        var dto = new AlertDto(a.Id, a.Category, a.Severity, a.Title, a.Detail, a.WellId,
            r.Payload, a.CreatedAt, false);
        await broadcaster.BroadcastAsync(dto, a.WellId);  // SignalR fan-out
        return Created($"alerts/{a.Id}", dto);
    }

    [HttpPatch("{id:int}/ack")]
    public async Task<ActionResult<AlertDto>> Acknowledge(int id)
    {
        var a = await db.Alerts.FindAsync(id);
        if (a is null) return NotFound();
        a.Acknowledged = true;
        a.AcknowledgedBy = User.FindFirst("email")?.Value ?? "unknown";
        a.AcknowledgedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return Ok(new AlertDto(a.Id, a.Category, a.Severity, a.Title, a.Detail, a.WellId,
            Json.Obj(a.PayloadJson), a.CreatedAt, a.Acknowledged));
    }
}
