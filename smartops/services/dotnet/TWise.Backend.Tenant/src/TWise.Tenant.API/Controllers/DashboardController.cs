using MediatR;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Features.Categories;
using TWise.Tenant.Application.Features.Dashboards;
using TWise.Tenant.Domain;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.API.Controllers;

[Route("api/[controller]")]
[Authorize]
[TypeFilter(typeof(TWise.Tenant.API.Auth.BiWritePermissionFilter))]
public class DashboardController(IMediator mediator, IDashboardLogoStorage logoStorage) : BaseApiController
{
    private async Task<bool> HasValidBrandingAsync(string? configJson, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(configJson)) return true;
        try
        {
            var branding = JsonNode.Parse(configJson)?["branding"];
            if (branding is null) return true;
            if (branding is not JsonObject) return false;
            foreach (var side in new[] { "leftLogo", "rightLogo" })
            {
                if (branding[side] is null) continue;
                var assetId = branding[side]?["assetId"]?.GetValue<string>();
                if (string.IsNullOrWhiteSpace(assetId)
                    || !long.TryParse(User.FindFirst("tenantId")?.Value, out var tenantId) || tenantId <= 0
                    || await logoStorage.ReadAsync(assetId, tenantId, ct) is null) return false;
            }
            return true;
        }
        catch (System.Text.Json.JsonException) { return false; }
        catch (InvalidOperationException) { return false; }
    }

    /// <summary>
    /// Create a new dashboard (Status = "Draft").
    /// </summary>
    [HttpPost]
    [ProducesResponseType(typeof(ApiEnvelope<CreateDashboardResponse>), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<IActionResult> CreateDashboard([FromBody] SaveDashboardRequest request, CancellationToken ct)
    {
        if (!await HasValidBrandingAsync(request.ConfigJson, ct)) return BadRequest(ApiEnvelope<object>.Fail("Invalid dashboard logo reference.", 400));
        var result = await mediator.Send(new CreateDashboardCommand(request), ct);
        return ToActionResult(result, StatusCodes.Status201Created);
    }

    /// <summary>
    /// Get categories for dropdown.
    /// </summary>
    [HttpGet("categories")]
    public async Task<IActionResult> GetCategories(CancellationToken ct)
    {
        var result = await mediator.Send(new GetCategoriesQuery(), ct);
        return ToActionResult(result);
    }

    /// <summary>
    /// Get WIP (In Progress) dashboards grouped by category. kind is dashboard (the default) or canvas.
    /// </summary>
    [HttpGet("wip")]
    public async Task<IActionResult> GetWipDashboards([FromQuery] string? kind, CancellationToken ct)
    {
        var result = await mediator.Send(new GetWipDashboardsQuery(kind), ct);
        return ToActionResult(result);
    }

    /// <summary>
    /// Minimal list of the current user's WIP dashboards (id + name) for the copy-chart picker. kind as for wip.
    /// </summary>
    [HttpGet("wip-min")]
    public async Task<IActionResult> GetWipDashboardsMinimal([FromQuery] string? kind, CancellationToken ct)
    {
        var result = await mediator.Send(new GetWipDashboardsMinimalQuery(kind), ct);
        return ToActionResult(result);
    }

    /// <summary>
    /// Get Published dashboards grouped by category. kind as for wip.
    /// </summary>
    [HttpGet("published")]
    public async Task<IActionResult> GetPublishedDashboards([FromQuery] string? kind, CancellationToken ct)
    {
        var result = await mediator.Send(new GetPublishedDashboardsQuery(kind), ct);
        return ToActionResult(result);
    }

    /// <summary>
    /// Publish a dashboard (admin role required).
    /// </summary>
    [HttpPost("{dashboardId}/publish")]
    [Authorize(Roles = "admin,tenant_admin,TenantAdmin,platform_admin,PlatformAdmin")]
    [ProducesResponseType(typeof(ApiEnvelope<PublishDashboardResponse>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiEnvelope<object>), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ApiEnvelope<object>), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ApiEnvelope<object>), StatusCodes.Status409Conflict)]
    public async Task<IActionResult> PublishDashboard(int dashboardId, CancellationToken ct)
    {
        var result = await mediator.Send(new PublishDashboardCommand(dashboardId), ct);
        return ToActionResult(result);
    }

    /// <summary>
    /// Move a published dashboard back to Draft (admin role required).
    /// </summary>
    [HttpPost("{dashboardId}/unpublish")]
    [Authorize(Roles = "admin,tenant_admin,TenantAdmin,platform_admin,PlatformAdmin")]
    [ProducesResponseType(typeof(ApiEnvelope<PublishDashboardResponse>), StatusCodes.Status200OK)]
    public async Task<IActionResult> UnpublishDashboard(int dashboardId, CancellationToken ct)
    {
        var result = await mediator.Send(new UnpublishDashboardCommand(dashboardId), ct);
        return ToActionResult(result);
    }

    /// <summary>
    /// Mark a dashboard as completed.
    /// </summary>
    [HttpPost("{dashboardId}/complete")]
    [ProducesResponseType(typeof(ApiEnvelope<CompleteDashboardResponse>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiEnvelope<object>), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ApiEnvelope<object>), StatusCodes.Status409Conflict)]
    public async Task<IActionResult> CompleteDashboard(int dashboardId, CancellationToken ct)
    {
        var result = await mediator.Send(new CompleteDashboardCommand(dashboardId), ct);
        return ToActionResult(result);
    }

    /// <summary>
    /// Move a Completed dashboard back to Draft.
    /// </summary>
    [HttpPost("{dashboardId}/reopen")]
    [ProducesResponseType(typeof(ApiEnvelope<ReopenDashboardResponse>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiEnvelope<object>), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ApiEnvelope<object>), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ApiEnvelope<object>), StatusCodes.Status409Conflict)]
    public async Task<IActionResult> ReopenDashboard(int dashboardId, CancellationToken ct)
    {
        var result = await mediator.Send(new ReopenDashboardCommand(dashboardId), ct);
        return ToActionResult(result);
    }

    /// <summary>
    /// Copy a published dashboard into a new Draft dashboard (appears in WIP Boards).
    /// </summary>
    [HttpPost("{dashboardId}/copy-to-draft")]
    [ProducesResponseType(typeof(ApiEnvelope<CreateDashboardResponse>), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(ApiEnvelope<object>), StatusCodes.Status404NotFound)]
    public async Task<IActionResult> CopyDashboardToDraft(int dashboardId, CancellationToken ct)
    {
        var result = await mediator.Send(new CopyDashboardToDraftCommand(dashboardId), ct);
        return ToActionResult(result, StatusCodes.Status201Created);
    }

    /// <summary>
    /// Generate a new external, token-protected link for a dashboard.
    /// </summary>
    [HttpPost("{dashboardId}/share-link")]
    public async Task<IActionResult> CreateShareLink(int dashboardId, CancellationToken ct)
    {
        var result = await mediator.Send(new CreateDashboardShareLinkCommand(dashboardId), ct);
        return ToActionResult(result);
    }

    /// <summary>
    /// Share a dashboard internally with specific tenant users (shows up in their "Shared" tab).
    /// </summary>
    [HttpPost("{dashboardId}/share-internal")]
    public async Task<IActionResult> ShareInternally(int dashboardId, [FromBody] ShareDashboardInternallyRequest request, CancellationToken ct)
    {
        if (!TryGetTenantId(out var tenantId)) return Unauthorized("TenantId not found in token.");
        var result = await mediator.Send(new ShareDashboardInternallyCommand(dashboardId, request.UserIds, tenantId), ct);
        return ToActionResult(result);
    }

    /// <summary>
    /// Get dashboards internally shared with the current user, grouped by category. kind as for wip.
    /// </summary>
    [HttpGet("shared-with-me")]
    public async Task<IActionResult> GetSharedWithMeDashboards([FromQuery] string? kind, CancellationToken ct)
    {
        var result = await mediator.Send(new GetSharedWithMeDashboardsQuery(kind), ct);
        return ToActionResult(result);
    }

    /// <summary>
    /// Get one dashboard through its external share token. This is the only anonymous dashboard endpoint.
    /// </summary>
    [AllowAnonymous]
    [HttpGet("shared/{dashboardId}")]
    public async Task<IActionResult> GetSharedDashboard(int dashboardId, [FromQuery] string token, CancellationToken ct)
    {
        var result = await mediator.Send(new GetSharedDashboardQuery(dashboardId, token), ct);
        return ToActionResult(result);
    }

    /// <summary>
    /// Get only the widgets configured on an externally shared dashboard.
    /// </summary>
    [AllowAnonymous]
    [HttpGet("shared/{dashboardId}/widgets")]
    public async Task<IActionResult> GetSharedDashboardWidgets(int dashboardId, [FromQuery] string token, CancellationToken ct)
    {
        var result = await mediator.Send(new GetSharedDashboardWidgetsQuery(dashboardId, token), ct);
        return ToActionResult(result);
    }

    [AllowAnonymous]
    [HttpGet("shared/{dashboardId}/widgets/{widgetId:long}")]
    public async Task<IActionResult> GetSharedWidget(int dashboardId, long widgetId, [FromQuery] string token,
        [FromServices] IDashboardShareAccessService shareAccess, CancellationToken ct)
    {
        var widget = await shareAccess.FindSharedWidgetByIdAsync(dashboardId, token, widgetId, ct);
        return widget is null ? NotFound() : Ok(widget);
    }

    /// <summary>
    /// Get published version history for a dashboard's series (newest first).
    /// </summary>
    [HttpGet("{dashboardId}/versions")]
    [TypeFilter(typeof(TWise.Tenant.API.Auth.DashboardVersionPermissionFilter))]
    [ProducesResponseType(typeof(ApiEnvelope<IReadOnlyList<DashboardVersionSummaryResponse>>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiEnvelope<object>), StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetVersionHistory(int dashboardId, CancellationToken ct)
    {
        var result = await mediator.Send(new GetDashboardVersionHistoryQuery(dashboardId), ct);
        return ToActionResult(result);
    }

    /// <summary>
    /// Restore a previous published version (admin role required).
    ///
    /// Append-only: the chosen version's content is republished as a NEW version rather than
    /// reactivating the old row, so the version history — including the faulty version that
    /// prompted the rollback — stays intact for audit.
    /// </summary>
    [HttpPost("{dashboardId}/restore/{versionNo:int}")]
    [Authorize(Roles = "admin,tenant_admin,TenantAdmin,platform_admin,PlatformAdmin")]
    [ProducesResponseType(typeof(ApiEnvelope<RestoreDashboardVersionResponse>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiEnvelope<object>), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ApiEnvelope<object>), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ApiEnvelope<object>), StatusCodes.Status409Conflict)]
    public async Task<IActionResult> RestoreVersion(int dashboardId, int versionNo, CancellationToken ct)
    {
        var result = await mediator.Send(new RestoreDashboardVersionCommand(dashboardId, versionNo), ct);
        return ToActionResult(result);
    }

    /// <summary>
    /// Update a dashboard (name, description, widget layout/config).
    /// </summary>
    [HttpPut("{dashboardId}")]
    [ProducesResponseType(typeof(ApiEnvelope<UpdateDashboardResponse>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiEnvelope<object>), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ApiEnvelope<object>), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ApiEnvelope<object>), StatusCodes.Status409Conflict)]
    public async Task<IActionResult> UpdateDashboard(int dashboardId, [FromBody] SaveDashboardRequest request, CancellationToken ct)
    {
        if (!await HasValidBrandingAsync(request.ConfigJson, ct)) return BadRequest(ApiEnvelope<object>.Fail("Invalid dashboard logo reference.", 400));
        var result = await mediator.Send(new UpdateDashboardCommand(dashboardId, request), ct);
        return ToActionResult(result);
    }

    /// <summary>
    /// Soft delete a dashboard.
    /// </summary>
    [HttpDelete("{dashboardId}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(typeof(ApiEnvelope<object>), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ApiEnvelope<object>), StatusCodes.Status409Conflict)]
    public async Task<IActionResult> DeleteDashboard(int dashboardId, CancellationToken ct)
    {
        var result = await mediator.Send(new DeleteDashboardCommand(dashboardId), ct);
        return ToVoidActionResult(result);
    }

    /// <summary>
    /// Toggle enable/disable for a published dashboard.
    /// </summary>
    [HttpPatch("{dashboardId}/toggle-active")]
    [ProducesResponseType(typeof(ApiEnvelope<ToggleDashboardActiveResponse>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiEnvelope<object>), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ApiEnvelope<object>), StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> ToggleActive(int dashboardId, CancellationToken ct)
    {
        var result = await mediator.Send(new ToggleDashboardActiveCommand(dashboardId), ct);
        return ToActionResult(result);
    }

    /// <summary>
    /// Patch only the widget layout (ConfigJson, ModifiedBy, ModifiedAt).
    /// Called on reorder or resize — lightweight, no widget table writes.
    /// </summary>
    [HttpPatch("{dashboardId}/layout")]
    [ProducesResponseType(typeof(ApiEnvelope<PatchDashboardLayoutResponse>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiEnvelope<object>), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ApiEnvelope<object>), StatusCodes.Status403Forbidden)]
    public async Task<IActionResult> PatchLayout(int dashboardId, [FromBody] PatchDashboardLayoutRequest request, CancellationToken ct)
    {
        if (!await HasValidBrandingAsync(request.ConfigJson, ct)) return BadRequest(ApiEnvelope<object>.Fail("Invalid dashboard logo reference.", 400));
        var result = await mediator.Send(new PatchDashboardLayoutCommand(dashboardId, request.ConfigJson), ct);
        return ToActionResult(result);
    }

    /// <summary>
    /// Get a single dashboard with widgets (for edit page).
    /// </summary>
    [HttpGet("{dashboardId}")]
    [TypeFilter(typeof(TWise.Tenant.API.Auth.DashboardVersionPermissionFilter))]
    [ProducesResponseType(typeof(ApiEnvelope<DashboardDetailResponse>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetDashboard(int dashboardId, CancellationToken ct)
    {
        var result = await mediator.Send(new GetDashboardByIdQuery(dashboardId), ct);
        return ToActionResult(result);
    }

    /// <summary>
    /// Get the widgets referenced by a specific dashboard (any authenticated user \u2014 e.g. a dashboard
    /// shared internally with a user who does not own its widgets still renders correctly).
    /// </summary>
    [HttpGet("{dashboardId}/widgets")]
    [TypeFilter(typeof(TWise.Tenant.API.Auth.DashboardVersionPermissionFilter))]
    [ProducesResponseType(typeof(ApiEnvelope<WidgetLibraryResponse>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetDashboardWidgets(int dashboardId, CancellationToken ct)
    {
        var result = await mediator.Send(new GetDashboardWidgetsQuery(dashboardId), ct);
        return ToActionResult(result);
    }

    /// <summary>
    /// Get active charts and tiles from core.Widgets for the Dashboard Builder library.
    /// Returns published (shared) widgets plus the current user's drafts, grouped by type.
    /// </summary>
    [HttpGet("widgets/library")]
    [ProducesResponseType(typeof(ApiEnvelope<WidgetLibraryResponse>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetWidgetLibrary(CancellationToken ct)
    {
        var result = await mediator.Send(new GetWidgetLibraryQuery(), ct);
        return ToActionResult(result);
    }

    private bool TryGetTenantId(out long tenantId)
    {
        tenantId = 0;
        var claim = User.FindFirst("tenantId")?.Value;
        return claim is not null && long.TryParse(claim, out tenantId) && tenantId > 0;
    }
}
