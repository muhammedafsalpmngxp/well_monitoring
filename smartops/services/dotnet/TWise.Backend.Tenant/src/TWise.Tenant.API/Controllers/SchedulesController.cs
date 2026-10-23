using System.Globalization;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Application.Features.Delivery;
using TWise.Tenant.Domain;
using TWise.Tenant.Domain.Entities.Delivery;

namespace TWise.Tenant.API.Controllers;

/// <summary>
/// Scheduled deliveries of reports, dashboards and canvases, and their Delivery Log. View on smart-alerts.schedules lists
/// schedules and runs; create adds one and sends a test; the owner, or anyone with modify (admins always), edits, pauses,
/// resumes, deletes and runs one now. A schedule can only be made for an item the caller may view and read
/// (TargetAccess). A schedule runs as its owner, so whoever saves an edit becomes its owner; pause, resume, delete and
/// run now leave the owner as it is.
/// </summary>
[Authorize]
[Route("api/schedules")]
public sealed class SchedulesController(IScheduleStore store, DeliveryRunner runner, IRecipientResolver directory) : BaseApiController
{
    [HttpGet]
    public async Task<IActionResult> List([FromQuery] string? targetType, [FromQuery] long? targetId, CancellationToken ct)
    {
        if (Denied(ModulePermission.View, out var tenantId, out _) is { } denied) return denied;
        var schedules = await store.ListAsync(tenantId, targetType, targetId, ct);
        return Ok(ApiEnvelope<IReadOnlyList<ScheduleDto>>.Ok(await DtosAsync(tenantId, schedules, ct)));
    }

