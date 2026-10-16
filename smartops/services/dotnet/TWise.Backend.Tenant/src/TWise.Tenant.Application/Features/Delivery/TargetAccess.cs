using System.Linq.Expressions;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Features.Delivery;

/// <summary>
/// Which items a user may send on a schedule: the read rules of the item pages. A report is read by its creator or once
/// published (ReportRepository.GetByIdForReadAsync); a dashboard or canvas the same way (its WIP list is the creator's
/// own, the standard list shows published ones). Checked for the caller when a schedule is saved or tested, and for
/// the owner at every run.
/// </summary>
// ponytail: a WIP dashboard or canvas shared internally with a user (ConfigJson sharedWithUserIds) is not readable here;
// read that marker too if users ask to schedule items shared with them.
public static class TargetAccess
{
    public static Expression<Func<Report, bool>> Reports(long tenantId, long userId)
        => r => r.TenantId == tenantId && !r.IsDeleted && (r.CreatedBy == userId || r.Status == "published");

    public static Expression<Func<Dashboard, bool>> Boards(long userId)
    {
        var id = userId.ToString(System.Globalization.CultureInfo.InvariantCulture);
        return d => !d.IsDeleted && (d.CreatedBy == id || d.Status == DashboardStatus.Published);
    }
}
