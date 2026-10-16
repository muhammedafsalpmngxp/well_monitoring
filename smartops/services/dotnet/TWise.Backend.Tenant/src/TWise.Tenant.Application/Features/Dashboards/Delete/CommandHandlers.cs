using MediatR;
using Microsoft.Extensions.Logging;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Features.Dashboards;

public sealed class DeleteDashboardHandler(
    IDashboardRepository repo,
    ICurrentUserService currentUser,
    ILogger<DeleteDashboardHandler> logger) : IRequestHandler<DeleteDashboardCommand, Result>
{
    public async Task<Result> Handle(DeleteDashboardCommand cmd, CancellationToken ct)
    {
        logger.LogInformation("Soft deleting dashboard. DashboardId={DashboardId}", cmd.DashboardId);

        var dashboard = await repo.GetDashboardByIdAsync(cmd.DashboardId, ct);
        if (dashboard is null)
            return Result.NotFound($"Dashboard with ID {cmd.DashboardId} was not found. It may have already been deleted.");

        if (dashboard.Status == DashboardStatus.Deleted)
            return Result.Conflict("This dashboard has already been deleted.");

        // Ownership check: only the creator or an admin can delete
        var userId = currentUser.UserId ?? "system";
        var isAdmin = currentUser.Roles.Any(r => r.Equals("admin", StringComparison.OrdinalIgnoreCase));

        // Non-admin cannot delete published dashboards
        if (!isAdmin && dashboard.Status == DashboardStatus.Published)
            return Result.ValidationError("Published dashboards must be deactivated before they can be deleted.");

        if (!isAdmin && !string.Equals(dashboard.CreatedBy, userId, StringComparison.OrdinalIgnoreCase))
            return Result.Forbidden("You can only delete dashboards you created.");

        dashboard.Status = DashboardStatus.Deleted;
        dashboard.IsDeleted = true;
        dashboard.IsActive = false;
        dashboard.DeletedBy = userId;
        dashboard.ModifiedBy = userId;
        dashboard.ModifiedAt = DateTime.UtcNow;

        await repo.UpdateDashboardAsync(dashboard, ct);

        logger.LogInformation("Dashboard soft deleted. DashboardId={DashboardId}", cmd.DashboardId);

        return Result.Success();
    }
}
