using MediatR;
using Microsoft.Extensions.Logging;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Features.Dashboards;

public sealed class ToggleDashboardActiveHandler(
    IDashboardRepository repo,
    ICurrentUserService currentUser,
    ILogger<ToggleDashboardActiveHandler> logger) : IRequestHandler<ToggleDashboardActiveCommand, Result<ToggleDashboardActiveResponse>>
{
    public async Task<Result<ToggleDashboardActiveResponse>> Handle(ToggleDashboardActiveCommand cmd, CancellationToken ct)
    {
        logger.LogInformation("Toggling dashboard active state. DashboardId={DashboardId}", cmd.DashboardId);

        // Only admin can toggle active state
        var isAdmin = currentUser.Roles.Any(r => r.Equals("admin", StringComparison.OrdinalIgnoreCase));
        if (!isAdmin)
            return Result<ToggleDashboardActiveResponse>.Forbidden("Only admin users can activate or deactivate dashboards.");

        var dashboard = await repo.GetDashboardByIdAsync(cmd.DashboardId, ct);
        if (dashboard is null)
            return Result<ToggleDashboardActiveResponse>.NotFound($"Dashboard with ID {cmd.DashboardId} not found.");

        if (dashboard.Status != DashboardStatus.Published && dashboard.Status != DashboardStatus.Inactive)
            return Result<ToggleDashboardActiveResponse>.ValidationError("Only published or inactive dashboards can be toggled. Current status: " + dashboard.Status + ".");

        // Un-publishing archives the current version in place (kept for history, no
        // longer "latest") and carries edits forward via a new (or already-open) draft
        // row instead of overwriting the published row back to Draft.
        if (dashboard.Status == DashboardStatus.Published)
        {
            dashboard.IsLatestVersion = false;
            dashboard.ModifiedBy = currentUser.UserId ?? "system";
            dashboard.ModifiedAt = DateTime.UtcNow;

            var userId = currentUser.UserId ?? "system";
            var existingDraft = await repo.GetActiveDraftForSeriesAsync(dashboard.DashboardSeriesId, ct);
            var newDraft = existingDraft ?? new Dashboard
            {
                // No "copy" suffix here: the live published board is being archived by this
                // very action, so there's no other row left with this name to clash with.
                DashboardName = dashboard.DashboardName,
                DashboardSeriesId = dashboard.DashboardSeriesId,
                CategoryId = dashboard.CategoryId,
                Description = dashboard.Description,
                ConfigJson = dashboard.ConfigJson,
                Status = DashboardStatus.Draft,
                VersionNo = null,
                IsLatestVersion = false,
                CreatedBy = userId,
                ModifiedBy = userId
            };

            await repo.UnpublishToNewDraftAsync(dashboard, existingDraft is null ? newDraft : null, ct);

            return Result<ToggleDashboardActiveResponse>.Success(new ToggleDashboardActiveResponse
            {
                DashboardId = newDraft.DashboardId,
                IsActive = false,
                Message = $"'{dashboard.DashboardName}' has been unpublished and moved to WIP Boards as a draft."
            });
        }
        else
        {
            dashboard.Status = DashboardStatus.Published;
            dashboard.IsActive = true;
        }
        dashboard.ModifiedBy = currentUser.UserId ?? "system";
        dashboard.ModifiedAt = DateTime.UtcNow;

        await repo.UpdateDashboardAsync(dashboard, ct);

        var message = $"Dashboard '{dashboard.DashboardName}' has been activated successfully.";

        logger.LogInformation("Dashboard toggled. DashboardId={DashboardId}, NewStatus={Status}", cmd.DashboardId, dashboard.Status);

        return Result<ToggleDashboardActiveResponse>.Success(new ToggleDashboardActiveResponse
        {
            DashboardId = dashboard.DashboardId,
            IsActive = dashboard.IsActive,
            Message = message
        });
    }
}

public sealed class PatchDashboardLayoutHandler(
    IDashboardRepository repo,
    ICurrentUserService currentUser,
    ILogger<PatchDashboardLayoutHandler> logger) : IRequestHandler<PatchDashboardLayoutCommand, Result<PatchDashboardLayoutResponse>>
{
    public async Task<Result<PatchDashboardLayoutResponse>> Handle(PatchDashboardLayoutCommand cmd, CancellationToken ct)
    {
        logger.LogInformation("Patching dashboard layout. DashboardId={DashboardId}", cmd.DashboardId);

        var dashboard = await repo.GetDashboardByIdAsync(cmd.DashboardId, ct);
        if (dashboard is null)
            return Result<PatchDashboardLayoutResponse>.NotFound($"Dashboard with ID {cmd.DashboardId} not found.");

        // Ownership check: only the creator or an admin can patch layout
        var userId = currentUser.UserId ?? "system";
        var isAdmin = currentUser.Roles.Any(r => r.Equals("admin", StringComparison.OrdinalIgnoreCase));
        if (!isAdmin && !string.Equals(dashboard.CreatedBy, userId, StringComparison.OrdinalIgnoreCase))
            return Result<PatchDashboardLayoutResponse>.Forbidden("You can only edit dashboards you created.");

        // The builder sends the full widget layout on every autosave.
        // The body replaces the whole stored config (only _meta is carried over), so it must be of the stored kind.
        var kindRefusal = DashboardKind.ChangeRefusal(dashboard.ConfigJson, cmd.ConfigJson);
        if (kindRefusal is not null)
            return Result<PatchDashboardLayoutResponse>.ValidationError(kindRefusal);

        dashboard.ConfigJson = DashboardShareLink.PreserveMeta(dashboard.ConfigJson, cmd.ConfigJson);
        dashboard.ModifiedBy = currentUser.UserId ?? "system";
        dashboard.ModifiedAt = DateTime.UtcNow;

        await repo.UpdateDashboardConfigAsync(dashboard, ct);

        return Result<PatchDashboardLayoutResponse>.Success(new PatchDashboardLayoutResponse
        {
            DashboardId = dashboard.DashboardId,
            Message = "Layout updated successfully."
        });
    }
}
