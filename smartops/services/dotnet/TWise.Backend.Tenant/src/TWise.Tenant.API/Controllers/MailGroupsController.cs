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
/// Named address lists schedules can send to. View on smart-alerts.schedules lists them, create adds one, modify changes
/// or deletes one. A schedule reads a group's addresses when it runs, so a change reaches the next run.
/// </summary>
[Authorize]
[Route("api/mail-groups")]
public sealed class MailGroupsController(IMailGroupStore store) : BaseApiController
{
    [HttpGet]
    public async Task<IActionResult> List(CancellationToken ct)
    {
        if (Denied(ModulePermission.View, out var tenantId, out _) is { } denied) return denied;
        var groups = await store.ListAsync(tenantId, ct);
        return Ok(ApiEnvelope<IReadOnlyList<MailGroupDto>>.Ok(groups.Select(MailGroupDto.From).ToList()));
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] MailGroupRequest request, CancellationToken ct)
    {
        if (Denied(ModulePermission.Create, out var tenantId, out var userId) is { } denied) return denied;
        if (await Refusal(request, tenantId, null, ct) is { } refused) return refused;
        ScheduleRules.MailGroupProblem(request, out var members);
        var now = DateTime.UtcNow;
        var group = new MailGroup
        {
            TenantId = tenantId, Name = request.Name!.Trim(), Description = Description(request), CreatedBy = userId, CreatedAt = now,
            ModifiedAt = now, Members = members.Select(m => new MailGroupMember { Email = m }).ToList(),
        };
        await store.AddAsync(group, ct);
        return StatusCode(201, ApiEnvelope<MailGroupDto>.Ok(MailGroupDto.From(group), statusCode: 201));
    }

    [HttpPut("{id:long}")]
    public async Task<IActionResult> Update(long id, [FromBody] MailGroupRequest request, CancellationToken ct)
    {
        if (Denied(ModulePermission.Modify, out var tenantId, out var userId) is { } denied) return denied;
        var group = await store.GetAsync(id, tenantId, ct);
        if (group is null) return NotFound(ApiEnvelope<object>.Fail("The mail group was not found.", 404));
        if (await Refusal(request, tenantId, id, ct) is { } refused) return refused;
        ScheduleRules.MailGroupProblem(request, out var members);
        group.Name = request.Name!.Trim();
        group.Description = Description(request);
        group.Members.Clear();
        group.Members.AddRange(members.Select(m => new MailGroupMember { Email = m }));
        group.ModifiedBy = userId;
        group.ModifiedAt = DateTime.UtcNow;
        await store.SaveAsync(ct);
        return Ok(ApiEnvelope<MailGroupDto>.Ok(MailGroupDto.From(group)));
    }

    [HttpDelete("{id:long}")]
    public async Task<IActionResult> Delete(long id, CancellationToken ct)
    {
        if (Denied(ModulePermission.Modify, out var tenantId, out var userId) is { } denied) return denied;
        var group = await store.GetAsync(id, tenantId, ct);
        if (group is null) return NotFound(ApiEnvelope<object>.Fail("The mail group was not found.", 404));
        group.IsDeleted = true;
        group.ModifiedBy = userId;
        group.ModifiedAt = DateTime.UtcNow;
        await store.SaveAsync(ct);
        return NoContent();
    }

    private static string? Description(MailGroupRequest request)
        => string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim();

    private async Task<IActionResult?> Refusal(MailGroupRequest request, long tenantId, long? id, CancellationToken ct)
    {
        if (ScheduleRules.MailGroupProblem(request, out _) is { } problem) return BadRequest(ApiEnvelope<object>.Fail(problem, 400));
        var name = request.Name!.Trim();
        return await store.NameTakenAsync(tenantId, name, id, ct)
            ? Conflict(ApiEnvelope<object>.Fail($"A mail group named \"{name}\" already exists.", 409))
            : null;
    }

    /// <summary>Null when the caller holds the action on smart-alerts.schedules; otherwise the 401 or 403 to return.</summary>
    private IActionResult? Denied(char action, out long tenantId, out long userId)
    {
        userId = 0;
        if (!long.TryParse(User.FindFirst("tenantId")?.Value, out tenantId) || tenantId <= 0)
            return StatusCode(StatusCodes.Status401Unauthorized, ApiEnvelope<object>.Fail("TenantId not found in token.", 401));
        if (!long.TryParse(User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out userId) || userId <= 0)
            return StatusCode(StatusCodes.Status401Unauthorized, ApiEnvelope<object>.Fail("UserId not found in token.", 401));
        return ModulePermission.Has(User, ModulePermission.Schedules, action)
            ? null
            : StatusCode(StatusCodes.Status403Forbidden, ApiEnvelope<object>.Fail("You do not have permission to change mail groups.", 403));
    }
}
