using System.IdentityModel.Tokens.Jwt;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Features.DatabaseViews;
using TWise.Tenant.Domain.DTOs;

using TWise.Tenant.API.Auth;

namespace TWise.Tenant.API.Controllers;

/// <summary>
/// Manages database views created via the View Builder UI.
/// Stores the full builder definition (tables, joins, columns, filters)
/// and the generated SQL query. Supports live data preview.
/// </summary>
[ApiController]
// [Authorize]
[Route("api/database-views")]
public sealed class DatabaseViewController(ISender sender, IDashboardShareAccessService shareAccess) : ControllerBase
{
    private const string TenantIdMissing = "TenantId not found in token.";

    /// <summary>
    /// Returns all available enum options for the View Builder UI dropdowns:
    /// join types, filter operators, logical connectors, and sort directions.
    /// </summary>
    [HttpGet("options")]
    [ProducesResponseType(typeof(ViewBuilderOptionsResponse), StatusCodes.Status200OK)]
    public IActionResult GetBuilderOptions()
    {
        return Ok(ViewBuilderOptions.All);
    }

    /// <summary>List all database views for the current tenant (summary view for the grid).</summary>
    [HttpGet]
    [ProducesResponseType(typeof(IReadOnlyList<DatabaseViewListDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> GetAll([FromQuery] string? type, CancellationToken cancellationToken)
    {
        if (!TryGetTenantId(out var tenantId)) return Unauthorized(TenantIdMissing);
        return Ok(await sender.Send(new ListDatabaseViewsQuery(tenantId, type), cancellationToken));
    }

    [AllowAnonymous]
    [HttpGet("shared-value")]
    public async Task<IActionResult> GetSharedValue([FromQuery] int shareDashboardId, [FromQuery] string shareToken,
        [FromQuery] string sourceName, [FromQuery] string column, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(column)) return BadRequest();
        var widget = await shareAccess.FindSharedTableWidgetAsync(shareDashboardId, shareToken, sourceName, "View", ct);
        if (widget is null) return Forbid();
        var views = await sender.Send(new ListDatabaseViewsQuery(widget.TenantId, "view"), ct);
        var view = views.FirstOrDefault(item => item.ViewName.Equals(sourceName, StringComparison.OrdinalIgnoreCase));
        if (view is null) return NotFound();
        var result = await sender.Send(new PreviewDatabaseViewCommand(
            new PreviewDatabaseViewRequest(view.ConnectionId, ViewId: view.Id, MaxRows: 1), widget.TenantId), ct);
        return result is null ? NotFound() : Ok(new { value = result.Rows.FirstOrDefault()?.GetValueOrDefault(column) });
    }

    /// <summary>Every view checked against the view contract (docs/VIEW-CONTRACT.md). An empty
    /// violation list means the view is model-compliant.</summary>
    [HttpGet("contract-report")]
    [ProducesResponseType(typeof(IReadOnlyList<ViewContractReportItem>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> GetContractReport(CancellationToken cancellationToken)
    {
        if (!TryGetTenantId(out var tenantId)) return Unauthorized(TenantIdMissing);
        return Ok(await sender.Send(new GetViewContractReportQuery(tenantId), cancellationToken));
    }

    /// <summary>Get a single database view by ID (full definition for the builder). Also usable
    /// anonymously via shareDashboardId/shareToken for a dashboard shared externally.</summary>
    [HttpGet("{id:long}")]
    [ProducesResponseType(typeof(DatabaseViewDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetById(long id, [FromQuery] int? shareDashboardId, [FromQuery] string? shareToken, CancellationToken cancellationToken)
    {
        if (!TryGetTenantId(out var tenantId))
        {
            if (shareDashboardId is null || string.IsNullOrWhiteSpace(shareToken)) return Unauthorized(TenantIdMissing);
            var widget = await shareAccess.FindSharedViewWidgetAsync(shareDashboardId.Value, shareToken, id, cancellationToken);
            if (widget is null) return Forbid();
            tenantId = widget.TenantId;
        }
        var result = await sender.Send(new GetDatabaseViewQuery(id, tenantId), cancellationToken);
        return result is null ? NotFound() : Ok(result);
    }

    /// <summary>The last stored data preview of a view (first maxRows rows, 1–5000), shown while the
    /// live preview runs. 204 when the view has never been previewed.</summary>
    [HttpGet("{id:long}/preview-snapshot")]
    [ProducesResponseType(typeof(PreviewSnapshotDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> GetPreviewSnapshot(long id, [FromQuery] int maxRows, [FromQuery] int? shareDashboardId, [FromQuery] string? shareToken, CancellationToken cancellationToken)
    {
        if (!TryGetTenantId(out var tenantId))
        {
            if (shareDashboardId is null || string.IsNullOrWhiteSpace(shareToken)) return Unauthorized(TenantIdMissing);
            var widget = await shareAccess.FindSharedViewWidgetAsync(shareDashboardId.Value, shareToken, id, cancellationToken);
            if (widget is null) return Forbid();
            tenantId = widget.TenantId;
        }
        var result = await sender.Send(new GetPreviewSnapshotQuery(id, tenantId, Math.Clamp(maxRows, 1, 5000)), cancellationToken);
        return result is null ? NoContent() : Ok(result);
    }

    /// <summary>Save a new database view from the View Builder.</summary>
    [HttpPost]
    [RequireModulePermission("settings.database-view", 'c')]
    [ProducesResponseType(typeof(DatabaseViewDto), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> Create([FromBody] CreateDatabaseViewRequest request, CancellationToken cancellationToken)
    {
        if (!TryGetUserId(out var userId)) return Unauthorized();
        if (!TryGetTenantId(out var tenantId)) return Unauthorized(TenantIdMissing);

        var created = await sender.Send(new CreateDatabaseViewCommand(request, userId, tenantId), cancellationToken);
        return CreatedAtAction(nameof(GetById), new { id = created.Id }, created);
    }

    /// <summary>Update an existing database view definition.</summary>
    [HttpPut("{id:long}")]
    [RequireModulePermission("settings.database-view", 'm')]
    [ProducesResponseType(typeof(DatabaseViewDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Update(long id, [FromBody] UpdateDatabaseViewRequest request, CancellationToken cancellationToken)
    {
        if (!TryGetUserId(out var userId)) return Unauthorized();
        if (!TryGetTenantId(out var tenantId)) return Unauthorized(TenantIdMissing);

        var result = await sender.Send(new UpdateDatabaseViewCommand(id, request, userId, tenantId), cancellationToken);
        return result is null ? NotFound() : Ok(result);
    }

    /// <summary>Soft-delete a database view.</summary>
    [HttpDelete("{id:long}")]
    [RequireModulePermission("settings.database-view", 'm')]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Delete(long id, CancellationToken cancellationToken)
    {
        if (!TryGetUserId(out var userId)) return Unauthorized();
        if (!TryGetTenantId(out var tenantId)) return Unauthorized(TenantIdMissing);
        return await sender.Send(new DeleteDatabaseViewCommand(id, userId, tenantId), cancellationToken) ? NoContent() : NotFound();
    }

    /// <summary>Execute the view SQL against the connection and return a data preview. Also usable
    /// anonymously via shareDashboardId/shareToken for a dashboard shared externally.</summary>
    [HttpPost("preview")]
    [ProducesResponseType(typeof(PreviewDatabaseViewResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Preview([FromBody] PreviewDatabaseViewRequest request, [FromQuery] int? shareDashboardId, [FromQuery] string? shareToken, CancellationToken cancellationToken)
    {
        if (!TryGetTenantId(out var tenantId))
        {
            if (shareDashboardId is null || string.IsNullOrWhiteSpace(shareToken) || request.ViewId is null)
                return Unauthorized(TenantIdMissing);
            var widget = await shareAccess.FindSharedViewWidgetAsync(shareDashboardId.Value, shareToken, request.ViewId.Value, cancellationToken);
            if (widget is null) return Forbid();
            tenantId = widget.TenantId;
        }
        var result = await sender.Send(new PreviewDatabaseViewCommand(request, tenantId), cancellationToken);
        return result is null ? NotFound("Database connection not found.") : Ok(result);
    }

    /// <summary>Existing and suggested indexes for the tables the given view SQL reads (SQL Server).
    /// Reads catalog metadata only; the SQL is parsed, not run, and no index is created.</summary>
    [HttpPost("index-advice")]
    [ProducesResponseType(typeof(ViewIndexAdviceResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> IndexAdvice([FromBody] ViewIndexAdviceRequest request, CancellationToken cancellationToken)
    {
        if (!TryGetTenantId(out var tenantId)) return Unauthorized(TenantIdMissing);
        var result = await sender.Send(new GetViewIndexAdviceQuery(request, tenantId), cancellationToken);
        return result is null ? NotFound("Database connection not found.") : Ok(result);
    }

    private bool TryGetUserId(out long userId)
    {
        userId = 0;
        var sub = User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value
               ?? User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        return sub is not null && long.TryParse(sub, out userId);
    }

    private bool TryGetTenantId(out long tenantId)
    {
        tenantId = 0;
        var claim = User.FindFirst("tenantId")?.Value;
        return claim is not null && long.TryParse(claim, out tenantId) && tenantId > 0;
    }
}
