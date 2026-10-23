using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Features.Ai.Dictionary;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.API.Controllers;

/// <summary>Data governance: the data dictionary and the lineage graph.</summary>
[ApiController]
[Authorize]
[Route("api/governance")]
public sealed class GovernanceController(IGovernanceService governance, ISender sender) : ControllerBase
{
    /// <summary>The AI's draft documentation for a dataset (Draft the data dictionary feature). Nothing is saved: the
    /// editor shows it for review and the user saves with PUT. 400 with { message } when the AI cannot draft it.</summary>
    [HttpPost("dictionary/{kind}/{id:long}/draft")]
    [ProducesResponseType(typeof(DictionaryDraftDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> DraftDataset(string kind, long id, CancellationToken ct)
    {
        if (!TryGetUserId(out var userId)) return Unauthorized();
        if (!TryGetTenantId(out var tenantId)) return Unauthorized(TenantIdMissing);
        try
        {
            return await sender.Send(new DraftDictionaryCommand(kind, id, tenantId, userId), ct) is { } draft ? Ok(draft) : NotFound();
        }
        catch (Exception ex) when (ex is InvalidOperationException or HttpRequestException) { return BadRequest(new { message = ex.Message }); }
    }

    private const string TenantIdMissing = "TenantId not found in token.";

    /// <summary>Every documentable dataset (completed imports and database views) with coverage counts.</summary>
    [HttpGet("dictionary")]
    public async Task<ActionResult<IReadOnlyList<DictionaryDatasetDto>>> ListDatasets(CancellationToken ct)
    {
        if (!TryGetTenantId(out var tenantId)) return Unauthorized(TenantIdMissing);
        return Ok(await governance.ListDatasetsAsync(tenantId, ct));
    }

    /// <summary>One dataset's columns merged with their documentation. Kind is "import" or "view".</summary>
    [HttpGet("dictionary/{kind}/{id:long}")]
    public async Task<ActionResult<DictionaryDatasetDetailDto>> GetDataset(string kind, long id, CancellationToken ct)
    {
        if (!TryGetTenantId(out var tenantId)) return Unauthorized(TenantIdMissing);
        var detail = await governance.GetDatasetAsync(kind, id, tenantId, ct);
        return detail is null ? NotFound() : Ok(detail);
    }

    /// <summary>Saves dataset and column documentation. Unknown column names are ignored.</summary>
    [HttpPut("dictionary/{kind}/{id:long}")]
    public async Task<ActionResult<DictionaryDatasetDetailDto>> SaveDataset(string kind, long id, [FromBody] SaveDictionaryRequest request, CancellationToken ct)
    {
        if (!TryGetUserId(out var userId)) return Unauthorized();
        if (!TryGetTenantId(out var tenantId)) return Unauthorized(TenantIdMissing);
        var detail = await governance.SaveDatasetAsync(kind, id, request, userId, tenantId, ct);
        return detail is null ? NotFound() : Ok(detail);
    }

    /// <summary>Source → dataset → chart → dashboard/report graph for the tenant.</summary>
    [HttpGet("lineage")]
    public async Task<ActionResult<LineageGraphDto>> Lineage(CancellationToken ct)
    {
        if (!TryGetTenantId(out var tenantId)) return Unauthorized(TenantIdMissing);
        return Ok(await governance.GetLineageAsync(tenantId, ct));
    }

    private bool TryGetTenantId(out long tenantId) =>
        long.TryParse(User.FindFirst("tenantId")?.Value, out tenantId) && tenantId > 0;

    private bool TryGetUserId(out long userId) =>
        long.TryParse(User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out userId);
}
