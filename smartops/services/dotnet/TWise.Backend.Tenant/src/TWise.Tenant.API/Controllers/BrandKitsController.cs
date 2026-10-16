using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Application.Features.Canvas;
using TWise.Tenant.Domain;
using TWise.Tenant.Domain.Entities.Model;

namespace TWise.Tenant.API.Controllers;

/// <summary>
/// Saved brand kits for the reporting canvas. Anyone who can view canvases can list them; saving, changing and
/// deleting a kit needs modify on dashboard.canvas. A canvas keeps its own copy of a kit, so a change here never
/// changes a canvas.
/// </summary>
[Authorize]
[Route("api/canvas/brand-kits")]
public sealed class BrandKitsController(IBrandKitStore store) : BaseApiController
{
    [HttpGet]
    public async Task<IActionResult> List(CancellationToken ct)
    {
        if (Denied(ModulePermission.View, out var tenantId, out _) is { } denied) return denied;
        var kits = await store.ListAsync(tenantId, ct);
        return Ok(ApiEnvelope<IReadOnlyList<BrandKitDto>>.Ok(kits.Select(BrandKitDto.From).ToList()));
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] BrandKitRequest request, CancellationToken ct)
    {
        if (Denied(ModulePermission.Modify, out var tenantId, out var userId) is { } denied) return denied;
        if (await Refusal(request, tenantId, null, ct) is { } refused) return refused;
        var now = DateTime.UtcNow;
        var kit = new BrandKit
        {
            TenantId = tenantId, Name = request.Name!.Trim(), Kit = request.Kit!.Value.GetRawText(),
            CreatedBy = userId, CreatedAt = now, ModifiedAt = now,
        };
        await store.AddAsync(kit, ct);
        return StatusCode(201, ApiEnvelope<BrandKitDto>.Ok(BrandKitDto.From(kit), statusCode: 201));
    }

    [HttpPut("{id:long}")]
    public async Task<IActionResult> Update(long id, [FromBody] BrandKitRequest request, CancellationToken ct)
    {
        if (Denied(ModulePermission.Modify, out var tenantId, out var userId) is { } denied) return denied;
        var kit = await store.GetAsync(id, tenantId, ct);
        if (kit is null) return NotFound(ApiEnvelope<object>.Fail("The brand kit was not found.", 404));
        if (await Refusal(request, tenantId, id, ct) is { } refused) return refused;
        kit.Name = request.Name!.Trim();
        kit.Kit = request.Kit!.Value.GetRawText();
        kit.ModifiedBy = userId;
        kit.ModifiedAt = DateTime.UtcNow;
        await store.SaveAsync(ct);
        return Ok(ApiEnvelope<BrandKitDto>.Ok(BrandKitDto.From(kit)));
    }

    [HttpDelete("{id:long}")]
    public async Task<IActionResult> Delete(long id, CancellationToken ct)
    {
        if (Denied(ModulePermission.Modify, out var tenantId, out var userId) is { } denied) return denied;
        var kit = await store.GetAsync(id, tenantId, ct);
        if (kit is null) return NotFound(ApiEnvelope<object>.Fail("The brand kit was not found.", 404));
        kit.IsDeleted = true;
        kit.ModifiedBy = userId;
        kit.ModifiedAt = DateTime.UtcNow;
        await store.SaveAsync(ct);
        return NoContent();
    }

    private async Task<IActionResult?> Refusal(BrandKitRequest request, long tenantId, long? id, CancellationToken ct)
    {
        if (BrandKitRules.Problem(request) is { } problem) return BadRequest(ApiEnvelope<object>.Fail(problem, 400));
        var name = request.Name!.Trim();
        return await store.NameTakenAsync(tenantId, name, id, ct)
            ? Conflict(ApiEnvelope<object>.Fail($"A brand kit named \"{name}\" already exists.", 409))
            : null;
    }

    /// <summary>Null when the caller may perform the action; otherwise the 401 or 403 to return.</summary>
    private IActionResult? Denied(char action, out long tenantId, out long userId)
    {
        userId = 0;
        if (!long.TryParse(User.FindFirst("tenantId")?.Value, out tenantId) || tenantId <= 0)
            return StatusCode(StatusCodes.Status401Unauthorized, ApiEnvelope<object>.Fail("TenantId not found in token.", 401));
        _ = long.TryParse(User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out userId);
        var allowed = action == ModulePermission.View
            ? ModulePermission.Has(User, ModulePermission.Canvas, ModulePermission.View)
              || ModulePermission.Has(User, ModulePermission.StandardCanvases, ModulePermission.View)
            : ModulePermission.Has(User, ModulePermission.Canvas, action);
        return allowed
            ? null
            : StatusCode(StatusCodes.Status403Forbidden, ApiEnvelope<object>.Fail("You do not have permission to change brand kits.", 403));
    }
}
