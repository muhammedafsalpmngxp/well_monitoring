using System.Security.Claims;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Application.Features.Dashboards;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Infrastructure.Services;

public sealed class DashboardPermissionService(
    ICommentRepository comments,
    IDashboardRepository dashboards) : IDashboardPermissionService
{
    public async Task<Result> CheckCommentAccessAsync(ClaimsPrincipal user, char action, string? targetType,
        int targetId, long? commentId, CreateCommentRequest? create, CancellationToken ct)
    {
        if (user.Identity?.IsAuthenticated != true)
            return Result.Forbidden("An authenticated user is required.");

        var type = create?.TargetType ?? targetType;
        targetId = create?.TargetId ?? targetId;
        if (commentId is { } existingCommentId)
        {
            var comment = await comments.GetByIdAsync(existingCommentId, ct);
            type = comment?.TargetType;
            targetId = comment?.TargetId ?? 0;
        }
        if (create?.ParentCommentId is { } parentId)
        {
            var parent = await comments.GetByIdAsync(parentId, ct);
            if (parent is not null && string.Equals(parent.TargetType, "Dashboard", StringComparison.OrdinalIgnoreCase)
                && (!string.Equals(create.TargetType, parent.TargetType, StringComparison.OrdinalIgnoreCase)
                    || create.TargetId != parent.TargetId))
                return Result.ValidationError("Reply target must match its parent comment.");
        }
        if (!string.Equals(type, "Dashboard", StringComparison.OrdinalIgnoreCase))
            return Result.Success();

        if (!ModulePermission.Has(user, ModulePermission.DashboardComments, ModulePermission.View)
            || !ModulePermission.Has(user, ModulePermission.DashboardComments, action))
            return Result.Forbidden("You do not have permission to access dashboard comments.");

        if (!ModulePermission.Has(user, ModulePermission.DashboardVersions, ModulePermission.View))
        {
            var dashboard = await dashboards.GetDashboardByIdAsync(targetId, ct);
            var latest = dashboard is null ? null
                : await dashboards.GetLatestVersionAsync(dashboard.DashboardSeriesId, ct);
            if (latest is null || latest.DashboardId != targetId || latest.IsDeleted
                || !latest.IsActive || latest.Status != DashboardStatus.Published)
                return Result.Forbidden("Comments are available only on the latest published dashboard version.");
        }
        return Result.Success();
    }

    public async Task<Result<DashboardVersionAccess>> ResolveVersionAccessAsync(ClaimsPrincipal user,
        int dashboardId, bool isHistoryRequest, CancellationToken ct)
    {
        if (user.Identity?.IsAuthenticated != true)
            return Result<DashboardVersionAccess>.Forbidden("An authenticated user is required.");

        if (ModulePermission.Has(user, ModulePermission.DashboardVersions, ModulePermission.View))
            return Result<DashboardVersionAccess>.Success(new(dashboardId));

        var dashboard = await dashboards.GetDashboardByIdAsync(dashboardId, ct);
        if (dashboard is null)
            return Result<DashboardVersionAccess>.NotFound("Dashboard not found.");

        // Canvas authors open any canvas; a user who may only view Standard Canvases opens published ones only.
        if (DashboardKind.Of(dashboard.ConfigJson) == DashboardKind.Canvas)
            return ModulePermission.Has(user, ModulePermission.Canvas, ModulePermission.View)
                || (ModulePermission.Has(user, ModulePermission.StandardCanvases, ModulePermission.View)
                    && dashboard.Status == DashboardStatus.Published && dashboard.IsActive && !dashboard.IsDeleted)
                ? Result<DashboardVersionAccess>.Success(new(dashboardId))
                : Result<DashboardVersionAccess>.Forbidden("You do not have permission to open this canvas.");

        var userId = user.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? user.FindFirst("sub")?.Value;
        if (!isHistoryRequest && dashboard.VersionNo is null
            && dashboard.Status is DashboardStatus.Draft or DashboardStatus.Completed
            && !string.IsNullOrEmpty(userId) && dashboard.CreatedBy == userId
            && ModulePermission.Has(user, "dashboard.wip-boards", ModulePermission.View)
            && (ModulePermission.Has(user, "dashboard.wip-boards", ModulePermission.Create)
                || ModulePermission.Has(user, "dashboard.wip-boards", ModulePermission.Modify)))
            return Result<DashboardVersionAccess>.Success(new(dashboardId));

        var latest = await dashboards.GetLatestVersionAsync(dashboard.DashboardSeriesId, ct);
        if (latest is null || latest.IsDeleted || !latest.IsActive || latest.Status != DashboardStatus.Published)
            return Result<DashboardVersionAccess>.NotFound("No published version is available for this dashboard.");

        if (isHistoryRequest)
        {
            IReadOnlyList<DashboardVersionSummaryResponse> versions = [new()
            {
                DashboardId = latest.DashboardId,
                VersionNo = latest.VersionNo ?? 0,
                Status = latest.Status,
                IsLatestVersion = true,
                PublishedBy = latest.PublishedBy,
                ModifiedDate = latest.ModifiedAt
            }];
            return Result<DashboardVersionAccess>.Success(new(latest.DashboardId, versions));
        }
        return Result<DashboardVersionAccess>.Success(new(latest.DashboardId));
    }
}