    [HttpGet("{id:long}")]
    public async Task<IActionResult> Get(long id, CancellationToken ct)
    {
        if (Denied(ModulePermission.View, out var tenantId, out _) is { } denied) return denied;
        var schedule = await store.GetAsync(id, tenantId, ct);
        return schedule is null ? NotFoundSchedule() : Ok(ApiEnvelope<ScheduleDto>.Ok((await DtosAsync(tenantId, [schedule], ct))[0]));
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] ScheduleRequest request, CancellationToken ct)
    {
        if (Denied(ModulePermission.Create, out var tenantId, out var userId) is { } denied) return denied;
        var now = DateTime.UtcNow;
        if (await Refusal(request, tenantId, userId, now, ct) is { } refused) return refused;
        var schedule = new Schedule { TenantId = tenantId, OwnerUserId = userId, CreatedBy = userId, CreatedAt = now, IsActive = true };
        Apply(schedule, request, userId, now);
        await store.AddAsync(schedule, ct);
        return StatusCode(201, ApiEnvelope<ScheduleDto>.Ok((await DtosAsync(tenantId, [schedule], ct))[0], statusCode: 201));
    }

    [HttpPut("{id:long}")]
    public async Task<IActionResult> Update(long id, [FromBody] ScheduleRequest request, CancellationToken ct)
    {
        var (schedule, tenantId, userId, refusal) = await EditableAsync(id, ct);
        if (refusal is not null) return refusal;
        var now = DateTime.UtcNow;
        if (await Refusal(request, tenantId, userId, now, ct) is { } refused) return refused;
        // The next run renders as the owner, so the editor, whose rights were just checked, becomes the owner.
        schedule!.OwnerUserId = userId;
        Apply(schedule, request, userId, now);
        await store.SaveAsync(ct);
        return Ok(ApiEnvelope<ScheduleDto>.Ok((await DtosAsync(tenantId, [schedule!], ct))[0]));
    }

    [HttpDelete("{id:long}")]
    public async Task<IActionResult> Delete(long id, CancellationToken ct)
    {
        var (schedule, _, userId, refusal) = await EditableAsync(id, ct);
        if (refusal is not null) return refusal;
        schedule!.IsDeleted = true;
        schedule.IsActive = false;
        Touch(schedule, userId);
        await store.SaveAsync(ct);
        return NoContent();
    }

    [HttpPost("{id:long}/pause")]
    public async Task<IActionResult> Pause(long id, CancellationToken ct)
    {
        var (schedule, tenantId, userId, refusal) = await EditableAsync(id, ct);
        if (refusal is not null) return refusal;
        schedule!.IsActive = false;
        Touch(schedule, userId);
        await store.SaveAsync(ct);
        return Ok(ApiEnvelope<ScheduleDto>.Ok((await DtosAsync(tenantId, [schedule], ct))[0]));
    }

    [HttpPost("{id:long}/resume")]
    public async Task<IActionResult> Resume(long id, CancellationToken ct)
    {
        var (schedule, tenantId, userId, refusal) = await EditableAsync(id, ct);
        if (refusal is not null) return refusal;
        var next = Recurrence.Next(Spec(schedule!), DateTime.UtcNow);
        if (next is null) return BadRequest(ApiEnvelope<object>.Fail("This schedule has no run left. Change when it runs first.", 400));
        schedule!.IsActive = true;
        schedule.NextRunAt = next;
        Touch(schedule, userId);
        await store.SaveAsync(ct);
        return Ok(ApiEnvelope<ScheduleDto>.Ok((await DtosAsync(tenantId, [schedule], ct))[0]));
    }

    /// <summary>Runs the schedule now, as its owner, to all its recipients. The next scheduled run is not changed.</summary>
    [HttpPost("{id:long}/run-now")]
    public async Task<IActionResult> RunNow(long id, CancellationToken ct)
    {
        var (schedule, _, _, refusal) = await EditableAsync(id, ct);
        if (refusal is not null) return refusal;
        var run = await runner.RunAsync(schedule!, DeliveryTerms.RunNow, DateTime.UtcNow, ct);
        return Ok(ApiEnvelope<ScheduleRunDto>.Ok(ScheduleRunDto.From(run)));
    }

    /// <summary>Renders the request as the caller and sends it to the caller only. Nothing is saved.</summary>
    [HttpPost("test")]
    public async Task<IActionResult> Test([FromBody] ScheduleRequest request, CancellationToken ct)
    {
        if (Denied(ModulePermission.Create, out var tenantId, out var userId) is { } denied) return denied;
        var now = DateTime.UtcNow;
        // A run once time already past is fine for a test.
        var checkedRequest = string.IsNullOrWhiteSpace(request.Cron) && request.RunOnceAt is not null ? request with { RunOnceAt = now.AddDays(1) } : request;
        if (await Refusal(checkedRequest, tenantId, userId, now, ct) is { } refused) return refused;
        var schedule = new Schedule { TenantId = tenantId, OwnerUserId = userId };
        Apply(schedule, request, userId, now);
        var run = await runner.RunAsync(schedule, DeliveryTerms.Test, now, ct);
        return Ok(ApiEnvelope<ScheduleRunDto>.Ok(ScheduleRunDto.From(run)));
    }

    /// <summary>The next five run times, UTC, for the dialog's preview.</summary>
    [HttpPost("preview-runs")]
    public IActionResult PreviewRuns([FromBody] PreviewRunsRequest request)
    {
        if (Denied(ModulePermission.View, out _, out _) is { } denied) return denied;
        var spec = new RecurrenceSpec(request.Cron, request.RunOnceAt, request.TimeZone ?? string.Empty, request.StartAt, request.EndAt);
        if (Recurrence.Problem(spec) is { } problem) return BadRequest(ApiEnvelope<object>.Fail(problem, 400));
        var runs = Recurrence.NextFive(spec, DateTime.UtcNow)
            .Select(t => t.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture)).ToList();
        return Ok(ApiEnvelope<IReadOnlyList<string>>.Ok(runs));
    }

    [HttpGet("runs")]
    public async Task<IActionResult> Runs(
        [FromQuery] long? scheduleId, [FromQuery] string? status, [FromQuery] DateTime? from, [FromQuery] DateTime? to,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 50, CancellationToken ct = default)
    {
        if (Denied(ModulePermission.View, out var tenantId, out _) is { } denied) return denied;
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 200);
        var (items, total) = await store.RunsAsync(tenantId, scheduleId, status, Utc(from), Utc(to), page, pageSize, ct);
        return Ok(ApiEnvelope<ScheduleRunPage>.Ok(new ScheduleRunPage(items.Select(ScheduleRunDto.From).ToList(), total)));
    }

    private static void Apply(Schedule schedule, ScheduleRequest r, long userId, DateTime now)
    {
        schedule.Name = r.Name!.Trim();
        schedule.TargetType = r.TargetType!;
        schedule.TargetId = r.TargetId;
        schedule.Format = r.Format!;
        schedule.Cron = string.IsNullOrWhiteSpace(r.Cron) ? null : r.Cron.Trim();
        schedule.RunOnceAt = schedule.Cron is null ? Utc(r.RunOnceAt) : null;
        schedule.TimeZone = r.TimeZone!.Trim();
        schedule.StartAt = Utc(r.StartAt);
        schedule.EndAt = Utc(r.EndAt);
        schedule.SkipIfEmpty = r.SkipIfEmpty && r.Format != DeliveryTerms.Link;
        schedule.Subject = r.Subject!.Trim();
        schedule.Body = r.Body ?? string.Empty;
        schedule.Recipients.Clear();
        schedule.Recipients.AddRange((r.Recipients ?? []).Select(x => new ScheduleRecipient
        {
            Kind = x.Kind, RecipientType = x.Type, Value = x.Value.Trim(),
            Label = x.Label?.Trim() is { Length: > 0 } label ? label[..Math.Min(200, label.Length)] : null,
        }));
        if (schedule.IsActive) schedule.NextRunAt = Recurrence.Next(Spec(schedule), now);
        schedule.ModifiedBy = schedule.Id == 0 ? null : userId;
        schedule.ModifiedAt = now;
    }

    private static void Touch(Schedule schedule, long userId)
    {
        schedule.ModifiedBy = userId;
        schedule.ModifiedAt = DateTime.UtcNow;
    }

    /// <summary>Null when the caller may save or test the request; else the 400 or 403 to return.</summary>
    private async Task<IActionResult?> Refusal(ScheduleRequest request, long tenantId, long userId, DateTime now, CancellationToken ct)
    {
        if (ScheduleRules.Problem(request, now) is { } problem) return BadRequest(ApiEnvelope<object>.Fail(problem, 400));
        var kind = request.TargetType!.ToLowerInvariant();
        if (!ScheduleRules.CanView(request.TargetType!, code => ModulePermission.Has(User, code, ModulePermission.View)))
            return StatusCode(StatusCodes.Status403Forbidden, ApiEnvelope<object>.Fail($"You do not have permission to view this {kind}.", 403));
        var names = await store.TargetNamesAsync(tenantId, [(request.TargetType!, request.TargetId)], userId, ct);
        return names.Count == 0 ? BadRequest(ApiEnvelope<object>.Fail($"The {kind} was not found, or you cannot open it.", 400)) : null;
    }

    /// <summary>The tracked schedule when the caller may change it, else the 401, 403 or 404 to return.</summary>
    private async Task<(Schedule? Schedule, long TenantId, long UserId, IActionResult? Refusal)> EditableAsync(long id, CancellationToken ct)
    {
        if (Denied(ModulePermission.View, out var tenantId, out var userId) is { } denied) return (null, tenantId, userId, denied);
        var schedule = await store.GetAsync(id, tenantId, ct);
        if (schedule is null) return (null, tenantId, userId, NotFoundSchedule());
        var allowed = schedule.OwnerUserId == userId || ModulePermission.Has(User, ModulePermission.Schedules, ModulePermission.Modify);
        return allowed
            ? (schedule, tenantId, userId, null)
            : (null, tenantId, userId, StatusCode(StatusCodes.Status403Forbidden, ApiEnvelope<object>.Fail("Only the schedule's owner or someone who can modify schedules may change it.", 403)));
    }

    private async Task<IReadOnlyList<ScheduleDto>> DtosAsync(long tenantId, IReadOnlyList<Schedule> schedules, CancellationToken ct)
    {
        var names = await store.TargetNamesAsync(tenantId, schedules.Select(s => (s.TargetType, s.TargetId)).Distinct().ToList(), null, ct);
        var owners = new Dictionary<long, string>();
        try
        {
            foreach (var user in await directory.ResolveAsync(tenantId, schedules.Select(s => s.OwnerUserId).Distinct().ToList(), [], ct))
                owners[user.UserId] = user.Name ?? user.Email;
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !ct.IsCancellationRequested)
        {
            // The list still shows when the control plane is down; owner names are left blank.
        }
        return schedules.Select(s => ScheduleDto.From(s, owners.GetValueOrDefault(s.OwnerUserId), names.GetValueOrDefault((s.TargetType, s.TargetId)))).ToList();
    }

    private static RecurrenceSpec Spec(Schedule s) => new(s.Cron, s.RunOnceAt, s.TimeZone, s.StartAt, s.EndAt);

    private static DateTime? Utc(DateTime? value) => value is { } v ? Recurrence.AsUtc(v) : null;

    private ObjectResult NotFoundSchedule() => NotFound(ApiEnvelope<object>.Fail("The schedule was not found.", 404));

    /// <summary>Null when the caller holds the action on smart-alerts.schedules; otherwise the 401 or 403 to return.</summary>
    private IActionResult? Denied(char action, out long tenantId, out long userId)
    {
        userId = 0;
        if (!long.TryParse(User.FindFirst("tenantId")?.Value, out tenantId) || tenantId <= 0)
            return StatusCode(StatusCodes.Status401Unauthorized, ApiEnvelope<object>.Fail("TenantId not found in token.", 401));
        // A schedule runs as its owner, so every call must name its user.
        if (!long.TryParse(User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out userId) || userId <= 0)
            return StatusCode(StatusCodes.Status401Unauthorized, ApiEnvelope<object>.Fail("UserId not found in token.", 401));
        return ModulePermission.Has(User, ModulePermission.Schedules, action)
            ? null
            : StatusCode(StatusCodes.Status403Forbidden, ApiEnvelope<object>.Fail("You do not have permission to manage schedules.", 403));
    }
}
